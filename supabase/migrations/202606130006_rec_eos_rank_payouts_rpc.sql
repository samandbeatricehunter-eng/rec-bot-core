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
  with ranked as (
    select
      r.user_id,
      row_number() over (
        order by
          coalesce(r.wins, 0) desc,
          coalesce(r.point_differential, 0) desc,
          r.user_id asc
      )::integer as rank,
      coalesce(r.wins, 0)::integer as wins,
      coalesce(r.losses, 0)::integer as losses,
      coalesce(r.ties, 0)::integer as ties,
      coalesce(r.point_differential, 0)::numeric as point_differential,
      coalesce(r.games_played, coalesce(r.wins, 0) + coalesce(r.losses, 0) + coalesce(r.ties, 0))::integer as games_played
    from public.rec_season_user_records r
    where r.league_id = p_league_id
      and r.season_number = p_season_number
      and r.user_id is not null
  )
  select
    ranked.user_id,
    ranked.rank,
    case ranked.rank
      when 1 then 'Regular Season Champion'
      when 2 then '2nd Place'
      when 3 then '3rd Place'
      when 4 then '4th Place'
      when 5 then '5th Place'
      when 6 then '6th Place'
      when 7 then '7th Place'
      when 8 then '8th Place'
      else 'Rank ' || ranked.rank::text
    end as rank_label,
    case ranked.rank
      when 1 then 250
      when 2 then 175
      when 3 then 125
      when 4 then 100
      when 5 then 75
      when 6 then 75
      when 7 then 50
      when 8 then 50
      else 0
    end as rank_amount,
    ranked.wins,
    ranked.losses,
    ranked.ties,
    ranked.point_differential,
    ranked.games_played
  from ranked
  order by ranked.rank asc;
$$;
