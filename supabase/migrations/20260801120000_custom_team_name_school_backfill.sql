-- Custom/relocated teams previously stored the mascot in rec_teams.name (written by the
-- custom-team flow), while catalog teams store the school ("Ohio State"). Display helpers
-- and raw team.name renders now assume name is the school/full identity, so backfill CFB
-- custom teams to use the school (display_city) when name still equals the mascot.
-- Madden is intentionally untouched: its legacy name=mascot rows still render as the
-- correct "City Mascot" combo through the display helpers.
UPDATE rec_teams t
SET name = t.display_city
FROM rec_leagues l
WHERE t.league_id = l.id
  AND l.game = 'cfb_27'
  AND t.is_relocated = true
  AND t.display_city IS NOT NULL
  AND trim(t.display_city) <> ''
  AND t.name = t.display_nick;
