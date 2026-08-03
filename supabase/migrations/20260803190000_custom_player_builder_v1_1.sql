-- REC Custom Player Builder v1.1: durable drafts, versioned builds, roster application,
-- website-only purchase deadlines, and native CFB player identity.

alter table public.rec_players alter column madden_player_id drop not null;
alter table public.rec_players
  add column if not exists player_source text not null default 'imported',
  add column if not exists custom_player_build_id uuid,
  add column if not exists hometown_city text,
  add column if not exists hometown_state text,
  add column if not exists jersey_number integer,
  add column if not exists handedness text,
  add column if not exists archetype text,
  add column if not exists attributes jsonb not null default '{}'::jsonb,
  add column if not exists contract_bonus bigint;

alter table public.rec_league_configuration
  add column if not exists purchase_deadlines jsonb not null default '{}'::jsonb;

create table if not exists public.rec_custom_player_packages (
  id uuid primary key default gen_random_uuid(),
  game_family text not null check (game_family in ('CFB','MADDEN')),
  game_year integer not null,
  package_key text not null,
  tier integer not null check (tier between 1 and 5),
  display_name text not null,
  coin_price integer not null check (coin_price > 0),
  creation_point_budget integer not null check (creation_point_budget > 0),
  target_ovr_min integer not null,
  target_ovr_max integer not null,
  absolute_ovr_cap numeric not null,
  included_dev_credit integer not null default 0,
  high_impact_cap integer not null,
  configuration_version text not null,
  display_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_family, game_year, package_key, configuration_version)
);
alter table public.rec_custom_player_packages enable row level security;

create table if not exists public.rec_player_archetypes (
  id uuid primary key default gen_random_uuid(),
  game_family text not null check (game_family in ('CFB','MADDEN')),
  game_year integer not null,
  position text not null,
  archetype_key text not null,
  display_name text not null,
  primary_attributes jsonb not null default '[]'::jsonb,
  secondary_attributes jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  configuration_version text not null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_family, game_year, position, archetype_key, configuration_version)
);
alter table public.rec_player_archetypes enable row level security;

create table if not exists public.rec_custom_player_wizard_sessions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_id uuid references public.rec_seasons(id) on delete set null,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid references public.rec_teams(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','submitted','cancelled','expired')),
  current_step text not null default 'package',
  game_family text not null check (game_family in ('CFB','MADDEN')),
  game_year integer not null,
  package_tier integer check (package_tier between 1 and 5),
  position text,
  archetype_key text,
  development_trait text,
  identity jsonb not null default '{}'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  evaluation jsonb not null default '{}'::jsonb,
  package_configuration_version text not null,
  cost_configuration_version text not null,
  archetype_configuration_version text not null,
  build_rules_version text not null,
  ovr_model_version text not null,
  name_corpus_version text not null,
  submitted_build_id uuid,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_custom_player_wizard_sessions enable row level security;
create unique index if not exists rec_custom_player_one_active_draft_idx
  on public.rec_custom_player_wizard_sessions (league_id,user_id)
  where status='draft';

create table if not exists public.rec_custom_player_builds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.rec_custom_player_wizard_sessions(id) on delete set null,
  purchase_id uuid references public.rec_purchases(id) on delete set null,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_id uuid references public.rec_seasons(id) on delete set null,
  season_number integer not null,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  -- Retain the build after its outgoing roster row is removed during application.
  replacement_player_id uuid references public.rec_players(id) on delete set null,
  replacement_player_snapshot jsonb not null default '{}'::jsonb,
  created_player_id uuid references public.rec_players(id) on delete set null,
  game_family text not null check (game_family in ('CFB','MADDEN')),
  game_year integer not null,
  package_tier integer not null check (package_tier between 1 and 5),
  package_key text not null,
  position text not null,
  selected_archetype_key text not null,
  inferred_archetype_key text not null,
  development_trait text not null,
  identity jsonb not null,
  attributes jsonb not null,
  evaluation jsonb not null,
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','applied','cancelled','refunded')),
  coin_price integer not null,
  creation_point_budget integer not null,
  attribute_points_spent integer not null,
  development_points_spent integer not null,
  creation_points_spent integer not null,
  creation_points_remaining integer not null,
  unused_cp_refund_coins integer not null default 0,
  estimated_ovr_raw numeric not null,
  estimated_ovr integer not null,
  linear_score numeric not null,
  model_confidence numeric,
  raw_ovr_cap numeric not null,
  support_indexes jsonb not null default '{}'::jsonb,
  package_configuration_version text not null,
  cost_configuration_version text not null,
  archetype_configuration_version text not null,
  build_rules_version text not null,
  ovr_model_version text not null,
  name_corpus_version text not null,
  idempotency_key text not null,
  debit_ledger_id uuid references public.rec_dollar_ledger(id) on delete set null,
  unused_cp_refund_ledger_id uuid references public.rec_dollar_ledger(id) on delete set null,
  reviewed_by_discord_id text,
  review_note text,
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  applied_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id,user_id,idempotency_key)
);
alter table public.rec_custom_player_builds enable row level security;
alter table public.rec_custom_player_wizard_sessions
  add constraint rec_custom_player_session_build_fk foreign key (submitted_build_id)
  references public.rec_custom_player_builds(id) on delete set null;
