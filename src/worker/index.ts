// Ingestion worker. Runs on the owner's Mac from Koyomi (`npm run worker`): claims queued
// items one at a time until the queue is empty, has Codex pull and describe each one
// in an empty working directory, uploads the files Codex lists, and completes or fails
// the item. Exits 1 if any item failed, so Koyomi emails an alert.
//
// Codex decides what to pull (src/worker/instructions.md). This script owns
// everything that must be exact: the claim, the file checks, uploads and status.
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ApiError, loadConfig, request, type Config } from "../client/api.ts";
import {
  appendPrivateLog,
  assertUnchanged,
  closeFiles,
  createRunDir,
  inputName,
  MAX_INPUT_BYTES,
  MAX_MANIFEST_BYTES,
  openListedFiles,
  readBounded,
  RunFailure,
  saveBounded,
  writePrivateFile,
  type RunDir,
  type VerifiedFile,
} from "./files.ts";

const WORK_ROOT = path.join(os.homedir(), ".swipe-list", "work");
const HERE = import.meta.dirname;
/** Kept under the server's 45-minute lease. */
const CODEX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_ITEMS_PER_RUN = 20;

/** What the API is told when Codex gives up. Codex's own words stay in the run's log. */
const CODEX_FAILURES = {
  not_found: "Codex reported that the content no longer exists or the link is wrong.",
  login_required: "Codex reported that the content is private or behind a login it could not pass.",
  blocked: "Codex reported that the site blocked it.",
  nothing_to_keep: "Codex reported that nothing worth keeping could be pulled from the link.",
  other: "Codex reported that it could not collect this item.",
} as const;

const Manifest = z.object({
  status: z.enum(["ok", "failed"]),
  error_kind: z.enum(["none", "not_found", "login_required", "blocked", "nothing_to_keep", "other"]),
  error: z.string(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  author: z.string(),
  extracted_text: z.string(),
  assets: z.array(
    z.object({
      file: z.string(),
      role: z.enum(["image", "video", "thumbnail", "screenshot"]),
      source_url: z.string(),
      caption: z.string(),
    }),
  ),
});
type Manifest = z.infer<typeof Manifest>;

interface Claim {
  run_id: string;
  item: { id: number; kind: "link" | "upload"; url: string | null; note: string };
  uploads: { asset_id: number; filename: string; url: string }[];
}

/** Printed lines reach Koyomi's run log and its alert email, so they carry no item content. */
const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`);

function runCodex(run: RunDir, prompt: string, images: string[]): Promise<void> {
  const args = [
    "exec",
    "--cd", run.job,
    "--skip-git-repo-check",
    "--ephemeral",
    // Full access: Codex drives the owner's real Chrome, which a sandboxed run cannot reach.
    "--sandbox", "danger-full-access",
    "-c", "approval_policy=\"never\"",
    "--output-schema", path.join(HERE, "manifest.schema.json"),
    "--output-last-message", path.join(run.job, "manifest.json"),
    ...images.flatMap((image) => ["--image", image]),
    "-",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd: run.job,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SWIPE_TOOLS: path.join(HERE, "tools") },
    });
    let output = "";
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-20_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGTERM"), CODEX_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new RunFailure("codex could not be started", error.message));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      // Codex's output stays in the run's private directory and is never sent anywhere.
      writePrivateFile(path.join(run.root, "codex.log"), output).then(() => {
        if (signal) reject(new RunFailure(`codex was stopped (${signal}) after ${CODEX_TIMEOUT_MS / 60_000} minutes`));
        else if (code !== 0) reject(new RunFailure(`codex exited with code ${code}`));
        else resolve();
      }, reject);
    });
    child.stdin.end(prompt);
  });
}

async function download(url: string, file: string, number: number) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new RunFailure(`downloading upload ${number} failed with ${res.status}`);
  const tooLarge = new RunFailure(`upload ${number} is larger than ${MAX_INPUT_BYTES / 1024 / 1024} MB`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_INPUT_BYTES) throw tooLarge;
  await saveBounded(res.body, file, MAX_INPUT_BYTES, tooLarge);
}

async function readManifest(run: RunDir): Promise<Manifest> {
  const text = await readBounded(path.join(run.job, "manifest.json"), MAX_MANIFEST_BYTES);
  if (text === null) throw new RunFailure("codex finished without writing a usable answer");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RunFailure("codex's answer was not valid JSON");
  }
  const parsed = Manifest.safeParse(json);
  if (!parsed.success) throw new RunFailure("codex's answer did not match the manifest schema", parsed.error.message);
  return parsed.data;
}

/** Sends the verified file's bytes from its open handle, so what was checked is what is stored. */
async function put(url: string, file: VerifiedFile, number: number) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers: { "content-type": file.contentType, "content-length": String(file.size) },
      body: file.handle.createReadStream({ start: 0, end: file.size - 1, autoClose: false }) as never,
      duplex: "half",
    } as RequestInit);
  } catch (error) {
    throw new RunFailure(`uploading file ${number} did not finish`, (error as Error).message);
  }
  if (!res.ok) throw new RunFailure(`uploading file ${number} failed with ${res.status}`, await res.text().catch(() => ""));
  await assertUnchanged(file, number);
}

async function processItem(config: Config, claim: Claim, run: RunDir) {
  const { item, run_id } = claim;
  const images: string[] = [];
  for (const [index, upload] of claim.uploads.entries()) {
    const file = path.join(run.job, "inputs", inputName(index, upload.filename));
    await download(upload.url, file, index + 1);
    images.push(file);
  }
  const { tags } = await request<{ tags: { tag: string }[] }>(config, "GET", "/tags");
  const instructions = await readFile(path.join(HERE, "instructions.md"), "utf8");
  const prompt = [
    instructions,
    "## Existing tags",
    tags.length ? tags.map((t) => t.tag).join(", ") : "(none yet)",
    "## The item",
    JSON.stringify({ kind: item.kind, url: item.url, note: item.note, uploads: images.map((f) => path.relative(run.job, f)) }, null, 2),
  ].join("\n\n");

  log(`item ${item.id}: running codex in ${run.job}`);
  await runCodex(run, prompt, images);
  const manifest = await readManifest(run);
  if (manifest.status === "failed") {
    const kind = manifest.error_kind === "none" ? "other" : manifest.error_kind;
    throw new RunFailure(`${CODEX_FAILURES[kind]} Its full reason is in the worker's log on the Mac.`, manifest.error);
  }

  const files = await openListedFiles(run.job, manifest.assets.map((asset) => asset.file));
  const keys: string[] = [];
  try {
    if (files.length) {
      const { uploads } = await request<{ uploads: { key: string; url: string }[] }>(config, "POST", `/items/${item.id}/uploads`, {
        json: { run_id, files: files.map((f) => ({ name: f.name, content_type: f.contentType })) },
      });
      for (const [index, file] of files.entries()) {
        await put(uploads[index]!.url, file, index + 1);
        keys.push(uploads[index]!.key);
      }
    }
  } finally {
    await closeFiles(files);
  }
  await request(config, "POST", `/items/${item.id}/complete`, {
    json: {
      run_id,
      title: manifest.title,
      description: manifest.description,
      tags: manifest.tags,
      author: manifest.author,
      extracted_text: manifest.extracted_text,
      assets: manifest.assets.map((asset, index) => ({
        key: keys[index],
        role: asset.role,
        source_url: asset.source_url || null,
        caption: asset.caption,
      })),
    },
  });
  await rm(run.root, { recursive: true, force: true });
  log(`item ${item.id}: done, ${files.length} file(s)`);
}

