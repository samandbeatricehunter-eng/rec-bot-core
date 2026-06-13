alter table public.rec_import_staging_player_stats
  add column if not exists source_stat_id text,
  add column if not exists source_schedule_id text;
alter table public.rec_import_staging_player_stats enable row level security;

alter table public.rec_player_weekly_stats
  add column if not exists guild_id text,
  add column if not exists source_stat_id text,
  add column if not exists source_schedule_id text,
  add column if not exists source_stage_index integer,
  add column if not exists source_week_index integer,
  add column if not exists source_team_id text,
  add column if not exists source_roster_id text;
alter table public.rec_player_weekly_stats enable row level security;

update public.rec_player_weekly_stats pws
set
  guild_id = coalesce(pws.guild_id, ds.guild_id),
  source_stat_id = coalesce(pws.source_stat_id, pws.stats->>'statId', pws.raw_payload->>'statId'),
  source_schedule_id = coalesce(pws.source_schedule_id, pws.stats->>'scheduleId', pws.raw_payload->>'scheduleId'),
  source_stage_index = coalesce(
    pws.source_stage_index,
    case when coalesce(pws.stats->>'stageIndex', pws.raw_payload->>'stageIndex') ~ '^-?[0-9]+$'
      then coalesce(pws.stats->>'stageIndex', pws.raw_payload->>'stageIndex')::integer
    end
  ),
  source_week_index = coalesce(
    pws.source_week_index,
    case when coalesce(pws.stats->>'weekIndex', pws.raw_payload->>'weekIndex') ~ '^-?[0-9]+$'
      then coalesce(pws.stats->>'weekIndex', pws.raw_payload->>'weekIndex')::integer
    end
  ),
  source_team_id = coalesce(pws.source_team_id, pws.stats->>'teamId', pws.raw_payload->>'teamId', pws.madden_team_id),
  source_roster_id = coalesce(pws.source_roster_id, pws.stats->>'rosterId', pws.raw_payload->>'rosterId', pws.madden_player_id)
from public.rec_server_league_links sll
join public.rec_discord_servers ds on ds.id = sll.server_id
where sll.league_id = pws.league_id
  and sll.is_primary = true;

update public.rec_player_weekly_stats
set
  source_stat_id = coalesce(source_stat_id, 'week:' || coalesce(week_number::text, 'na') || ':cat:' || stat_category || ':player:' || madden_player_id || ':team:' || coalesce(madden_team_id, 'na')),
  source_schedule_id = coalesce(source_schedule_id, 'week:' || coalesce(week_number::text, 'na'));

