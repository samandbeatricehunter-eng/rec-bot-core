-- Cached per-user box score stat rollups (season + career) for profiles and EOS payouts.
-- Source of truth remains rec_team_game_stats; rows are rebuilt after each box score approval.

create table if not exists public.rec_user_box_score_profile_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid references public.rec_leagues(id) on delete cascade,
  season_number integer,
  scope text not null check (scope in ('season', 'career')),
  games_logged integer not null default 0,
  box_scores_uploaded integer not null default 0,
  total_yards bigint not null default 0,
  passing_yards bigint not null default 0,
  rushing_yards bigint not null default 0,
  first_downs bigint not null default 0,
  turnovers_generated bigint not null default 0,
  turnovers_committed bigint not null default 0,
  turnover_differential bigint not null default 0,
  red_zone_off_pct_avg integer not null default 0,
  red_zone_def_pct_avg integer not null default 0,
  active_streak text not null default '—',
  updated_at timestamptz not null default now()
);

create unique index if not exists rec_user_box_score_profile_stats_unique
  on public.rec_user_box_score_profile_stats (
    user_id,
    coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(season_number, -1),
    scope
  );

create index if not exists idx_rec_user_box_score_profile_stats_user
  on public.rec_user_box_score_profile_stats (user_id, scope);

alter table public.rec_user_box_score_profile_stats enable row level security;
