alter table public.rec_team_game_stats
  drop column if exists time_of_possession;

with approved as (
  select *
  from public.rec_box_score_submissions
  where status = 'approved'
    and team_stats is not null
    and (team1_id is not null or team2_id is not null)
),
sides as (
  select
    approved.*,
    'team1'::text as side_key,
    'team2'::text as opponent_side_key,
    team1_id as stat_team_id,
    team2_id as stat_opponent_team_id
  from approved
  where team1_id is not null

  union all

  select
    approved.*,
    'team2'::text as side_key,
    'team1'::text as opponent_side_key,
    team2_id as stat_team_id,
    team1_id as stat_opponent_team_id
  from approved
  where team2_id is not null
),
mapped as (
  select
    s.*,
    case
      when s.side_key = 'team1' then s.team1_id = s.home_team_id
      else s.team2_id = s.home_team_id
    end as stat_is_home,
    case
      when s.side_key = 'team1' and s.team1_id = s.home_team_id then s.home_user_id
      when s.side_key = 'team1' then s.away_user_id
      when s.team2_id = s.home_team_id then s.home_user_id
      else s.away_user_id
    end as stat_user_id,
    case
      when s.side_key = 'team1' and s.team1_id = s.home_team_id then s.away_user_id
      when s.side_key = 'team1' then s.home_user_id
      when s.team2_id = s.home_team_id then s.away_user_id
      else s.home_user_id
    end as stat_opponent_user_id,
    case
      when s.side_key = 'team1' and s.team1_id = s.home_team_id then s.home_score
      when s.side_key = 'team1' then s.away_score
      when s.team2_id = s.home_team_id then s.home_score
      else s.away_score
    end as stat_points_for,
    case
      when s.side_key = 'team1' and s.team1_id = s.home_team_id then s.away_score
      when s.side_key = 'team1' then s.home_score
      when s.team2_id = s.home_team_id then s.away_score
      else s.home_score
    end as stat_points_against
  from sides s
),
restored as (
  select
    m.league_id,
    m.season_number,
    m.week_number,
    m.phase,
    m.game_id,
    m.id as submission_id,
    m.stat_team_id as team_id,
    m.stat_opponent_team_id as opponent_team_id,
    m.stat_user_id as user_id,
    m.stat_opponent_user_id as opponent_user_id,
    m.stat_is_home as is_home,
    case
      when m.stat_points_for is null or m.stat_points_against is null then null
      when m.stat_points_for > m.stat_points_against then 'win'
      when m.stat_points_for < m.stat_points_against then 'loss'
      else 'tie'
    end as result,
    m.stat_points_for as points_for,
    m.stat_points_against as points_against,
    nullif(regexp_replace(coalesce(m.team_stats->'off_yards_gained'->>m.side_key, ''), '[^0-9]', '', 'g'), '')::integer as off_yards_gained,
    nullif(regexp_replace(coalesce(m.team_stats->'off_rush_yards'->>m.side_key, ''), '[^0-9]', '', 'g'), '')::integer as off_rush_yards,
    nullif(regexp_replace(coalesce(m.team_stats->'off_pass_yards'->>m.side_key, ''), '[^0-9]', '', 'g'), '')::integer as off_pass_yards,
    nullif(regexp_replace(coalesce(m.team_stats->'off_first_down'->>m.side_key, ''), '[^0-9]', '', 'g'), '')::integer as off_first_down,
    nullif(regexp_replace(coalesce(m.team_stats->'punt_return_yards'->>m.side_key, ''), '[^0-9]', '', 'g'), '')::integer as punt_return_yards,
    nullif(regexp_replace(coalesce(m.team_stats->'kick_return_yards'->>m.side_key, ''), '[^0-9]', '', 'g'), '')::integer as kick_return_yards,
    nullif(regexp_replace(coalesce(m.team_stats->'total_yards_gained'->>m.side_key, ''), '[^0-9]', '', 'g'), '')::integer as total_yards_gained,
    nullif(regexp_replace(coalesce(m.team_stats->'turnovers'->>m.side_key, ''), '[^0-9]', '', 'g'), '')::integer as turnovers_committed,
    nullif(regexp_replace(coalesce(m.team_stats->'red_zone_off_percentage'->>m.side_key, ''), '[^0-9]', '', 'g'), '')::integer as red_zone_off_percentage,
    nullif(regexp_replace(coalesce(m.team_stats->'turnovers'->>m.opponent_side_key, ''), '[^0-9]', '', 'g'), '')::integer as generated_turnovers,
    nullif(regexp_replace(coalesce(m.team_stats->'total_yards_gained'->>m.opponent_side_key, ''), '[^0-9]', '', 'g'), '')::integer as yards_allowed,
    nullif(regexp_replace(coalesce(m.team_stats->'off_rush_yards'->>m.opponent_side_key, ''), '[^0-9]', '', 'g'), '')::integer as rush_yards_allowed,
    nullif(regexp_replace(coalesce(m.team_stats->'off_pass_yards'->>m.opponent_side_key, ''), '[^0-9]', '', 'g'), '')::integer as pass_yards_allowed,
    nullif(regexp_replace(coalesce(m.team_stats->'off_first_down'->>m.opponent_side_key, ''), '[^0-9]', '', 'g'), '')::integer as first_downs_allowed,
    coalesce(
      nullif(regexp_replace(coalesce(m.team_stats->'red_zone_def_percentage'->>m.side_key, ''), '[^0-9]', '', 'g'), '')::integer,
      case
        when nullif(regexp_replace(coalesce(m.team_stats->'red_zone_off_percentage'->>m.opponent_side_key, ''), '[^0-9]', '', 'g'), '') is null then null
        else greatest(0, least(100, 100 - nullif(regexp_replace(coalesce(m.team_stats->'red_zone_off_percentage'->>m.opponent_side_key, ''), '[^0-9]', '', 'g'), '')::integer))
      end
    ) as red_zone_def_percentage,
    case when m.comeback_winner_team_id = m.stat_team_id then m.comeback_deficit else null end as comeback_deficit,
    case when m.comeback_winner_team_id = m.stat_team_id then m.comeback_deficit_quarter else null end as comeback_deficit_quarter,
    case when m.comeback_winner_team_id = m.stat_team_id then m.comeback_rate else null end as comeback_rate,
    case when m.comeback_winner_team_id = m.stat_team_id then m.fourth_quarter_comeback else false end as fourth_quarter_comeback,
    m.quarter_scores->m.side_key as quarter_scores,
    (
      select coalesce(jsonb_object_agg(e.key, e.value->>m.side_key), '{}'::jsonb)
      from jsonb_each(m.team_stats) as e(key, value)
    ) as offensive_stats,
    (
      select coalesce(jsonb_object_agg(e.key, e.value->>m.opponent_side_key), '{}'::jsonb)
      from jsonb_each(m.team_stats) as e(key, value)
    ) as defensive_stats
  from mapped m
)
insert into public.rec_team_game_stats (
  league_id,
  season_number,
  week_number,
  phase,
  game_id,
  submission_id,
  team_id,
  opponent_team_id,
  user_id,
  opponent_user_id,
  is_home,
  result,
  points_for,
  points_against,
  off_yards_gained,
  off_rush_yards,
  off_pass_yards,
  off_first_down,
  punt_return_yards,
  kick_return_yards,
  total_yards_gained,
  turnovers_committed,
  red_zone_off_percentage,
  generated_turnovers,
  yards_allowed,
  rush_yards_allowed,
  pass_yards_allowed,
  first_downs_allowed,
  red_zone_def_percentage,
  comeback_deficit,
  comeback_deficit_quarter,
  comeback_rate,
  fourth_quarter_comeback,
  quarter_scores,
  offensive_stats,
  defensive_stats
)
select
  league_id,
  season_number,
  week_number,
  phase,
  game_id,
  submission_id,
  team_id,
  opponent_team_id,
  user_id,
  opponent_user_id,
  is_home,
  result,
  points_for,
  points_against,
  off_yards_gained,
  off_rush_yards,
  off_pass_yards,
  off_first_down,
  punt_return_yards,
  kick_return_yards,
  total_yards_gained,
  turnovers_committed,
  red_zone_off_percentage,
  generated_turnovers,
  yards_allowed,
  rush_yards_allowed,
  pass_yards_allowed,
  first_downs_allowed,
  red_zone_def_percentage,
  comeback_deficit,
  comeback_deficit_quarter,
  comeback_rate,
  fourth_quarter_comeback,
  quarter_scores,
  offensive_stats,
  defensive_stats