alter table public.rec_players
  add constraint rec_players_custom_build_fk foreign key (custom_player_build_id)
  references public.rec_custom_player_builds(id) on delete set null;

create table if not exists public.rec_custom_player_build_attributes (
  build_id uuid not null references public.rec_custom_player_builds(id) on delete cascade,
  attribute_key text not null,
  rating integer not null check (rating between 0 and 99),
  points_spent integer not null check (points_spent >= 0),
  per_point_cost_ledger jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (build_id,attribute_key)
);
alter table public.rec_custom_player_build_attributes enable row level security;

create table if not exists public.rec_custom_player_audit_log (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.rec_custom_player_builds(id) on delete cascade,
  action text not null,
  actor_user_id uuid references public.rec_users(id) on delete set null,
  actor_discord_id text,
  previous_status text,
  next_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.rec_custom_player_audit_log enable row level security;

create table if not exists public.rec_custom_player_calibration_runs (
  id uuid primary key default gen_random_uuid(),
  game_family text not null,
  game_year integer not null,
  ovr_model_version text not null,
  cost_configuration_version text not null,
  status text not null default 'draft',
  parameters jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  promoted_at timestamptz,
  promoted_by_user_id uuid references public.rec_users(id) on delete set null
);
alter table public.rec_custom_player_calibration_runs enable row level security;

create table if not exists public.rec_custom_player_calibration_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.rec_custom_player_calibration_runs(id) on delete cascade,
  package_tier integer not null,
  position text not null,
  archetype_key text not null,
  optimizer_strategy text not null,
  max_discovered_ovr numeric not null,
  points_spent integer not null,
  points_remaining integer not null,
  build_attributes jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  iteration_count integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.rec_custom_player_calibration_results enable row level security;

create index if not exists rec_custom_player_builds_review_idx on public.rec_custom_player_builds(league_id,status,submitted_at);
create index if not exists rec_custom_player_builds_user_idx on public.rec_custom_player_builds(user_id,league_id,season_number);
create index if not exists rec_custom_player_audit_build_idx on public.rec_custom_player_audit_log(build_id,created_at);

insert into public.rec_custom_player_packages
  (game_family,game_year,package_key,tier,display_name,coin_price,creation_point_budget,target_ovr_min,target_ovr_max,absolute_ovr_cap,included_dev_credit,high_impact_cap,configuration_version,display_order)
values
  ('CFB',27,'tier_1',1,'Walk-On',500,5000,58,63,65,0,88,'rec-custom-player-packages-v1.1.0',1),
  ('CFB',27,'tier_2',2,'3-Star Recruit',750,5600,64,69,71,0,91,'rec-custom-player-packages-v1.1.0',2),
  ('CFB',27,'tier_3',3,'4-Star Recruit',1000,6300,70,76,78,400,94,'rec-custom-player-packages-v1.1.0',3),
  ('CFB',27,'tier_4',4,'5-Star Recruit',1500,7300,77,82,84,400,97,'rec-custom-player-packages-v1.1.0',4),
  ('CFB',27,'tier_5',5,'Campus GOAT',2000,8500,83,87,88,400,99,'rec-custom-player-packages-v1.1.0',5),
  ('MADDEN',27,'tier_1',1,'JAG (Just a Guy)',500,5000,58,63,65,0,88,'rec-custom-player-packages-v1.1.0',1),
  ('MADDEN',27,'tier_2',2,'Solid Depth Player',750,5600,64,69,71,0,91,'rec-custom-player-packages-v1.1.0',2),
  ('MADDEN',27,'tier_3',3,'Future Starter',1000,6300,70,76,78,400,94,'rec-custom-player-packages-v1.1.0',3),
  ('MADDEN',27,'tier_4',4,'Instant Starter',1500,7300,77,82,84,400,97,'rec-custom-player-packages-v1.1.0',4),
  ('MADDEN',27,'tier_5',5,'Franchise Player',2000,8500,83,87,88,400,99,'rec-custom-player-packages-v1.1.0',5)
on conflict do nothing;

revoke all on public.rec_custom_player_packages, public.rec_player_archetypes,
  public.rec_custom_player_wizard_sessions, public.rec_custom_player_builds,
  public.rec_custom_player_build_attributes, public.rec_custom_player_audit_log,
  public.rec_custom_player_calibration_runs, public.rec_custom_player_calibration_results
from anon, authenticated;
grant all on public.rec_custom_player_packages, public.rec_player_archetypes,
  public.rec_custom_player_wizard_sessions, public.rec_custom_player_builds,
  public.rec_custom_player_build_attributes, public.rec_custom_player_audit_log,
  public.rec_custom_player_calibration_runs, public.rec_custom_player_calibration_results
to service_role;
