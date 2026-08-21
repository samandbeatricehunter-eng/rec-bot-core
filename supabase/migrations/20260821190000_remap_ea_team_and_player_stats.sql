-- Remap existing Madden companion team-weekly rows from EA payload keys
-- (offPassYds, tOGiveaways, …) onto the dedicated rec_team_game_stats columns
-- that matchup ranks, EOS, SOS, wagers, and user rating already read.
-- Also copy rec_games scores (stats often landed before the schedule had scores)
-- and recanonicalize player weekly keys needed by Madden import EOS bonuses.

-- Drop season-0 companion duplicates when the same team/week exists for a real season.
delete from rec_team_game_stats a
using rec_team_game_stats b
where a.source_type = 'madden_companion'
  and a.season_number = 0
  and b.league_id = a.league_id
  and b.week_number = a.week_number
  and b.team_id = a.team_id
  and b.season_number > 0
  and b.source_type = 'madden_companion';

update rec_team_game_stats t
set season_number = l.season_number
from rec_leagues l
where t.league_id = l.id
  and t.source_type = 'madden_companion'
  and t.season_number = 0;

update rec_team_game_stats t
set
  off_pass_yards = coalesce(nullif(t.raw_payload->>'offPassYds', '')::int, t.off_pass_yards),
  off_rush_yards = coalesce(nullif(t.raw_payload->>'offRushYds', '')::int, t.off_rush_yards),
  off_yards_gained = coalesce(nullif(t.raw_payload->>'offTotalYds', '')::int, t.off_yards_gained),
  off_first_down = coalesce(nullif(t.raw_payload->>'off1stDowns', '')::int, t.off_first_down),
  total_yards_gained = coalesce(
    nullif(t.raw_payload->>'offTotalYdsGained', '')::int,
    nullif(t.raw_payload->>'offTotalYds', '')::int,
    t.total_yards_gained
  ),
  turnovers_committed = coalesce(nullif(t.raw_payload->>'tOGiveaways', '')::int, t.turnovers_committed),
  generated_turnovers = coalesce(nullif(t.raw_payload->>'tOTakeaways', '')::int, t.generated_turnovers),
  pass_yards_allowed = coalesce(nullif(t.raw_payload->>'defPassYds', '')::int, t.pass_yards_allowed),
  rush_yards_allowed = coalesce(nullif(t.raw_payload->>'defRushYds', '')::int, t.rush_yards_allowed),
  yards_allowed = coalesce(nullif(t.raw_payload->>'defTotalYds', '')::int, t.yards_allowed),
  red_zone_off_percentage = coalesce(
    round(nullif(t.raw_payload->>'offRedZonePct', '')::numeric)::int,
    t.red_zone_off_percentage
  ),
  red_zone_def_percentage = coalesce(
    round(nullif(t.raw_payload->>'defRedZonePct', '')::numeric)::int,
    t.red_zone_def_percentage
  ),
  offensive_stats = jsonb_strip_nulls(jsonb_build_object(
    'off_yards_gained', nullif(t.raw_payload->>'offTotalYds', '')::int,
    'off_rush_yards', nullif(t.raw_payload->>'offRushYds', '')::int,
    'off_pass_yards', nullif(t.raw_payload->>'offPassYds', '')::int,
    'off_first_down', nullif(t.raw_payload->>'off1stDowns', '')::int,
    'turnovers', nullif(t.raw_payload->>'tOGiveaways', '')::int,
    'third_down_conversions', case
      when t.raw_payload ? 'off3rdDownConv' and t.raw_payload ? 'off3rdDownAtt'
      then (t.raw_payload->>'off3rdDownConv') || '-' || (t.raw_payload->>'off3rdDownAtt')
    end,
    'off3rdDownConvPct', case
      when t.raw_payload ? 'off3rdDownConv' and t.raw_payload ? 'off3rdDownAtt'
      then (t.raw_payload->>'off3rdDownConv') || '-' || (t.raw_payload->>'off3rdDownAtt')
    end,
    'fourth_down_conversions', case
      when t.raw_payload ? 'off4thDownConv' and t.raw_payload ? 'off4thDownAtt'
      then (t.raw_payload->>'off4thDownConv') || '-' || (t.raw_payload->>'off4thDownAtt')
    end,
    'two_point_conversions', case
      when t.raw_payload ? 'off2PtConv' and t.raw_payload ? 'off2PtAtt'
      then (t.raw_payload->>'off2PtConv') || '-' || (t.raw_payload->>'off2PtAtt')
    end,
    'red_zone_off_percentage', round(nullif(t.raw_payload->>'offRedZonePct', '')::numeric)::int,
    'red_zone_tds', nullif(t.raw_payload->>'offRedZoneTDs', '')::int,
    'red_zone_fgs', nullif(t.raw_payload->>'offRedZoneFGs', '')::int,
    'penalties', nullif(t.raw_payload->>'penalties', '')::int,
    'penalty_yards', nullif(t.raw_payload->>'penaltyYds', '')::int,
    'off_rush_tds', nullif(t.raw_payload->>'offRushTDs', '')::int,
    'off_pass_tds', nullif(t.raw_payload->>'offPassTDs', '')::int,
    'off_sacks_taken', nullif(t.raw_payload->>'offSacks', '')::int
  )),
  defensive_stats = jsonb_strip_nulls(jsonb_build_object(
    'yards_allowed', nullif(t.raw_payload->>'defTotalYds', '')::int,
    'rush_yards_allowed', nullif(t.raw_payload->>'defRushYds', '')::int,
    'pass_yards_allowed', nullif(t.raw_payload->>'defPassYds', '')::int,
    'generated_turnovers', nullif(t.raw_payload->>'tOTakeaways', '')::int,
    'takeaways', nullif(t.raw_payload->>'tOTakeaways', '')::int,
    'team_interceptions', nullif(t.raw_payload->>'defIntsRec', '')::int,
    'team_sacks', nullif(t.raw_payload->>'defSacks', '')::int,
    'fumble_recoveries', nullif(t.raw_payload->>'defFumRec', '')::int,
    'forced_fumbles', nullif(t.raw_payload->>'defForcedFum', '')::int,
    'red_zone_def_percentage', round(nullif(t.raw_payload->>'defRedZonePct', '')::numeric)::int,
    'red_zone_tds_allowed', nullif(t.raw_payload->>'defRedZoneTDs', '')::int,
    'red_zone_fgs_allowed', nullif(t.raw_payload->>'defRedZoneFGs', '')::int
  ))
