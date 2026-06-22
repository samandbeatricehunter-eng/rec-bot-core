-- One-time repair for mw4 (guild 1476251181524189438): clear custom teams, links, and stale schedule rows.
-- Applied 2026-06-19 via Supabase MCP.

begin;

delete from public.rec_team_assignments
where league_id = '9f8874f3-f793-416f-bbab-bbe0e8a39af6';

delete from public.rec_games
where league_id = '9f8874f3-f793-416f-bbab-bbe0e8a39af6';

delete from public.rec_teams
where league_id = '9f8874f3-f793-416f-bbab-bbe0e8a39af6';

insert into public.rec_teams (league_id, name, abbreviation, conference, division, source) values
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Baltimore Ravens','BAL','AFC','North','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Buffalo Bills','BUF','AFC','East','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Cincinnati Bengals','CIN','AFC','North','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Cleveland Browns','CLE','AFC','North','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Denver Broncos','DEN','AFC','West','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Houston Texans','HOU','AFC','South','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Indianapolis Colts','IND','AFC','South','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Jacksonville Jaguars','JAX','AFC','South','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Kansas City Chiefs','KC','AFC','West','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Las Vegas Raiders','LV','AFC','West','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Los Angeles Chargers','LAC','AFC','West','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Miami Dolphins','MIA','AFC','East','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','New England Patriots','NE','AFC','East','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','New York Jets','NYJ','AFC','East','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Pittsburgh Steelers','PIT','AFC','North','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Tennessee Titans','TEN','AFC','South','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Arizona Cardinals','ARI','NFC','West','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Atlanta Falcons','ATL','NFC','South','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Carolina Panthers','CAR','NFC','South','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Chicago Bears','CHI','NFC','North','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Dallas Cowboys','DAL','NFC','East','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Detroit Lions','DET','NFC','North','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Green Bay Packers','GB','NFC','North','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Los Angeles Rams','LAR','NFC','West','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Minnesota Vikings','MIN','NFC','North','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','New Orleans Saints','NO','NFC','South','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','New York Giants','NYG','NFC','East','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Philadelphia Eagles','PHI','NFC','East','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','San Francisco 49ers','SF','NFC','West','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Seattle Seahawks','SEA','NFC','West','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Tampa Bay Buccaneers','TB','NFC','South','manual_admin_entry'),
('9f8874f3-f793-416f-bbab-bbe0e8a39af6','Washington Commanders','WAS','NFC','East','manual_admin_entry');

update public.rec_league_configuration
set default_schedule_seeded_at = null
where league_id = '9f8874f3-f793-416f-bbab-bbe0e8a39af6';

commit;
