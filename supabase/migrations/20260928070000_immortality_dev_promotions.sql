-- Progression Tree purchases (additive characteristic rows) already have unlocked_at /
-- xp_spent / source on rec_immortality_prospect_characteristics. This table records
-- development-trait promotions that the commissioner must replicate in Madden -- EA
-- roster sync overwrites rec_players.dev_trait, so REC cannot treat that column as source of truth.
create table if not exists public.rec_immortality_dev_promotions (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  target_player_id uuid references public.rec_players(id) on delete set null,
  target_name text not null,
  from_trait text not null,
  to_trait text not null,
  source text not null,
  season_number integer not null,
  xp_spent integer not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.rec_immortality_dev_promotions enable row level security;

alter table public.rec_immortality_dev_promotions
  drop constraint if exists rec_immortality_dev_promotions_source_check;
alter table public.rec_immortality_dev_promotions
  add constraint rec_immortality_dev_promotions_source_check
  check (source in ('season_trend', 'self_purchase', 'teammate_purchase'));

alter table public.rec_immortality_dev_promotions
  drop constraint if exists rec_immortality_dev_promotions_status_check;
alter table public.rec_immortality_dev_promotions
  add constraint rec_immortality_dev_promotions_status_check
  check (status in ('pending', 'applied', 'refunded'));

-- One automatic season-trend promotion attempt per prospect per season (refunded still counts).
create unique index if not exists rec_immortality_dev_promotions_trend_season_uidx
  on public.rec_immortality_dev_promotions (prospect_id, season_number)
  where source = 'season_trend';

create index if not exists rec_immortality_dev_promotions_prospect_idx
  on public.rec_immortality_dev_promotions (prospect_id, status);

create index if not exists rec_immortality_dev_promotions_target_idx
  on public.rec_immortality_dev_promotions (target_player_id, status)
  where target_player_id is not null;

-- Origins is free Tier 1 only. Drop any Progression Tree perk that was stored as a
-- creation pick (the old client omitted tier, so a prospect could select them for 0 XP).
delete from public.rec_immortality_prospect_characteristics
where source = 'creation'
  and characteristic_key in (
    'personnel_chief',
    'complete_package',
    'self_made',
    'development_staff',
    'pocket_architect',
    'dual_threat_engine',
    'film_room_commander',
    'spotlight',
    'clutch_gene',
    'immortal_arm',
    'workhorse_frame',
    'home_run_burst',
    'pass_catching_back',
    'between_the_tackles',
    'feature_back',
    'route_technician',
    'contested_catcher',
    'yac_artist',
    'separation_artist',
    'alpha_target',
    'ball_hawk',
    'shutdown_cover',
    'range_finder',
    'interceptor_instinct',
    'defensive_captain',
    'sideline_to_sideline',
    'run_stuffer',
    'coverage_linebacker',
    'tone_setter',
    'heart_of_the_defense'
  );
