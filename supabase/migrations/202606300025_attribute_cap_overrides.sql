-- Per-individual Core attribute purchase caps. core_attributes already holds the selected
-- core attribute codes (string[]); this adds the per-attribute cap overrides. The effective
-- season points cap for a core attribute is overrides[code] when set, else the league's
-- default core cap (core_attribute_purchases_season_cap). Non-core uses one total points cap
-- (non_core_attribute_purchases_season_cap). All caps are points-per-user-per-season.

alter table public.rec_league_configuration
  add column if not exists core_attribute_cap_overrides jsonb not null default '{}'::jsonb;
