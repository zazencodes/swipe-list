import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sweepWorkerFiles } from "../src/server/domain/items.ts";
import { MAX_ASSET_BYTES } from "../src/server/domain/queue.ts";
import { DASHBOARD_URL, setup, type Harness } from "./harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await setup();
}, 60_000);
afterAll(async () => h?.teardown());

const header = (type: string) => {
  const bytes: Record<string, string> = {
    "image/png": "89504e470d0a1a0a",
    "image/jpeg": "ffd8ffe0",
    "video/mp4": "000000146674797069736f6d000000006d703432",
  };
  return Buffer.from(bytes[type]!, "hex");
};

const png = (name = "shot.png") => new File([new Uint8Array(header("image/png"))], name, { type: "image/png" });

/** Plays the worker's part: claim, "upload" each file into memory storage, complete. */
async function process(files: { name: string; type: string; role: string }[], extra: Record<string, unknown> = {}) {
  const claim = await h.worker.post("/queue/claim");
  expect(claim.status).toBe(200);
  const { run_id, item } = claim.body;
  let keys: string[] = [];
  if (files.length) {
    const uploads = await h.worker.post(`/items/${item.id}/uploads`, {
      run_id,
      files: files.map((f) => ({ name: f.name, content_type: f.type })),
    });
    expect(uploads.status).toBe(200);
    keys = uploads.body.uploads.map((u: { key: string }) => u.key);
    for (const [index, key] of keys.entries()) await h.storage.put(key, header(files[index]!.type), files[index]!.type);
  }
  const done = await h.worker.post(`/items/${item.id}/complete`, {
    run_id,
    title: "A title",
    description: "What it is and why it is good.",
    tags: ["video", "product-launch"],
    author: "@someone",
    extracted_text: "Introducing Octopus OS",
    assets: files.map((f, index) => ({ key: keys[index], role: f.role, source_url: null, caption: f.name })),
    ...extra,
  });
  return { claim: claim.body, done, stagingKeys: keys };
}

describe("authentication", () => {
  it("rejects missing and unknown credentials", async () => {
    expect((await h.anonymous.get("/me")).status).toBe(401);
    expect((await h.as("swl_forged").get("/me")).body.error.code).toBe("unauthenticated");
  });

  it("tells a credential who it is and where the dashboard is", async () => {
    const me = await h.agent.get("/me");
    expect(me.body).toEqual({ actor: { kind: "credential", id: expect.any(Number), name: "test-agent", permission: "client" }, dashboard_url: DASHBOARD_URL });
  });

  it("separates workers, submitters and ordinary credentials", async () => {
    for (const caller of [h.agent, h.submitter]) {
      expect((await caller.post("/queue/claim")).status).toBe(403);
      for (const route of ["uploads", "complete", "fail"]) {
        expect((await caller.post(`/items/1/${route}`)).status).toBe(403);
      }
    }
    for (const caller of [h.agent, h.worker]) {
      for (const route of ["/items", "/items/upload", "/items/1/retry"]) {
        expect((await caller.post(route)).body.error.code).toBe("submitter_only");
      }
    }
    expect((await h.owner.post("/queue/claim")).status).toBe(403);
    expect((await h.agent.get("/credentials")).status).toBe(403);
    expect((await h.owner.get("/credentials")).status).toBe(200);
  });
});

