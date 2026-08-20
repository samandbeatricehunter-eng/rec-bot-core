alter table public.rec_league_configuration
  add column if not exists force_win_rules_regular text[] not null default '{}',
  add column if not exists force_win_rules_postseason text[] not null default '{}',
  add column if not exists fair_sim_rules_regular text[] not null default '{}',
  add column if not exists fair_sim_rules_postseason text[] not null default '{}';
