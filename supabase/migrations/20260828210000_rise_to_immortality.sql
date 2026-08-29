-- Rise to Immortality: Madden 27 franchise mode.
-- Maps onto existing rec_leagues / rec_teams / rec_users / rec_players rather than duplicating
-- those systems. Store purchases stay off; Player XP and annual contract coins are mode-specific.

create table if not exists public.rec_immortality_leagues (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null unique references public.rec_leagues(id) on delete cascade,
  chapter_state text not null default 'SETUP',
  offense_position text not null,
  defense_position text not null,
  creation_point_budget integer not null default 60,
  max_seasons integer not null default 10,
  formula_versions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (chapter_state in (
    'SETUP','REGISTRATION','ORIGINS','ORIGINS_COMPLETE',
    'ROOKIE_DRAFT_PREP','ROOKIE_DRAFT_LIVE','ROOKIE_DRAFT_COMPLETE','TEAM_DRAFT',
    'FRANCHISE_ACTIVE','OFFSEASON','IMMORTALITY_PREP','IMMORTALITY_VOTING',
    'IMMORTALITY_REVEAL','ARCHIVED'
  )),
  check (offense_position in ('QB','HB','WR','TE')),
  check (defense_position in ('CB','FS','SS','MIKE'))
);
alter table public.rec_immortality_leagues enable row level security;
create index if not exists rec_immortality_leagues_state_idx on public.rec_immortality_leagues(chapter_state);

create table if not exists public.rec_immortality_state_history (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  from_state text,
  to_state text not null,
  actor_user_id uuid references public.rec_users(id),
  note text,
  created_at timestamptz not null default now()
);
alter table public.rec_immortality_state_history enable row level security;
create index if not exists rec_immortality_state_history_league_idx on public.rec_immortality_state_history(immortality_league_id, created_at);

create table if not exists public.rec_immortality_prospects (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  side text not null check (side in ('offense','defense')),
  position text not null,
  first_name text,
  last_name text,
  age integer,
  hometown text,
  hometown_state text,
  college text,
  jersey_number integer,
  height_inches integer,
  weight_lbs integer,
  body_type text,
  headshot_url text,
  player_id uuid references public.rec_players(id),
  origins_step text not null default 'identity',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (immortality_league_id, user_id, side),
  check (age is null or (age >= 18 and age <= 22)),
  check (jersey_number is null or (jersey_number >= 0 and jersey_number <= 99))
);
alter table public.rec_immortality_prospects enable row level security;
create index if not exists rec_immortality_prospects_user_idx on public.rec_immortality_prospects(immortality_league_id, user_id);

create table if not exists public.rec_immortality_iq_attempts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  side text not null,
  started_at timestamptz not null default now(),
  current_question integer not null default 1,
  question_started_at timestamptz not null default now(),
  question_expires_at timestamptz not null,
  completed_at timestamptz,
  correct_count integer not null default 0,
  iq_score integer,
  awareness_result integer,
  play_recognition_result integer,
  test_version text not null default 'immortality-iq-v1',
  unique (prospect_id)
);
alter table public.rec_immortality_iq_attempts enable row level security;

create table if not exists public.rec_immortality_iq_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.rec_immortality_iq_attempts(id) on delete cascade,
  question_id integer not null,
  presented_option_order integer[] not null,
  selected_option integer,
  timed_out boolean not null default false,
  submitted_at timestamptz not null default now(),
  response_ms integer,
  correct boolean not null default false,
  unique (attempt_id, question_id)
);
alter table public.rec_immortality_iq_answers enable row level security;

