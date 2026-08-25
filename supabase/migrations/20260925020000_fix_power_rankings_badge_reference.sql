-- refresh_power_rankings() (20260805111500_power_rankings_pg_cron.sql) was a straight SQL port
-- of computeDynastyScoresForGame/computeCompScoresForGame in
-- apps/api/src/modules/rankings/rankings.service.ts at the time it was written -- including a
-- badge-count term (10 of 100 points) sourced from rec_badge_ownership. Badges were removed from
-- the TS scoring formula weeks ago (rankings.service.ts:135-145,178-186, "Weights renormalized
-- to sum to 100 after removing the badge component"), but this SQL copy was never updated to
-- match, and rec_badge_ownership was never created -- so this function has thrown
-- "relation rec_badge_ownership does not exist" on every single cron run since it was written.
-- Re-ports the function from the CURRENT rankings.service.ts weights, badge term removed.
create or replace function public.refresh_power_rankings()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g text;
begin
  foreach g in array array['madden_26', 'madden_27', 'cfb_27']
  loop
    -- Dynasty scope.
    delete from rec_global_power_rankings
    where game = g and scope = 'dynasty' and computed_date = current_date;

    insert into rec_global_power_rankings (game, scope, user_id, rank, score, computed_date)
    select g, 'dynasty', scored.user_id,
      row_number() over (order by scored.score desc, scored.user_id::text asc),
      scored.score, current_date
    from (
      select
        r.user_id,
        round((
          22.2222 * (case when (r.wins + r.losses + r.ties) > 0 then (r.wins + r.ties * 0.5) / (r.wins + r.losses + r.ties)::numeric else 0 end)
          + 11.1111 * coalesce(oq.opponent_win_pct, 0)
          + least(5.5556 * r.superbowl_wins, 5.5556)
          + 22.2222 * (case when (r.playoff_wins + r.playoff_losses) > 0 then r.playoff_wins::numeric / (r.playoff_wins + r.playoff_losses) else 0 end)
          + 16.6667 * least((case when r.games_played > 0 then r.points_for::numeric / r.games_played else 0 end) / 35, 1)
          + 16.6667 * (1 - least((case when r.games_played > 0 then r.points_against::numeric / r.games_played else 0 end) / 35, 1))
          + 5.5556 * least(r.games_played::numeric / 50, 1)
        )::numeric, 2) as score
      from (
        select
          p.user_id,
          count(*) filter (where p.result = 'win')::int as wins,
          count(*) filter (where p.result = 'loss')::int as losses,
          count(*) filter (where p.result = 'tie')::int as ties,
          count(*) filter (where p.is_playoff and p.result = 'win')::int as playoff_wins,
          count(*) filter (where p.is_playoff and p.result = 'loss')::int as playoff_losses,
          count(*) filter (where p.is_super_bowl and p.result = 'win')::int as superbowl_wins,
          sum(p.points_for)::int as points_for,
          sum(p.points_against)::int as points_against,
          count(*)::int as games_played
        from (
          select gr.home_user_id as user_id,
            case when gr.is_tie then 'tie' when gr.winning_user_id = gr.home_user_id then 'win' else 'loss' end as result,
            gr.home_score as points_for, gr.away_score as points_against,
            gr.is_playoff, gr.is_super_bowl
          from rec_game_results gr
          join rec_leagues l on l.id = gr.league_id
          join rec_league_configuration c on c.league_id = l.id
          where l.game = g and gr.home_user_id is not null
            and (case when l.game = 'cfb_27' then coalesce(c.cfb_difficulty, case c.difficulty when 'all_pro' then 'all_american' when 'all_madden' then 'heisman' else c.difficulty::text end) in ('all_american', 'heisman') else c.difficulty in ('all_pro', 'all_madden') end)
          union all
          select gr.away_user_id,
            case when gr.is_tie then 'tie' when gr.winning_user_id = gr.away_user_id then 'win' else 'loss' end,
            gr.away_score, gr.home_score, gr.is_playoff, gr.is_super_bowl
          from rec_game_results gr
          join rec_leagues l on l.id = gr.league_id
          join rec_league_configuration c on c.league_id = l.id
          where l.game = g and gr.away_user_id is not null
            and (case when l.game = 'cfb_27' then coalesce(c.cfb_difficulty, case c.difficulty when 'all_pro' then 'all_american' when 'all_madden' then 'heisman' else c.difficulty::text end) in ('all_american', 'heisman') else c.difficulty in ('all_pro', 'all_madden') end)
        ) p
        join rec_users registered on registered.id = p.user_id and registered.supabase_auth_user_id is not null
        group by p.user_id
      ) r
      left join (
        select p.user_id,
          avg(case when o.games_played > 0 then (o.wins + o.ties * 0.5) / o.games_played::numeric else 0 end) as opponent_win_pct
        from (
          select gr.home_user_id as user_id, gr.away_user_id as opponent_user_id
          from rec_game_results gr join rec_leagues l on l.id = gr.league_id
          join rec_league_configuration c on c.league_id = l.id
          where l.game = g and (case when l.game = 'cfb_27' then coalesce(c.cfb_difficulty, case c.difficulty when 'all_pro' then 'all_american' when 'all_madden' then 'heisman' else c.difficulty::text end) in ('all_american', 'heisman') else c.difficulty in ('all_pro', 'all_madden') end)
            and gr.home_user_id is not null and gr.away_user_id is not null
          union all
          select gr.away_user_id, gr.home_user_id
          from rec_game_results gr join rec_leagues l on l.id = gr.league_id
          join rec_league_configuration c on c.league_id = l.id
          where l.game = g and (case when l.game = 'cfb_27' then coalesce(c.cfb_difficulty, case c.difficulty when 'all_pro' then 'all_american' when 'all_madden' then 'heisman' else c.difficulty::text end) in ('all_american', 'heisman') else c.difficulty in ('all_pro', 'all_madden') end)
            and gr.home_user_id is not null and gr.away_user_id is not null
        ) p
        join (
          select p2.user_id, count(*)::int as games_played,
            count(*) filter (where p2.result = 'win')::int as wins,
            count(*) filter (where p2.result = 'tie')::int as ties
          from (
            select gr.home_user_id as user_id,
              case when gr.is_tie then 'tie' when gr.winning_user_id = gr.home_user_id then 'win' else 'loss' end as result
            from rec_game_results gr join rec_leagues l on l.id = gr.league_id
            join rec_league_configuration c on c.league_id = l.id
            where l.game = g and gr.home_user_id is not null
              and (case when l.game = 'cfb_27' then coalesce(c.cfb_difficulty, case c.difficulty when 'all_pro' then 'all_american' when 'all_madden' then 'heisman' else c.difficulty::text end) in ('all_american', 'heisman') else c.difficulty in ('all_pro', 'all_madden') end)
            union all
            select gr.away_user_id,
              case when gr.is_tie then 'tie' when gr.winning_user_id = gr.away_user_id then 'win' else 'loss' end
            from rec_game_results gr join rec_leagues l on l.id = gr.league_id
            join rec_league_configuration c on c.league_id = l.id
            where l.game = g and gr.away_user_id is not null
              and (case when l.game = 'cfb_27' then coalesce(c.cfb_difficulty, case c.difficulty when 'all_pro' then 'all_american' when 'all_madden' then 'heisman' else c.difficulty::text end) in ('all_american', 'heisman') else c.difficulty in ('all_pro', 'all_madden') end)
          ) p2
          join rec_users registered2 on registered2.id = p2.user_id and registered2.supabase_auth_user_id is not null
          group by p2.user_id
        ) o on o.user_id = p.opponent_user_id
        group by p.user_id
      ) oq on oq.user_id = r.user_id
    ) scored
    on conflict (game, scope, user_id, computed_date)
    do update set rank = excluded.rank, score = excluded.score;

    -- Comp scope.
    delete from rec_global_power_rankings
    where game = g and scope = 'comp' and computed_date = current_date;

    insert into rec_global_power_rankings (game, scope, user_id, rank, score, computed_date)
    select g, 'comp', scored.user_id,
      row_number() over (order by scored.score desc, scored.user_id::text asc),
      scored.score, current_date
    from (
      select
        r.user_id,
        round((
          44.4444 * (r.wins::numeric / greatest(r.games, 1))
          + 16.6667 * coalesce(o.oq, 0)
          + 22.2222 * ((greatest(-1, least(1, coalesce(r.avg_pd, 0) / 21)) + 1) / 2)
          + 16.6667 * least(r.games::numeric / 25, 1)
        )::numeric, 2) as score
      from (
        select s.user_id, count(*)::int as games,
          count(*) filter (where s.won)::int as wins,
          avg((s.points_for - s.points_against)::numeric) as avg_pd
        from rec_comp_game_stats s
        join rec_users u on u.id = s.user_id and u.supabase_auth_user_id is not null
        where s.game = g
        group by s.user_id
      ) r
      left join (
        select s.user_id,
          avg(case when opp.games > 0 then opp.wins::numeric / opp.games else 0 end) as oq
        from rec_comp_game_stats s
        join (
          select user_id, count(*)::int as games, count(*) filter (where won)::int as wins
          from rec_comp_game_stats where game = g group by user_id
        ) opp on opp.user_id = s.opponent_user_id
        where s.game = g
        group by s.user_id
      ) o on o.user_id = r.user_id
    ) scored
    on conflict (game, scope, user_id, computed_date)
    do update set rank = excluded.rank, score = excluded.score;
  end loop;
end;
$$;
