#!/usr/bin/env node
// swipe: command-line client for the Swipe List API.
// Every command prints JSON on stdout. Failures print the API error JSON on
// stderr and exit non-zero.
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Command, Option } from "commander";
import { version } from "../../package.json";
import { ApiError, CONFIG_PATH, loadConfig, request, serverOrigin, type Config, type Query } from "../client/api.ts";

const call = async (method: string, route: string, opts: { query?: Query; json?: unknown; form?: FormData } = {}) =>
  request(await loadConfig(), method, route, opts);

function print(value: unknown) {
  if (value !== null && value !== undefined) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const STATUSES = ["queued", "processing", "done", "failed"];
const MEDIA = ["upload", "image", "video", "thumbnail", "screenshot"];

interface Asset {
  id: number;
  role: string;
  content_type: string;
  url: string;
  position: number;
}

const program = new Command("swipe")
  .description("Swipe List: your saved design and video inspiration. All output is JSON.")
  .version(version)
  .showHelpAfterError();

program
  .command("login")
  .description("store the server URL and your credential; the credential is read from stdin or prompted for")
  .requiredOption("--url <url>", "server URL, e.g. https://swipe-api.example.com")
  .action(async (opts: { url: string }) => {
    const url = serverOrigin(opts.url);
    let token: string;
    if (process.stdin.isTTY) {
      process.stderr.write("Credential (input hidden): ");
      const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
      const rl = createInterface({ input: process.stdin, output: silent, terminal: true });
      const cancel = new AbortController();
      rl.once("SIGINT", () => cancel.abort());
      try {
        token = await rl.question("", { signal: cancel.signal });
      } finally {
        rl.close();
        process.stderr.write("\n");
      }
    } else {
      token = await readStdin();
    }
    token = token.trim();
    if (!token.startsWith("swl_")) throw new ApiError("credentials start with swl_", null);
    const config: Config = { url, token };
    const me = await request(config, "GET", "/me");
    await mkdir(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
    const temp = await mkdtemp(path.join(path.dirname(CONFIG_PATH), ".login-"));
    try {
      const file = path.join(temp, "config.json");
      await writeFile(file, JSON.stringify(config, null, 2), { mode: 0o600 });
      await rename(file, CONFIG_PATH);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
    print({ logged_in: true, url: config.url, config: CONFIG_PATH, ...(me as object) });
  });

program
  .command("logout")
  .description("forget the stored credential")
  .action(async () => {
    await rm(CONFIG_PATH, { force: true });
    print({ logged_in: false });
  });

program.command("whoami").description("show which credential you are using").action(async () => print(await call("GET", "/me")));

program
  .command("add <url>")
  .description("queue a link; the worker on your Mac pulls its media and describes it")
  .option("--note <text>", "what to pull and what you like about it, in your words")
  .action(async (url, o) => print(await call("POST", "/items", { json: { url, note: o.note ?? "" } })));

program
  .command("upload <files...>")
  .description("upload images (JPEG, PNG, WebP, GIF) as one item; the worker describes and tags them")
  .option("--note <text>", "what you like about it, in your words")
  .action(async (files: string[], o) => {
    const form = new FormData();
    for (const file of files) {
      const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
      if (!type) throw new ApiError(`${file} is not a JPEG, PNG, WebP or GIF image`, null);
      const bytes = await readFile(file).catch((error: Error) => {
        throw new ApiError(`cannot read ${file}: ${error.message}`, null);
      });
      form.append("file", new Blob([bytes], { type }), path.basename(file));
    }
    if (o.note) form.append("note", o.note);
    print(await call("POST", "/items/upload", { form }));
  });

program
  .command("search [query]")
  .description("search the library (title, your note, description, tags, author, page text), best match first")
  .addOption(new Option("--status <status>").choices(STATUSES))
  .option("--tag <tag>")
  .addOption(new Option("--media <role>", "only items with this kind of file").choices(MEDIA))
  .option("--limit <n>", "default 50, max 200")
  .option("--offset <n>")
  .action(async (q, o) =>
    print(await call("GET", "/items", { query: { q, status: o.status, tag: o.tag, media: o.media, limit: o.limit, offset: o.offset } })),
  );

program.command("show <id>").description("an item with every file (URLs are valid for one hour)").action(async (id) => print(await call("GET", `/items/${id}`)));

program.command("tags").description("every tag in use, with counts").action(async () => print(await call("GET", "/tags")));

program
  .command("download <id>")
  .description("download an item's files into a directory")
  .requiredOption("--dir <path>")
  .addOption(new Option("--role <role>", "only files with this role").choices(MEDIA))
  .action(async (id, o) => {
    const item = (await call("GET", `/items/${id}`)) as { assets: Asset[] };
    await mkdir(o.dir, { recursive: true });
    const saved = [];
    for (const asset of item.assets.filter((a) => !o.role || a.role === o.role)) {
      const res = await fetch(asset.url);
      if (!res.ok || !res.body) throw new ApiError(`downloading asset ${asset.id} failed with ${res.status}`, res.status);
      const name = path.basename(new URL(asset.url).pathname);
      const file = path.join(o.dir, `${asset.position}-${asset.role}-${name.replace(/^[0-9a-f-]{36}-/, "")}`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
      saved.push({ asset_id: asset.id, role: asset.role, content_type: asset.content_type, path: path.resolve(file) });
    }
    print({ item_id: Number(id), saved });
  });

program.command("retry <id>").description("queue a done or failed item to be processed again").action(async (id) => print(await call("POST", `/items/${id}/retry`)));

program
  .command("delete <id>")
  .description("delete an item and all of its files")
  .action(async (id) => print((await call("DELETE", `/items/${id}`)) ?? { deleted: Number(id) }));

program
  .command("audit")
  .description("who changed what")
  .option("--object-id <id>", "an item id")
  .option("--limit <n>")
  .action(async (o) => print(await call("GET", "/audit", { query: { object_type: o.objectId ? "item" : undefined, object_id: o.objectId, limit: o.limit } })));

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof ApiError) {
    process.stderr.write(`${JSON.stringify({ error: error.message, response: error.payload }, null, 2)}\n`);
    process.exit(1);
  }
  throw error;
}
