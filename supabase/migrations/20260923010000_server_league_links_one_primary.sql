-- rec_server_league_links had no constraint preventing more than one is_primary=true row per
-- league; a duplicate setup call could leave two, and every downstream .maybeSingle() query
-- (e.g. checkLeagueLinked) then throws "Expected zero or one row, received 2."
create unique index if not exists rec_server_league_links_one_primary_per_league
  on public.rec_server_league_links (league_id)
  where is_primary;
