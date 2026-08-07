-- Madden roster pre-seed, phase 1: baseline dataset + per-league player pool.
-- See docs/madden-fantasy-draft-plan.md for the full feature plan this belongs to.
--
-- Mirrors the CFB baseline pattern (20260731150000_cfb_baseline_roster.sql), simplified:
-- Madden's 32 teams are fixed (join on team_abbreviation against the league's own
-- rec_teams, no separate baseline_teams table needed) and its attribute set is fixed and
-- flat (real columns, not CFB's EAV attribute_key/attribute_value shape).

create table if not exists public.rec_madden_roster_datasets (
  id uuid primary key default gen_random_uuid(),
  game_title text not null,              -- 'madden_27'
  provider text not null,                -- 'maddenratings.com'
  published_date date not null,
  source_version text not null,          -- scrape-date tag, e.g. '2026-08-07'
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (game_title, provider, published_date, source_version)
);
alter table public.rec_madden_roster_datasets enable row level security;
create index if not exists rec_madden_roster_datasets_game_idx on public.rec_madden_roster_datasets(game_title, is_active);

create table if not exists public.rec_madden_baseline_players (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.rec_madden_roster_datasets(id) on delete cascade,
  source_slug text not null,             -- maddenratings.com URL slug — stable player id
  name text not null,
  team_abbreviation text,                -- null = free agent
  position text not null,
  position_full text,
  jersey_number integer,
  archetype text,
  overall_rating integer,                -- null for placeholder (unrated) stub players
  age integer,
  date_of_birth date,
  nationality text,
  college text,
  years_pro integer,
  draft_year integer,
  draft_pick_overall integer,
  drafted_by_team text,
  photo_url text,                        -- Cloudflare-hosted, not the source site's URL
  abilities_raw text,
  data_quality text not null default 'rated' check (data_quality in ('rated', 'backfilled_prior_year', 'placeholder')),
  -- Full flat attribute set (see madden27_all_rosters.csv header for the canonical order).
  speed integer, acceleration integer, strength integer, agility integer, awareness integer,
  jumping integer, injury integer, stamina integer, toughness integer,
  throw_power integer, throw_under_pressure integer, throw_accuracy_short integer,
  throw_accuracy_mid integer, throw_accuracy_deep integer, throw_on_the_run integer, play_action integer,
  catching integer, spectacular_catch integer, catch_in_traffic integer,
  route_running_short integer, route_running_medium integer, route_running_deep integer, release integer,
  carrying integer, break_tackle integer, trucking integer, change_of_direction integer,
  bc_vision integer, stiff_arm integer, spin_move integer, juke_move integer, break_sack integer,
  tackle integer, power_moves integer, finesse_moves integer, block_shedding integer, pursuit integer,
  play_recognition integer, man_coverage integer, zone_coverage integer, hit_power integer, press integer,
  run_block integer, pass_block integer, impact_blocking integer, run_block_power integer,
  run_block_finesse integer, pass_block_power integer, pass_block_finesse integer, lead_block integer,
  kick_power integer, kick_accuracy integer, kick_return integer,
  total_attributes integer,
  created_at timestamptz not null default now(),
  unique (dataset_id, source_slug)
);
alter table public.rec_madden_baseline_players enable row level security;
create index if not exists rec_madden_baseline_players_dataset_idx on public.rec_madden_baseline_players(dataset_id);
create index if not exists rec_madden_baseline_players_team_idx on public.rec_madden_baseline_players(dataset_id, team_abbreviation);
create index if not exists rec_madden_baseline_players_position_idx on public.rec_madden_baseline_players(dataset_id, position);

-- Per-league mutable copy: both "regular_rosters" and "fantasy_draft" leagues get one row
-- per pool player here. team_id starts populated (regular_rosters, real team) or null
-- league-wide (fantasy_draft — position-grouped pool, nothing assigned until drafted).
-- Custom players added via the draft-pool wizard (no baseline_player_id) also live here.
create table if not exists public.rec_madden_league_players (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  baseline_player_id uuid references public.rec_madden_baseline_players(id),
  team_id uuid references public.rec_teams(id),
  is_custom boolean not null default false,
  is_drafted boolean not null default false,
  drafted_pick_id uuid,   -- FK added in the fantasy-draft-session migration (phase 2)
  -- Custom (non-baseline) players carry their own copy of every displayed field instead of
  -- joining to rec_madden_baseline_players — keeps read queries to one table either way.
  custom_name text, custom_position text, custom_jersey_number integer, custom_archetype text,
  custom_overall_rating integer, custom_photo_url text,
  custom_speed integer, custom_acceleration integer, custom_strength integer, custom_agility integer,
  custom_awareness integer, custom_jumping integer, custom_injury integer, custom_stamina integer,
  custom_toughness integer, custom_throw_power integer, custom_throw_under_pressure integer,
  custom_throw_accuracy_short integer, custom_throw_accuracy_mid integer, custom_throw_accuracy_deep integer,
  custom_throw_on_the_run integer, custom_play_action integer, custom_catching integer,
  custom_spectacular_catch integer, custom_catch_in_traffic integer, custom_route_running_short integer,
  custom_route_running_medium integer, custom_route_running_deep integer, custom_release integer,
  custom_carrying integer, custom_break_tackle integer, custom_trucking integer,
  custom_change_of_direction integer, custom_bc_vision integer, custom_stiff_arm integer,
  custom_spin_move integer, custom_juke_move integer, custom_break_sack integer, custom_tackle integer,
  custom_power_moves integer, custom_finesse_moves integer, custom_block_shedding integer,
  custom_pursuit integer, custom_play_recognition integer, custom_man_coverage integer,
  custom_zone_coverage integer, custom_hit_power integer, custom_press integer, custom_run_block integer,
  custom_pass_block integer, custom_impact_blocking integer, custom_run_block_power integer,
  custom_run_block_finesse integer, custom_pass_block_power integer, custom_pass_block_finesse integer,
  custom_lead_block integer, custom_kick_power integer, custom_kick_accuracy integer, custom_kick_return integer,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  check ((is_custom = false and baseline_player_id is not null) or (is_custom = true and custom_name is not null))
);
alter table public.rec_madden_league_players enable row level security;
create index if not exists rec_madden_league_players_league_idx on public.rec_madden_league_players(league_id);
create unique index if not exists rec_madden_league_players_league_baseline_idx
  on public.rec_madden_league_players(league_id, baseline_player_id) where baseline_player_id is not null;
