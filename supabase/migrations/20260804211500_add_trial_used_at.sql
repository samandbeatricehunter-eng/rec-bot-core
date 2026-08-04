-- Tracks whether a user has already redeemed the 7-day free trial, so a checkout
-- session only gets trial_period_days once per account (not once per cancel/resubscribe
-- cycle).
alter table public.rec_users
  add column if not exists trial_used_at timestamptz;
