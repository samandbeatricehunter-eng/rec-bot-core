create table if not exists public.rec_matchup_panels (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  server_id uuid not null references public.rec_discord_servers(id) on delete cascade,
  season_number integer not null default 1,
  week_number integer not null,
  game_id text,
  home_team_id text,
  away_team_id text,
  home_discord_id text,
  away_discord_id text,
  status text not null default 'not_scheduled',
  status_text text not null default 'Not Scheduled Yet',
  channel_id text,
  message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rec_matchup_panels_week_idx
  on public.rec_matchup_panels(league_id, week_number);
