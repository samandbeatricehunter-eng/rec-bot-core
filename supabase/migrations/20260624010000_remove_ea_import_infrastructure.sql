-- Remove EA import infrastructure and purge legacy import-derived league data.
-- REC now uses manual setup, box scores, and nflverse default schedules only.

alter table if exists public.rec_game_results drop column if exists import_job_id;
alter table if exists public.rec_weekly_player_awards drop column if exists source_import_job_id;
alter table if exists public.rec_roster_snapshots drop column if exists import_job_id;
alter table if exists public.rec_player_weekly_stats drop column if exists import_job_id;
alter table if exists public.rec_team_weekly_stats drop column if exists import_job_id;
alter table if exists public.rec_league_event_logs drop column if exists import_job_id;

truncate table public.rec_player_weekly_stats;
truncate table public.rec_team_weekly_stats;
truncate table public.rec_roster_snapshots;
truncate table public.rec_weekly_player_awards;
truncate table public.rec_power_rankings;
truncate table public.rec_team_standings_snapshots;
truncate table public.rec_league_records;
truncate table public.rec_season_user_records;
truncate table public.rec_league_user_records;
truncate table public.rec_game_results cascade;
truncate table public.rec_games cascade;
truncate table public.rec_seasons cascade;

drop table if exists public.rec_import_staging_league_feed cascade;
drop table if exists public.rec_import_staging_player_stats cascade;
drop table if exists public.rec_import_staging_team_stats cascade;
drop table if exists public.rec_import_staging_standings cascade;
drop table if exists public.rec_import_staging_games cascade;
drop table if exists public.rec_import_staging_rosters cascade;
drop table if exists public.rec_import_staging_teams cascade;
drop table if exists public.rec_import_raw_field_dictionary cascade;
drop table if exists public.rec_import_endpoint_attempts cascade;
drop table if exists public.rec_import_job_items cascade;
drop table if exists public.rec_import_events cascade;
drop table if exists public.rec_import_payloads cascade;
drop table if exists public.rec_import_runs cascade;
drop table if exists public.rec_league_event_logs cascade;
drop table if exists public.rec_season_sync_state cascade;
drop table if exists public.rec_import_jobs cascade;
drop table if exists public.rec_import_endpoint_catalog cascade;
drop table if exists public.rec_league_ea_franchise_links cascade;
drop table if exists public.rec_ea_franchises cascade;
drop table if exists public.rec_ea_accounts cascade;

alter table public.rec_leagues drop column if exists import_enabled;
alter table public.rec_league_configuration drop column if exists import_mode;
alter table public.rec_league_configuration drop column if exists coin_economy_requires_imported_game_users;
alter table public.rec_server_routes drop column if exists admin_import_log_channel_id;
alter table public.rec_teams drop column if exists import_city;
alter table public.rec_teams drop column if exists import_nick;
alter table public.rec_teams drop column if exists import_abbr;

update public.rec_leagues set trust_mode = 'manual' where trust_mode is distinct from 'manual';

drop index if exists public.rec_games_one_away_team_per_week_key;
drop index if exists public.rec_games_one_home_team_per_week_key;

create unique index if not exists rec_games_one_away_team_per_week_key
  on public.rec_games (league_id, season_id, week_number, away_team_id)
  where away_team_id is not null;

create unique index if not exists rec_games_one_home_team_per_week_key
  on public.rec_games (league_id, season_id, week_number, home_team_id)
  where home_team_id is not null;

create or replace function public.rec_delete_league(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tables text[] := array[
    'rec_account_reconciliation_queue','rec_active_check_events','rec_active_check_misses',
    'rec_active_check_responses','rec_award_winners','rec_awards','rec_commissioners_inbox',
    'rec_dev_upgrade_prizes','rec_dollar_ledger','rec_draft_picks','rec_eos_award_polls',
    'rec_eos_payout_batches','rec_eos_payout_items','rec_game_channel_activity_penalties',
    'rec_game_channel_checkins','rec_game_channels','rec_game_of_week_candidates',
    'rec_game_of_week_polls','rec_game_of_week_votes','rec_game_results','rec_games',
    'rec_goty_nominations','rec_highlight_posts','rec_league_configuration',
    'rec_league_feature_settings','rec_league_memberships','rec_league_records',
    'rec_league_user_records','rec_madden_source_links','rec_media_awards','rec_media_submissions',
    'rec_player_weekly_stats','rec_players','rec_poty_nominations','rec_power_rankings',
    'rec_purchase_holds','rec_purchases','rec_roster_snapshots','rec_rule_sections',
    'rec_season_team_seeds','rec_season_user_records','rec_seasons','rec_server_league_links',
    'rec_stream_compliance_logs','rec_stream_payout_reviews','rec_team_assignments',
    'rec_team_standings_snapshots','rec_team_weekly_stats','rec_teams','rec_user_badges',
    'rec_user_h2h_league_records','rec_weekly_challenges','rec_weekly_player_awards'
  ];
  v_table text;
  v_total int := 0;
  v_count int;
  v_deleted jsonb := '{}'::jsonb;
begin
  if p_league_id is null then
    raise exception 'p_league_id is required';
  end if;
  set local session_replication_role = 'replica';
  foreach v_table in array v_tables loop
    execute format('delete from public.%I where league_id = $1', v_table) using p_league_id;
    get diagnostics v_count = row_count;
    if v_count > 0 then v_deleted := v_deleted || jsonb_build_object(v_table, v_count); end if;
    v_total := v_total + v_count;
  end loop;
  delete from public.rec_leagues where id = p_league_id;
  get diagnostics v_count = row_count;
  return jsonb_build_object('league_id', p_league_id, 'rows_deleted', v_total, 'league_deleted', (v_count > 0), 'tables', v_deleted);
end;
$$;
