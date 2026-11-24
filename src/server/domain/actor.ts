import type { Db } from "../db.ts";
import type { CredentialIdentity } from "./credentials.ts";

export type CredentialActor = { kind: "credential" } & CredentialIdentity;

/** Who is making a request: the owner through the dashboard, or an agent holding a credential. */
export type Actor =
  | { kind: "owner"; email: string }
  | CredentialActor;

export function actorLabel(actor: Actor): string {
  return actor.kind === "owner" ? `owner:${actor.email}` : `agent:${actor.name}`;
}

export async function audit(
  db: Db,
  actor: Actor,
  action: string,
  objectType: string,
  objectId: string | number,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db`
    insert into audit_log (actor, action, object_type, object_id, details)
    values (${actorLabel(actor)}, ${action}, ${objectType}, ${String(objectId)}, ${db.json(details as never)})
  `;
}

export async function listAudit(
  db: Db,
  filter: { objectType?: string; objectId?: string; limit: number },
) {
  return db`
    select id, at, actor, action, object_type, object_id, details - 'run_id' as details from audit_log
    where (${filter.objectType ?? null}::text is null or object_type = ${filter.objectType ?? null})
      and (${filter.objectId ?? null}::text is null or object_id = ${filter.objectId ?? null})
    order by id desc limit ${filter.limit}
  `;
}
