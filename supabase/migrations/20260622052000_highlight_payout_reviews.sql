create table if not exists public.rec_highlight_payout_reviews (
  id uuid primary key default gen_random_uuid(),
  highlight_post_id uuid not null references public.rec_highlight_posts(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id),
  team_id uuid references public.rec_teams(id),
  season_number integer not null,
  week_number integer not null,
  payout_kind text not null default 'weekly_highlight' check (payout_kind in ('weekly_highlight', 'season_award')),
  award_category text,
  vote_count integer,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'issued')),
  amount integer not null default 25,
  discord_channel_id text,
  discord_message_id text,
  reviewed_by_discord_id text,
  denied_reason text,
  issued_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_highlight_payout_reviews enable row level security;

create unique index if not exists rec_highlight_payout_reviews_post_kind_key
  on public.rec_highlight_payout_reviews(highlight_post_id, payout_kind, (coalesce(award_category, '')));

create unique index if not exists rec_highlight_award_review_category_key
  on public.rec_highlight_payout_reviews(league_id, season_number, payout_kind, award_category)
  where payout_kind = 'season_award' and award_category is not null;

create index if not exists rec_highlight_payout_reviews_week_user_idx
  on public.rec_highlight_payout_reviews(league_id, season_number, week_number, user_id, status);

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
    'rec_goty_nominations','rec_highlight_payout_reviews','rec_highlight_posts','rec_import_jobs',
    'rec_import_raw_field_dictionary','rec_import_runs','rec_import_staging_games',
    'rec_import_staging_league_feed','rec_import_staging_player_stats','rec_import_staging_rosters',
    'rec_import_staging_standings','rec_import_staging_team_stats','rec_import_staging_teams',
    'rec_league_configuration','rec_league_ea_franchise_links','rec_league_event_logs',
    'rec_league_feature_settings','rec_league_memberships','rec_league_records',
    'rec_league_user_records','rec_madden_source_links','rec_media_awards','rec_media_submissions',
    'rec_player_weekly_stats','rec_players','rec_poty_nominations','rec_power_rankings',
    'rec_purchase_holds','rec_purchases','rec_roster_snapshots','rec_rule_sections',
    'rec_season_sync_state','rec_season_team_seeds','rec_season_user_records','rec_seasons',
    'rec_server_league_links','rec_stream_compliance_logs','rec_stream_payout_reviews',
    'rec_team_assignments','rec_team_standings_snapshots','rec_team_weekly_stats','rec_teams',
    'rec_user_badges','rec_user_h2h_league_records','rec_weekly_challenges','rec_weekly_player_awards'
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
