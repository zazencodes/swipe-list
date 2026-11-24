# Records, search, files and auth live in one Neon project

## Decision

Neon is the one supported backend. Postgres holds items, assets and the search
index; a private Neon Object Storage bucket holds the files; Neon Auth handles the
dashboard login. Postgres stores bucket keys, never bytes. The API hands out
presigned URLs: the worker uploads straight to the bucket, and the dashboard
streams videos straight from it.

## Why

One provider, one free plan, and one command (`neon deploy`) provisions the
database, the bucket and the login together. Storage and auth branch with the
database, so development and test branches get their own copy of everything.
Storage was costed on 2026-10-26 at $0.023/GB-month with no request fees; a
library of about 1,000 items is about 15 GB.

## Rejected

- **Plain Postgres plus any S3-compatible store.** The storage code would work, but
  the dashboard login would need a second auth system, and every self-hoster
  would wire up three providers.
- **Google Cloud Storage.** About the same cost, and a second provider to wire up.
- **Routing file bytes through the API server.** Videos run to hundreds of MB;
  presigned URLs keep them off the server.
