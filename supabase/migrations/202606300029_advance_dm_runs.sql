-- One row per completed Advance Week, written at the end of completeAdvanceWeek.
-- `advanced_at` anchors "since the previous advance" windows for Advance DMs, and
-- `badge_state` snapshots each user's active badges so the next advance can diff
-- gained / maintained / lost badges per coach.
create table if not exists public.rec_advance_dm_runs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  from_week integer not null,
  to_week integer not null,
  advanced_by_discord_id text,
  advanced_at timestamptz not null default now(),
  badge_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.rec_advance_dm_runs enable row level security;

create index if not exists rec_advance_dm_runs_league_idx
  on public.rec_advance_dm_runs (league_id, season_number, advanced_at desc);
