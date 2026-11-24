// The ingestion queue. Items are rows in `items`; the worker on the owner's Mac claims one
// at a time under a lease, uploads the media it pulled straight to the bucket with
// presigned URLs, then completes or fails the run. A run is identified by `run_id`:
// every worker call names it, so a stale worker can never overwrite a newer run.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db.ts";
import { AppError, invalid, notFound } from "../errors.ts";
import type { Storage } from "../storage.ts";
import { actorLabel, audit, type CredentialActor } from "./actor.ts";
import { matchesMediaType } from "./media.ts";
import { ITEM_COLUMNS, itemPrefix, MEDIA_TYPES, safeName, tag, type AssetRow, type ItemRow } from "./items.ts";

/** How long a claim lasts. The worker gives Codex less than this. */
export const LEASE_MINUTES = 45;
/** Claims that expire this many times (the worker died or the Mac slept) fail the item. */
export const MAX_ATTEMPTS = 3;
export const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

const runId = z.uuid();

export const UploadRequestSchema = z
  .object({
    run_id: runId,
    files: z
      .array(z.object({ name: z.string().min(1), content_type: z.string() }).strict())
      .min(1)
      .max(50),
  })
  .strict();

const WORKER_ROLES = ["image", "video", "thumbnail", "screenshot"] as const;

