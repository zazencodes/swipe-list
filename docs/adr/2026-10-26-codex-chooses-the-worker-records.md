# Codex chooses what to pull; the worker script records it

## Decision

For each claimed item the worker runs `codex exec` in an empty work directory
with written instructions (`src/worker/instructions.md`). Codex decides what to
pull, takes screenshots, and describes the item, then answers with a manifest in
a fixed JSON schema. The worker script owns everything that must be exact: the
claim, checking each listed file, uploading, and completing or failing the item.
Codex never holds the API credential and never touches storage or status.

Every item goes through this path, uploads included, so everything in the
library has a description and tags written the same way.

## Why

What to keep from a link depends on the owner's note ("the second video", "just the
hero") and on what the page turns out to contain, which is judgment. Uploads,
statuses and bucket keys are not, and a model improvising them would corrupt the
library. Splitting it this way lets the instructions change freely while the
bookkeeping stays tested code.

Codex runs with full access (`danger-full-access`) because it drives the owner's real
Chrome, which a sandboxed run cannot reach. Page content is treated as content to
describe, never as instructions.

## Rejected

- **A deterministic scraper per site.** Breaks on every new site,
  and can't follow a free-text note.
- **Codex calling the API itself.** Would put the credential and the item's
  status in the model's hands.
- **Marking uploads done without a worker run.** They would be unsearchable.
