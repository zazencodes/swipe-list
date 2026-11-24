# AGENTS.md

Swipe List: a self-hosted library of design inspiration. A queue of saved links and uploads, an ingestion worker on the owner's Mac that has Codex pull each item's media, a searchable library API, the `swipe` CLI, a phone-first dashboard, a native Mac app (`macos/`), and the `inspo-swipe-list` agent skill. See README.md for what it is, `docs/self-hosting.md` for running it, and `docs/data-model.md` for how data is stored.

## Development Philosophy

**The code is the source of truth.** When a document and the code disagree, the
code is right and the document is stale: fix the doc or delete it, never the
behaviour to match it.

Specs and plans are scaffolding: write one to build a feature, delete it once the
feature ships. What survives:

- **`docs/adr/`**: one file per standing decision, `YYYY-MM-DD-<topic>.md`, with
  `## Decision`, `## Why` and `## Rejected`. High-level only: what was decided,
  why, what was rejected, and what must not be re-litigated. Never restate schemas,
  function names, config values or anything else a refactor would change. Write one
  whenever a real decision is made; supersede an old one by editing or deleting it,
  not by contradicting it.
- **`docs/*.md`**: how the system works and how to run it (`docs/data-model.md`, `docs/self-hosting.md`).
- **README.md**: what it is, how to get it, how to develop it.

| Decision | ADR |
| --- | --- |
| Ingestion on the owner's Mac through Koyomi, polling a queue that is the `items` table | `docs/adr/2026-10-26-ingestion-runs-on-the-mac.md` |
| Codex chooses what to pull; the worker script records it; uploads go through the queue too | `docs/adr/2026-10-26-codex-chooses-the-worker-records.md` |
| X posts through the fxtwitter script, everything else through the owner's Chrome (no yt-dlp) | `docs/adr/2026-10-26-x-script-and-chrome.md` |
| Neon is the one supported backend: records, search, files and auth in one project | `docs/adr/2026-10-26-everything-in-one-neon-project.md` |
| Postgres full-text search, no embeddings yet | `docs/adr/2026-10-26-postgres-full-text-search.md` |
| A tailnet-only dashboard and a public, credential-only agent API | `docs/adr/2026-10-26-private-dashboard-public-agent-api.md` |
| Accepted risk: the worker runs with its macOS user's privileges | `docs/adr/2026-10-26-worker-runs-with-the-owners-privileges.md` |
| The Mac app signs in with a credential kept in the Keychain | `docs/adr/2026-11-18-mac-app-signs-in-with-a-keychain-credential.md` |
| The Mac app plays videos in `AVPlayerView` | `docs/adr/2026-11-18-mac-app-plays-videos-in-avplayerview.md` |

## Commands

- `npm run dev`: server against the Neon `dev` branch (`.env.local`): dashboard listener :9021, agent listener :9022
- `npm run dev:web`: dashboard on :5173
- `npm test`: integration tests on the Neon `test` branch (`.env.test`); each run wipes that branch's `public` schema
- `npm run typecheck`, `npm run typecheck:web`
- `npm run worker`: process the queue once, using the server and credential in `~/.config/swipe/config.json`
- `npm run build`, `./scripts/deploy.sh`: build and deploy to the server in `deploy.env`
- `cd macos && swift test`: Mac app unit tests (requests go to a stub, never a server); `./build.sh`, `./install.sh`: build, and install to `/Applications`

## Rules

- Library and queue rules live in `src/server/domain/`; routes in `src/server/app.ts` only parse input and call the domain. Mutations run in a transaction and write to `audit_log`.
- The worker (`src/worker/index.ts`) owns everything that must be exact: claim, file checks, uploads, complete/fail. Codex only decides what to pull and how to describe it, following `src/worker/instructions.md`, and answers in `src/worker/manifest.schema.json`. Change pulling behaviour in the instructions, not the script.
- Every item goes through the queue, uploads included. Don't add a path that marks an item done without a worker run.
- Bucket files are owned by asset rows: anything under `items/<id>/` without a row is deleted by `sweepItemFiles`. Never write files outside that layout.
- Schema changes are new files in `migrations/` (never edit an applied migration). They run at server start. Update `docs/data-model.md` in the same change.
- When the API changes, update the CLI in `src/cli/index.ts` and the skill in `skill/inspo-swipe-list/` in the same change.
- The dashboard is used mostly on a phone: check every screen at phone width. It uses no emoji.
- The Mac app follows the dashboard's look (palette in `web/src/index.css`, IBM Plex, the brand mark, chips, the masonry library, the item page). When the dashboard's style or flows change, match them in `macos/`.
- The Mac app keeps the credential only in the login Keychain: never log it, print it, bundle it or put it in `UserDefaults`. Media requests go to presigned URLs and never carry it. The server URL must be HTTPS (plain HTTP only for `localhost` and `127.0.0.1`).
- Run `npm test`, both typechecks and `swift test` in `macos/` before committing. Note user-facing changes in `CHANGELOG.md` under `## [Unreleased]`; releases are tagged `vX.Y.Z` from `package.json`'s version, which the Mac app shares.
- Never point local commands at the `main` Neon branch; it is production.
- Public files hold no one's real hosts, account ids, emails or data. Use `example.com` and fictional items in examples.
- Two listeners (`src/server/index.ts`): the agent listener is public on the internet and must never serve the login proxy, the dashboard, or accept owner sessions.
