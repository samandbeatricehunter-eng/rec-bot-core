-- Add the three launch prices to the global economy JSON without disturbing any
-- commissioner overrides already stored for the legacy products.
update public.rec_global_economy_config
set config = jsonb_set(
      jsonb_set(
        jsonb_set(config, '{store,bust}', '2000'::jsonb, true),
        '{store,hometownHero}', '4000'::jsonb, true
      ),
      '{store,celebsCouldveBeens}', '4000'::jsonb, true
    ),
    version = version + 1,
    updated_at = now()
where config_key = 'global';

-- The expanded storefront shares one team-based cap across Legends, Immortals,
-- Busts, Hometown Heroes, Screen Stars, and Could've Beens. Raise leagues using
-- the former three-player policy; do not overwrite leagues with a different
-- commissioner-selected limit.
update public.rec_league_configuration
set legends_season_cap = 4,
    updated_at = now()
where legends_enabled = true
  and legends_season_cap = 3;