describe("the queue", () => {
  it("queues a link, rejects the same link twice, and returns 204 when nothing is queued", async () => {
    expect((await h.worker.post("/queue/claim")).status).toBe(204);
    const created = await h.owner.post("/items", { url: "https://x.com/example/status/1/video/1", note: "the 3D effects" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: "link", status: "queued", site: "x.com", note: "the 3D effects" });
    const dupe = await h.owner.post("/items", { url: "https://x.com/example/status/1/video/1" });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.details.item_id).toBe(created.body.id);
  });

  it("claims, uploads and completes a link, then finds it by search", async () => {
    const { claim, done, stagingKeys } = await process([
      { name: "video.mp4", type: "video/mp4", role: "video" },
      { name: "thumb.jpg", type: "image/jpeg", role: "thumbnail" },
    ]);
    expect(claim.item.status).toBe("processing");
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("done");

    const item = await h.agent.get(`/items/${claim.item.id}`);
    expect(item.body).not.toHaveProperty("search");
    expect(item.body.extracted_text).toBe("Introducing Octopus OS");
    expect(item.body.assets.map((a: { role: string }) => a.role)).toEqual(["video", "thumbnail"]);
    const finalKey = new URL(item.body.assets[0].url).pathname.slice(1);
    expect(finalKey).toContain("/worker-media/");
    expect(stagingKeys).not.toContain(finalKey);
    expect(stagingKeys.every((key) => !h.storage.objects.has(key))).toBe(true);
    await h.storage.put(stagingKeys[0]!, header("image/png"), "image/png");
    await sweepWorkerFiles(h.sql, h.storage);
    expect(h.storage.objects.has(stagingKeys[0]!)).toBe(false);
    expect(Array.from(h.storage.objects.get(finalKey)!.body)).toEqual(Array.from(header("video/mp4")));

    const found = await h.agent.get("/items?q=octopus");
    expect(found.body.items.map((i: { id: number }) => i.id)).toEqual([claim.item.id]);
    expect(found.body.items[0]).not.toHaveProperty("extracted_text");
    expect(found.body.items[0].preview.role).toBe("thumbnail");
    expect(found.body.items[0].media).toEqual({ video: 1, thumbnail: 1 });
    expect((await h.agent.get("/items?q=watercolour")).body.items).toEqual([]);
    expect((await h.agent.get("/items?media=video")).body.total).toBe(1);
    expect((await h.agent.get("/items?tag=product-launch")).body.total).toBe(1);
    expect((await h.agent.get("/tags")).body.tags).toContainEqual({ tag: "product-launch", count: 1 });
  });

  it("refuses keys outside the run, missing uploads, and a link with no media", async () => {
    const created = await h.owner.post("/items", { url: "https://example.com/site" });
    const claim = await h.worker.post("/queue/claim");
    const run_id = claim.body.run_id;
    const base = { run_id, title: "t", description: "d", tags: [] };
    const uploadRequest = { run_id, files: [{ name: "a.png", content_type: "image/png" }] };
    const route = `/items/${created.body.id}`;
    expect((await h.otherWorker.post(`${route}/uploads`, uploadRequest)).body.error.code).toBe("wrong_worker");
    expect((await h.otherWorker.post(`${route}/complete`, { ...base, assets: [] })).status).toBe(403);
    expect((await h.otherWorker.post(`${route}/fail`, { run_id, error: "test" })).status).toBe(403);
    const audit = await h.agent.get(`/audit?object_type=item&object_id=${created.body.id}`);
    expect(JSON.stringify(audit.body)).not.toContain(run_id);
    const outside = await h.worker.post(`/items/${created.body.id}/complete`, {
      ...base,
      assets: [{ key: "items/1/elsewhere.png", role: "image" }],
    });
    expect(outside.status).toBe(422);
    const { body } = await h.worker.post(`/items/${created.body.id}/uploads`, { run_id, files: [{ name: "a.png", content_type: "image/png" }] });
    const missing = await h.worker.post(`/items/${created.body.id}/complete`, { ...base, assets: [{ key: body.uploads[0].key, role: "image" }] });
    expect(missing.body.error.message).toMatch(/nothing was uploaded/);
    expect((await h.worker.post(`/items/${created.body.id}/complete`, { ...base, assets: [] })).status).toBe(422);
    const badType = await h.worker.post(`/items/${created.body.id}/uploads`, { run_id, files: [{ name: "a.pdf", content_type: "application/pdf" }] });
    expect(badType.status).toBe(422);

    const key = body.uploads[0].key;
    const completion = { ...base, assets: [{ key, role: "screenshot" }] };
    await h.storage.put(key, header("image/jpeg"), "image/jpeg");
    expect((await h.worker.post(`${route}/complete`, completion)).status).toBe(422);
    await h.storage.put(key, header("image/jpeg"), "image/png");
    expect((await h.worker.post(`${route}/complete`, completion)).status).toBe(422);
    await h.storage.put(key, header("image/png"), "image/png");
    const snapshot = (await h.storage.inspectUpload(key))!;
    vi.spyOn(h.storage, "inspectUpload").mockResolvedValueOnce({ ...snapshot, size: MAX_ASSET_BYTES + 1 });
    expect((await h.worker.post(`${route}/complete`, completion)).status).toBe(422);
    vi.restoreAllMocks();
    vi.spyOn(h.storage, "inspectUpload").mockResolvedValueOnce({ ...snapshot, etag: "superseded-version" });
    expect((await h.worker.post(`${route}/complete`, completion)).body.error.code).toBe("upload_changed");
    vi.restoreAllMocks();
    const duplicate = await h.worker.post(`${route}/complete`, { ...base, assets: [...completion.assets, ...completion.assets] });
    expect(duplicate.status).toBe(422);
    expect((await h.storage.list(`items/${created.body.id}/worker-media/`))).toEqual([]);
    await sweepWorkerFiles(h.sql, h.storage);
    expect(h.storage.objects.has(key)).toBe(true);

    // The owner sees a fixed failure message. Diagnostic text stays on the worker.
    await h.storage.put(body.uploads[0].key, new Uint8Array([1]), "image/png");
    const failed = await h.worker.post(`/items/${created.body.id}/fail`, { run_id, error: "login wall" });
    expect(failed.body).toMatchObject({ status: "failed", last_error: "Ingestion failed. See the local worker log.", claim_expires_at: null });
    expect(h.storage.objects.has(key)).toBe(false);
    const failedAudit = await h.agent.get(`/audit?object_id=${created.body.id}`);
    expect(JSON.stringify(failedAudit.body)).not.toContain("login wall");
    // The run no longer owns the item.
    expect((await h.worker.post(`/items/${created.body.id}/fail`, { run_id, error: "again" })).body.error.code).toBe("stale_run");
  });

  it("retries a failed item and replaces media from the previous run", async () => {
    const [failedItem] = (await h.agent.get("/items?status=failed")).body.items;
    expect((await h.submitter.post(`/items/${failedItem.id}/retry`)).body.status).toBe("queued");
    expect((await h.owner.post(`/items/${failedItem.id}/retry`)).status).toBe(409);
    const first = await process([{ name: "desktop.png", type: "image/png", role: "screenshot" }]);
    expect(first.done.status).toBe(200);
    const firstKeys = [...h.storage.objects.keys()].filter((k) => k.startsWith(`items/${failedItem.id}/`));

    await h.owner.post(`/items/${failedItem.id}/retry`);
    const second = await process([{ name: "mobile.png", type: "image/png", role: "screenshot" }]);
    expect(second.claim.run_id).not.toBe(first.claim.run_id);
    const item = await h.agent.get(`/items/${failedItem.id}`);
    expect(item.body.assets.map((a: { caption: string }) => a.caption)).toEqual(["mobile.png"]);
    for (const key of firstKeys) expect(h.storage.objects.has(key)).toBe(false);
  });

  it("re-queues an item whose lease expired, and fails it after three expired leases", async () => {
    const created = await h.submitter.post("/items", { url: "https://example.com/slow" });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claim = await h.worker.post("/queue/claim");
      expect(claim.body.item).toMatchObject({ id: created.body.id, attempts: attempt });
      await h.sql`update items set claim_expires_at = now() - interval '1 minute' where id = ${created.body.id}`;
      const expired = await h.worker.post(`/items/${created.body.id}/fail`, { run_id: claim.body.run_id, error: "test" });
      expect(expired.body.error.code).toBe("stale_run");
    }
    expect((await h.worker.post("/queue/claim")).status).toBe(204);
    const item = await h.agent.get(`/items/${created.body.id}`);
    expect(item.body.status).toBe("failed");
    expect(item.body.last_error).toMatch(/3 times/);
  });
});

