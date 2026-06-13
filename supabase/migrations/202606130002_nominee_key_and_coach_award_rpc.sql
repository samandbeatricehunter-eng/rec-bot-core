-- Add stable nominee_key to rec_award_nominees so Discord select menus survive
-- nominee regeneration (new UUID inserts previously broke stale menus).
-- Also creates rec_coach_award_scores RPC to move heavy coach/team award
-- computations (SOS, upset wins, OL OVR, Best GM, etc.) into the database.

-- ── 1. nominee_key column ────────────────────────────────────────────────────

alter table public.rec_award_nominees
  add column if not exists nominee_key text;

-- Backfill existing rows: coach awards used user_id as the logical key
update public.rec_award_nominees
set nominee_key = user_id::text
where nominee_key is null;

-- Drop the old (award_id, user_id) unique constraint so multiple players from
-- the same coach can be nominees for the same award (e.g. two QBs in best_qb).
alter table public.rec_award_nominees
  drop constraint if exists rec_award_nominees_award_id_user_id_key;

-- Partial unique index: enforce uniqueness only when nominee_key is populated.
-- Rows backfilled above all have a value so they participate immediately.
create unique index if not exists rec_award_nominees_award_nominee_key_uidx
  on public.rec_award_nominees (award_id, nominee_key)
  where nominee_key is not null;

-- ── 2. rec_award_num helper (idempotent) ────────────────────────────────────

create or replace function public.rec_award_num(stats jsonb, keys text[])
returns numeric
language sql immutable parallel safe
as $$
  select coalesce(
    (select (stats ->> k)::numeric
     from unnest(keys) k
     where (stats ->> k) ~ '^-?[0-9]+(\.[0-9]+)?$'
     limit 1),
    0
  )
$$;

-- ── 3. rec_coach_award_scores RPC ────────────────────────────────────────────
-- Replaces ~10 separate TypeScript data-fetch round-trips with a single DB pass.
-- Computes all coach/team award scores: COTY, Best OL, Best H2H, Best GM,
-- plus raw counts for Best Streamer, Challenge King, Badge Collector.

