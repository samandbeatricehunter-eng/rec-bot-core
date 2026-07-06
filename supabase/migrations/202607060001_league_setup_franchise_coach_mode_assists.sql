-- Franchise/Coach Mode/Assist settings (shared across Madden and CFB), plus CFB's Active Rosters
-- toggle. Coach Mode sub-toggles for recruiting/staff/budget management are CFB-only and stay
-- null for Madden leagues, matching the existing convention for CFB-only columns on this table.
alter table public.rec_league_configuration
  add column if not exists active_rosters_enabled boolean,
  add column if not exists coach_firing_policy text not null default 'on',
  add column if not exists preorder_bonuses_enabled boolean not null default true,
  add column if not exists coach_mode_enabled boolean not null default false,
  add column if not exists coach_mode_auto_pass_enabled boolean not null default false,
  add column if not exists coach_mode_auto_snap_enabled boolean not null default false,
  add column if not exists coach_mode_coach_suggestions_enabled boolean not null default false,
  add column if not exists coach_mode_recruit_flipping_enabled boolean,
  add column if not exists coach_mode_auto_recruiting_enabled boolean,
  add column if not exists coach_mode_auto_progress_players_enabled boolean,
  add column if not exists coach_mode_user_auto_progression_enabled boolean,
  add column if not exists coach_mode_cpu_manage_budget_enabled boolean,
  add column if not exists coach_mode_cpu_manage_staff_enabled boolean,
  add column if not exists coach_mode_cpu_manage_facilities_enabled boolean,
  add column if not exists ball_hawk text not null default 'keep_individual',
  add column if not exists heat_seeker text not null default 'keep_individual',
  add column if not exists switch_assist text not null default 'keep_individual';

-- recruiting_restrictions was never wired into the League Setup UI — drop the dead column.
alter table public.rec_league_configuration
  drop column if exists recruiting_restrictions;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rec_league_configuration_coach_firing_policy_check') then
    alter table public.rec_league_configuration
      add constraint rec_league_configuration_coach_firing_policy_check
      check (coach_firing_policy in ('off', 'on', 'cpu_only'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rec_league_configuration_ball_hawk_check') then
    alter table public.rec_league_configuration
      add constraint rec_league_configuration_ball_hawk_check
      check (ball_hawk in ('on', 'off', 'keep_individual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rec_league_configuration_heat_seeker_check') then
    alter table public.rec_league_configuration
      add constraint rec_league_configuration_heat_seeker_check
      check (heat_seeker in ('on', 'off', 'keep_individual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rec_league_configuration_switch_assist_check') then
    alter table public.rec_league_configuration
      add constraint rec_league_configuration_switch_assist_check
      check (switch_assist in ('on', 'off', 'keep_individual'));
  end if;
end $$;
