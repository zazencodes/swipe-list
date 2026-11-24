# A private dashboard and a public agent API

## Decision

One Hono server with two listeners. The dashboard listener serves the web app,
the login proxy and the API for the owner; it is reachable only on the owner's
tailnet (Tailscale), and only `OWNER_EMAILS` can sign in, with an emailed
one-time code. The agent listener is published to the internet through Caddy and
accepts only credentials (`swl_...`); it also serves the CLI and the agent skill.

## Why

Agents and the Mac app need the library from anywhere, and a credential is easy to
issue and revoke per machine. The dashboard holds the owner's session, deletion
and credential management; keeping it off the internet shrinks the attack surface
to the credential check. Tailscale on the phone is enough to reach it.

## Rejected

- **A public dashboard behind the login only.** A larger attack surface, for a
  page only one person uses.
- **Hosting on serverless platforms (Vercel, Neon Functions).** Possible, but the
  worker's long uploads, the two listeners and the private dashboard fit a small
  server better.
