-- The weekly recap's clip-selection rules differ by postseason round (wild card/divisional/
-- conference/Super Bowl each get a different per-game clip allowance), and rec_games.phase only
-- distinguishes regular_season/playoffs -- the specific round has to be resolved once, at enqueue
-- time, from the week number the recap is actually for (see advance-results.service.ts's
-- enqueueWeeklyHighlightRecap call, which passes stageForWeek(currentWeek, game)).
alter table public.rec_weekly_recap_jobs add column if not exists season_stage text;
