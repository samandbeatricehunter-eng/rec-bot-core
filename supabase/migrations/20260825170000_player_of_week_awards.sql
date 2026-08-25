-- Persists computed Player of the Week winners (packages/shared/src/player-of-week.ts) so the
-- automated award only fires once per league/season/week/conference/side, and so the site
-- headline article + Discord post can be rebuilt from stored data instead of recomputed live.
create table if not exists public.rec_player_of_week_awards (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  conference text not null check (conference in ('AFC', 'NFC')),
  side text not null check (side in ('offense', 'defense')),
  player_id uuid not null references public.rec_players(id) on delete cascade,
  player_name text not null,
  position text,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  team_name text not null,
  user_id uuid references public.rec_users(id),
  score numeric not null,
  stat_line jsonb not null,
  coins_awarded integer not null default 0,
  scheduling_bonus_doubled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (league_id, season_number, week_number, conference, side)
);
alter table public.rec_player_of_week_awards enable row level security;
create index if not exists rec_player_of_week_awards_league_week_idx on public.rec_player_of_week_awards (league_id, season_number, week_number);
