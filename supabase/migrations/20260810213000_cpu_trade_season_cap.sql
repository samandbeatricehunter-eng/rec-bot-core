alter table public.rec_league_configuration
  add column if not exists cpu_trades_season_cap integer not null default 0;

alter table public.rec_league_configuration
  drop constraint if exists rec_league_configuration_cpu_trades_season_cap_check;

alter table public.rec_league_configuration
  add constraint rec_league_configuration_cpu_trades_season_cap_check
  check (cpu_trades_season_cap between 0 and 5);

comment on column public.rec_league_configuration.cpu_trades_season_cap is
  'Maximum trades per user-controlled team per season involving a CPU-controlled team. Zero means unlimited.';
