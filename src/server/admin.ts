// Operator commands, run on the server with the production environment:
//   node --env-file=.env dist/admin.mjs migrate
//   node --env-file=.env dist/admin.mjs credentials create|list|revoke [name]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./db.ts";
import { createCredential, listCredentials, revokeCredential } from "./domain/credentials.ts";
import { migrate } from "./migrate.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.basename(here) === "dist" ? path.resolve(here, "..") : path.resolve(here, "../..");
const usage = "usage: admin migrate | credentials create <name> [--worker | --allow-submit] | credentials list | credentials revoke <name>";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("missing required environment variable DATABASE_URL");
const sql = connect(url, { max: 1 });
const [command, sub, name, ...flags] = process.argv.slice(2);

try {
  if (command === "migrate" && !sub) {
    const ran = await migrate(sql, path.join(root, "migrations"));
    console.log(ran.length ? `applied: ${ran.join(", ")}` : "up to date");
  } else if (command === "credentials" && sub === "create" && name && !name.startsWith("-")) {
    if (flags.length > 1 || flags.some((flag) => flag !== "--worker" && flag !== "--allow-submit")) throw new Error(usage);
    const permission = flags[0] === "--worker" ? "worker" : flags[0] === "--allow-submit" ? "submitter" : "client";
    const credential = await createCredential(sql, name, permission);
    console.log(`created credential "${credential.name}" (id ${credential.id}, ${permission})`);
    console.log(`token (shown once): ${credential.token}`);
  } else if (command === "credentials" && sub === "list" && !name) {
    console.table(await listCredentials(sql));
  } else if (command === "credentials" && sub === "revoke" && name && !flags.length) {
    await revokeCredential(sql, name);
    console.log(`revoked credential "${name}"`);
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} finally {
  await sql.end();
}
