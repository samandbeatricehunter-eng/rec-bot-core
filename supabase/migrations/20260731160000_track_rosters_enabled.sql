-- Editorial & Import Master Plan §5 — CFB Track Rosters toggle.
--
-- When ON, a new CFB 27 league is auto-seeded from the approved baseline roster dataset
-- (rec_cfb_roster_datasets + friends) at creation time, so the league begins with the full
-- game-year reference roster instead of an empty one. Distinct from active_rosters_enabled
-- (which controls whether ratings/styles keep tracking real-world changes through the season).
--
-- CFB-only column: null for Madden leagues, matching the existing convention for CFB-only
-- columns on this table (e.g. active_rosters_enabled, dynasty_type, recruiting_difficulty).
alter table public.rec_league_configuration
  add column if not exists track_rosters_enabled boolean;
