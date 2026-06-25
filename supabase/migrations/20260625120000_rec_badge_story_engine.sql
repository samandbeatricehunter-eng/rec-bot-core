-- Box-score story + badge engine tables. Everything here is computed at box-score
-- IMPORT time and only READ at advance time (see box-score-intelligence module).
-- All tables enable RLS per project policy; the service role bypasses it and there
-- are intentionally no anon policies.

-- ── Per-team/game computed tactical labels + qualified badges ────────────────────
create table if not exists public.rec_game_profiles (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  season integer not null,
  week integer not null,
  game_id uuid,
  team_id uuid,
  user_id uuid,
  opponent_team_id uuid,
  won boolean,
  margin integer,
  story_angles jsonb,
  qualified_badges jsonb,
  profile jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, team_id)
);
alter table public.rec_game_profiles enable row level security;
create index if not exists idx_rec_game_profiles_league_week on public.rec_game_profiles (league_id, season, week);
create index if not exists idx_rec_game_profiles_user on public.rec_game_profiles (user_id);

-- ── One generated narrative per game ─────────────────────────────────────────────
create table if not exists public.rec_game_stories (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  season integer not null,
  week integer not null,
  game_id uuid,
  winner_team_id uuid,
  loser_team_id uuid,
  primary_angle text,
  headline text,
  body text,
  notes jsonb,
  posted_message_id text,
  posted_channel_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id)
);
alter table public.rec_game_stories enable row level security;
create index if not exists idx_rec_game_stories_league_week on public.rec_game_stories (league_id, season, week);

-- ── Permanent badge ownership (weekly / season / global) ─────────────────────────
create table if not exists public.rec_user_badges (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  user_id uuid not null,
  team_id uuid,
  badge_key text not null,
  badge_scope text not null,            -- 'weekly' | 'season' | 'global'
  tier text not null default 'normal',  -- 'normal' | 'bronze' | 'silver' | 'gold' | 'xf'
  season integer,
  week integer,
  earned_count integer not null default 1,
  current_streak integer not null default 1,
  best_streak integer not null default 1,
  last_earned_week integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_user_badges enable row level security;
-- Season-scoped badges are unique per (user, key, scope, season); global badges
-- (season is null) are unique per (user, key, scope).
create unique index if not exists uq_rec_user_badges_seasoned
  on public.rec_user_badges (league_id, user_id, badge_key, badge_scope, season)
  where season is not null;
create unique index if not exists uq_rec_user_badges_global
  on public.rec_user_badges (league_id, user_id, badge_key, badge_scope)
  where season is null;
create index if not exists idx_rec_user_badges_lookup on public.rec_user_badges (league_id, user_id, badge_scope);

-- ── Append-only audit/history of every badge earn ────────────────────────────────
create table if not exists public.rec_user_badge_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  user_id uuid not null,
  team_id uuid,
  badge_key text not null,
  badge_scope text not null,
  tier text,
  season integer,
  week integer,
  game_id uuid,
  reason text,
  stats_snapshot jsonb,
  created_at timestamptz not null default now()
);
alter table public.rec_user_badge_events enable row level security;
create index if not exists idx_rec_user_badge_events_user on public.rec_user_badge_events (league_id, user_id, season);
create index if not exists idx_rec_user_badge_events_game on public.rec_user_badge_events (game_id);
