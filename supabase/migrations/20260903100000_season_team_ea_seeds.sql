-- EA's own computed playoff seed per team per season, imported straight from the Companion
-- App's standings endpoint (teamStandingInfoList: seed/totalWins/totalLosses/totalTies/
-- isPlayoff) -- previously fetched but silently discarded (no canonical mapping for the
-- "standings" endpoint). Kept in its own table, separate from rec_season_team_seeds (which our
-- own from-scratch tiebreaker computation writes on every advance) so an import never races
-- with that recompute -- nfl-standings.service.ts reads both and prefers this one when a
-- complete 1-7 seed set is present for a conference, since Madden's own seeding can diverge
-- from a real-NFL-style tiebreaker chain (confirmed live: it ranked a team ahead of one that
-- had beaten it head-to-head).
create table if not exists public.rec_season_team_ea_seeds (
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  conference text,
  ea_seed integer,
  ea_wins integer,
  ea_losses integer,
  ea_ties integer,
  ea_is_playoff boolean,
  updated_at timestamptz not null default now(),
  primary key (league_id, season_number, team_id)
);
alter table public.rec_season_team_ea_seeds enable row level security;
