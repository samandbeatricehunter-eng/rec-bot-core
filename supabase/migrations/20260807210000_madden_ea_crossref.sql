-- Madden 27 EA cross-reference pass — EA.com's official ratings are now the source of
-- truth for player ratings (see docs/madden-fantasy-draft-plan.md §12 progress log).
-- Adds the columns needed to store EA-derived data on the baseline rows:
--   dev_trait      derived development-trait tier (normal/star/superstar/xfactor),
--                  values match @rec/shared's RecDevTier MADDEN ladder; derived from the
--                  player's equipped ability types (xfactor ability => xfactor, any other
--                  ability => superstar, none => normal). EA's public site does not expose
--                  Star vs Normal directly (its silver-star badge is a rendered overlay,
--                  not data), so Star players read as normal.
--   ea_player_id   EA's own numeric player id — stable identity for future re-scrapes.
--   height/weight/handedness — present on EA, now forwarded to rec_players by the apply
--                  flow so the roster viewer can show Ht/Wt/Handedness for Madden.
-- abilities_raw (existing text column) is repurposed on EA-confirmed rows to hold a
-- structured JSON array of equipped abilities [{id,label,type}], replacing the raw
-- maddenratings.com text blob; the full ability catalog (with descriptions for tooltips)
-- lives in apps/api/scripts/data/madden27/madden27_ea_abilities_catalog.json.
alter table public.rec_madden_baseline_players
  add column if not exists dev_trait text check (dev_trait in ('normal', 'star', 'superstar', 'xfactor')),
  add column if not exists ea_player_id bigint,
  add column if not exists height_inches integer,
  add column if not exists weight_lbs integer,
  add column if not exists handedness text;
