-- Persist active-check native poll outcomes for restart-safe settlement/review.
-- Existing active-check tables already have RLS enabled; no new table is created.

alter table public.rec_active_check_events
  add column if not exists discord_channel_id text,
  add column if not exists discord_message_id text,
  add column if not exists status text not null default 'open',
  add column if not exists closes_at timestamptz,
  add column if not exists closed_at timestamptz;

alter table public.rec_active_check_responses
  add column if not exists response_type text not null default 'active';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rec_active_check_responses_type_check') then
    alter table public.rec_active_check_responses
      add constraint rec_active_check_responses_type_check
      check (response_type in ('active', 'kick_me'));
  end if;
end $$;

alter table public.rec_active_check_misses
  add column if not exists discord_id text,
  add column if not exists boot_status text not null default 'pending';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rec_active_check_misses_boot_status_check') then
    alter table public.rec_active_check_misses
      add constraint rec_active_check_misses_boot_status_check
      check (boot_status in ('pending', 'kept', 'booted'));
  end if;
end $$;

create index if not exists rec_active_check_events_message_idx
  on public.rec_active_check_events(discord_channel_id, discord_message_id);

create index if not exists rec_active_check_responses_type_idx
  on public.rec_active_check_responses(event_id, response_type);

create index if not exists rec_active_check_misses_boot_idx
  on public.rec_active_check_misses(event_id, boot_status);
