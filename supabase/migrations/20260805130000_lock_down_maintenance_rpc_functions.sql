-- refresh_power_rankings/refresh_spotlight_reel (added by the pg_cron migrations earlier
-- today) are security definer, and Postgres grants EXECUTE on new functions to PUBLIC by
-- default — meaning both were callable by anyone via PostgREST's /rest/v1/rpc/ endpoint,
-- unauthenticated, and each call does a full multi-league table rewrite. Same lockdown
-- pattern as 20260728210000_lock_down_rec_rpcs.sql / 20260728130000_revoke_public_exec_rec_delete_league.sql.
-- pg_cron itself is unaffected — it calls these as the job owner, not through PostgREST.
revoke execute on function public.refresh_power_rankings() from public, anon, authenticated;
revoke execute on function public.refresh_spotlight_reel() from public, anon, authenticated;
