-- Fixes weekly-challenge-issuance.service.ts's tier-stacking bug: bronze/silver/gold conditions
-- are cumulative (silver includes bronze's conditions, gold includes both), so a team that clears
-- gold outright was being credited bronze + silver + gold Player XP and Franchise XP in the same
-- grading pass, instead of only the highest tier reached (the XP plan's explicit "no
-- Bronze+Silver+Gold stacking... highest challenge tier only" rule).
--
-- credited_tier remembers the highest tier already paid for this issued challenge so a later
-- re-grade (e.g. a corrected box score bumping a team from bronze to gold mid-week) credits only
-- the delta up to the new tier instead of re-paying or stacking on top of what was already paid.
alter table public.rec_weekly_team_challenges_issued
  add column if not exists credited_tier text check (credited_tier is null or credited_tier in ('bronze', 'silver', 'gold'));
