-- Dead-highlight pruning (checks each highlight's video against Cloudflare's API) can't be
-- ported into pure SQL the way the spotlight reel / power rankings were — it's genuinely
-- external HTTP work with real branching logic (Cloudflare Stream vs generic playback URL,
-- stuck-pending timeouts). Instead of duplicating that logic in SQL, this triggers the
-- existing, unchanged TypeScript route via pg_net directly from Postgres — same daily
-- schedule, but no separate Railway cron service and no risk of the service-to-service secret
-- drifting out of sync the way the old spotlight-reel-refresh cron did.
--
-- Requires a one-time manual step this migration can't perform (storing a secret needs a
-- human to run it, not an automated migration): run this once in the Supabase SQL editor,
-- with the real REC_INTERNAL_API_KEY value substituted in:
--
--   select vault.create_secret('<REC_INTERNAL_API_KEY value>', 'rec_internal_api_key');
--
-- Until that secret exists, this cron job will fail (no key to send) — non-fatal, just means
-- dead highlights linger an extra day, same as before this migration.
select cron.schedule(
  'prune_dead_highlights_daily',
  '15 13 * * *', -- 8:15 AM America/Chicago — slightly after the 8:00 spotlight/rankings refresh
  $cron$
  select net.http_post(
    url := 'https://recapi-production.up.railway.app/v1/site-home/highlights/prune',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-rec-api-key', (select decrypted_secret from vault.decrypted_secrets where name = 'rec_internal_api_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
