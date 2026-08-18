-- REC Game Scheduling System, Phase 1: availability foundation.
-- Per-user timezone + recurring weekly availability + temporary overrides (week/day/matchup),
-- plus tracking for the persistent division-grouped Discord availability board messages.
-- Global by default (league_id null), overrideable per league per user's design (point 28).

create table if not exists public.rec_user_availability_profiles (
  user_id uuid primary key references public.rec_users(id) on delete cascade,
  timezone text,
  timezone_source text not null default 'unset' check (timezone_source in ('unset', 'site_detected', 'site_manual', 'discord_manual')),
  show_detailed_availability boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.rec_user_availability_profiles enable row level security;

-- Recurring "when I can normally play" windows. weekday follows JS Date#getDay (0=Sunday..6=Saturday).
-- start_minute/end_minute are minutes-since-local-midnight; end_minute may exceed 1440 to express
-- a window crossing into the next calendar day (e.g. Sat 7PM-1AM = start 1140, end 1500).
-- league_id null = this user's global default availability; a non-null row scopes it to one league.
create table if not exists public.rec_user_availability_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid references public.rec_leagues(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 2880),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rec_user_availability_windows_range check (end_minute > start_minute)
);
create index if not exists rec_user_availability_windows_user_idx on public.rec_user_availability_windows (user_id, league_id, weekday) where active;
alter table public.rec_user_availability_windows enable row level security;

-- Temporary exceptions layered over the recurring default: a full week's adjustment, a single
-- day's adjustment, or a single-matchup adjustment (game_id set). Resolution order at query time
-- is matchup > week > default (day overrides are just a week override with a narrower starts_at/
-- ends_at span, so no separate "day" storage is needed beyond the scope label for UI purposes).
-- unavailable=true is a blackout window; unavailable=false is an added/replacement available window.
create table if not exists public.rec_availability_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid references public.rec_leagues(id) on delete cascade,
  game_id uuid references public.rec_games(id) on delete cascade,
  scope text not null check (scope in ('week', 'day', 'matchup')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  unavailable boolean not null default false,
  timezone_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint rec_availability_overrides_range check (ends_at > starts_at),
  constraint rec_availability_overrides_matchup_scope check (scope != 'matchup' or game_id is not null)
);
create index if not exists rec_availability_overrides_user_idx on public.rec_availability_overrides (user_id, league_id, starts_at, ends_at);
create index if not exists rec_availability_overrides_game_idx on public.rec_availability_overrides (game_id) where game_id is not null;
alter table public.rec_availability_overrides enable row level security;

-- One row per persistent Discord message the bot edits in place (the control panel, plus one
-- section per division/grouping) so the availability board never spams new messages.
create table if not exists public.rec_availability_board_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  discord_channel_id text not null,
  section_key text not null,
  discord_message_id text not null,
  updated_at timestamptz not null default now(),
  unique (league_id, section_key)
);
alter table public.rec_availability_board_messages enable row level security;
