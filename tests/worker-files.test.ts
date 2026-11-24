// The worker's file checks, against fixtures in a temporary directory. No server or database.
import { link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendPrivateLog,
  assertUnchanged,
  closeFiles,
  createRunDir,
  inputName,
  openListedFile,
  openListedFiles,
  readBounded,
  RunFailure,
  saveBounded,
  sniffMedia,
  writePrivateFile,
  type RunDir,
} from "../src/worker/files.ts";

const RUN_ID = "0b0e4a52-6c6e-4d1c-9d3e-0a4b6f1c2d3e";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const MP4 = Uint8Array.from("\0\0\0\x18ftypisom\0\0\0\0isommp42", (c) => c.charCodeAt(0));
const NOTE = "not media, and not for the API";

let base: string;
let run: RunDir;
/** A file outside the run that must never be uploaded or named in a report. */
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "swipe-worker-"));
  run = await createRunDir(path.join(base, "home", "work"), 7, RUN_ID);
  outside = path.join(base, "outside-notes.png");
  await writeFile(outside, NOTE);
});
afterEach(() => rm(base, { recursive: true, force: true }));

const mode = async (file: string) => (await stat(file)).mode & 0o777;

async function refusal(listed: string): Promise<RunFailure> {
  const error = await openListedFile(run.job, listed, 1).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RunFailure);
  return error as RunFailure;
}

describe("run directories", () => {
  it("are private to the owner", async () => {
    for (const dir of [path.dirname(run.root), run.root, run.job, path.join(run.job, "out"), path.join(run.job, "inputs")]) {
      expect(await mode(dir)).toBe(0o700);
    }
  });

  it("are never reused and take only a server-shaped run id", async () => {
    await expect(createRunDir(path.join(base, "home", "work"), 7, RUN_ID)).rejects.toThrow();
    await expect(createRunDir(path.join(base, "home", "work"), 7, "../escape")).rejects.toBeInstanceOf(RunFailure);
  });

  it("refuse a work root that is a link", async () => {
    await symlink(base, path.join(base, "linked"));
    await expect(createRunDir(path.join(base, "linked"), 8, RUN_ID)).rejects.toThrow(/must be a directory/);
  });

  it("hold logs only the owner can read, and do not write through a link", async () => {
    const codexLog = path.join(run.root, "codex.log");
    await writePrivateFile(codexLog, "output");
    expect(await mode(codexLog)).toBe(0o600);
    await expect(writePrivateFile(codexLog, "again")).rejects.toThrow();

    await symlink(outside, path.join(run.root, "worker.log"));
    await expect(appendPrivateLog(path.join(run.root, "worker.log"), "detail")).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe(NOTE);
  });
});

