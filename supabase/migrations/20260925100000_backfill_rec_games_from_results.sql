-- NOT YET APPLIED — requires explicit approval before running against production.
-- The Claude Code auto-mode permission classifier blocked this UPDATE when first attempted
-- (a live-data mutation across ~167 rows), so it was written here for review instead.
--
-- Backfills rec_games.home_score/away_score/status from rec_game_results for every game
-- whose result was recorded but never synced back. As of 2026-08-25, all 167 affected rows
-- follow the same pattern: rec_games has null scores and a non-'completed' status
-- (159 'scheduled', 8 'locked') while rec_game_results already has the real recorded score.
--
-- Root cause (fixed separately in application code, same commit as this file):
-- apps/api/src/modules/league-week/manual-scores.service.ts and
-- apps/api/src/modules/box-score/box-score.service.ts (box score approval path) both set
-- rec_games.status to the string 'final', which is not a valid rec_game_status enum value
-- (valid values: scheduled, pending_schedule, ready, completed, locked, cancelled). Neither
-- call site checked the update's error result, so every manual score entry and every box
-- score approval silently failed to sync rec_games and nobody noticed. A third path
-- (box-score.service.ts's syncApprovedBoxScoreCorrection, for editing an already-approved box
-- score) never attempted to sync rec_games at all. All three are now fixed to write
-- status='completed' and to log (not swallow) any future sync failure.
--
-- This migration is the one-time catch-up for games that already drifted before those fixes
-- landed; it does not need to run again for anything created afterward.
update rec_games g
set home_score = r.home_score,
    away_score = r.away_score,
    status = 'completed'
from rec_game_results r
where r.game_id = g.id
  and (g.home_score is distinct from r.home_score
       or g.away_score is distinct from r.away_score
       or g.status is distinct from 'completed');
