-- Idempotency flags for the scheduled-draft T-1hr/T-30min/T-10min notification poller
-- (apps/api/src/modules/fantasy-draft/fantasy-draft.service.ts checkFantasyDraftScheduleNotifications)
-- — a plain in-process interval re-checks these every ~60s rather than firing a one-shot
-- timer, so a server restart mid-countdown just picks the check back up next tick instead
-- of silently dropping the notification.
alter table public.rec_fantasy_draft_sessions
  add column if not exists notified_1hr_at timestamptz,
  add column if not exists notified_30min_at timestamptz,
  add column if not exists notified_10min_at timestamptz;
