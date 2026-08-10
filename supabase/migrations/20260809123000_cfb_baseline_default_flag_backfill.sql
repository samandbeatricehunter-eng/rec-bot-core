-- Re-flag CFB baseline players as default/protected. The original backfill in
-- 20260803140000_player_roster_lifecycle.sql ran once for leagues that existed at the time;
-- any league seeded from a CFB baseline AFTER that migration never got is_default_player
-- set, because applyCfbBaselineToLeague's insert omitted the column (now fixed to set it
-- true at insert time). Default players are excluded from ALL store purchases in CFB, so
-- the flag must be correct or baseline players could slip through as purchase targets.
update public.rec_players
set is_default_player = true
where madden_player_id like 'cfb27:%'
  and is_default_player = false;
