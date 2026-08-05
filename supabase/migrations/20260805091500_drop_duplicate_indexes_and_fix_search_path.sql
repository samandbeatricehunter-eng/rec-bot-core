-- Cleanup from the 2026-08-05 security/efficiency audit: drop exact-duplicate indexes
-- (identical column sets to an existing index — wasted writes/storage) and pin a mutable
-- search_path on a trigger function (Postgres privilege-escalation hardening).
drop index if exists public.rec_active_check_responses_event_user_key;
drop index if exists public.rec_site_conversation_members_pair_uidx;
drop index if exists public.idx_rec_h2h_last_played_at;
drop index if exists public.idx_rec_h2h_user_a_id;
drop index if exists public.idx_rec_h2h_user_b_id;

alter function public.log_commissioner_case_event() set search_path = public, pg_temp;
