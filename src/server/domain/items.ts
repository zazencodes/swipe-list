// Saved inspiration: links the owner shared and images they uploaded, with the media the
// worker pulled for them. Search runs on Postgres full-text search over `items.search`.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db, Sql, Tx } from "../db.ts";
import { AppError, invalid, notFound } from "../errors.ts";
import { PREFIX_BYTES, type Storage } from "../storage.ts";
import { actorLabel, audit, type Actor } from "./actor.ts";
import { matchesMediaType } from "./media.ts";

export const STATUSES = ["queued", "processing", "done", "failed"] as const;
export const ROLES = ["upload", "image", "video", "thumbnail", "screenshot"] as const;
export type Role = (typeof ROLES)[number];

/** Media types the bucket accepts, and the extension each is stored under. */
export const MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};
export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;

/** Lowercase kebab-case, e.g. `product-launch`, `glassmorphism`. */
export const tag = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "tags are lowercase kebab-case, e.g. product-launch");

export const LinkCreateSchema = z
  .object({
    url: z.url({ protocol: /^https?$/ }),
    note: z.string().trim().default(""),
  })
  .strict();

export const NoteSchema = z.string().trim().default("");

export const ItemFilterSchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(STATUSES).optional(),
  tag: tag.optional(),
  media: z.enum(ROLES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface ItemRow {
  id: number;
  kind: "link" | "upload";
  url: string | null;
  site: string;
  note: string;
  status: (typeof STATUSES)[number];
  title: string;
  description: string;
  tags: string[];
  author: string;
  extracted_text: string;
  attempts: number;
  last_error: string | null;
  run_id: string | null;
  claimed_by: string | null;
  claim_expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface AssetRow {
  id: number;
  item_id: number;
  role: Role;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  source_url: string | null;
  caption: string;
  position: number;
  created_at: string;
}

/** Every items column except `search`, the generated full-text index, which is never returned. */
export const ITEM_COLUMNS = [
  "id", "kind", "url", "site", "note", "status", "title", "description", "tags", "author", "extracted_text",
  "attempts", "last_error", "run_id", "claimed_by", "claim_expires_at", "created_by", "created_at", "updated_at",
  "processed_at",
] as const;

export const itemPrefix = (itemId: number) => `items/${itemId}/`;

/** Lowercase, path-safe file name that keeps its extension. */
export function safeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "");
  return cleaned.slice(-80) || "file";
}

async function assetView(storage: Storage, asset: AssetRow) {
  const { storage_key, item_id: _item, ...rest } = asset;
  return { ...rest, url: await storage.presignGet(storage_key) };
}

/** The asset a grid card shows: an uploaded image, a screenshot, an image, or a video's thumbnail. */
const PREVIEW_ORDER: Role[] = ["upload", "screenshot", "image", "thumbnail"];

function previewOf(assets: AssetRow[]) {
  for (const role of PREVIEW_ORDER) {
    const asset = assets.find((a) => a.role === role);
    if (asset) return asset;
  }
  return null;
}

async function summaryView(storage: Storage, item: ItemRow, assets: AssetRow[]) {
  const { extracted_text: _text, run_id: _run, ...rest } = item;
  const preview = previewOf(assets);
  const counts: Partial<Record<Role, number>> = {};
  for (const asset of assets) counts[asset.role] = (counts[asset.role] ?? 0) + 1;
  return { ...rest, media: counts, preview: preview ? await assetView(storage, preview) : null };
}

async function assetsFor(db: Db, itemIds: number[]): Promise<Map<number, AssetRow[]>> {
  const rows = itemIds.length
    ? await db<AssetRow[]>`select * from assets where item_id = any(${itemIds}::bigint[]) order by item_id, position`
    : [];
  const byItem = new Map<number, AssetRow[]>();
  for (const row of rows) byItem.set(row.item_id, [...(byItem.get(row.item_id) ?? []), row]);
  return byItem;
}

