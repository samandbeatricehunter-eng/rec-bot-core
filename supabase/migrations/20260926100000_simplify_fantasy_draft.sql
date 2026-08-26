-- Fantasy/off-season draft rework: REC no longer tracks which player each team picks (that
-- proved too tedious in practice, and leagues no longer start with a baseline roster to draft
-- from anyway -- rosters populate from the first EA import instead). The draft becomes a pure
-- turn-order/pick-clock coordinator for the real in-Madden draft: whose turn it is, an optional
-- per-pick timer, and commissioner controls to start/end the draft, set the pick order, and
-- skip picks. Everything below that only existed to support player-by-player selection (the
-- pool board, personal rankings, saved boards, pick requests, skipped-pick fill-in-later,
-- check-ins) is removed.

-- Normalize existing rows before tightening the status check constraint.
update public.rec_fantasy_draft_sessions set status = 'not_started' where status in ('not_scheduled', 'scheduled');
update public.rec_fantasy_draft_sessions set status = 'concluded' where status = 'wrap_up';

alter table public.rec_fantasy_draft_sessions drop constraint if exists rec_fantasy_draft_sessions_status_check;
alter table public.rec_fantasy_draft_sessions add constraint rec_fantasy_draft_sessions_status_check
  check (status in ('not_started', 'live', 'concluded'));

alter table public.rec_fantasy_draft_sessions
  drop column if exists scheduled_at,
  drop column if exists checkin_message_channel_id,
  drop column if exists checkin_message_id,
  drop column if exists schedule_message_channel_id,
  drop column if exists schedule_message_id,
  drop column if exists notified_1hr_at,
  drop column if exists notified_30min_at,
  drop column if exists notified_10min_at;

alter table public.rec_fantasy_draft_sessions
  add column if not exists draft_type text not null default 'fantasy' check (draft_type in ('fantasy', 'offseason')),
  add column if not exists pick_timer_seconds integer check (pick_timer_seconds is null or pick_timer_seconds > 0),
  add column if not exists turn_started_at timestamptz,
  -- null = unbounded (fantasy draft; commissioner ends it manually with End Draft).
  -- 7 for offseason drafts, enforced at the application layer when a session is created.
  add column if not exists total_rounds integer check (total_rounds is null or total_rounds > 0),
  -- Reset to false every time turn_started_at changes (a new team goes on the clock) --
  -- lets the timer sweep know it hasn't yet sent this pick's 15-second warning ping.
  add column if not exists warning_sent boolean not null default false;

-- Drop child tables before rec_fantasy_draft_picks itself (FK dependency).
drop table if exists public.rec_fantasy_draft_skipped_picks;
drop trigger if exists trg_fantasy_draft_pick_removes_board_entries on public.rec_fantasy_draft_picks;
drop table if exists public.rec_fantasy_draft_board_entries;
drop function if exists private.rec_remove_drafted_from_boards();
drop table if exists public.rec_fantasy_draft_pick_requests;
drop table if exists public.rec_fantasy_draft_saved_board_entries;
drop table if exists public.rec_fantasy_draft_saved_boards;
drop table if exists public.rec_fantasy_draft_checkins;
drop table if exists public.rec_fantasy_draft_picks;

-- rec_fantasy_draft_pick_order is unchanged -- still the team-order-per-round table both
-- fantasy (standard/snake, commissioner's choice) and offseason (always standard) drafts use.
