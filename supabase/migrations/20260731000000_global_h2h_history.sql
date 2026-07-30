-- Durable user-vs-user H2H history. Row-per-matchup (not aggregated) so a full historical
-- log can be displayed, not just a W/L tally. Two rows are written per real H2H result — one
-- per participant's perspective — so either side's history query is a simple user_id lookup.
--
-- For an active league, "Last Matchup" can be read straight off rec_game_results (is_user_h2h
-- = true). This table exists for the case rec_game_results can't answer: rec_delete_league
-- hard-deletes rec_game_results for the league being torn down, so a league's H2H games are
-- copied here (see preserveH2hHistoryBeforeLeagueDelete) before that happens — the same
-- preserve-before-delete pattern rec_global_user_records already uses for W/L records.
create table if not exists public.rec_global_h2h_matchups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  opponent_user_id uuid not null references public.rec_users(id) on delete cascade,
  league_name text not null,
  game text,
  season_number integer,
  week_number integer,
  user_team_name text,
  opponent_team_name text,
  user_score integer,
  opponent_score integer,
  result text not null check (result in ('win', 'loss', 'tie')),
  played_at timestamptz,
  source_game_result_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, opponent_user_id, source_game_result_id)
);
alter table public.rec_global_h2h_matchups enable row level security;
create index if not exists rec_global_h2h_matchups_pair_idx
  on public.rec_global_h2h_matchups(user_id, opponent_user_id, played_at desc);
revoke all on table public.rec_global_h2h_matchups from anon, authenticated;
