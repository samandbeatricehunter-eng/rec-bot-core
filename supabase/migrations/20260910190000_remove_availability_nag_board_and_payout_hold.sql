-- Removes the availability nag, the persistent Discord availability board, and the
-- payout-hold-for-missing-availability mechanic. The underlying availability data model
-- (rec_user_availability_profiles, rec_user_availability_windows, rec_user_availability_day_marks,
-- rec_availability_overrides) stays -- users still set/view their own availability through the
-- new /schedule command and gameday-channel emoji actions, it just no longer nags, boards, or
-- blocks payouts.
drop table if exists public.rec_availability_nag_state;
drop table if exists public.rec_availability_compliance;
drop table if exists public.rec_availability_board_messages;