where t.source_type = 'madden_companion'
  and t.raw_payload is not null
  and t.raw_payload ? 'offPassYds';

update rec_team_game_stats t
set
  is_home = case when g.home_team_id is not null then g.home_team_id = t.team_id else t.is_home end,
  points_for = coalesce(
    case
      when g.home_team_id = t.team_id then g.home_score
      when g.away_team_id = t.team_id then g.away_score
    end,
    t.points_for
  ),
  points_against = coalesce(
    case
      when g.home_team_id = t.team_id then g.away_score
      when g.away_team_id = t.team_id then g.home_score
    end,
    t.points_against
  )
from rec_games g
where t.game_id = g.id
  and t.source_type = 'madden_companion';

update rec_team_game_stats t
set
  is_home = case when g.home_team_id is not null then g.home_team_id = t.team_id else t.is_home end,
  points_for = coalesce(
    case
      when g.home_team_id = t.team_id then g.home_score
      when g.away_team_id = t.team_id then g.away_score
    end,
    t.points_for
  ),
  points_against = coalesce(
    case
      when g.home_team_id = t.team_id then g.away_score
      when g.away_team_id = t.team_id then g.home_score
    end,
    t.points_against
  ),
  game_id = coalesce(t.game_id, g.id)
from rec_games g
where t.source_type = 'madden_companion'
  and t.game_id is null
  and g.league_id = t.league_id
  and g.week_number = t.week_number
  and (g.home_team_id = t.team_id or g.away_team_id = t.team_id);

update rec_team_game_stats t
set result = case
  when t.points_for is null or t.points_against is null then t.result
  when t.points_for > t.points_against then 'win'
  when t.points_for < t.points_against then 'loss'
  else 'tie'
end
where t.source_type = 'madden_companion';

update rec_player_weekly_stats p
set stats = coalesce(p.stats, '{}'::jsonb)
  - 'stageIndex' - 'seasonIndex' - 'weekIndex'
  || jsonb_strip_nulls(jsonb_build_object(
    'broken_tackles', coalesce(p.stats->'broken_tackles', p.raw_payload->'rushBrokenTackles'),
    'rush_yards_after_contact', coalesce(p.stats->'rush_yards_after_contact', p.raw_payload->'rushYdsAfterContact'),
    'rush_20_plus', coalesce(p.stats->'rush_20_plus', p.raw_payload->'rush20PlusYds'),
    'fg_50_attempts', coalesce(p.stats->'fg_50_attempts', p.raw_payload->'fG50PlusAtt'),
    'fg_50_made', coalesce(p.stats->'fg_50_made', p.raw_payload->'fG50PlusMade'),
    'punts', coalesce(p.stats->'punts', p.raw_payload->'puntAtt'),
    'punt_long', coalesce(p.stats->'punt_long', p.raw_payload->'puntLongest'),
    'touchbacks', coalesce(p.stats->'touchbacks', p.raw_payload->'puntTBs'),
    'kickoff_attempts', coalesce(p.stats->'kickoff_attempts', p.raw_payload->'kickoffAtt'),
    'kickoff_touchbacks', coalesce(p.stats->'kickoff_touchbacks', p.raw_payload->'kickoffTBs'),
    'rec_yards_after_catch', coalesce(p.stats->'rec_yards_after_catch', p.raw_payload->'recYdsAfterCatch')
  ))
where p.source_type = 'madden_companion'
  and p.raw_payload is not null;
