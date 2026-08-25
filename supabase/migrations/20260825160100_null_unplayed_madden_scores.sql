-- EA's export reports home_score/away_score as 0-0 for a Madden game that hasn't been played
-- yet, never null, and ea-direct-writer.ts / madden-companion.canonical.ts previously wrote
-- that literal 0-0 straight through. Anything downstream reading a null score as "not played"
-- (e.g. GOTW nomination's eligibility filter) treated every not-yet-played game as already
-- scored, so it silently found zero eligible games in every Madden league, every week.
--
-- Both writers are now fixed to null the score for a not-yet-played game going forward; this
-- backfills the 0-0 placeholders already sitting in the table so existing leagues are fixed
-- immediately instead of only on the next import. Scoped to status='scheduled' (a genuinely
-- final 0-0 tie would have status='completed') and source='madden_companion_export' (the only
-- writer that had this bug) so a real, differently-sourced 0-0 score is never touched.
update public.rec_games
set home_score = null, away_score = null, updated_at = now()
where status = 'scheduled' and home_score = 0 and away_score = 0 and source = 'madden_companion_export';
