import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { authenticate, type OwnerVerifier } from "./auth.ts";
import type { Sql, Tx } from "./db.ts";
import { listAudit, type Actor } from "./domain/actor.ts";
import { listCredentials } from "./domain/credentials.ts";
import * as items from "./domain/items.ts";
import * as queue from "./domain/queue.ts";
import { AppError } from "./errors.ts";
import type { Storage } from "./storage.ts";

type Vars = { Variables: { actor: Actor } };

export interface AppDeps {
  sql: Sql;
  storage: Storage;
  verifyOwner: OwnerVerifier;
  /** The dashboard's address, returned by `GET /me`. */
  dashboardUrl: string;
}

function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      400,
      "bad_request",
      "request did not match the expected shape",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

async function body(c: Context) {
  try {
    return await c.req.json();
  } catch {
    throw new AppError(400, "bad_request", "request body must be JSON");
  }
}

const id = z.coerce.number().int().positive();
const param = (c: Context, name: string) => parse(id, c.req.param(name));

/** Postgres errors that mean "your request conflicts with the library", not "the server broke". */
function fromPostgres(error: unknown): AppError | null {
  const e = error as { code?: string; message?: string; detail?: string };
  if (e.code === "23505") return new AppError(409, "conflict", e.detail ?? e.message ?? "duplicate value");
  if (e.code === "23503") return new AppError(409, "conflict", e.detail ?? e.message ?? "referenced record is in use");
  if (e.code === "23514") return new AppError(422, "invalid", e.message ?? "rejected by a database check");
  return null;
}

export function createApi(deps: AppDeps) {
  const { sql, storage, verifyOwner, dashboardUrl } = deps;
  const tx = <T>(fn: (db: Tx) => Promise<T>) => sql.begin(fn) as Promise<T>;
  const api = new Hono<Vars>();

  api.onError((error, c) => {
    const appError = error instanceof AppError ? error : fromPostgres(error);
    if (appError) {
      return c.json({ error: { code: appError.code, message: appError.message, details: appError.details } }, appError.status);
    }
    console.error(error);
    return c.json({ error: { code: "internal", message: "internal server error" } }, 500);
  });
  api.notFound((c) => c.json({ error: { code: "not_found", message: `no route ${c.req.method} ${c.req.path}` } }, 404));

  api.use("*", async (c, next) => {
    c.set("actor", await authenticate(sql, c.req.header("authorization"), verifyOwner));
    await next();
  });
  // JSON bodies are limited; image uploads get their own limit.
  const limit = (mb: number) =>
    bodyLimit({
      maxSize: mb * 1024 * 1024,
      onError: () => {
        throw new AppError(422, "invalid", `request bodies here are limited to ${mb} MB`);
      },
    });
  const jsonLimit = limit(4);
  const uploadLimit = limit((items.MAX_UPLOAD_BYTES * items.MAX_UPLOAD_FILES) / 1024 / 1024 + 1);
  api.use("*", (c, next) => (c.req.method === "POST" && c.req.path.endsWith("/items/upload") ? uploadLimit(c, next) : jsonLimit(c, next)));

  const actor = (c: Context<Vars>) => c.get("actor");
  const ownerOnly = (c: Context<Vars>) => {
    if (actor(c).kind !== "owner") throw new AppError(403, "owner_only", "only the owner can do this, from the dashboard");
  };
  const workerOnly = (c: Context<Vars>) => {
    const credential = actor(c);
    if (credential.kind !== "credential" || credential.permission !== "worker") throw new AppError(403, "worker_only", "only the ingestion worker's credential can do this");
    return credential;
  };
  const requireSubmitter = (c: Context<Vars>) => {
    const caller = actor(c);
    if (caller.kind !== "owner" && caller.permission !== "submitter") {
      throw new AppError(403, "submitter_only", "submitting work requires the owner or a credential created with --allow-submit");
    }
  };

  api.get("/me", (c) => c.json({ actor: actor(c), dashboard_url: dashboardUrl }));

  // ---------------------------------------------------------------- library
  api.get("/items", async (c) => c.json(await items.listItems(sql, storage, parse(items.ItemFilterSchema, c.req.query()))));
  api.get("/items/:id", async (c) => c.json(await items.getItem(sql, storage, param(c, "id"))));
  api.get("/tags", async (c) => c.json({ tags: await items.listTags(sql) }));

  api.post("/items", async (c) => {
    requireSubmitter(c);
    const input = parse(items.LinkCreateSchema, await body(c));
    return c.json(await tx((db) => items.createLink(db, actor(c), input)), 201);
  });
  api.post("/items/upload", async (c) => {
    requireSubmitter(c);
    const form = await c.req.formData().catch(() => {
      throw new AppError(400, "bad_request", "send multipart/form-data with one or more `file` fields and an optional `note`");
    });
    const files = await Promise.all(
      form
        .getAll("file")
        .filter((f): f is File => f instanceof File)
        .map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })),
    );
    const note = parse(items.NoteSchema, form.get("note") ?? undefined);
    return c.json(await tx((db) => items.createUpload(db, storage, actor(c), files, note)), 201);
  });
  api.post("/items/:id/retry", async (c) => {
    requireSubmitter(c);
    return c.json(await tx((db) => items.retryItem(db, actor(c), param(c, "id"))));
  });
  api.delete("/items/:id", async (c) => {
    const itemId = param(c, "id");
    await tx((db) => items.deleteItem(db, actor(c), itemId));
    await tx((db) => items.sweepItemFiles(db, storage, itemId));
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- queue (worker)
  api.post("/queue/claim", async (c) => {
    const worker = workerOnly(c);
    const claimed = await tx((db) => queue.claim(db, storage, worker));
    return claimed ? c.json(claimed) : c.body(null, 204);
  });
  api.post("/items/:id/uploads", async (c) => {
    const worker = workerOnly(c);
    const input = parse(queue.UploadRequestSchema, await body(c));
    return c.json(await tx((db) => queue.presignUploads(db, storage, worker, param(c, "id"), input)));
  });
  api.post("/items/:id/complete", async (c) => {
    const worker = workerOnly(c);
    const itemId = param(c, "id");
    const input = parse(queue.CompleteSchema, await body(c));
    const row = await tx((db) => queue.complete(db, storage, worker, itemId, input));
    await tx((db) => items.sweepItemFiles(db, storage, itemId));
    return c.json(row);
  });
  api.post("/items/:id/fail", async (c) => {
    const worker = workerOnly(c);
    const itemId = param(c, "id");
    const input = parse(queue.FailSchema, await body(c));
    const row = await tx((db) => queue.fail(db, worker, itemId, input));
    await tx((db) => items.sweepItemFiles(db, storage, itemId));
    return c.json(row);
  });

  // ---------------------------------------------------------------- admin
  api.get("/credentials", async (c) => {
    ownerOnly(c);
    return c.json({ credentials: await listCredentials(sql) });
  });
  api.get("/audit", async (c) => {
    const q = parse(
      z.object({
        object_type: z.string().optional(),
        object_id: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      c.req.query(),
    );
    return c.json({ entries: await listAudit(sql, { objectType: q.object_type, objectId: q.object_id, limit: q.limit }) });
  });

  return api;
}
