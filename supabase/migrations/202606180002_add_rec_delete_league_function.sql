-- Hard-delete a league and every row scoped to it (records, links, imports, teams, players, etc.),
-- for erasing a league before the inactivity window. Global user identity/economy
-- (rec_users, rec_discord_accounts, rec_wallets, rec_global_user_records, rec_legacy_user_baselines,
-- rec_ea_accounts) and the Discord server row are intentionally preserved. FK enforcement is disabled
-- for the transaction so the bulk delete is order-independent.
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
    'rec_goty_nominations','rec_highlight_posts','rec_import_jobs','rec_import_raw_field_dictionary',
    'rec_import_runs','rec_import_staging_games','rec_import_staging_league_feed',
    'rec_import_staging_player_stats','rec_import_staging_rosters','rec_import_staging_standings',
    'rec_import_staging_team_stats','rec_import_staging_teams','rec_league_configuration',
    'rec_league_ea_franchise_links','rec_league_event_logs','rec_league_feature_settings',
    'rec_league_memberships','rec_league_records','rec_league_user_records','rec_madden_source_links',
    'rec_media_awards','rec_media_submissions','rec_player_weekly_stats','rec_players',
    'rec_poty_nominations','rec_power_rankings','rec_purchase_holds','rec_purchases',
    'rec_roster_snapshots','rec_rule_sections','rec_season_sync_state','rec_season_team_seeds',
    'rec_season_user_records','rec_seasons','rec_server_league_links','rec_stream_compliance_logs',
    'rec_stream_payout_reviews','rec_team_assignments','rec_team_standings_snapshots',
    'rec_team_weekly_stats','rec_teams','rec_user_badges','rec_user_h2h_league_records',
    'rec_weekly_challenges','rec_weekly_player_awards'
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
