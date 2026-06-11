-- Persist EA playoff seed / playoffStatus per team per season so EOS logic can tell who made the
-- playoffs INCLUDING first-round-bye teams (which have no wild-card game yet). Previously playoff
-- participation was inferred from is_playoff game results, which wrongly flagged #1-seed bye teams
-- as "missed playoffs".
create table if not exists public.rec_season_team_seeds (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  conference text,
  seed integer,
  playoff_status integer,
  made_playoffs boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, season_number, team_id)
);

alter table public.rec_season_team_seeds enable row level security;

create index if not exists idx_rec_season_team_seeds_lookup
  on public.rec_season_team_seeds (league_id, season_number);