create table if not exists public.rec_immortality_persona_results (
  prospect_id uuid primary key references public.rec_immortality_prospects(id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  primary_dimension text not null,
  secondary_dimension text not null,
  label text not null,
  answers jsonb not null default '[]'::jsonb,
  formula_version text not null default 'immortality-persona-v1',
  created_at timestamptz not null default now()
);
alter table public.rec_immortality_persona_results enable row level security;

create table if not exists public.rec_immortality_playstyle_results (
  prospect_id uuid primary key references public.rec_immortality_prospects(id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  primary_archetype text not null,
  secondary_archetype text not null,
  blend jsonb not null default '{}'::jsonb,
  answers jsonb not null default '[]'::jsonb,
  formula_version text not null default 'immortality-playstyle-v1',
  created_at timestamptz not null default now()
);
alter table public.rec_immortality_playstyle_results enable row level security;

create table if not exists public.rec_immortality_prospect_characteristics (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  characteristic_key text not null,
  slot_cost integer not null,
  unique (prospect_id, characteristic_key)
);
alter table public.rec_immortality_prospect_characteristics enable row level security;

create table if not exists public.rec_immortality_creation_builds (
  prospect_id uuid primary key references public.rec_immortality_prospects(id) on delete cascade,
  baseline_attributes jsonb not null default '{}'::jsonb,
  spent_attributes jsonb not null default '{}'::jsonb,
  final_attributes jsonb not null default '{}'::jsonb,
  creation_points_spent integer not null default 0,
  creation_points_budget integer not null default 60,
  estimated_ovr integer,
  draft_value numeric,
  projected_round integer,
  formula_version text not null default 'immortality-cp-v1',
  updated_at timestamptz not null default now()
);
alter table public.rec_immortality_creation_builds enable row level security;

create table if not exists public.rec_immortality_draft_classes (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null unique references public.rec_immortality_leagues(id) on delete cascade,
  status text not null default 'pending',
  solved_at timestamptz,
  formula_version text not null default 'immortality-draft-v1',
  created_at timestamptz not null default now()
);
alter table public.rec_immortality_draft_classes enable row level security;

create table if not exists public.rec_immortality_draft_assignments (
  id uuid primary key default gen_random_uuid(),
  draft_class_id uuid not null references public.rec_immortality_draft_classes(id) on delete cascade,
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  round integer not null,
  overall_pick integer not null,
  reveal_ownership boolean not null default false,
  revealed_at timestamptz,
  unique (draft_class_id, prospect_id),
  unique (draft_class_id, overall_pick)
);
alter table public.rec_immortality_draft_assignments enable row level security;
create index if not exists rec_immortality_draft_assignments_class_idx on public.rec_immortality_draft_assignments(draft_class_id, overall_pick);

create table if not exists public.rec_immortality_user_team_assignments (
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  revealed_at timestamptz,
  primary key (immortality_league_id, user_id),
  unique (immortality_league_id, team_id)
);
alter table public.rec_immortality_user_team_assignments enable row level security;

create table if not exists public.rec_immortality_xp_ledger (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  season integer,
  week integer,
  event_type text not null,
  source_id text,
  player_xp_delta integer not null default 0,
  team_xp_delta integer not null default 0,
  balance_after integer,
  formula_version text not null default 'immortality-xp-v1',
  created_at timestamptz not null default now(),
  unique (prospect_id, event_type, source_id)
);
alter table public.rec_immortality_xp_ledger enable row level security;
create index if not exists rec_immortality_xp_ledger_prospect_idx on public.rec_immortality_xp_ledger(prospect_id, created_at);

create table if not exists public.rec_immortality_team_xp_ledger (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  teammate_player_id uuid references public.rec_players(id),
  player_xp_spent integer not null,
  team_xp_gained integer not null,
  attribute_code text,
  created_at timestamptz not null default now()
);
alter table public.rec_immortality_team_xp_ledger enable row level security;

create table if not exists public.rec_immortality_contracts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  contract_number integer not null check (contract_number in (1, 2, 3)),
  start_season integer not null,
  end_season integer not null,
  coins_per_season integer not null,
  band text,
  formula_version text not null default 'immortality-contracts-v1',
  created_at timestamptz not null default now(),
  unique (prospect_id, contract_number)
);
alter table public.rec_immortality_contracts enable row level security;

create table if not exists public.rec_immortality_contract_scores (
  contract_id uuid primary key references public.rec_immortality_contracts(id) on delete cascade,
  production_score numeric not null,
  awards_score numeric not null,
  postseason_score numeric not null,
  raw_performance_score numeric not null,
  known_commodity_floor_applied boolean not null default false,
  negotiator_multiplier numeric not null default 1,
  final_salary integer not null,
  formula_version text not null
);
alter table public.rec_immortality_contract_scores enable row level security;

create table if not exists public.rec_immortality_career_scores (
  prospect_id uuid primary key references public.rec_immortality_prospects(id) on delete cascade,
  production numeric not null default 0,
  peak_dominance numeric not null default 0,
  awards numeric not null default 0,
  winning numeric not null default 0,
  records_legacy numeric not null default 0,
  career_score numeric not null default 0,
  normalized_vote numeric not null default 0,
  immortality_score numeric not null default 0,
  formula_version text not null default 'immortality-career-score-v1',
  calculated_at timestamptz not null default now()
);
alter table public.rec_immortality_career_scores enable row level security;

create table if not exists public.rec_immortality_hof_votes (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  voter_user_id uuid not null references public.rec_users(id) on delete cascade,
  side text not null check (side in ('offense','defense')),
  nominee_prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (immortality_league_id, voter_user_id, side)
);
alter table public.rec_immortality_hof_votes enable row level security;

create table if not exists public.rec_immortality_audit_log (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  actor_user_id uuid references public.rec_users(id),
  event_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.rec_immortality_audit_log enable row level security;
create index if not exists rec_immortality_audit_log_league_idx on public.rec_immortality_audit_log(immortality_league_id, created_at);
