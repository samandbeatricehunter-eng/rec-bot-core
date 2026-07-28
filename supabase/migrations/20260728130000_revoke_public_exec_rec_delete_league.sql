-- rec_delete_league is a SECURITY DEFINER function that hard-deletes an entire league
-- (disabling triggers via session_replication_role='replica' and deleting across ~60
-- tables) with no auth.uid() check of its own — it relies entirely on callers being
-- pre-authorized. It was granted EXECUTE to PUBLIC (i.e. callable by anon/authenticated via
-- PostgREST's /rest/v1/rpc/rec_delete_league using just the project's anon/publishable key),
-- which bypasses this app's whole "no anon-key client, service role only" security model.
-- The only caller is apps/api/src/modules/setup/setup.service.ts via the service-role
-- client, so revoking PUBLIC execute changes nothing for legitimate use.
revoke execute on function public.rec_delete_league(uuid) from public;
revoke execute on function public.rec_delete_league(uuid) from anon;
revoke execute on function public.rec_delete_league(uuid) from authenticated;
