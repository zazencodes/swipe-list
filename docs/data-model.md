# How the Swipe List stores its data

Everything lives in one Neon project: Postgres holds the records and the search
index, and the private Object Storage bucket `media` holds the files. Postgres
never stores file bytes, only bucket keys. Each Neon branch (`main` = production,
`dev`, `test`) has its own database and its own copy of the bucket.

The schema is `migrations/001_schema.sql`; later migrations change it.

## Items

One row in `items` per saved piece of inspiration.

| Column | Meaning |
| --- | --- |
| `kind` | `link` (the owner shared a URL) or `upload` (the owner uploaded images, e.g. a screenshot) |
| `url`, `site` | The shared link and its host without `www.` (`x.com`). Links are unique: saving one twice is refused with the existing item's id. Empty for uploads |
| `note` | Instructions from the owner or a credential trusted to submit work. The worker follows it |
| `status` | `queued` → `processing` → `done` or `failed` |
| `title`, `description`, `tags`, `author`, `extracted_text` | Written by the worker (Codex) when it completes the item. `extracted_text` is the post's text or the page's main text |
| `attempts`, `last_error` | Claims taken on the item since it was last queued, and why the last run failed |
| `run_id`, `claimed_by`, `claimant_id`, `claim_expires_at` | The current or last run, which credential claimed it, and when its lease ends (set only while `processing`) |
| `search` | Generated `tsvector` over the fields below, used by `GET /items?q=` and never returned by the API |

Tags are lowercase kebab-case (`product-launch`, `glassmorphism`). The worker is
shown the tags already in use so it reuses them.

## Assets

One row in `assets` per stored file, ordered by `position` (the order the owner should
see them, most important first).

| `role` | What it is | Who adds it |
| --- | --- | --- |
| `upload` | An image the owner uploaded | The dashboard or `swipe upload`; never replaced by the worker |
| `image` | An image pulled from the source | Worker |
| `video` | A video pulled from the source (MP4, WebM or MOV) | Worker |
| `thumbnail` | A video's poster frame | Worker |
| `screenshot` | A capture of a webpage the worker took | Worker |

Each asset also keeps its `content_type`, `size_bytes` (read from the bucket, not
trusted from the worker), `source_url` (where it was downloaded from) and a one-line
`caption`. The API returns each asset with a presigned `url` valid for one hour;
videos stream from it with HTTP Range requests.

## Files in the bucket

```
media/
  items/<item id>/upload/<uuid>-<file name>     the owner's uploads
  items/<item id>/worker-temp/<run id>/...      temporary signed upload targets
  items/<item id>/worker-media/<uuid>.<ext>     validated files served to clients
```

The `worker_uploads` table records temporary keys and expected media types for the active lease. The rows in `assets` decide which files are live. After a run completes or fails,
and after an item is deleted, the server deletes every file under
`items/<item id>/` that no asset row references. Files from abandoned runs, from
earlier runs of a reprocessed item, and from deleted items never stay behind.

## The queue

The queue is the `items` table; there is no separate queue service.

1. Adding a link or an upload inserts an item with `status = queued`.
2. The worker on the owner's Mac (Koyomi job `swipe-list-worker`, every 5 minutes) calls
   `POST /queue/claim`. The oldest queued item becomes `processing` with a new
   `run_id` and a 45-minute lease. `for update skip locked` keeps two workers from
   claiming the same item.
3. The worker runs Codex in `~/.swipe-list/work/<item>-<run>/job/`, uploads the files
   Codex lists straight to the bucket with presigned PUT URLs
   (`POST /items/:id/uploads`), then calls `POST /items/:id/complete`. The server
   checks each issued upload against its expected media type and size, copies the verified version to a new final key, replaces the item's earlier
   worker files with the new ones, and sets `status = done`.
4. If Codex cannot get the content, or anything else goes wrong, the worker calls
   `POST /items/:id/fail` with the reason (`status = failed`, `last_error`). The
   work directory is kept for debugging and the worker exits 1, so Koyomi emails
   an alert.
5. If a lease expires (the worker died, or the Mac slept mid-run), the next claim
   takes the item again. After 3 expired leases the item fails instead.
6. Run mutations require the active run ID and the same worker credential that claimed it.
7. `POST /items/:id/retry` puts a `done` or `failed` item back in the queue. Its
   current files stay visible until the new run completes.

## Search

`GET /items?q=` (and `swipe search`) uses Postgres full-text search:
`websearch_to_tsquery('english', q)` against `items.search`, best match first, then
newest. Weights: title, note and tags (A), description (B), author and site (C),
extracted text (D). Filters: `status`, `tag`, `media` (items with at least one file
of that role). The index is a generated column, so an item is searchable the moment
the transaction that completes it commits.

## Audit log

Every create, claim, complete, fail, retry and delete writes a row to `audit_log`
(who, what, which item, details). `GET /audit` and `swipe audit` read it.