from restored
on conflict (submission_id, team_id) do update set
  league_id = excluded.league_id,
  season_number = excluded.season_number,
  week_number = excluded.week_number,
  phase = excluded.phase,
  game_id = excluded.game_id,
  opponent_team_id = excluded.opponent_team_id,
  user_id = excluded.user_id,
  opponent_user_id = excluded.opponent_user_id,
  is_home = excluded.is_home,
  result = excluded.result,
  points_for = excluded.points_for,
  points_against = excluded.points_against,
  off_yards_gained = excluded.off_yards_gained,
  off_rush_yards = excluded.off_rush_yards,
  off_pass_yards = excluded.off_pass_yards,
  off_first_down = excluded.off_first_down,
  punt_return_yards = excluded.punt_return_yards,
  kick_return_yards = excluded.kick_return_yards,
  total_yards_gained = excluded.total_yards_gained,
  turnovers_committed = excluded.turnovers_committed,
  red_zone_off_percentage = excluded.red_zone_off_percentage,
  generated_turnovers = excluded.generated_turnovers,
  yards_allowed = excluded.yards_allowed,
  rush_yards_allowed = excluded.rush_yards_allowed,
  pass_yards_allowed = excluded.pass_yards_allowed,
  first_downs_allowed = excluded.first_downs_allowed,
  red_zone_def_percentage = excluded.red_zone_def_percentage,
  comeback_deficit = excluded.comeback_deficit,
  comeback_deficit_quarter = excluded.comeback_deficit_quarter,
  comeback_rate = excluded.comeback_rate,
  fourth_quarter_comeback = excluded.fourth_quarter_comeback,
  quarter_scores = excluded.quarter_scores,
  offensive_stats = excluded.offensive_stats,
  defensive_stats = excluded.defensive_stats;
