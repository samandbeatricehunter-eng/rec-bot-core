-- APPLIED 2026-08-25 (via Supabase MCP, after explicit user approval).
--
-- rec_cleanup_stale_leagues_daily (live since 202606150003_stale_league_cleanup.sql, moved to
-- the private schema in 202606160002) called private.rec_cleanup_stale_leagues(21, false),
-- which ran a raw `delete from rec_leagues` for any league inactive 21+ days -- with NO call
-- to preserveGlobalContributionsBeforeLeagueDelete()/preserveH2hHistoryBeforeLeagueDelete()
-- (official-records.service.ts, live since 202607290000, six weeks AFTER this cron started
-- running). This is the confirmed root cause of the orphaned rec_team_game_stats rows and
-- stale rec_user_h2h_global_records data found in the 2026-08 combined data-integrity audit
-- (see 20260925100000_backfill_rec_games_from_results.sql and
-- 20260925110000_drop_dead_records_tables.sql) -- and it has kept running daily the entire
-- time, meaning any league that goes 21+ days inactive from today forward would have hit the
-- exact same unsafe path again.
--
-- Fix: same pg_net-to-TypeScript-route pattern as prune_dead_highlights_daily
-- (20260805120000_prune_dead_highlights_pg_cron.sql) -- the cron now calls
-- POST /v1/admin/leagues/sweep-stale, which runs sweepStaleLeagues() (admin.service.ts). That
-- function shares deleteLeagueWithPreservation() with the human-driven admin delete flow, so
-- both paths always run stream-highlight cleanup + both preservation calls before the actual
-- rec_delete_league RPC. Same 21-day default and same staleness signal
-- (coalesce(last_advanced_at, updated_at, created_at)) as the old function, so WHEN a league
-- goes stale is unchanged -- only HOW it gets deleted changed.
select cron.unschedule('rec_cleanup_stale_leagues_daily');

select cron.schedule(
  'rec_cleanup_stale_leagues_daily',
  '17 9 * * *', -- unchanged schedule
  $cron$
  select net.http_post(
    url := 'https://recapi-production.up.railway.app/v1/admin/leagues/sweep-stale',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-rec-api-key', (select decrypted_secret from vault.decrypted_secrets where name = 'rec_internal_api_key')
    ),
    body := '{"staleDays": 21}'::jsonb
  );
  $cron$
);

drop function if exists private.rec_cleanup_stale_leagues(integer, boolean);
