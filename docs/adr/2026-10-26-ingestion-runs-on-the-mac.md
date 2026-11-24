# Ingestion runs on the owner's Mac, pulled from a queue in Postgres

## Decision

Saving something only records it: the dashboard, the CLI or an agent inserts a
queued item. A worker on the owner's Mac, run by Koyomi every 5 minutes, claims
queued items one at a time from the server and does the fetching there. The queue
is the `items` table itself, with a lease on each claim; there is no separate
queue service.

## Why

The hard part is getting the content out of the link: X posts, logged-in pages,
videos. That works reliably from a real machine with the owner's browser and
logins, and badly from a datacenter, where X and similar sites block or degrade
requests. A Mac the owner already has is the cheapest machine that can do it well.

A poll every 5 minutes is one HTTP call and costs nothing when the queue is empty;
Codex only starts for a claimed item. The Mac being asleep only delays ingestion,
and Koyomi runs a missed slot on wake.

## Rejected

- **A cloud agent doing the fetching.** It can't reliably pull from links like X
  posts or download their media.
- **A queue service (SQS, Redis and the like).** One worker and a handful of items
  a day don't need one; a row with a status and a lease is enough and keeps the
  item and its queue state in one place.
- **Push to the Mac (webhooks, a tunnel).** The Mac is often asleep or off the
  network; polling needs no inbound connection.
- **Scheduling with launchd or cron directly.** Koyomi is the one supported
  scheduler: it catches up after sleep and alerts on failure.
