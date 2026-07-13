alter table public.rec_commissioners_inbox
  add column if not exists dm_notified_at timestamptz;

create index if not exists rec_commissioners_inbox_unattended_idx
  on public.rec_commissioners_inbox (guild_id, created_at)
  where status = 'pending' and dm_notified_at is null;