describe("uploads", () => {
  it("stores a trusted submitter's images, hands them to the worker, and keeps them through completion", async () => {
    const form = new FormData();
    form.append("file", png("Screenshot 2026-10-26 at 3.14.png"));
    form.append("file", png("second.png"));
    form.append("note", "love the gradient");
    const created = await h.submitter.post("/items/upload", form);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: "upload", url: null, status: "queued" });

    const { claim, done } = await process([]);
    expect(claim.item.id).toBe(created.body.id);
    expect(claim.uploads).toHaveLength(2);
    expect(claim.uploads[0].filename).toMatch(/screenshot-2026-10-26-at-3\.14\.png$/);
    expect(done.status).toBe(200);
    const item = await h.owner.get(`/items/${created.body.id}`);
    expect(item.body.assets.map((a: { role: string }) => a.role)).toEqual(["upload", "upload"]);
  });

  it("rejects non-images and empty uploads", async () => {
    const pdf = new FormData();
    pdf.append("file", new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" }));
    expect((await h.owner.post("/items/upload", pdf)).status).toBe(422);
    const mislabeled = new FormData();
    mislabeled.append("file", new File(["fixture"], "fixture.png", { type: "image/png" }));
    expect((await h.owner.post("/items/upload", mislabeled)).status).toBe(422);
    expect((await h.owner.post("/items/upload", new FormData())).status).toBe(422);
  });
});

describe("deleting", () => {
  it("deletes an item, its asset rows and every stored file", async () => {
    const [upload] = (await h.agent.get("/items?q=gradient")).body.items;
    expect(upload).toBeDefined();
    expect([...h.storage.objects.keys()].some((k) => k.startsWith(`items/${upload.id}/`))).toBe(true);
    expect((await h.owner.delete(`/items/${upload.id}`)).status).toBe(204);
    expect((await h.owner.get(`/items/${upload.id}`)).status).toBe(404);
    expect([...h.storage.objects.keys()].some((k) => k.startsWith(`items/${upload.id}/`))).toBe(false);
    expect((await h.sql`select count(*)::int as n from assets where item_id = ${upload.id}`)[0]!.n).toBe(0);
  });
});
