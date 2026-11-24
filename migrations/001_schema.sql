-- Swipe List schema. See docs/data-model.md for how items, assets and stored files fit together.

create table credentials (
  id bigint generated always as identity primary key,
  name text not null unique,
  token_prefix text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  object_type text not null,
  object_id text not null,
  details jsonb not null default '{}'
);
create index audit_log_object_idx on audit_log (object_type, object_id);

-- array_to_string is only stable; generated columns need an immutable expression.
create function tags_text(tags text[]) returns text
  language sql immutable parallel safe
  return array_to_string(tags, ' ');

-- One saved piece of inspiration. A link the owner shared (kind = link) or images they
-- uploaded (kind = upload). Every item goes through the queue: the Mac worker
-- claims it, fetches its media, describes it, and completes it.
create table items (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('link', 'upload')),
  url text unique,
  site text not null default '',
  note text not null default '',
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed')),
  title text not null default '',
  description text not null default '',
  tags text[] not null default '{}',
  author text not null default '',
  extracted_text text not null default '',
  attempts integer not null default 0,
  last_error text,
  run_id uuid,
  claimed_by text,
  claim_expires_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  search tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', note), 'A') ||
    setweight(to_tsvector('english', tags_text(tags)), 'A') ||
    setweight(to_tsvector('english', description), 'B') ||
    setweight(to_tsvector('simple', author || ' ' || site), 'C') ||
    setweight(to_tsvector('english', extracted_text), 'D')
  ) stored,
  check ((kind = 'link') = (url is not null)),
  check ((status = 'processing') = (claim_expires_at is not null))
);
create index items_search_idx on items using gin (search);
create index items_tags_idx on items using gin (tags);
create index items_queue_idx on items (created_at) where status in ('queued', 'processing');
create index items_created_idx on items (created_at desc);

-- A stored file belonging to an item. The bytes live in the `media` bucket at storage_key.
--   upload      an image the owner uploaded themselves (never replaced by the worker)
--   image       an image pulled from the source
--   video       a video pulled from the source
--   thumbnail   a video's poster frame
--   screenshot  a screenshot of a webpage
create table assets (
  id bigint generated always as identity primary key,
  item_id bigint not null references items (id) on delete cascade,
  role text not null check (role in ('upload', 'image', 'video', 'thumbnail', 'screenshot')),
  storage_key text not null unique,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  source_url text,
  caption text not null default '',
  position integer not null,
  created_at timestamptz not null default now(),
  unique (item_id, position)
);
create index assets_item_idx on assets (item_id);
