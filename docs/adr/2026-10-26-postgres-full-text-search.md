# Search is Postgres full-text search

## Decision

The library is searched with Postgres full-text search over a generated column
on `items`: title, the owner's note and tags weigh most, then the description, then the
author and site, then the source's text. It is updated in the same transaction
that completes an item, so the index is never behind.

## Why

Agents and the owner search with a few words about a look, a technique or a medium.
The worker writes descriptions and tags for exactly that, which keyword search
matches well. A generated column can't drift from the data and needs no job to
keep it current.

## Rejected

- **Embeddings / vector search, for now.** Add them only if keyword search proves
  too weak on a real library; they need a model call per item and per query.
- **A search service.** Nothing here needs one.