export const CompleteSchema = z
  .object({
    run_id: runId,
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    tags: z.array(tag).max(20),
    author: z.string().trim().default(""),
    extracted_text: z.string().default(""),
    assets: z
      .array(
        z
          .object({
            key: z.string(),
            role: z.enum(WORKER_ROLES),
            source_url: z.url().nullable().default(null),
            caption: z.string().trim().default(""),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export const FailSchema = z.object({ run_id: runId, error: z.string().trim().min(1) }).strict();

/**
 * Claims the oldest queued item, or one whose lease expired. Returns null when the
 * queue is empty. Leases that expired MAX_ATTEMPTS times fail their item instead.
 */
export async function claim(db: Db, storage: Storage, actor: CredentialActor) {
  const expired = await db<{ id: number }[]>`
    update items set status = 'failed', claimant_id = null, claimed_by = null, claim_expires_at = null, updated_at = now(),
      last_error = 'the worker claimed this item ' || attempts || ' times without finishing'
    where status = 'processing' and claim_expires_at < now() and attempts >= ${MAX_ATTEMPTS}
    returning id
  `;
  for (const { id } of expired) {
    await db`delete from worker_uploads where item_id = ${id}`;
    await audit(db, actor, "fail", "item", id, { reason: "lease expired" });
  }

  const [item] = await db<ItemRow[]>`
    update items set status = 'processing', attempts = attempts + 1, run_id = gen_random_uuid(),
      claimant_id = ${actor.id}, claimed_by = ${actorLabel(actor)}, claim_expires_at = now() + make_interval(mins => ${LEASE_MINUTES}),
      updated_at = now()
    where id = (
      select id from items
      where status = 'queued' or (status = 'processing' and claim_expires_at < now())
      order by created_at, id limit 1
      for update skip locked
    )
    returning ${db(ITEM_COLUMNS)}
  `;
  if (!item) return null;
  await db`delete from worker_uploads where item_id = ${item.id}`;
  await audit(db, actor, "claim", "item", item.id, { attempt: item.attempts });
  const uploads = await db<AssetRow[]>`
    select * from assets where item_id = ${item.id} and role = 'upload' order by position
  `;
  return {
    item,
    run_id: item.run_id!,
    lease_expires_at: item.claim_expires_at!,
    uploads: await Promise.all(
      uploads.map(async (a) => ({
        asset_id: a.id,
        content_type: a.content_type,
        filename: a.storage_key.split("/").pop()!,
        url: await storage.presignGet(a.storage_key),
      })),
    ),
  };
}

/** Serialize writes to this item, then check the credential, run and lease under the lock. */
async function ownRun(db: Db, actor: CredentialActor, itemId: number, run: string) {
  const [item] = await db<(ItemRow & { claimant_id: number | null })[]>`
    select ${db(ITEM_COLUMNS)}, claimant_id from items where id = ${itemId} for update
  `;
  if (!item) throw notFound("item", itemId);
  if (item.status !== "processing" || item.run_id !== run) throw staleRun();
  if (item.claimant_id !== actor.id) throw new AppError(403, "wrong_worker", "the run belongs to another worker");
  const [lease] = await db`select claim_expires_at > clock_timestamp() as valid from items where id = ${itemId}`;
  if (!lease!.valid) throw staleRun();
  return item;
}

function staleRun() {
  return new AppError(409, "stale_run", "the run is expired or no longer owns this item");
}

/** Each grant names one private staging object. Only the server writes published media. */
export async function presignUploads(db: Db, storage: Storage, actor: CredentialActor, itemId: number, input: z.infer<typeof UploadRequestSchema>) {
  await ownRun(db, actor, itemId, input.run_id);
  const uploads = [];
  for (const file of input.files) {
    const contentType = file.content_type.toLowerCase();
    if (!Object.hasOwn(MEDIA_TYPES, contentType)) throw invalid("unsupported media type", { allowed: Object.keys(MEDIA_TYPES) });
    const key = `${itemPrefix(itemId)}worker-temp/${input.run_id}/${randomUUID()}-${safeName(file.name)}`;
    await db`insert into worker_uploads (storage_key, item_id, run_id, content_type)
      values (${key}, ${itemId}, ${input.run_id}, ${contentType})`;
    uploads.push({ name: file.name, key, content_type: contentType, url: await storage.presignPut(key, contentType) });
  }
  return { uploads };
}

/**
 * Records what the run found and marks the item done. Media from earlier runs is
 * replaced; the owner's uploads are kept. The caller sweeps unreferenced files afterwards.
 */
export async function complete(db: Db, storage: Storage, actor: CredentialActor, itemId: number, input: z.infer<typeof CompleteSchema>) {
  const item = await ownRun(db, actor, itemId, input.run_id);
  if (item.kind === "link" && input.assets.length === 0) {
    throw invalid("a link item needs at least one image, video or screenshot; fail the run if nothing could be pulled");
  }
  const grants = await db<{ storage_key: string; content_type: string }[]>`
    select storage_key, content_type from worker_uploads where item_id = ${itemId} and run_id = ${input.run_id}
  `;
  const available = new Map(grants.map((grant) => [grant.storage_key, grant.content_type]));
  const copied: string[] = [];
  try {
    const stored = [];
    for (const asset of input.assets) {
      const contentType = available.get(asset.key);
      if (!contentType) throw invalid("asset key is duplicated or was not issued to this run");
      available.delete(asset.key);
      const snapshot = await storage.inspectUpload(asset.key);
      if (!snapshot) throw invalid("nothing was uploaded to the staging key");
      if (!Number.isSafeInteger(snapshot.size) || snapshot.size <= 0 || snapshot.size > MAX_ASSET_BYTES) {
        throw invalid("asset must be non-empty and at most 2 GB");
      }
      if (snapshot.contentType !== contentType || !matchesMediaType(snapshot.prefix, contentType)) {
        throw invalid("uploaded media does not match its requested content type");
      }
      const key = `${itemPrefix(itemId)}worker-media/${randomUUID()}${MEDIA_TYPES[contentType]}`;
      await storage.copyUpload(asset.key, key, snapshot);
      copied.push(key);
      stored.push({ ...asset, key, size: snapshot.size, contentType });
    }
    await db`delete from assets where item_id = ${itemId} and role <> 'upload'`;
    const [{ next } = { next: 0 }] = await db<{ next: number }[]>`
      select coalesce(max(position) + 1, 0)::int as next from assets where item_id = ${itemId}
    `;
    for (const [index, asset] of stored.entries()) {
      await db`
        insert into assets (item_id, role, storage_key, content_type, size_bytes, source_url, caption, position)
        values (${itemId}, ${asset.role}, ${asset.key}, ${asset.contentType}, ${asset.size}, ${asset.source_url},
          ${asset.caption}, ${next + index})
      `;
    }
    const [row] = await db<ItemRow[]>`
      update items set status = 'done', title = ${input.title}, description = ${input.description},
        tags = ${[...new Set(input.tags)]}::text[], author = ${input.author}, extracted_text = ${input.extracted_text},
        last_error = null, claimant_id = null, claimed_by = null, claim_expires_at = null, processed_at = now(), updated_at = now()
      where id = ${itemId} and claim_expires_at > clock_timestamp() returning ${db(ITEM_COLUMNS)}
    `;
    if (!row) throw staleRun();
    await db`delete from worker_uploads where item_id = ${itemId}`;
    await audit(db, actor, "complete", "item", itemId, { assets: stored.length });
    return row;
  } catch (error) {
    // Still inside the item transaction: none of these new keys could have been published.
    if (copied.length) await storage.delete(copied);
    throw error;
  }
}

/** Keep raw worker diagnostics on the worker. The library exposes only the public failure message. */
export async function fail(db: Db, actor: CredentialActor, itemId: number, input: z.infer<typeof FailSchema>) {
  await ownRun(db, actor, itemId, input.run_id);
  const [row] = await db<ItemRow[]>`
    update items set status = 'failed', last_error = 'Ingestion failed. See the local worker log.', claimant_id = null, claimed_by = null, claim_expires_at = null,
      updated_at = now()
    where id = ${itemId} and claim_expires_at > clock_timestamp() returning ${db(ITEM_COLUMNS)}
  `;
  if (!row) throw staleRun();
  await db`delete from worker_uploads where item_id = ${itemId}`;
  await audit(db, actor, "fail", "item", itemId);
  return row;
}
