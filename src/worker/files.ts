// File handling for the ingestion worker. Codex runs with the owner's privileges on
// content from the open web, so everything it leaves behind (the manifest, the paths it
// lists, the files under out/) is untrusted input. This module owns the checks that keep
// a run inside its own directory and keep diagnostics on this Mac:
//
// - run directories are private to the owner (0700) and files the worker writes are 0600;
// - a listed file is opened without following links, verified on the open handle, and
//   uploaded from that same handle, so it cannot be swapped after the check;
// - a failure carries a fixed `report` for the API and a `detail` that only goes to the
//   local log.
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { matchesMediaType } from "../server/domain/media.ts";

/** Matches the server's limit on one stored file. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
/** Matches the server's limit on files per run. */
export const MAX_ASSETS = 50;
/** Matches the server's limit on one image the owner uploads. */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 1024 * 1024;

const NO_FOLLOW_READ = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};
const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};
export const CONTENT_TYPES: Record<string, string> = { ...IMAGE_TYPES, ...VIDEO_TYPES };
const MEDIA_TYPES = [...new Set(Object.values(CONTENT_TYPES))];
/** How much of a file the server reads to check its signature. */
const SIGNATURE_BYTES = 512;

/**
 * A run that should be recorded as failed. `report` is sent to the API and printed, so
 * it is always a fixed sentence (plus numbers the worker chose). `detail` may hold
 * subprocess output, manifest text or file names and is written only to the run's log.
 */
export class RunFailure extends Error {
  constructor(
    readonly report: string,
    readonly detail = "",
  ) {
    super(report);
  }
}

const code = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code ?? "";

/** Creates `dir` if needed and insists it is a real directory owned by, and private to, this user. */
export async function ensurePrivateDir(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory()) throw new Error(`${dir} must be a directory, not a link or a file`);
  if (info.uid !== process.getuid!()) throw new Error(`${dir} belongs to another user`);
  await chmod(dir, 0o700);
}

export interface RunDir {
  /** Private to the worker: holds the logs. */
  root: string;
  /** Codex's working directory, with `out/` and `inputs/`. */
  job: string;
}

/** Makes the private directory for one run. Fails if it already exists. */
export async function createRunDir(workRoot: string, itemId: number, runId: string): Promise<RunDir> {
  if (!Number.isSafeInteger(itemId) || itemId < 0) throw new RunFailure("the server sent an item id the worker cannot use");
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new RunFailure("the server sent a run id the worker cannot use");
  await ensurePrivateDir(path.dirname(workRoot));
  await ensurePrivateDir(workRoot);
  const root = path.join(workRoot, `${itemId}-${runId}`);
  const job = path.join(root, "job");
  for (const dir of [root, job, path.join(job, "out"), path.join(job, "inputs")]) await mkdir(dir, { mode: 0o700 });
  return { root, job };
}

/** Writes a new owner-only file. Fails if anything, including a link, is already at `file`. */
export async function writePrivateFile(file: string, data: string | Uint8Array) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}

/** Appends to an owner-only log, creating it if needed and never following a link. */
export async function appendPrivateLog(file: string, text: string) {
  const handle = await open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(text);
  } finally {
    await handle.close();
  }
}

/** The local name for the owner's `index`th uploaded image: the worker's own, with the upload's extension. */
export function inputName(index: number, filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (!IMAGE_TYPES[ext]) throw new RunFailure(`upload ${index + 1} is not an image type the worker takes`);
  return `upload-${index + 1}${ext}`;
}

