-- EOS rank payouts now use final regular-season power-ranking position.
-- Existing payout tables already have RLS enabled; no new table is created here.
create or replace function public.rec_eos_rank_payouts(
  p_league_id uuid,
  p_season_number integer
)
returns table (
  user_id uuid,
  rank integer,
  rank_label text,
  rank_amount integer,
  wins integer,
  losses integer,
  ties integer,
  point_differential numeric,
  games_played integer
)
language sql
stable
as $$
  with latest_power_week as (
    select max(week_number) as week_number
    from public.rec_power_ranking_snapshots
    where league_id = p_league_id
      and season_number = p_season_number
      and week_number <= 18
  ),
  power_ranked as (
    select
      ta.user_id,
      prs.team_id,
      prs.rank::integer as rank,
      prs.score::numeric as power_score
    from latest_power_week lpw
    join public.rec_power_ranking_snapshots prs
      on prs.league_id = p_league_id
     and prs.season_number = p_season_number
     and prs.week_number = lpw.week_number
    join public.rec_team_assignments ta
      on ta.league_id = p_league_id
     and ta.team_id = prs.team_id
     and ta.assignment_status = 'active'
     and ta.ended_at is null
    where lpw.week_number is not null
      and ta.user_id is not null
  ),
  record_ranked as (
    select
      r.user_id,
      row_number() over (
        order by
          coalesce(r.wins, 0) desc,
          coalesce(r.point_differential, 0) desc,
          r.user_id asc
      )::integer as rank
    from public.rec_season_user_records r
    where r.league_id = p_league_id
      and r.season_number = p_season_number
      and r.user_id is not null
      and not exists (select 1 from power_ranked)
  ),
  ranked as (
    select user_id, rank from power_ranked
    union all
    select user_id, rank from record_ranked
  )
  select
    ranked.user_id,
    ranked.rank,
    case
      when ranked.rank = 1 then 'Power Ranking Champion'
      when ranked.rank = 2 then 'Power Ranking 2nd Place'
      when ranked.rank between 3 and 5 then 'Power Ranking Top 5'
      when ranked.rank between 6 and 10 then 'Power Ranking Top 10'
      else 'Power Ranking Rank ' || ranked.rank::text
    end as rank_label,
    case
      when ranked.rank = 1 then 1000
      when ranked.rank = 2 then 750
      when ranked.rank between 3 and 5 then 500
      when ranked.rank between 6 and 10 then 250
      else 100
    end as rank_amount,
    coalesce(r.wins, 0)::integer as wins,
    coalesce(r.losses, 0)::integer as losses,
    coalesce(r.ties, 0)::integer as ties,
    coalesce(r.point_differential, 0)::numeric as point_differential,
    coalesce(r.games_played, coalesce(r.wins, 0) + coalesce(r.losses, 0) + coalesce(r.ties, 0))::integer as games_played
  from ranked
  left join public.rec_season_user_records r
    on r.league_id = p_league_id
   and r.season_number = p_season_number
   and r.user_id = ranked.user_id
  order by ranked.rank asc;
$$;
