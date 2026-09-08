-- Lets an advance moving the league out of the Super Bowl / national-championship stage into
-- the first offseason stage give every purchase-capped type (age resets, dev upgrades,
-- contracts, custom players, legends) a fresh season allotment for the offseason, without
-- touching season_number itself (season_number only advances on entering preseason -- see
-- league-week.service.ts's "ONE rule" comment). Spend is derived live by counting rec_purchases
-- (and rec_custom_player_builds for custom players) -- this just records a cutoff timestamp;
-- purchases at or before it stop counting toward the cap, mirroring the existing
-- rec_attribute_cap_resets mechanism for attribute caps.
alter table public.rec_league_configuration
  add column if not exists purchase_caps_reset_at timestamptz;
