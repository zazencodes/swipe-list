import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { handleAuthProxyRequest } from "@neondatabase/auth/server";
import { Hono } from "hono";
import { createApi } from "./app.ts";
import { neonOwnerVerifier } from "./auth.ts";
import { connect } from "./db.ts";
import { sweepWorkerFiles } from "./domain/items.ts";
import { loadEnv } from "./env.ts";
import { migrate } from "./migrate.ts";
import { s3Storage } from "./storage.ts";

// In production this file is bundled to dist/server.mjs; in development it runs from src/server.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.basename(here) === "dist" ? path.resolve(here, "..") : path.resolve(here, "../..");
const dist = path.join(root, "dist");

const env = loadEnv();
const sql = connect(env.databaseUrl);
const applied = await migrate(sql, path.join(root, "migrations"));
if (applied.length) console.log(`applied migrations: ${applied.join(", ")}`);
const storage = s3Storage(env.mediaBucket);

async function cleanWorkerStorage() {
  try {
    await sweepWorkerFiles(sql, storage);
  } catch (error) {
    console.error("worker storage cleanup failed", error);
  } finally {
    setTimeout(cleanWorkerStorage, 60 * 60 * 1000).unref();
  }
}
void cleanWorkerStorage();

/** Health check, client installer, CLI and skill downloads: served on both listeners. */
function withClientDownloads(app: Hono) {
  app.get("/healthz", async (c) => {
    await sql`select 1`;
    return c.json({ ok: true });
  });
  app.get("/downloads/swipe.mjs", async (c) =>
    c.body(await readFile(path.join(dist, "swipe.mjs")), 200, { "content-type": "text/javascript; charset=utf-8" }),
  );
  app.get("/downloads/inspo-swipe-list.tar.gz", async (c) =>
    c.body(await readFile(path.join(dist, "inspo-swipe-list.tar.gz")), 200, { "content-type": "application/gzip" }),
  );
  app.get("/install.sh", async (c) => {
    const script = (await readFile(path.join(root, "scripts", "install-client.sh"), "utf8")).replaceAll("__AGENT_URL__", env.agentUrl);
    return c.body(script, 200, { "content-type": "text/x-shellscript; charset=utf-8" });
  });
  return app;
}

// Agent listener: published to the internet through Caddy (AGENT_URL). Only
// credential-authenticated API calls; no dashboard, no login proxy, and owner
// session tokens are not accepted here.
const agentApp = withClientDownloads(new Hono());
agentApp.route("/api", createApi({ sql, storage, verifyOwner: async () => null, dashboardUrl: env.dashboardUrl }));

// Dashboard listener: private network only (Tailscale). Serves the web app, proxies Neon Auth so
// session cookies are first-party, and accepts both owner sessions and credentials.
const dashboardApp = withClientDownloads(new Hono());
dashboardApp.all("/api/auth/*", (c) =>
  handleAuthProxyRequest({
    request: c.req.raw,
    path: c.req.path.slice("/api/auth/".length),
    baseUrl: env.neonAuthBaseUrl,
    cookieSecret: env.authCookieSecret,
  }),
);
dashboardApp.route(
  "/api",
  createApi({
    sql,
    storage,
    verifyOwner: neonOwnerVerifier({ jwksUrl: env.neonAuthJwksUrl, authBaseUrl: env.neonAuthBaseUrl, ownerEmails: env.ownerEmails }),
    dashboardUrl: env.dashboardUrl,
  }),
);
const web = path.relative(process.cwd(), path.join(dist, "web"));
dashboardApp.use("/assets/*", serveStatic({ root: web }));
dashboardApp.get("/assets/*", (c) => c.text("not found", 404));
dashboardApp.get("*", serveStatic({ root: web }));
dashboardApp.get("*", serveStatic({ path: path.join(web, "index.html") }));

serve({ fetch: dashboardApp.fetch, hostname: env.host, port: env.dashboardPort }, (info) => {
  console.log(`dashboard listening on http://${info.address}:${info.port}`);
});
serve({ fetch: agentApp.fetch, hostname: env.host, port: env.agentPort }, (info) => {
  console.log(`agent API listening on http://${info.address}:${info.port} (public ${env.agentUrl})`);
});
