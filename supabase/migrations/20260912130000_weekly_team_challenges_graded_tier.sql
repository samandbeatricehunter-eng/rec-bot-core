-- Splits weekly-team-challenge grading from crediting: grading (which tier the box score
-- currently satisfies) now happens the moment an import completes cleanly, logged into
-- graded_tier; crediting (Player XP + Franchise XP payout) is deferred to the advance the
-- commissioner actually runs, which is also when the Rewards Recap presentation is built from
-- whatever got credited that advance. credited_tier keeps its existing meaning (the highest tier
-- actually paid so far) and is only ever advanced forward; graded_tier reflects the current truth
-- of the box score and can move if a correction comes in before advance.
alter table public.rec_weekly_team_challenges_issued
  add column if not exists graded_tier text check (graded_tier is null or graded_tier in ('bronze', 'silver', 'gold'));
