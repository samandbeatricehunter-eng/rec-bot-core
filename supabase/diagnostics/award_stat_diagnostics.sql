-- Award stat diagnostics.
-- Replace the two values in params before running.
with params as (
  select
    '<league_id>'::uuid as league_id,
    <season_number>::integer as season_number
),
active_coaches as (
  select distinct on (ta.team_id)
    ta.user_id,
    ta.team_id,
    coalesce(t.name, t.abbreviation, 'Unknown') as team_name
  from public.rec_team_assignments ta
  join public.rec_teams t on t.id = ta.team_id
  join params p on p.league_id = ta.league_id
  where ta.assignment_status = 'active'
    and ta.ended_at is null
    and ta.user_id is not null
  order by ta.team_id, ta.started_at desc nulls last
),
deduped_stats as (
  select *
  from (
    select pws.*,
      row_number() over (
        partition by pws.league_id, pws.season_number, pws.team_id, pws.player_id, pws.stat_category,
          coalesce(pws.source_stat_id, pws.stats->>'statId', 'week:' || coalesce(pws.week_number::text, 'na')),
          coalesce(pws.source_schedule_id, pws.stats->>'scheduleId', 'week:' || coalesce(pws.week_number::text, 'na'))
        order by pws.updated_at desc nulls last, pws.created_at desc nulls last, pws.id desc
      ) as rn
    from public.rec_player_weekly_stats pws
    join params p on p.league_id = pws.league_id and p.season_number = pws.season_number
    join active_coaches ac on ac.team_id = pws.team_id
    where pws.season_stage = 'regular_season'
      and pws.week_number <= 18
      and pws.player_id is not null
      and pws.team_id is not null
  ) x
  where rn = 1
),
stat_totals as (
  select player_id, team_id, jsonb_object_agg(key, total_value) as stats
  from (
    select ds.player_id, ds.team_id, e.key,
      case when lower(e.key) like '%long%' then max(e.value::numeric) else sum(e.value::numeric) end as total_value
    from deduped_stats ds
    cross join lateral jsonb_each_text(ds.stats) e(key, value)
    where e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
    group by ds.player_id, ds.team_id, e.key
  ) s
  group by player_id, team_id
),
player_metrics as (
  select
    rp.full_name,
    upper(coalesce(rp.position, '')) as position,
    ac.team_name,
    st.team_id,
    st.player_id,
    public.rec_award_num(st.stats, array['receiving_yards','recYds','receiving_yds']) as rec_yards,
    public.rec_award_num(st.stats, array['receiving_tds','recTDs','receiving_tds']) as rec_tds,
    public.rec_award_num(st.stats, array['receptions','recCatches','catches']) as receptions,
    public.rec_award_num(st.stats, array['receiving_drops','recDrops','drops']) as rec_drops,
    public.rec_award_num(st.stats, array['tackles','defTotalTackles','defTackles']) as tackles,
    public.rec_award_num(st.stats, array['interceptions','defInts','defInterceptions']) as def_ints,
    public.rec_award_num(st.stats, array['forced_fumbles','defForcedFumbles','forcedFumbles']) as forced_fumbles,
    public.rec_award_num(st.stats, array['fumble_recoveries','defFumbleRecoveries','fumbleRecoveries']) as fumble_recoveries,
    public.rec_award_num(st.stats, array['pass_deflections','defPassDeflections','passDeflections']) as pass_deflections,
    public.rec_award_num(st.stats, array['defensive_tds','defTDs','defensiveTDs']) as def_tds
  from stat_totals st
  join active_coaches ac on ac.team_id = st.team_id
  left join public.rec_players rp on rp.id = st.player_id
)
select
  'George Pickens / Michael Pittman WR totals' as diagnostic,
  full_name,
  position,
  team_name,
  rec_yards,
  rec_tds,
  receptions,
  rec_drops
from player_metrics
where full_name ilike any (array['%George Pickens%', '%Michael Pittman%'])
order by full_name, team_name;

with params as (
  select
    '<league_id>'::uuid as league_id,
    <season_number>::integer as season_number
)
select
  'RPC top award candidates' as diagnostic,
  award_key,
  player_name,
  player_position,
  team_name,
  performance_score,
  stat_line
from public.rec_award_candidate_scores((select league_id from params), (select season_number from params))
where award_key in ('mvp', 'opoy', 'best_wr', 'best_db')
order by award_key, performance_score desc;