with ranked as (
  select id,
    row_number() over (
      partition by league_id, season_number, team_id, player_id, madden_player_id, stat_category, source_stat_id, source_schedule_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.rec_player_weekly_stats
)
delete from public.rec_player_weekly_stats pws
using ranked r
where pws.id = r.id
  and r.rn > 1;

alter table public.rec_player_weekly_stats
  drop constraint if exists rec_player_weekly_stats_league_id_season_number_season_stag_key;

alter table public.rec_player_weekly_stats
  add constraint rec_player_weekly_stats_source_identity_key
  unique (league_id, season_number, team_id, player_id, madden_player_id, stat_category, source_stat_id, source_schedule_id);

create index if not exists idx_rec_player_weekly_stats_awards_source_lookup
on public.rec_player_weekly_stats (guild_id, league_id, season_number, team_id, player_id, stat_category, source_stat_id, source_schedule_id)
where week_number <= 18;

alter table public.rec_import_staging_player_stats
  drop constraint if exists rec_import_staging_player_stats_job_player_week_category_unique;

update public.rec_import_staging_player_stats
set
  source_stat_id = coalesce(source_stat_id, stats->>'statId', raw_payload->>'statId', 'week:' || coalesce(week_number::text, 'na') || ':cat:' || coalesce(stat_category, 'unknown') || ':player:' || coalesce(player_external_id, external_player_id, 'na')),
  source_schedule_id = coalesce(source_schedule_id, stats->>'scheduleId', raw_payload->>'scheduleId', 'week:' || coalesce(week_number::text, 'na'));

with ranked as (
  select id,
    row_number() over (
      partition by import_job_id, player_external_id, week_number, stat_category, source_stat_id, source_schedule_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.rec_import_staging_player_stats
)
delete from public.rec_import_staging_player_stats ps
using ranked r
where ps.id = r.id
  and r.rn > 1;

alter table public.rec_import_staging_player_stats
  add constraint rec_import_staging_player_stats_source_identity_key
  unique (import_job_id, player_external_id, week_number, stat_category, source_stat_id, source_schedule_id);

alter table public.rec_award_nominees
  add column if not exists nominee_key text;
alter table public.rec_award_nominees enable row level security;

update public.rec_award_nominees
set nominee_key = coalesce(nominee_key, user_id::text)
where nominee_key is null;

alter table public.rec_award_nominees
  alter column nominee_key set not null,
  drop constraint if exists rec_award_nominees_award_id_user_id_key;

alter table public.rec_award_nominees
  add constraint rec_award_nominees_award_id_nominee_key_key unique (award_id, nominee_key);

alter table public.rec_award_votes
  add column if not exists nominee_key text;
alter table public.rec_award_votes enable row level security;

update public.rec_award_votes
set nominee_key = coalesce(nominee_key, nominee_user_id::text)
where nominee_key is null;

create or replace function public.rec_award_candidate_scores(p_league_id uuid, p_season_number integer)
returns table(
  award_key text,
  user_id uuid,
  team_id uuid,
  team_name text,
  player_id uuid,
  player_name text,
  player_position text,
  performance_score numeric,
  stat_line text,
  raw_stats jsonb
)
language sql
stable
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
records as (
  select user_id,
    case when coalesce(games_played, wins + losses + ties, 0) > 0
      then wins::numeric / coalesce(games_played, wins + losses + ties)
      else 0 end as win_pct
  from public.rec_season_user_records
  where league_id = p_league_id
    and season_number = p_season_number
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
    join active_coaches ac on ac.team_id = pws.team_id
    where pws.league_id = p_league_id
      and pws.season_number = p_season_number
      and pws.season_stage = 'regular_season'
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
players as (
  select st.player_id, st.team_id, ac.user_id, ac.team_name,
    coalesce(rp.full_name, rp.first_name || ' ' || rp.last_name, min(ds.player_name), st.player_id::text) as player_name,
    upper(coalesce(rp.position, min(ds.position), '')) as player_position,
    coalesce(
      rp.years_pro,
      case when rp.raw_payload->>'yearsPro' ~ '^-?[0-9]+$' then (rp.raw_payload->>'yearsPro')::integer end,
      0
    ) as years_pro,
    coalesce(r.win_pct, 0) as win_pct,
    st.stats
  from stat_totals st
  join active_coaches ac on ac.team_id = st.team_id
  left join records r on r.user_id = ac.user_id
  left join public.rec_players rp on rp.id = st.player_id
  left join deduped_stats ds on ds.player_id = st.player_id and ds.team_id = st.team_id
  group by st.player_id, st.team_id, ac.user_id, ac.team_name, rp.full_name, rp.first_name, rp.last_name, rp.position, rp.years_pro, rp.raw_payload, r.win_pct, st.stats
),
metrics as (
  select *,
    public.rec_award_num(stats, array['pass_yards','passYds','passing_yards']) as pass_yards,
    public.rec_award_num(stats, array['pass_tds','passTDs','passing_tds']) as pass_tds,
    public.rec_award_num(stats, array['pass_attempts','passAtt','passingAttempts']) as pass_attempts,
    public.rec_award_num(stats, array['pass_completions','passComp','passingCompletions']) as pass_completions,
    public.rec_award_num(stats, array['interceptions_thrown','passInts','passInt']) as pass_ints,
    public.rec_award_num(stats, array['sacks_taken','passSacks','sacksTaken']) as sacks_taken,
    public.rec_award_num(stats, array['rush_yards','rushYds','rushing_yards']) as rush_yards,
    public.rec_award_num(stats, array['rush_tds','rushTDs','rushing_tds']) as rush_tds,
    public.rec_award_num(stats, array['rush_attempts','rushAtt','rushingAttempts']) as rush_attempts,
    public.rec_award_num(stats, array['receiving_yards','recYds','receiving_yds']) as rec_yards,
    public.rec_award_num(stats, array['receiving_tds','recTDs','receiving_tds']) as rec_tds,
    public.rec_award_num(stats, array['receptions','recCatches','catches']) as receptions,
    public.rec_award_num(stats, array['receiving_drops','recDrops','drops']) as rec_drops,
    public.rec_award_num(stats, array['tackles','defTotalTackles','defTackles']) as tackles,
    public.rec_award_num(stats, array['tackles_for_loss','defTFL','tfl']) as tfl,
    public.rec_award_num(stats, array['sacks','defSacks']) as sacks,
    public.rec_award_num(stats, array['interceptions','defInts','defInterceptions']) as def_ints,
    public.rec_award_num(stats, array['forced_fumbles','defForcedFumbles','forcedFumbles']) as forced_fumbles,
    public.rec_award_num(stats, array['fumble_recoveries','defFumbleRecoveries','fumbleRecoveries']) as fumble_recoveries,
    public.rec_award_num(stats, array['pass_deflections','defPassDeflections','passDeflections']) as pass_deflections,
    public.rec_award_num(stats, array['defensive_tds','defTDs','defensiveTDs']) as def_tds,
    public.rec_award_num(stats, array['fg_made','fGMade','fgMade']) as fg_made,
    public.rec_award_num(stats, array['fg_attempts','fGAtt','fgAtt']) as fg_attempts,
    public.rec_award_num(stats, array['fg_long','fGLongest','fgLongest']) as fg_long,
    public.rec_award_num(stats, array['xp_made','xPMade','xpMade']) as xp_made,
    public.rec_award_num(stats, array['xp_attempts','xPAtt','xpAtt']) as xp_attempts
  from players
),
base as (
  select *,
    least(100, pass_yards / 52.0) * 0.34 + least(100, pass_tds * 2.0) * 0.32
      + greatest(0, least(100, ((pass_completions / greatest(pass_attempts, 1)) - 0.54) / 0.18 * 100)) * 0.10
      + least(100, rush_yards / 9.0) * 0.09 + least(100, rush_tds * 8.33) * 0.07
      - least(pass_ints, 6) * 0.65 - greatest(0, pass_ints - 6) * 1.65 - sacks_taken * 0.08 as qb_score,
    least(100, rush_yards / 17.0) * 0.43 + least(100, rush_tds * 4.55) * 0.30
      + greatest(0, least(100, ((rush_yards / greatest(rush_attempts, 1)) - 3.6) / 2.6 * 100)) * 0.17
      + least(100, rush_attempts / 2.8) * 0.05 as rb_score,
    least(100, rec_yards / 17.0) * 0.43 + least(100, rec_tds * 5.56) * 0.28
      + least(100, receptions / 1.15) * 0.12
      + greatest(0, least(100, ((rec_yards / greatest(receptions, 1)) - 9) / 8 * 100)) * 0.07
      - rec_drops * 1.35 as rec_score,
    case
      when player_position in ('LE','RE','DT','LEDGE','REDGE') then least(100, sacks * 4.55) * 0.42 + least(100, tfl * 3.57) * 0.18 + least(100, forced_fumbles * 14.29) * 0.16 + least(100, tackles * 1.25) * 0.14 + least(100, def_tds * 33.33) * 0.10
      when player_position in ('LOLB','MLB','ROLB','MIKE','WILL','SAM') then least(100, tackles / 1.5) * 0.34 + least(100, tfl * 4.17) * 0.18 + least(100, sacks * 6.25) * 0.20 + least(100, def_ints * 16.67) * 0.12 + least(100, (forced_fumbles + fumble_recoveries) * 14.29) * 0.10 + least(100, def_tds * 33.33) * 0.06
      when player_position in ('CB','FS','SS') then least(100, def_ints * 10.0) * 0.32 + least(100, pass_deflections * 4.17) * 0.22 + least(100, tackles * 1.11) * 0.17 + least(100, (forced_fumbles + fumble_recoveries) * 16.67) * 0.12 + least(100, def_tds * 25.0) * 0.17
      else 0
    end as defense_score,
    case when fg_attempts + xp_attempts >= 50 then (fg_made / greatest(fg_attempts, 1)) * 55 + (xp_made / greatest(xp_attempts, 1)) * 30 + least(100, fg_long / 60.0 * 100) * 0.15 else 0 end as kicker_score
  from metrics
),
award_pool as (
  select 'best_qb'::text award_key, 'QB'::text peer_group, *, qb_score as abs_score from base where player_position = 'QB' and pass_attempts >= 80
  union all select 'best_rb', 'RB', *, rb_score * 0.72 + rec_score * 0.25 + qb_score * 0.03 from base where player_position in ('HB','FB','RB') and (rush_attempts >= 50 or rush_yards >= 300)
  union all select 'best_wr', 'REC', *, rec_score * 0.80 + rb_score * 0.15 + qb_score * 0.05 from base where player_position in ('WR','TE') and (receptions >= 15 or rec_yards >= 250)
  union all select 'best_dl', 'FRONT', *, defense_score from base where player_position in ('LE','RE','DT','LEDGE','REDGE')
  union all select 'best_lb', 'LB', *, defense_score from base where player_position in ('LOLB','MLB','ROLB','MIKE','WILL','SAM')
  union all select 'best_db', 'DB', *, defense_score from base where player_position in ('CB','FS','SS')
  union all select 'best_kicker', 'K', *, kicker_score from base where player_position = 'K'
  union all select 'opoy', player_position, *, case when player_position = 'QB' then qb_score * 0.86 + rb_score * 0.18 when player_position in ('HB','FB','RB') then rb_score * 0.70 + rec_score * 0.27 when player_position in ('WR','TE') then rec_score * 0.78 + rb_score * 0.17 else 0 end from base where player_position in ('QB','HB','FB','RB','WR','TE') and years_pro > 0
  union all select 'offensive_rookie', player_position, *, case when player_position = 'QB' then qb_score * 0.86 + rb_score * 0.18 when player_position in ('HB','FB','RB') then rb_score * 0.70 + rec_score * 0.27 when player_position in ('WR','TE') then rec_score * 0.78 + rb_score * 0.17 else 0 end from base where player_position in ('QB','HB','FB','RB','WR','TE') and years_pro = 0
  union all select 'dpoy', case when player_position in ('LE','RE','DT','LEDGE','REDGE') then 'FRONT' when player_position in ('LOLB','MLB','ROLB','MIKE','WILL','SAM') then 'LB' else 'DB' end, *, defense_score from base where player_position in ('LE','RE','DT','LEDGE','REDGE','LOLB','MLB','ROLB','MIKE','WILL','SAM','CB','FS','SS') and years_pro > 0
  union all select 'defensive_rookie', case when player_position in ('LE','RE','DT','LEDGE','REDGE') then 'FRONT' when player_position in ('LOLB','MLB','ROLB','MIKE','WILL','SAM') then 'LB' else 'DB' end, *, defense_score from base where player_position in ('LE','RE','DT','LEDGE','REDGE','LOLB','MLB','ROLB','MIKE','WILL','SAM','CB','FS','SS') and years_pro = 0
  union all select 'mvp', case when player_position = 'QB' then 'QB' when player_position in ('HB','FB','RB') then 'RB' when player_position in ('WR','TE') then 'REC' when player_position in ('LE','RE','DT','LEDGE','REDGE') then 'FRONT' when player_position in ('LOLB','MLB','ROLB','MIKE','WILL','SAM') then 'LB' else 'DB' end, *, greatest(qb_score, rb_score, rec_score, defense_score) from base where player_position in ('QB','HB','FB','RB','WR','TE','LE','RE','DT','LEDGE','REDGE','LOLB','MLB','ROLB','MIKE','WILL','SAM','CB','FS','SS')
),
scored as (
  select *,
    case
      when count(*) over (partition by award_key, peer_group) = 1 then 75
      else (percent_rank() over (partition by award_key, peer_group order by abs_score)) * 100
    end as relative_score
  from award_pool
  where abs_score > 0
),
ranked as (
  select *,
    round((coalesce(relative_score, 75) * 0.65 + least(abs_score, 100) * 0.25 + win_pct * 100 * 0.10)::numeric, 2) as final_score,
    row_number() over (partition by award_key order by (coalesce(relative_score, 75) * 0.65 + least(abs_score, 100) * 0.25 + win_pct * 100 * 0.10) desc, abs_score desc, player_name asc) as rn
  from scored
)
select award_key, user_id, team_id, team_name, player_id, player_name, player_position, final_score as performance_score,
  coalesce(nullif(concat_ws(' | ',
    nullif(case when pass_yards > 0 then concat(pass_yards::int, ' Pass Yds') end, ''),
    nullif(case when pass_tds > 0 then concat(pass_tds::int, ' Pass TD') end, ''),
    nullif(case when pass_ints > 0 then concat(pass_ints::int, ' INT') end, ''),
    nullif(case when rush_yards > 0 then concat(rush_yards::int, ' Rush Yds') end, ''),
    nullif(case when rush_tds > 0 then concat(rush_tds::int, ' Rush TD') end, ''),
    nullif(case when rec_yards > 0 then concat(rec_yards::int, ' Rec Yds') end, ''),
    nullif(case when rec_tds > 0 then concat(rec_tds::int, ' Rec TD') end, ''),
    nullif(case when receptions > 0 then concat(receptions::int, ' Rec') end, ''),
    nullif(case when rec_drops > 0 then concat(rec_drops::int, ' Drp') end, ''),
    nullif(case when tackles > 0 then concat(tackles::int, ' Tkl') end, ''),
    nullif(case when sacks > 0 then concat(sacks::int, ' Sack') end, ''),
    nullif(case when def_ints > 0 then concat(def_ints::int, ' INT') end, ''),
    nullif(case when forced_fumbles > 0 then concat(forced_fumbles::int, ' FF') end, ''),
    nullif(case when pass_deflections > 0 then concat(pass_deflections::int, ' PD') end, ''),
    nullif(case when def_tds > 0 then concat(def_tds::int, ' Def TD') end, ''),
    nullif(case when fg_made > 0 then concat(fg_made::int, ' FG') end, ''),
    nullif(case when fg_long > 0 then concat(fg_long::int, ' Long') end, '')
  ), ''), concat(player_position, ' score: ', final_score::text)) as stat_line,
  stats || jsonb_build_object(
    'playerName', player_name,
    'position', player_position,
    'yearsPro', years_pro,
    'statLine', coalesce(nullif(concat_ws(' | ',
      nullif(case when pass_yards > 0 then concat(pass_yards::int, ' Pass Yds') end, ''),
      nullif(case when rush_yards > 0 then concat(rush_yards::int, ' Rush Yds') end, ''),
      nullif(case when rec_yards > 0 then concat(rec_yards::int, ' Rec Yds') end, ''),
      nullif(case when tackles > 0 then concat(tackles::int, ' Tkl') end, ''),
      nullif(case when def_ints > 0 then concat(def_ints::int, ' INT') end, '')
    ), ''), concat(player_position, ' score: ', final_score::text)),
    'scoreBreakdown', jsonb_build_object('absolute', round(abs_score::numeric, 2), 'relative', round(coalesce(relative_score, 75)::numeric, 2), 'winPct', round(win_pct::numeric, 3))
  ) as raw_stats
from ranked
where rn <= 10
order by award_key, rn;
$function$;
