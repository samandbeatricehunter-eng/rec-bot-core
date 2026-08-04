-- Dev-trait upgrade purchase caps: a league picks ONE of two limiting modes. dev_upgrades_season_cap
-- (already existed) is reused for 'total_purchases' — a flat count of purchase actions per
-- season. dev_upgrades_player_cap is new, for 'players_per_season' — caps how many DISTINCT
-- players a team can upgrade in a season; once chosen, a player can climb as many tiers as
-- purchased with no further slot cost.
alter table public.rec_league_configuration add column if not exists dev_upgrade_cap_mode text not null default 'total_purchases' check (dev_upgrade_cap_mode in ('total_purchases', 'players_per_season'));
alter table public.rec_league_configuration add column if not exists dev_upgrades_player_cap integer not null default 0;
