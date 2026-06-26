-- DB-backed weekly-scores review (parsed from a League Schedule screenshot) so the
-- pending-payouts embed survives restarts and any commissioner can approve. One
-- pending review per league/season/week; a new upload supersedes the prior one,
-- and the review is cleared when the week advances.
create table if not exists public.rec_weekly_score_reviews (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  guild_id text,
  image_url text,
  games jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'logged', 'cancelled')),
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_weekly_score_reviews enable row level security;

create index if not exists rec_weekly_score_reviews_league_week_status_idx
  on public.rec_weekly_score_reviews (league_id, season_number, week_number, status);

create unique index if not exists rec_weekly_score_reviews_unique_pending_week_idx
  on public.rec_weekly_score_reviews (league_id, season_number, week_number)
  where status = 'pending';
