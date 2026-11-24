alter table credentials add column permission text not null default 'client'
  check (permission in ('client', 'submitter', 'worker'));

alter table items add column claimant_id bigint references credentials (id);

-- Old leases have no authenticated worker identity. Require a fresh trusted submission
-- for queued agent input; the owner can review and retry those items.
update items set status = 'failed', run_id = null, claimed_by = null, claim_expires_at = null,
  last_error = 'A trusted submitter must review and retry this item.', updated_at = now()
where status in ('queued', 'processing') and created_by not like 'owner:%';

update items set status = 'queued', attempts = 0, run_id = null, claimed_by = null,
  claim_expires_at = null, updated_at = now()
where status = 'processing';

alter table items add check ((status = 'processing') = (claimant_id is not null));

create table worker_uploads (
  storage_key text primary key,
  item_id bigint not null references items (id) on delete cascade,
  run_id uuid not null,
  content_type text not null
);
create index worker_uploads_item_idx on worker_uploads (item_id);
