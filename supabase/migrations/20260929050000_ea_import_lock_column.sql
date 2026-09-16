-- Replaces the pg_advisory_lock-based cross-process import guard (acquireLeagueImportLock in
-- ea-connections.service.ts) with a plain row timestamp, self-healing the same way
-- rec_leagues.advance_in_progress_since already does.
--
-- Found live: releaseLeagueImportLock ran `pg_advisory_unlock` then swallowed its result
-- (`.catch(() => undefined)`) before unconditionally calling `client.release()` -- if the unlock
-- itself ever failed (a transient network blip, the connection being reset mid-call), the
-- connection still went back into the pg.Pool and got reused for ordinary unrelated queries, all
-- while Postgres still considered the advisory lock held on that session. Confirmed live: a
-- connection idle-and-serving-unrelated-queries for hours was still shown by pg_locks as holding
-- the ea_import advisory lock for a real league, permanently blocking every import attempt with
-- "an automatic import is already running" even though nothing was. Advisory locks tied to a
-- session are inherently fragile against exactly this kind of silent release failure; a plain row
-- timestamp with a staleness window has no session to leak.

alter table public.rec_ea_connections
  add column if not exists import_lock_acquired_at timestamptz;
