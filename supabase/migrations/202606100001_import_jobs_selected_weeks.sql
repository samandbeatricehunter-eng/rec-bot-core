-- Multi-week imports: persist the exact weeks chosen in the bot's week multi-select so
-- the executor can import non-contiguous weeks (e.g. 1 and 3) in one Blaze session.
-- Applied to remote 2026-06-09 (migration name: import_jobs_selected_weeks).
alter table public.rec_import_jobs add column if not exists selected_weeks jsonb;
