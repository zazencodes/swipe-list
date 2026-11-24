import { createHash } from "node:crypto";
import path from "node:path";
import { createApi } from "../src/server/app.ts";
import { connect, type Sql } from "../src/server/db.ts";
import { createCredential } from "../src/server/domain/credentials.ts";
import { migrate } from "../src/server/migrate.ts";
import { AppError } from "../src/server/errors.ts";
import { PREFIX_BYTES, type Storage } from "../src/server/storage.ts";

export const OWNER_TOKEN = "owner-session-jwt";
export const DASHBOARD_URL = "https://swipe.example.ts.net";

export function memoryStorage(): Storage & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const etag = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
  return {
    objects,
    async put(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async inspectUpload(key) {
      const object = objects.get(key);
      if (!object) return null;
      return { size: object.body.byteLength, contentType: object.contentType, etag: etag(object.body), prefix: object.body.slice(0, PREFIX_BYTES) };
    },
    async copyUpload(source, destination, snapshot) {
      const object = objects.get(source);
      if (!object || etag(object.body) !== snapshot.etag || objects.has(destination)) {
        throw new AppError(409, "upload_changed", "conditional copy refused");
      }
      objects.set(destination, { body: object.body.slice(), contentType: snapshot.contentType });
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix));
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
    async presignPut(key, contentType) {
      return `memory://put/${key}?type=${contentType}`;
    },
    async presignGet(key) {
      return `memory://get/${key}`;
    },
  };
}

/**
 * A freshly migrated database plus API clients for an agent credential and for
 * the owner. Runs against the dedicated Neon `test` branch, whose public schema
 * is wiped at the start of every run.
 */
export async function setup() {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../.env.test"));
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("missing TEST_DATABASE_URL in .env.test (the Neon `test` branch connection string)");
  const sql: Sql = connect(url, { max: 4 });
  await sql.unsafe("drop schema public cascade; create schema public;");
  await migrate(sql, path.resolve(import.meta.dirname, "../migrations"));
  const credential = await createCredential(sql, "test-agent");
  const submitter = await createCredential(sql, "test-submitter", "submitter");
  const worker = await createCredential(sql, "test-worker", "worker");
  const otherWorker = await createCredential(sql, "second-worker", "worker");
  const storage = memoryStorage();
  const api = createApi({
    sql,
    storage,
    verifyOwner: async (jwt) => (jwt === OWNER_TOKEN ? "owner@example.com" : null),
    dashboardUrl: DASHBOARD_URL,
  });

  const client = (token: string | null) => {
    const call = async (method: string, route: string, payload?: unknown) => {
      const headers: Record<string, string> = {};
      if (token) headers.authorization = `Bearer ${token}`;
      let bodyInit: BodyInit | undefined;
      if (payload instanceof FormData) bodyInit = payload;
      else if (payload !== undefined) {
        headers["content-type"] = "application/json";
        bodyInit = JSON.stringify(payload);
      }
      const res = await api.request(route, { method, headers, body: bodyInit });
      const text = await res.text();
      const isJson = res.headers.get("content-type")?.includes("application/json");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = isJson ? JSON.parse(text) : text;
      return { status: res.status, body: json, contentType: res.headers.get("content-type") };
    };
    return {
      get: (route: string) => call("GET", route),
      post: (route: string, payload?: unknown) => call("POST", route, payload ?? {}),
      put: (route: string, payload: unknown) => call("PUT", route, payload),
      patch: (route: string, payload: unknown) => call("PATCH", route, payload),
      delete: (route: string) => call("DELETE", route),
    };
  };

  return {
    sql,
    storage,
    agent: client(credential.token),
    submitter: client(submitter.token),
    worker: client(worker.token),
    otherWorker: client(otherWorker.token),
    owner: client(OWNER_TOKEN),
    anonymous: client(null),
    as: client,
    token: credential.token,
    async teardown() {
      await sql.end();
    },
  };
}

export type Harness = Awaited<ReturnType<typeof setup>>;
