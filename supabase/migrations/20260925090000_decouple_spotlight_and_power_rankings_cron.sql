-- refresh_daily_maintenance (20260805111500_power_rankings_pg_cron.sql) bundled
-- refresh_spotlight_reel() and refresh_power_rankings() into one cron.schedule command string.
-- pg_cron runs a multi-statement command as a single implicit transaction, so every day since
-- that migration, refresh_power_rankings() throwing (it references rec_badge_ownership, a table
-- that was never actually created -- the badge-ownership schema is drafted but not applied, per
-- project notes) has rolled back refresh_spotlight_reel()'s otherwise-successful work too. The
-- Spotlight Reel has not actually refreshed once since 20260805111500 landed.
--
-- Split back into two independent jobs so one function's failure can never take the other down
-- with it. This does not fix refresh_power_rankings() itself (rec_badge_ownership still doesn't
-- exist -- that's the badge-system rollout's job, not this one) -- it will keep failing daily
-- until that table exists, but that failure now stays contained to power rankings.
select cron.unschedule('refresh_daily_maintenance');

select cron.schedule(
  'refresh_spotlight_reel_daily',
  '0 13 * * *', -- 8:00 AM America/Chicago (CDT = UTC-5)
  $cron$select public.refresh_spotlight_reel();$cron$
);

select cron.schedule(
  'refresh_power_rankings_daily',
  '0 13 * * *', -- 8:00 AM America/Chicago (CDT = UTC-5)
  $cron$select public.refresh_power_rankings();$cron$
);