/** Streams `body` into a new owner-only file, stopping the run if it passes `limit` bytes. */
export async function saveBounded(body: AsyncIterable<Uint8Array>, file: string, limit: number, tooLarge: RunFailure) {
  const handle = await open(file, "wx", 0o600);
  try {
    let written = 0;
    for await (const chunk of body) {
      written += chunk.byteLength;
      if (written > limit) throw tooLarge;
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
}

/** Reads the whole of a regular file of at most `limit` bytes, without following a link at `file`. */
export async function readBounded(file: string, limit: number): Promise<string | null> {
  let handle: FileHandle;
  try {
    handle = await open(file, NO_FOLLOW_READ);
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) return null;
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

/** The accepted media type whose container signature `head` carries, by the server's own rules, or null. */
export function sniffMedia(head: Uint8Array): string | null {
  return MEDIA_TYPES.find((type) => matchesMediaType(head, type)) ?? null;
}

export interface VerifiedFile {
  /** Open on the verified file. The caller uploads from it and closes it. */
  handle: FileHandle;
  /** The file's own name, for the storage key. */
  name: string;
  size: number;
  mtimeMs: number;
  contentType: string;
}

/**
 * Opens the `number`th file Codex listed and verifies it on the open handle: a regular,
 * singly linked, non-empty media file of an accepted type that really lives under
 * `job/out`. Neither the file nor a directory on the way to it may be a link out of
 * `out/`, and a hard link to a file elsewhere is refused.
 */
export async function openListedFile(job: string, listed: string, number: number): Promise<VerifiedFile> {
  const fail = (what: string) => new RunFailure(`file ${number} in codex's answer ${what}`, `listed as ${JSON.stringify(listed)}`);
  const out = path.join(job, "out");
  const candidate = path.resolve(job, listed);
  if (listed.includes("\0") || !candidate.startsWith(out + path.sep)) throw fail("is not inside out/");
  const ext = path.extname(candidate).toLowerCase();
  if (!CONTENT_TYPES[ext]) throw fail("is not an accepted media type");

  let handle: FileHandle;
  try {
    handle = await open(candidate, NO_FOLLOW_READ);
  } catch (error) {
    throw fail(code(error) === "ELOOP" ? "is a link, not a file" : "does not exist or cannot be read");
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw fail("is not a regular file");
    if (info.nlink !== 1) throw fail("is hard-linked to another file");
    if (info.size === 0) throw fail("is empty");
    if (info.size > MAX_ASSET_BYTES) throw fail("is larger than 2 GB");

    // The path the handle was opened through must resolve, links and all, to this same
    // file under the real out/. With a single hard link, that pins the handle to out/.
    const realOut = path.join(await realpath(job), "out");
    const real = await realpath(candidate).catch(() => "");
    if (!real.startsWith(realOut + path.sep)) throw fail("is not inside out/");
    const onDisk = await lstat(real).catch(() => null);
    if (!onDisk || onDisk.dev !== info.dev || onDisk.ino !== info.ino) throw fail("changed while it was being checked");

    const head = new Uint8Array(SIGNATURE_BYTES);
    const { bytesRead } = await handle.read(head, 0, head.byteLength, 0);
    const contentType = sniffMedia(head.subarray(0, bytesRead));
    if (!contentType) throw fail("does not contain an accepted media format");
    if (contentType.startsWith("image/") !== Boolean(IMAGE_TYPES[ext])) throw fail("holds a different kind of media than its name says");
    return { handle, name: path.basename(real), size: info.size, mtimeMs: info.mtimeMs, contentType };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** Opens and verifies every listed file, in order. Closes what it opened if one is refused. */
export async function openListedFiles(job: string, listed: string[]): Promise<VerifiedFile[]> {
  if (listed.length > MAX_ASSETS) throw new RunFailure(`codex's answer lists more than ${MAX_ASSETS} files`);
  const files: VerifiedFile[] = [];
  try {
    for (const [index, file] of listed.entries()) files.push(await openListedFile(job, file, index + 1));
    return files;
  } catch (error) {
    await closeFiles(files);
    throw error;
  }
}

export async function closeFiles(files: VerifiedFile[]) {
  await Promise.all(files.map((file) => file.handle.close().catch(() => {})));
}

/** Fails the run if the file behind `file.handle` was written to after it was verified. */
export async function assertUnchanged(file: VerifiedFile, number: number) {
  const now = await file.handle.stat();
  if (now.size !== file.size || now.mtimeMs !== file.mtimeMs) {
    throw new RunFailure(`file ${number} in codex's answer changed while it was being uploaded`);
  }
}
