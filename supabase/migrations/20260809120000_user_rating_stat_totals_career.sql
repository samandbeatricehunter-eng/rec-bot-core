-- Make rec_user_rating_stat_totals career-scoped: Coach/User ratings carry every season's
-- production forward instead of resetting to baseline on season turnover (see
-- apps/api/src/modules/league-week/ratings.service.ts, which now calls this with
-- p_season_number = 0). Keeps the same signature for backward compatibility:
--   p_season_number <= 0  → aggregate ALL seasons (career scope)
--   p_season_number > 0   → aggregate through that season (inclusive)
create or replace function rec_user_rating_stat_totals(
  p_league_id uuid,
  p_season_number integer,
  p_user_ids uuid[],
  p_is_cfb boolean
)
returns table (
  user_id uuid,
  games_played bigint,
  passing_yards bigint,
  rushing_yards bigint,
  first_downs bigint,
  turnovers_committed bigint,
  opponent_turnovers bigint,
  red_zone_off_pct_avg integer
)
language sql
stable
as $$
  with rows as (
    select
      t.user_id,
      coalesce(t.off_pass_yards, 0) as off_pass_yards,
      coalesce(t.off_rush_yards, 0) as off_rush_yards,
      coalesce(t.off_first_down, 0) as off_first_down,
      coalesce(t.turnovers_committed, 0) as turnovers_committed,
      coalesce(t.generated_turnovers, 0) as generated_turnovers,
      coalesce(t.red_zone_off_percentage, 0) as red_zone_off_percentage,
      regexp_match(t.offensive_stats ->> 'third_down_conversions', '^(-?\d+)-(-?\d+)$') as third_match,
      regexp_match(t.offensive_stats ->> 'fourth_down_conversions', '^(-?\d+)-(-?\d+)$') as fourth_match,
      nullif(regexp_replace(coalesce(t.offensive_stats ->> 'pass_completions', ''), '[^0-9\-]', '', 'g'), '')::numeric as pass_completions,
      nullif(regexp_replace(coalesce(t.offensive_stats ->> 'pass_attempts', ''), '[^0-9\-]', '', 'g'), '')::numeric as pass_attempts,
      nullif(regexp_replace(coalesce(t.offensive_stats ->> 'yards_per_play', ''), '[^0-9.\-]', '', 'g'), '')::numeric as yards_per_play,
      nullif(regexp_replace(coalesce(t.offensive_stats ->> 'yards_per_rush', ''), '[^0-9.\-]', '', 'g'), '')::numeric as yards_per_rush,
      nullif(regexp_replace(coalesce(t.offensive_stats ->> 'yards_per_pass', ''), '[^0-9.\-]', '', 'g'), '')::numeric as yards_per_pass,
      nullif(regexp_replace(coalesce(t.offensive_stats ->> 'interceptions_thrown', ''), '[^0-9\-]', '', 'g'), '')::numeric as interceptions_thrown,
      nullif(regexp_replace(coalesce(t.offensive_stats ->> 'fumbles_lost', ''), '[^0-9\-]', '', 'g'), '')::numeric as fumbles_lost
    from rec_team_game_stats t
    where t.league_id = p_league_id
      and (p_season_number <= 0 or t.season_number <= p_season_number)
      and t.user_id = any(p_user_ids)
  ),
  flagged as (
    select
      r.*,
      (
        r.turnovers_committed < 0 or r.turnovers_committed > 10
        or r.generated_turnovers < 0 or r.generated_turnovers > 10
        or (r.third_match is not null and (r.third_match[1])::int > (r.third_match[2])::int)
        or (r.fourth_match is not null and (r.fourth_match[1])::int > (r.fourth_match[2])::int)
        or (p_is_cfb and r.pass_completions is not null and r.pass_attempts is not null and r.pass_completions > r.pass_attempts)
        or (p_is_cfb and r.yards_per_play is not null and r.yards_per_play <> 0 and (r.yards_per_play < 0 or r.yards_per_play > 25))
        or (p_is_cfb and r.yards_per_rush is not null and r.yards_per_rush <> 0 and (r.yards_per_rush < 0 or r.yards_per_rush > 25))
        or (p_is_cfb and r.yards_per_pass is not null and r.yards_per_pass <> 0 and (r.yards_per_pass < 0 or r.yards_per_pass > 25))
        or (p_is_cfb and r.interceptions_thrown is not null and r.interceptions_thrown <> 0 and (r.interceptions_thrown < 0 or r.interceptions_thrown > 10))
        or (p_is_cfb and r.fumbles_lost is not null and r.fumbles_lost <> 0 and (r.fumbles_lost < 0 or r.fumbles_lost > 10))
      ) as is_quarantined
    from rows r
  )
  select
    f.user_id,
    count(*) as games_played,
    sum(f.off_pass_yards) as passing_yards,
    sum(f.off_rush_yards) as rushing_yards,
    sum(f.off_first_down) as first_downs,
    sum(f.turnovers_committed) as turnovers_committed,
    sum(f.generated_turnovers) as opponent_turnovers,
    floor(avg(f.red_zone_off_percentage) + 0.5)::integer as red_zone_off_pct_avg
  from flagged f
  where not f.is_quarantined
  group by f.user_id;
$$;

alter function public.rec_user_rating_stat_totals(uuid, integer, uuid[], boolean) set search_path = public, pg_temp;
