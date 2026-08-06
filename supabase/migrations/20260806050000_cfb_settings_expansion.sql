-- CFB league settings expansion: new commissioner-configurable settings, per-conference
-- rules, custom player / legend body types, and a recruit->roster linkage column.

alter table public.rec_league_configuration
  drop constraint if exists rec_league_configuration_coach_xp_setting_check;
alter table public.rec_league_configuration
  add constraint rec_league_configuration_coach_xp_setting_check
  check (coach_xp_setting is null or coach_xp_setting = any (array['casual','career','simulation']));

alter table public.rec_league_configuration
  add column if not exists player_edit_permission text
    check (player_edit_permission is null or player_edit_permission = any (array['commish_only','any_player','none'])),
  add column if not exists manual_xp_progression_penalty_pct integer default 25
    check (manual_xp_progression_penalty_pct is null or manual_xp_progression_penalty_pct between 0 and 100),
  add column if not exists verbal_commit_influence_pct integer default 25
    check (verbal_commit_influence_pct is null or verbal_commit_influence_pct between 0 and 100),
  add column if not exists minimum_play_clock_seconds integer
    check (minimum_play_clock_seconds is null or minimum_play_clock_seconds between 10 and 25),
  add column if not exists user_transfer_chance_pct integer default 55
    check (user_transfer_chance_pct is null or user_transfer_chance_pct between 0 and 100),
  add column if not exists cpu_transfer_chance_pct integer default 55
    check (cpu_transfer_chance_pct is null or cpu_transfer_chance_pct between 0 and 100),
  add column if not exists transfer_portal_max_per_team integer default 20
    check (transfer_portal_max_per_team is null or transfer_portal_max_per_team between 0 and 30),
  add column if not exists season_experience text
    check (season_experience is null or season_experience = any (array['full_control','customized','simple'])),
  add column if not exists cross_play_enabled boolean default true,
  add column if not exists required_console text
    check (required_console is null or required_console = any (array['ps5','xbox','pc']));

create table if not exists public.rec_conference_rules (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  conference_name text not null,
  divisions_enabled boolean not null default false,
  division_1_name text,
  division_2_name text,
  conference_games integer check (conference_games is null or conference_games between 6 and 9),
  conf_champ_game_enabled boolean not null default false,
  champ_game_location text check (champ_game_location is null or champ_game_location = any (array['conference_leader_home','any_stadium'])),
  champ_game_selection_criteria text check (champ_game_selection_criteria is null or champ_game_selection_criteria = any (array['conference_record','division_winners'])),
  protected_opponents_enabled boolean not null default false,
  protected_opponents_count integer not null default 1 check (protected_opponents_count between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, conference_name)
);
alter table public.rec_conference_rules enable row level security;

alter table public.rec_legend_catalog
  add column if not exists body_type text
    check (body_type is null or body_type = any (array['standard','thin','heavy','lean','muscular']));

alter table public.rec_custom_player_builds
  add column if not exists body_type text
    check (body_type is null or body_type = any (array['standard','thin','heavy','lean','muscular'])),
  add column if not exists height_overage_cost integer not null default 0;

-- Links a materialized roster row back to the recruit it came from, so the preseason
-- signing sweep never double-inserts the same signed recruit into rec_players.
alter table public.rec_players
  add column if not exists source_recruit_id uuid references public.rec_recruiting_profiles(id) on delete set null;
