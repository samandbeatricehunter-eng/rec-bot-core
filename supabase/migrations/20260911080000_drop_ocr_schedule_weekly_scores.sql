-- Master Handoff Plan Phase 1, continued per explicit user direction: schedule-prefill and
-- weekly-scores OCR (screenshot-based schedule import + weekly scoreboard review) are obsolete
-- now that the league runs on EA data imports. The Comp ladder's own box-score OCR
-- (apps/api/src/modules/comp/comp.routes.ts) is unrelated and stays.
-- Confirmed 0 rows in rec_weekly_score_reviews and 0 referencing rec_commissioners_inbox rows
-- before dropping.

drop table if exists public.rec_weekly_score_reviews;
