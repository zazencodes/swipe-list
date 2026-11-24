import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db.ts";
import { AppError, notFound } from "../errors.ts";

export const TOKEN_PREFIX = "swl_";

export type Permission = "client" | "submitter" | "worker";
export interface CredentialIdentity {
  id: number;
  name: string;
  permission: Permission;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a credential and returns its secret token. The token is shown once; only its hash is stored. */
export async function createCredential(db: Db, name: string, permission: Permission = "client") {
  const [clash] = await db`select id from credentials where name = ${name}`;
  if (clash) throw new AppError(409, "conflict", `a credential named "${name}" already exists`);
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const [row] = await db<{ id: number; name: string; token_prefix: string; created_at: Date }[]>`
    insert into credentials (name, token_prefix, token_hash, permission)
    values (${name}, ${token.slice(0, TOKEN_PREFIX.length + 6)}, ${hash(token)}, ${permission})
    returning id, name, token_prefix, created_at
  `;
  return { ...row!, token };
}

export async function listCredentials(db: Db) {
  return db`select id, name, permission, token_prefix, created_at, last_used_at, revoked_at from credentials order by id`;
}

export async function revokeCredential(db: Db, name: string) {
  const [row] = await db`update credentials set revoked_at = now() where name = ${name} and revoked_at is null returning id`;
  if (!row) throw notFound("active credential", name);
}

export async function verifyCredential(db: Db, token: string): Promise<CredentialIdentity | null> {
  const [row] = await db<CredentialIdentity[]>`
    select id, name, permission from credentials where token_hash = ${hash(token)} and revoked_at is null
  `;
  if (!row) return null;
  await db`update credentials set last_used_at = now() where id = ${row.id} and (last_used_at is null or last_used_at < now() - interval '1 minute')`;
  return row;
}
