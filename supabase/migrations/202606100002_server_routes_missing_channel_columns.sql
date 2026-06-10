-- Schema drift repair: setEconomyConfig / server setup write these columns but they were
-- never added to the deployed rec_server_routes table, so PostgREST rejected the writes
-- (PGRST204 "column not found"). The server-setup channel menu only assigns channel IDs;
-- the role columns are written by a separate economy-config flow.
-- Applied to remote 2026-06-09 (migration name: server_routes_missing_channel_columns).
-- rec_server_routes already has RLS enabled (no new table created here).
alter table public.rec_server_routes add column if not exists pending_payouts_channel_id text;
alter table public.rec_server_routes add column if not exists commissioner_office_channel_id text;
alter table public.rec_server_routes add column if not exists streams_channel_id text;
alter table public.rec_server_routes add column if not exists highlights_channel_id text;
alter table public.rec_server_routes add column if not exists commissioner_role_id text;
alter table public.rec_server_routes add column if not exists comp_committee_role_id text;
