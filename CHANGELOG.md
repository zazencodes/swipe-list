# Changelog

All notable changes to Swipe List are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). The server, the `swipe` CLI and the Mac app share one version.

## [Unreleased]

## [0.1.0] - 2026-11-24

### Added

- The Swipe List server: a queue of saved links and uploads, a searchable library API, a private phone dashboard and a public, credential-only agent API, on Neon (Postgres, Object Storage and Auth).
- The ingestion worker, which has Codex pull each item's media through the fxtwitter API or the owner's Chrome, then describe and tag it, run by Koyomi.
- The `swipe` CLI and the `inspo-swipe-list` agent skill, served by the server with an installer.
- The Mac app (`macos/`): browse, search and filter the library, play videos, add links and screenshots, and manage the queue, signed in with a credential kept in the Keychain.
- `GET /me` and `swipe whoami` return the dashboard's address (`DASHBOARD_URL`).
- The self-hosting guide (`docs/self-hosting.md`).

### Security

- Separate permissions for library clients, trusted submitters and ingestion workers. Each worker lease is bound to its credential. Uploaded media is checked before publication under a new storage key.
- The worker checks its output files before uploading them and keeps detailed diagnostics on its Mac. The CLI uses HTTPS for remote servers and hides credential input. Mac thumbnail caches belong to the signed-in connection.