describe("listed files", () => {
  it("accepts media in out/ and types it by content", async () => {
    await mkdir(path.join(run.job, "out", "shots"));
    await writeFile(path.join(run.job, "out", "x-1.jpg"), PNG);
    await writeFile(path.join(run.job, "out", "shots", "hero.png"), PNG);
    await writeFile(path.join(run.job, "out", "clip.mp4"), MP4);
    const files = await openListedFiles(run.job, ["out/x-1.jpg", "out/shots/hero.png", "./out/clip.mp4"]);
    expect(files.map((f) => [f.name, f.contentType, f.size])).toEqual([
      ["x-1.jpg", "image/png", PNG.byteLength],
      ["hero.png", "image/png", PNG.byteLength],
      ["clip.mp4", "video/mp4", MP4.byteLength],
    ]);
    await closeFiles(files);
  });

  it("refuses paths that leave out/", async () => {
    await writeFile(path.join(run.job, "inputs", "upload-1.png"), PNG);
    for (const listed of ["../../outside-notes.png", outside, "inputs/upload-1.png", "out/../inputs/upload-1.png", "out"]) {
      expect((await refusal(listed)).report).toMatch(/not inside out\/|not an accepted media type/);
    }
  });

  it("refuses a link to a file elsewhere, by name or through a directory", async () => {
    await symlink(outside, path.join(run.job, "out", "linked.png"));
    expect((await refusal("out/linked.png")).report).toMatch(/is a link/);

    await symlink(base, path.join(run.job, "out", "dir"));
    expect((await refusal("out/dir/outside-notes.png")).report).toMatch(/not inside out\//);

    await link(outside, path.join(run.job, "out", "hard.png"));
    expect((await refusal("out/hard.png")).report).toMatch(/hard-linked/);
  });

  it("refuses empty files, other formats and missing files", async () => {
    await writeFile(path.join(run.job, "out", "empty.png"), "");
    await writeFile(path.join(run.job, "out", "notes.png"), NOTE);
    await writeFile(path.join(run.job, "out", "clip.mp4"), JPEG);
    await writeFile(path.join(run.job, "out", "notes.txt"), NOTE);
    expect((await refusal("out/empty.png")).report).toMatch(/is empty/);
    expect((await refusal("out/notes.png")).report).toMatch(/accepted media format/);
    expect((await refusal("out/clip.mp4")).report).toMatch(/different kind of media/);
    expect((await refusal("out/notes.txt")).report).toMatch(/accepted media type/);
    expect((await refusal("out/missing.png")).report).toMatch(/does not exist/);
  });

  it("keeps the listed path out of the report", async () => {
    const failure = await refusal("out/quarterly-plan-draft.png");
    expect(failure.report).toBe("file 1 in codex's answer does not exist or cannot be read");
    expect(failure.detail).toContain("quarterly-plan-draft");
  });

  it("reads from the file it verified after the path is replaced", async () => {
    const listed = path.join(run.job, "out", "a.png");
    await writeFile(listed, PNG);
    const [file] = await openListedFiles(run.job, ["out/a.png"]);
    await rm(listed);
    await symlink(outside, listed);
    const { buffer, bytesRead } = await file!.handle.read(new Uint8Array(PNG.byteLength), 0, PNG.byteLength, 0);
    expect(buffer.subarray(0, bytesRead)).toEqual(PNG);
    await assertUnchanged(file!, 1);
    await closeFiles([file!]);
  });

  it("notices a file rewritten after it was verified", async () => {
    const listed = path.join(run.job, "out", "a.png");
    await writeFile(listed, PNG);
    const [file] = await openListedFiles(run.job, ["out/a.png"]);
    await writeFile(listed, new Uint8Array([...PNG, 1, 2, 3]));
    await expect(assertUnchanged(file!, 1)).rejects.toBeInstanceOf(RunFailure);
    await closeFiles([file!]);
  });

  it("limits how many files one answer lists", async () => {
    await expect(openListedFiles(run.job, Array.from({ length: 51 }, () => "out/a.png"))).rejects.toThrow(/more than 50/);
  });
});

describe("inputs and bounded reads", () => {
  it("names uploads itself", () => {
    expect(inputName(0, "0-My Shot.PNG")).toBe("upload-1.png");
    expect(() => inputName(1, "../../.zshrc")).toThrow(RunFailure);
  });

  it("stops a download at its limit", async () => {
    async function* chunks() {
      yield new Uint8Array(6);
      yield new Uint8Array(6);
    }
    const tooLarge = new RunFailure("upload 1 is too large");
    const file = path.join(run.job, "inputs", "upload-1.png");
    await expect(saveBounded(chunks(), file, 10, tooLarge)).rejects.toBe(tooLarge);
    await saveBounded(chunks(), path.join(run.job, "inputs", "upload-2.png"), 12, tooLarge);
    expect(await mode(path.join(run.job, "inputs", "upload-2.png"))).toBe(0o600);
  });

  it("reads a manifest only when it is a small regular file", async () => {
    const manifest = path.join(run.job, "manifest.json");
    expect(await readBounded(manifest, 100)).toBeNull();
    await writeFile(manifest, "{}");
    expect(await readBounded(manifest, 100)).toBe("{}");
    expect(await readBounded(manifest, 1)).toBeNull();
    await rm(manifest);
    await symlink(outside, manifest);
    expect(await readBounded(manifest, 100)).toBeNull();
  });

  it("recognises the library's formats by their first bytes", () => {
    const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
    expect(sniffMedia(JPEG)).toBe("image/jpeg");
    expect(sniffMedia(bytes("GIF89a..."))).toBe("image/gif");
    expect(sniffMedia(bytes("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffMedia(bytes("\0\0\0\x1cftypavif\0\0\0\0avifmif1"))).toBe("image/avif");
    expect(sniffMedia(bytes("\0\0\0\x14ftypqt  \0\0\0\0qt  "))).toBe("video/quicktime");
    expect(sniffMedia(bytes("\0\0\0\x18ftypheic\0\0\0\0mif1heic"))).toBeNull();
    expect(sniffMedia(bytes("\x1a\x45\xdf\xa3\x9f\x42\x82\x84webm"))).toBe("video/webm");
    expect(sniffMedia(bytes("<!doctype html>"))).toBeNull();
    expect(sniffMedia(new Uint8Array())).toBeNull();
  });
});
