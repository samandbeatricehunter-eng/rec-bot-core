-- Scale the exact top-eight power-rank ladder by 10 and persist the new
-- season-award amounts in the service-role-only global economy singleton.
create or replace function public.rec_eos_rank_payouts(p_league_id uuid, p_season_number integer)
returns table (user_id uuid, rank integer, rank_label text, rank_amount integer, wins integer, losses integer, ties integer, point_differential numeric, games_played integer)
language sql stable
set search_path = public, pg_temp
as $$
  with latest_power_week as (
    select max(week_number) week_number from public.rec_power_ranking_snapshots
    where league_id = p_league_id and season_number = p_season_number and week_number <= 18
  ), power_ranked as (
    select ta.user_id, prs.rank::integer rank
    from latest_power_week lpw
    join public.rec_power_ranking_snapshots prs on prs.league_id=p_league_id and prs.season_number=p_season_number and prs.week_number=lpw.week_number
    join public.rec_team_assignments ta on ta.league_id=p_league_id and ta.team_id=prs.team_id and ta.assignment_status='active' and ta.ended_at is null
    where lpw.week_number is not null and ta.user_id is not null
  ), record_ranked as (
    select r.user_id, row_number() over(order by coalesce(r.wins,0) desc, coalesce(r.point_differential,0) desc, r.user_id)::integer rank
    from public.rec_season_user_records r
    where r.league_id=p_league_id and r.season_number=p_season_number and r.user_id is not null and not exists(select 1 from power_ranked)
  ), ranked as (
    select * from power_ranked union all select * from record_ranked
  )
  select ranked.user_id, ranked.rank,
    'Power Ranking #' || ranked.rank::text,
    case ranked.rank when 1 then 2500 when 2 then 1750 when 3 then 1250 when 4 then 1000 when 5 then 750 when 6 then 750 when 7 then 500 when 8 then 500 else 0 end,
    coalesce(r.wins,0)::integer, coalesce(r.losses,0)::integer, coalesce(r.ties,0)::integer,
    coalesce(r.point_differential,0)::numeric,
    coalesce(r.games_played,coalesce(r.wins,0)+coalesce(r.losses,0)+coalesce(r.ties,0))::integer
  from ranked left join public.rec_season_user_records r
    on r.league_id=p_league_id and r.season_number=p_season_number and r.user_id=ranked.user_id
  order by ranked.rank;
$$;

update public.rec_global_economy_config
set config = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(config,
      '{submissions,highlightSeasonAward}', '2000', true),
      '{submissions,gameOfYear}', '5000', true),
      '{awards,bestPassing}', '1000', true),
      '{awards,bestRushing}', '1000', true),
      '{awards,bestDefense}', '1000', true),
      '{awards,mvp}', '5000', true),
      '{awards,mostSkilled}', '2000', true),
    version = version + 1, updated_at = now()
where config_key = 'global';

update public.rec_global_economy_config
set config = jsonb_set(config, '{awards,mostHeart}', '2500', true), updated_at = now()
where config_key = 'global';