export async function getItemRow(db: Db, id: number): Promise<ItemRow> {
  const [row] = await db<ItemRow[]>`select ${db(ITEM_COLUMNS)} from items where id = ${id}`;
  if (!row) throw notFound("item", id);
  return row;
}

export async function getItem(db: Db, storage: Storage, id: number) {
  const item = await getItemRow(db, id);
  const assets = (await assetsFor(db, [id])).get(id) ?? [];
  const { run_id: _run, ...rest } = item;
  return { ...rest, assets: await Promise.all(assets.map((a) => assetView(storage, a))) };
}

export async function listItems(db: Db, storage: Storage, filter: z.infer<typeof ItemFilterSchema>) {
  const q = filter.q || null;
  const where = db`
    where (${q}::text is null or search @@ websearch_to_tsquery('english', ${q}))
      and (${filter.status ?? null}::text is null or status = ${filter.status ?? null})
      and (${filter.tag ?? null}::text is null or tags @> array[${filter.tag ?? null}]::text[])
      and (${filter.media ?? null}::text is null or exists (
        select 1 from assets a where a.item_id = items.id and a.role = ${filter.media ?? null}))
  `;
  const rows = await db<ItemRow[]>`
    select ${db(ITEM_COLUMNS)} from items ${where}
    order by case when ${q}::text is null then 0 else ts_rank(search, websearch_to_tsquery('english', ${q})) end desc,
      created_at desc, id desc
    limit ${filter.limit} offset ${filter.offset}
  `;
  const [count] = await db<{ total: number }[]>`select count(*)::bigint as total from items ${where}`;
  const assets = await assetsFor(
    db,
    rows.map((r) => r.id),
  );
  return {
    items: await Promise.all(rows.map((row) => summaryView(storage, row, assets.get(row.id) ?? []))),
    total: count!.total,
  };
}

export async function listTags(db: Db) {
  return db<{ tag: string; count: number }[]>`
    select tag, count(*)::bigint as count from items, unnest(tags) as tag
    group by tag order by count desc, tag
  `;
}

export async function createLink(db: Db, actor: Actor, input: z.infer<typeof LinkCreateSchema>) {
  const [existing] = await db<{ id: number }[]>`select id from items where url = ${input.url}`;
  if (existing) {
    throw new AppError(409, "conflict", `this link is already saved as item ${existing.id}`, { item_id: existing.id });
  }
  const site = new URL(input.url).hostname.replace(/^www\./, "");
  const [row] = await db<ItemRow[]>`
    insert into items (kind, url, site, note, created_by)
    values ('link', ${input.url}, ${site}, ${input.note}, ${actorLabel(actor)})
    returning ${db(ITEM_COLUMNS)}
  `;
  await audit(db, actor, "create", "item", row!.id, { kind: "link", url: input.url });
  return row!;
}