create or replace function public.rec_coach_award_scores(
  p_league_id    uuid,
  p_season_number integer
)
returns table (
  user_id          uuid,
  team_id          uuid,
  team_name        text,
  -- season record
  wins             integer,
  losses           integer,
  ties             integer,
  games_played     integer,
  point_differential integer,
  win_pct          numeric,
  -- prior season (for COTY improvement metric)
  prior_wins       integer,
  prior_games      integer,
  prior_win_pct    numeric,
  -- schedule / game metrics
  sos              numeric,
  upset_wins       integer,
  -- OL metrics
  sacks_taken      numeric,
  avg_ol_ovr       numeric,
  -- roster
  avg_roster_ovr   numeric,
  -- activity counts
  stream_count     integer,
  challenge_score  integer,
  badge_score      integer,
  -- pre-computed award scores
  coty_score       numeric,
  best_ol_score    numeric,
  best_h2h_score   numeric,
  best_gm_score    numeric
)
language sql stable
as $function$
with active_coaches as (
  select distinct on (ta.team_id)
    ta.user_id,
    ta.team_id,
    coalesce(t.name, t.abbreviation, 'Unknown') as team_name
  from public.rec_team_assignments ta
  join public.rec_teams t on t.id = ta.team_id
  where ta.league_id = p_league_id
    and ta.assignment_status = 'active'
    and ta.ended_at is null
    and ta.user_id is not null
  order by ta.team_id, ta.started_at desc nulls last
),
-- Current season win/loss record
cur_records as (
  select
    r.user_id,
    r.wins,
    r.losses,
    r.ties,
    coalesce(r.games_played, r.wins + r.losses + r.ties)::integer as games_played,
    r.point_differential,
    case
      when coalesce(r.games_played, r.wins + r.losses + r.ties) > 0
        then r.wins::numeric / coalesce(r.games_played, r.wins + r.losses + r.ties)
      else 0
    end as win_pct
  from public.rec_season_user_records r
  where r.league_id = p_league_id
    and r.season_number = p_season_number
),
-- Prior season record for year-over-year improvement
prior_records as (
  select
    r.user_id,
    r.wins as prior_wins,
    coalesce(r.games_played, r.wins + r.losses + r.ties)::integer as prior_games,
    case
      when coalesce(r.games_played, r.wins + r.losses + r.ties) > 0
        then r.wins::numeric / coalesce(r.games_played, r.wins + r.losses + r.ties)
      else 0
    end as prior_win_pct
  from public.rec_season_user_records r
  where r.league_id = p_league_id
    and r.season_number = p_season_number - 1
),
-- H2H regular-season games only
h2h_games as (
  select home_user_id, away_user_id, home_score, away_score
  from public.rec_game_results
  where league_id = p_league_id
    and season_number = p_season_number
    and is_playoff = false
    and is_cpu_game = false
    and home_user_id is not null
    and away_user_id is not null
),
-- Strength of schedule: average opponent win% per coach
sos_data as (
  select uid, avg(opp_win_pct) as sos
  from (
    select g.home_user_id as uid, coalesce(cr.win_pct, 0) as opp_win_pct
    from h2h_games g
    join cur_records cr on cr.user_id = g.away_user_id
    union all
    select g.away_user_id, coalesce(cr.win_pct, 0)
    from h2h_games g
    join cur_records cr on cr.user_id = g.home_user_id
  ) x
  group by uid
),
-- Upset wins: wins against an opponent with >10% better win%
upset_data as (
  select winner_uid, count(*)::integer as upset_wins
  from (
    select
      case when g.home_score > g.away_score then g.home_user_id else g.away_user_id end as winner_uid,
      case when g.home_score > g.away_score then g.away_user_id else g.home_user_id end as loser_uid
    from h2h_games g
    where g.home_score <> g.away_score
  ) outcomes
  join cur_records wr on wr.user_id = outcomes.winner_uid
  join cur_records lr on lr.user_id = outcomes.loser_uid
  where lr.win_pct > wr.win_pct + 0.10
  group by winner_uid
),
-- QB sacks taken = sacks allowed by the OL (passing stat rows per team)
ol_sacks as (
  select pws.team_id,
    sum(public.rec_award_num(pws.stats, array['sacks_taken','sacksTaken','passSacks'])) as sacks_taken
  from public.rec_player_weekly_stats pws
  join active_coaches ac on ac.team_id = pws.team_id
  where pws.league_id = p_league_id
    and pws.season_number = p_season_number
    and pws.season_stage = 'regular_season'
    and pws.stat_category = 'passing'
    and pws.week_number <= 18
  group by pws.team_id
),
-- Average OL position OVR per team (LT/LG/C/RG/RT from rec_players)
ol_ovr as (
  select t.id as team_id, avg(p.overall_rating)::numeric as avg_ol_ovr
  from public.rec_players p
  join public.rec_teams t
    on t.league_id = p.league_id
    and t.madden_team_id = (p.raw_payload ->> 'teamId')
  where p.league_id = p_league_id
    and p.position in ('LT','LG','C','RG','RT')
    and (p.raw_payload ->> 'teamId') is not null
    and (p.raw_payload ->> 'teamId') <> '0'
    and p.overall_rating is not null
  group by t.id
),
-- Latest roster OVR from power rankings (offense_ovr + defense_ovr average)
roster_ovr as (
  select distinct on (pr.team_id)
    pr.team_id,
    coalesce((pr.offense_ovr + pr.defense_ovr) / 2.0, pr.team_ovr_score, 80)::numeric as avg_ovr
  from public.rec_power_rankings pr
  join active_coaches ac on ac.team_id = pr.team_id
  where pr.league_id = p_league_id
    and pr.season_number = p_season_number
  order by pr.team_id, pr.week_number desc
),
-- Weekly challenge score: 1pt base + 2pt bonus for S-tier + 1pt bonus for A-tier
challenges as (
  select wc.user_id,
    (count(*)
      + sum(case when wc.earned_tier = 'S' then 2 else 0 end)
      + sum(case when wc.earned_tier = 'A' then 1 else 0 end)
    )::integer as challenge_score
  from public.rec_weekly_challenges wc
  join active_coaches ac on ac.user_id = wc.user_id
  where wc.league_id = p_league_id
    and wc.season_number = p_season_number
    and wc.status in ('completed','earned')
  group by wc.user_id
),
-- Badge count (badge_tier not yet in schema — 1pt per badge)
badges as (
  select b.user_id, count(*)::integer as badge_score
  from public.rec_user_badges b
  join active_coaches ac on ac.user_id = b.user_id
  where b.league_id = p_league_id
  group by b.user_id
),
-- League-wide average roster OVR for Best GM relative scoring
league_avg_ovr as (
  select coalesce(avg(ro.avg_ovr) filter (where ro.avg_ovr > 0), 80)::numeric as val
  from roster_ovr ro
  where ro.team_id in (select team_id from active_coaches)
),
combined as (
  select
    ac.user_id,
    ac.team_id,
    ac.team_name,
    coalesce(cr.wins,             0)::integer  as wins,
    coalesce(cr.losses,           0)::integer  as losses,
    coalesce(cr.ties,             0)::integer  as ties,
    coalesce(cr.games_played,     0)::integer  as games_played,
    coalesce(cr.point_differential, 0)::integer as point_differential,
    coalesce(cr.win_pct,          0)           as win_pct,
    coalesce(pr.prior_wins,       0)::integer  as prior_wins,
    coalesce(pr.prior_games,      0)::integer  as prior_games,
    coalesce(pr.prior_win_pct,    0)           as prior_win_pct,
    coalesce(sd.sos,              0.5)         as sos,
    coalesce(ud.upset_wins,       0)::integer  as upset_wins,
    coalesce(os.sacks_taken,      0)           as sacks_taken,
    coalesce(oo.avg_ol_ovr,       0)           as avg_ol_ovr,
    coalesce(ro.avg_ovr, lao.val, 80)          as avg_roster_ovr,
    0::integer                                 as stream_count,  -- rec_stream_posts not yet available
    coalesce(ch.challenge_score,  0)::integer  as challenge_score,
    coalesce(bg.badge_score,      0)::integer  as badge_score,
    lao.val                                    as league_avg_ovr
  from active_coaches ac
  cross join league_avg_ovr lao
  left join cur_records   cr on cr.user_id     = ac.user_id
  left join prior_records pr on pr.user_id     = ac.user_id
  left join sos_data      sd on sd.uid         = ac.user_id
  left join upset_data    ud on ud.winner_uid  = ac.user_id
  left join ol_sacks      os on os.team_id     = ac.team_id
  left join ol_ovr        oo on oo.team_id     = ac.team_id
  left join roster_ovr    ro on ro.team_id     = ac.team_id
  left join challenges    ch on ch.user_id     = ac.user_id
  left join badges        bg on bg.user_id     = ac.user_id
)
select
  user_id, team_id, team_name,
  wins, losses, ties, games_played, point_differential, win_pct,
  prior_wins, prior_games, prior_win_pct,
  sos, upset_wins, sacks_taken, avg_ol_ovr, avg_roster_ovr,
  stream_count, challenge_score, badge_score,

  -- Coach of the Year: 40% win%, 20% YoY improvement, 15% SOS, 15% upsets (cap 5), 10% PD
  round((
      win_pct * 100.0 * 0.40
    + greatest(0, win_pct - prior_win_pct) * 100.0 * 0.20
    + sos * 100.0 * 0.15
    + least(upset_wins::numeric, 5) * 20.0 * 0.15
    + least(greatest(point_differential + 200.0, 0), 400) / 4.0 * 0.10
  )::numeric, 4) as coty_score,

  -- Best OL: 60% sack prevention, 40% average OL OVR
  round((
      least(greatest((50.0 - sacks_taken) / 50.0 * 100.0, 0), 100) * 0.60
    + least(avg_ol_ovr / 99.0 * 100.0, 100) * 0.40
  )::numeric, 4) as best_ol_score,

  -- Best H2H: win% for coaches with ≥ 8 games; -1 signals ineligible
  case when games_played >= 8
    then round((win_pct * 100.0)::numeric, 4)
    else -1
  end as best_h2h_score,

  -- Best GM / Dynasty Builder: 45% win%, 20% SOS, 15% lower-OVR value, 20% overperformance
  round((
      win_pct * 100.0 * 0.45
    + sos * 100.0 * 0.20
    + least(greatest((league_avg_ovr + 4.0 - avg_roster_ovr) / 12.0, 0.0), 1.0) * 100.0 * 0.15
    + least(greatest(
        (win_pct
          - least(greatest(0.5 + (avg_roster_ovr - league_avg_ovr) / 28.0 - (sos - 0.5) * 0.35, 0.15), 0.85)
          + 0.25
        ) / 0.5,
        0.0
      ), 1.0) * 100.0 * 0.20
  )::numeric, 4) as best_gm_score

from combined;
$function$;
