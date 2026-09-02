-- Re-adds a lightweight "scheduled for" timestamp to fantasy draft sessions (the old
-- scheduling columns were dropped in 20260926100000_simplify_fantasy_draft.sql). This one is
-- simpler than the old design: no reminder-sweep columns, no notified_*_at markers -- setting
-- it immediately posts a one-shot Discord announcement (see scheduleFantasyDraft in
-- apps/api/src/modules/fantasy-draft/fantasy-draft.service.ts), it doesn't gate anything.
alter table public.rec_fantasy_draft_sessions
  add column if not exists scheduled_at timestamptz;
