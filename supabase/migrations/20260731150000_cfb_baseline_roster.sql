-- Editorial & Import Master Plan, Phase 2: CFB baseline roster.
--
-- Purpose (master plan §5.1): allow a new CFB league to begin with a known game-year
-- roster before dynasty-specific changes are imported. The baseline is an approved,
-- versioned reference dataset — NOT authoritative after league begins. Approved
-- league-specific screenshots and manual changes supersede it (master plan §5.4).
--
-- Dataset identity (master plan §5.3):
--   game_title + provider + published_date + source_version + checksum

create table if not exists public.rec_cfb_roster_datasets (
  id uuid primary key default gen_random_uuid(),
  game_title text not null,                    -- e.g. 'cfb_27'
  provider text not null,                      -- e.g. 'collegefootballdata.com', 'cfbdataset'
  published_date date not null,                -- when the source dataset was published
  source_version text not null,                -- provider's version string
  checksum text not null,                      -- sha256 of the source file/artifact
  attribution_config jsonb not null default '{}'::jsonb, -- license, citation, URL
  legal_review_status text not null default 'pending' check (legal_review_status in ('pending','approved','rejected')),
  legal_review_notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (game_title, provider, published_date, source_version)
);
alter table public.rec_cfb_roster_datasets enable row level security;
create index if not exists rec_cfb_roster_datasets_game_idx on public.rec_cfb_roster_datasets(game_title, is_active);

-- Baseline teams: the set of FBS teams in the dataset, with stable identifiers.
create table if not exists public.rec_cfb_baseline_teams (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.rec_cfb_roster_datasets(id) on delete cascade,
  source_team_id text not null,                -- stable ID from the provider (e.g. '2594' for Alabama)
  name text not null,                          -- full school name
  abbreviation text not null,                  -- short abbreviation (e.g. 'ALA')
  display_name text,                           -- optional display variant
  conference text,                             -- conference at time of dataset
  division text default 'FBS',
  color_primary text,                          -- team primary color (hex)
  color_secondary text,                        -- team secondary color (hex)
  logo_url text,                               -- optional logo reference
  created_at timestamptz not null default now(),
  unique (dataset_id, source_team_id)
);
alter table public.rec_cfb_baseline_teams enable row level security;
create index if not exists rec_cfb_baseline_teams_dataset_idx on public.rec_cfb_baseline_teams(dataset_id);
create index if not exists rec_cfb_baseline_teams_abbrev_idx on public.rec_cfb_baseline_teams(dataset_id, abbreviation);

-- Baseline players: rostered players at time of dataset.
create table if not exists public.rec_cfb_baseline_players (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.rec_cfb_roster_datasets(id) on delete cascade,
  team_id uuid not null references public.rec_cfb_baseline_teams(id) on delete cascade,
  source_player_id text not null,              -- stable ID from provider
  first_name text not null,
  last_name text not null,
  jersey_number integer,
  position text,                               -- position abbreviation (e.g. 'QB', 'WR', 'LB')
  year text,                                   -- 'FR', 'SO', 'JR', 'SR', 'GR'
  height_inches integer,
  weight_lbs integer,
  hometown_city text,
  hometown_state text,
  overall_rating integer,                      -- if provider includes composite rating
  created_at timestamptz not null default now(),
  unique (dataset_id, source_player_id)
);
alter table public.rec_cfb_baseline_players enable row level security;
create index if not exists rec_cfb_baseline_players_dataset_idx on public.rec_cfb_baseline_players(dataset_id);
create index if not exists rec_cfb_baseline_players_team_idx on public.rec_cfb_baseline_players(team_id);
create index if not exists rec_cfb_baseline_players_name_idx on public.rec_cfb_baseline_players(dataset_id, last_name, first_name);

-- Detailed player attributes (ratings, traits, development) — kept separate for schema stability
-- since providers may offer varying attribute sets.
create table if not exists public.rec_cfb_baseline_player_attributes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.rec_cfb_baseline_players(id) on delete cascade,
  attribute_key text not null,                 -- e.g. 'overall', 'speed', 'throw_power', 'dev_trait'
  attribute_value jsonb not null,              -- numeric, string, or object
  source_field text,                           -- which provider field this came from
  created_at timestamptz not null default now(),
  unique (player_id, attribute_key)
);
alter table public.rec_cfb_baseline_player_attributes enable row level security;
create index if not exists rec_cfb_baseline_player_attrs_player_idx on public.rec_cfb_baseline_player_attributes(player_id);

-- Raw source records preserved immutably — one row per dataset row as received.
-- Enables full re-parse, audit, and reconciliation.
create table if not exists public.rec_cfb_baseline_source_records (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.rec_cfb_roster_datasets(id) on delete cascade,
  record_type text not null check (record_type in ('team','player','attribute')),
  source_id text not null,                     -- provider's primary key for this row
  raw_payload jsonb not null,                  -- exact JSON from the source
  record_hash text not null,                   -- sha256 of raw_payload for dedup
  created_at timestamptz not null default now(),
  unique (dataset_id, record_type, source_id)
);
alter table public.rec_cfb_baseline_source_records enable row level security;
create index if not exists rec_cfb_baseline_source_records_dataset_idx on public.rec_cfb_baseline_source_records(dataset_id);
create index if not exists rec_cfb_baseline_source_records_type_idx on public.rec_cfb_baseline_source_records(dataset_id, record_type);

-- Revoke direct browser access — API service role only (master plan §4.4, §8.1)
revoke all on table public.rec_cfb_roster_datasets from anon, authenticated;
revoke all on table public.rec_cfb_baseline_teams from anon, authenticated;
revoke all on table public.rec_cfb_baseline_players from anon, authenticated;
revoke all on table public.rec_cfb_baseline_player_attributes from anon, authenticated;
revoke all on table public.rec_cfb_baseline_source_records from anon, authenticated;