/** Stores the owner's images and queues the item so the worker describes and tags them. */
export async function createUpload(
  db: Db,
  storage: Storage,
  actor: Actor,
  files: { name: string; type: string; bytes: Uint8Array }[],
  note: string,
) {
  if (files.length === 0) throw invalid("attach at least one image as `file`");
  if (files.length > MAX_UPLOAD_FILES) throw invalid(`upload at most ${MAX_UPLOAD_FILES} images at a time`);
  const checked = files.map((file) => {
    const contentType = file.type.split(";")[0]!.trim().toLowerCase();
    if (!UPLOAD_TYPES.includes(contentType)) {
      throw invalid(`"${file.name}" is ${file.type || "of an unknown type"}; upload JPEG, PNG, WebP or GIF images`, {
        allowed: UPLOAD_TYPES,
      });
    }
    if (file.bytes.byteLength === 0) throw invalid(`"${file.name}" is empty`);
    if (file.bytes.byteLength > MAX_UPLOAD_BYTES) throw invalid(`images are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    if (!matchesMediaType(file.bytes.subarray(0, PREFIX_BYTES), contentType)) throw invalid("uploaded image does not match its content type");
    return { ...file, contentType };
  });
  const [item] = await db<ItemRow[]>`
    insert into items (kind, note, created_by) values ('upload', ${note}, ${actorLabel(actor)}) returning ${db(ITEM_COLUMNS)}
  `;
  const stored: string[] = [];
  try {
    for (const [index, file] of checked.entries()) {
      const key = `${itemPrefix(item!.id)}upload/${randomUUID()}-${safeName(file.name)}`;
      await storage.put(key, file.bytes, file.contentType);
      stored.push(key);
      await db`
        insert into assets (item_id, role, storage_key, content_type, size_bytes, position)
        values (${item!.id}, 'upload', ${key}, ${file.contentType}, ${file.bytes.byteLength}, ${index})
      `;
    }
  } catch (error) {
    if (stored.length) await storage.delete(stored);
    throw error;
  }
  await audit(db, actor, "create", "item", item!.id, { kind: "upload", files: checked.map((f) => f.name) });
  return item!;
}

/** Requeues a done or failed item; its current media stays until the new run completes. */
export async function retryItem(db: Db, actor: Actor, id: number) {
  const [item] = await db<Pick<ItemRow, "status">[]>`select status from items where id = ${id} for update`;
  if (!item) throw notFound("item", id);
  if (item.status === "queued" || item.status === "processing") {
    throw new AppError(409, "conflict", `item ${id} is already ${item.status}`);
  }
  const [row] = await db<ItemRow[]>`
    update items set status = 'queued', attempts = 0, last_error = null, updated_at = now()
    where id = ${id} returning ${db(ITEM_COLUMNS)}
  `;
  await audit(db, actor, "retry", "item", id, { previous_status: item.status });
  return row!;
}

/** Deletes the item and its asset rows. The caller removes the stored files after the transaction commits. */
export async function deleteItem(db: Db, actor: Actor, id: number) {
  const item = await getItemRow(db, id);
  await db`delete from items where id = ${id}`;
  await audit(db, actor, "delete", "item", id, { kind: item.kind, url: item.url, title: item.title });
}

/** Hold the item lock across comparison and deletion so another completion cannot publish a file mid-sweep. */
export async function sweepItemFiles(db: Tx, storage: Storage, itemId: number, observedKeys?: string[]) {
  await db`select id from items where id = ${itemId} for update`;
  const keys = observedKeys ?? await storage.list(itemPrefix(itemId));
  if (!keys.length) return;
  const referenced = await db<{ storage_key: string }[]>`
    select storage_key from assets where item_id = ${itemId}
    union all
    select u.storage_key from worker_uploads u join items i on i.id = u.item_id
    where i.id = ${itemId} and i.status = 'processing' and i.run_id = u.run_id and i.claim_expires_at > clock_timestamp()
  `;
  const keep = new Set(referenced.map((row) => row.storage_key));
  const orphans = keys.filter((key) => !keep.has(key));
  if (orphans.length) await storage.delete(orphans);
}

/** Recover abandoned copies and late PUTs, including keys for items that have since been deleted. */
export async function sweepWorkerFiles(sql: Sql, storage: Storage) {
  const keys = await storage.list("items/");
  const rows = await sql<{ storage_key: string }[]>`
    select storage_key from assets where storage_key like 'items/%/worker-media/%'
  `;
  const published = new Set(rows.map((row) => row.storage_key));
  const byItem = new Map<number, string[]>();
  for (const key of keys) {
    const match = /^items\/(\d+)\/worker-(?:temp|media)\//.exec(key);
    if (!match || published.has(key)) continue;
    const id = Number(match[1]);
    const group = byItem.get(id);
    if (group) group.push(key);
    else byItem.set(id, [key]);
  }
  for (const [id, candidates] of byItem) {
    await sql.begin((tx) => sweepItemFiles(tx, storage, id, candidates));
  }
}