with params as (
  select
    '<league_id>'::uuid as league_id,
    <season_number>::integer as season_number
),
active_coaches as (
  select distinct on (ta.team_id)
    ta.user_id,
    ta.team_id,
    coalesce(t.name, t.abbreviation, 'Unknown') as team_name
  from public.rec_team_assignments ta
  join public.rec_teams t on t.id = ta.team_id
  join params p on p.league_id = ta.league_id
  where ta.assignment_status = 'active'
    and ta.ended_at is null
    and ta.user_id is not null
  order by ta.team_id, ta.started_at desc nulls last
),
deduped_stats as (
  select *
  from (
    select pws.*,
      row_number() over (
        partition by pws.league_id, pws.season_number, pws.team_id, pws.player_id, pws.stat_category,
          coalesce(pws.source_stat_id, pws.stats->>'statId', 'week:' || coalesce(pws.week_number::text, 'na')),
          coalesce(pws.source_schedule_id, pws.stats->>'scheduleId', 'week:' || coalesce(pws.week_number::text, 'na'))
        order by pws.updated_at desc nulls last, pws.created_at desc nulls last, pws.id desc
      ) as rn
    from public.rec_player_weekly_stats pws
    join params p on p.league_id = pws.league_id and p.season_number = pws.season_number
    join active_coaches ac on ac.team_id = pws.team_id
    where pws.season_stage = 'regular_season'
      and pws.week_number <= 18
      and pws.player_id is not null
      and pws.team_id is not null
  ) x
  where rn = 1
),
stat_totals as (
  select player_id, team_id, jsonb_object_agg(key, total_value) as stats
  from (
    select ds.player_id, ds.team_id, e.key,
      case when lower(e.key) like '%long%' then max(e.value::numeric) else sum(e.value::numeric) end as total_value
    from deduped_stats ds
    cross join lateral jsonb_each_text(ds.stats) e(key, value)
    where e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
    group by ds.player_id, ds.team_id, e.key
  ) s
  group by player_id, team_id
)
select
  'Browns DB corrected totals' as diagnostic,
  rp.full_name,
  upper(coalesce(rp.position, '')) as position,
  ac.team_name,
  public.rec_award_num(st.stats, array['tackles','defTotalTackles','defTackles']) as tackles,
  public.rec_award_num(st.stats, array['interceptions','defInts','defInterceptions']) as interceptions,
  public.rec_award_num(st.stats, array['forced_fumbles','defForcedFumbles','forcedFumbles']) as forced_fumbles,
  public.rec_award_num(st.stats, array['pass_deflections','defPassDeflections','passDeflections']) as pass_deflections,
  public.rec_award_num(st.stats, array['defensive_tds','defTDs','defensiveTDs']) as defensive_tds,
  round((
    least(100, public.rec_award_num(st.stats, array['interceptions','defInts','defInterceptions']) * 10.0) * 0.32
    + least(100, public.rec_award_num(st.stats, array['pass_deflections','defPassDeflections','passDeflections']) * 4.17) * 0.22
    + least(100, public.rec_award_num(st.stats, array['tackles','defTotalTackles','defTackles']) * 1.11) * 0.17
    + least(100, (public.rec_award_num(st.stats, array['forced_fumbles','defForcedFumbles','forcedFumbles']) + public.rec_award_num(st.stats, array['fumble_recoveries','defFumbleRecoveries','fumbleRecoveries'])) * 16.67) * 0.12
    + least(100, public.rec_award_num(st.stats, array['defensive_tds','defTDs','defensiveTDs']) * 25.0) * 0.17
  )::numeric, 2) as db_absolute_score
from stat_totals st
join active_coaches ac on ac.team_id = st.team_id
left join public.rec_players rp on rp.id = st.player_id
where ac.team_name ilike '%Browns%'
  and upper(coalesce(rp.position, '')) in ('CB','FS','SS')
order by db_absolute_score desc, interceptions desc, tackles desc;

with params as (
  select
    '<league_id>'::uuid as league_id,
    <season_number>::integer as season_number
)
select
  'regular season label bleed' as diagnostic,
  season_stage,
  week_number,
  stat_category,
  count(*) as rows
from public.rec_player_weekly_stats pws
join params p on p.league_id = pws.league_id and p.season_number = pws.season_number
where pws.season_stage = 'regular_season'
  and pws.week_number > 18
group by season_stage, week_number, stat_category
order by week_number, stat_category;