/** The fixed sentence the API and the printed log get for a failure. Anything else about it stays local. */
function failureReport(error: unknown): string {
  if (error instanceof RunFailure) return error.report;
  if (error instanceof ApiError) {
    return error.status === null ? "the worker could not reach the server" : `the server refused a worker request with ${error.status}`;
  }
  return "the worker hit an unexpected error; details are in its log on the Mac";
}

/** Everything known about a failure, for the run's private log only. */
function failureDetail(error: unknown): string {
  if (error instanceof RunFailure) return `${error.report}\n${error.detail}`;
  if (error instanceof ApiError) return `${error.message}\n${JSON.stringify(error.payload ?? null)}`;
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

const config = await loadConfig();
let failed = 0;
for (let n = 0; n < MAX_ITEMS_PER_RUN; n++) {
  const claim = await request<Claim | null>(config, "POST", "/queue/claim");
  if (!claim) break;
  log(`item ${claim.item.id}: claimed (${claim.item.kind})`);
  let run: RunDir | null = null;
  try {
    run = await createRunDir(WORK_ROOT, claim.item.id, claim.run_id);
    await processItem(config, claim, run);
  } catch (error) {
    failed++;
    const report = failureReport(error);
    if (run) await appendPrivateLog(path.join(run.root, "worker.log"), `[${new Date().toISOString()}] ${failureDetail(error)}\n`);
    log(`item ${claim.item.id}: failed: ${report}${run ? ` (logs kept in ${run.root})` : ""}`);
    await request(config, "POST", `/items/${claim.item.id}/fail`, { json: { run_id: claim.run_id, error: report } });
  }
}
log(failed ? `${failed} item(s) failed` : "queue empty");
process.exitCode = failed ? 1 : 0;
