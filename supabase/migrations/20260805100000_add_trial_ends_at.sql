-- Tracks the end of a user's *current* Stripe trial window (distinct from trial_used_at,
-- which just marks that a trial was ever granted). Lets us tell "still inside the 7-day
-- trial" apart from "trial converted to a full paid subscription" so trial-period league
-- limits (1 join + 1 create per game) can lift automatically once the trial ends or converts.
alter table public.rec_users
  add column if not exists trial_ends_at timestamptz;
