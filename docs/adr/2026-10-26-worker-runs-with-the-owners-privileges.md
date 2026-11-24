# The worker runs with its user's privileges (accepted risk)

## Decision

The ingestion worker runs Codex as an ordinary macOS user with full access
(`danger-full-access`) and that user's logged-in Chrome. This is a known risk,
stated in the README and the self-hosting guide, and left to each owner to
contain: run the worker under a separate macOS user with its own Chrome profile
and only the logins it needs.

## Why

A security audit on 2026-10-26 rated this the one High finding. Pages and images
the worker reads are untrusted; a successful prompt injection could read local
secrets (the swipe credential, `.env` files) or act through the logged-in
accounts. Instructions telling Codex to ignore page content are guidance, not
containment. A sandboxed Codex cannot reach Chrome, and without Chrome the worker
can't pull logged-in sources.

Only the owner and credentials explicitly trusted to submit work can queue content for this browser. A dedicated worker credential claims and completes each run. Keep detailed diagnostics under the worker account; the library receives a short failure reason.

## Rejected

- **Hardening prompts or schema checks as the fix.** They can't contain a
  compromised agent; only isolation can.
- **Dropping Chrome.** It costs reliability on logged-in sources.
