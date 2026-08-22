import type { LeagueDataMode } from "../league-week/data-mode.service.js";

/** Weekly numeric cells (player/week/key/value) from whichever table this league's data mode writes. */
export function playerWeeklyCellsSql(mode: LeagueDataMode, opts: {
  leagueParam: string;
  extraWhere?: string;
}): string {
  const extra = opts.extraWhere ?? "";
  if (mode === "import") {
    return `
      select s.player_id, s.team_id, s.week_number, s.season_number, e.key, e.value::numeric as value
        from rec_player_weekly_stats s
        cross join lateral jsonb_each_text(s.stats) e
       where s.league_id = ${opts.leagueParam}
         and e.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
         ${extra.replaceAll(/\bs\./g, "s.")}
    `;
  }

  // Box scores + manual entry write rec_game_performance_tags.stat_lines (completions/attempts/yards
  // plus turnover slots). Canonicalize per line so Stats/Records/QBR share keys with EA imports.
  return `
      select
        coalesce(t.roster_player_id, matched.id, t.watched_player_id) as player_id,
        t.team_id,
        t.week_number,
        t.season_number,
        mapped.key,
        (line->>'value')::numeric as value
      from rec_game_performance_tags t
      cross join lateral jsonb_array_elements(coalesce(t.stat_lines, '[]'::jsonb)) line
      cross join lateral (
        select array_agg(lower(coalesce(sib->>'statKey', ''))) as keys
          from jsonb_array_elements(coalesce(t.stat_lines, '[]'::jsonb)) sib
      ) bag
      cross join lateral (
        select
          lower(trim(coalesce(line->>'statKey', ''))) as sk,
          lower(trim(coalesce(line->>'label', ''))) as lbl
      ) n
      cross join lateral (
        select case
          when n.lbl like '%passing yards%' or n.lbl like '%pass yards%' then 'pass_yards'
          when n.lbl like '%rushing yards%' or n.lbl like '%rush yards%' then 'rush_yards'
          when n.lbl like '%receiving yards%' then 'receiving_yards'
          when n.lbl like '%passing touchdown%' or n.lbl like '%passing td%' then 'pass_tds'
          when n.lbl like '%rushing touchdown%' or n.lbl like '%rushing td%' then 'rush_tds'
          when n.lbl like '%receiving touchdown%' then 'receiving_tds'
          when n.lbl like '%interception thrown%' then 'interceptions_thrown'
          when n.lbl like '%interception made%' then 'interceptions'
          when n.lbl like '%forced fumble%' then 'forced_fumbles'
          when n.lbl like '%fumble lost%' then 'rushing_fumbles'
          when n.lbl like '%yards after catch%' then 'rec_yards_after_catch'
          when n.sk in ('completions', 'comp', 'pass_completions') then 'pass_completions'
          when n.sk in ('attempts', 'att', 'pass_attempts') then 'pass_attempts'
          when n.sk in ('carries', 'rush_attempts') then 'rush_attempts'
          when n.sk in ('receptions') then 'receptions'
          when n.sk in ('drops', 'receiving_drops') then 'receiving_drops'
          when n.sk in ('interceptions_thrown') then 'interceptions_thrown'
          when n.sk in ('interceptions_made') then 'interceptions'
          when n.sk in ('forced_fumble', 'forced_fumbles') then 'forced_fumbles'
          when n.sk in ('passer_rating', 'passerrating', 'qbrating') then 'passer_rating'
          when n.sk in ('yards', 'touchdowns', 'tds', 'longest') then
            case
              when n.sk = 'yards' and (n.lbl like '%pass%' or 'completions' = any(bag.keys) or 'attempts' = any(bag.keys)) then 'pass_yards'
              when n.sk = 'yards' and (n.lbl like '%rush%' or 'carries' = any(bag.keys)) then 'rush_yards'
              when n.sk = 'yards' and (n.lbl like '%rec%' or 'receptions' = any(bag.keys)) then 'receiving_yards'
              when n.sk = 'longest' and (n.lbl like '%pass%' or 'completions' = any(bag.keys)) then 'pass_long'
              when n.sk = 'longest' and (n.lbl like '%rush%' or 'carries' = any(bag.keys)) then 'rush_long'
              when n.sk = 'longest' and (n.lbl like '%rec%' or 'receptions' = any(bag.keys)) then 'receiving_long'
              when 'completions' = any(bag.keys) or 'attempts' = any(bag.keys) or n.lbl like '%pass%' then 'pass_tds'
              when 'carries' = any(bag.keys) or n.lbl like '%rush%' then 'rush_tds'
              when 'receptions' = any(bag.keys) or n.lbl like '%rec%' then 'receiving_tds'
              else null
            end
          when n.sk = 'interceptions' then
            case
              when 'completions' = any(bag.keys) or 'attempts' = any(bag.keys) or n.lbl like '%thrown%' then 'interceptions_thrown'
              else 'interceptions'
            end
          when n.sk <> '' then n.sk
          else null
        end as key
      ) mapped
      left join rec_watched_players w on w.id = t.watched_player_id
      left join rec_players matched
        on matched.league_id = t.league_id
       and matched.team_id = t.team_id
       and w.id is not null
       and lower(matched.full_name) = lower(w.player_name)
     where t.league_id = ${opts.leagueParam}
       and t.subject_type = 'player'
       and mapped.key is not null
       and (line->>'value') ~ '^-?[0-9]+(\\.[0-9]+)?$'
       ${extra.replaceAll(/\bs\./g, "t.")}
  `;
}

export const PLAYER_PHOTO_LATERAL = `
  left join lateral (
    select b.photo_url
      from rec_madden_baseline_players b
     where nullif(p.photo_url, '') is null
       and b.photo_url is not null and b.photo_url <> ''
       and (
         (p.madden_player_id is not null and b.ea_player_id::text = p.madden_player_id)
         or lower(b.name) = lower(p.full_name)
       )
     order by (b.ea_player_id::text = p.madden_player_id) desc nulls last
     limit 1
  ) baseline on true
`;

export const PLAYER_CONTEXT_JOINS = `
  left join rec_players p on p.id = r.player_id
  left join rec_watched_players w on w.id = r.player_id
  left join rec_teams t on t.id = coalesce(r.team_id, p.team_id, w.team_id)
  left join rec_team_game_stats tgs
    on tgs.league_id = $1 and tgs.season_number = r.season_number
   and tgs.week_number = r.week_number and tgs.team_id = coalesce(r.team_id, p.team_id, w.team_id)
  left join rec_team_assignments pa
    on pa.team_id = coalesce(r.team_id, p.team_id, w.team_id) and pa.league_id = $1
   and pa.assignment_status = 'active' and pa.ended_at is null
  left join rec_users pu on pu.id = coalesce(tgs.user_id, pa.user_id)
  left join rec_teams ot on ot.id = tgs.opponent_team_id
  left join rec_users ou on ou.id = tgs.opponent_user_id
  ${PLAYER_PHOTO_LATERAL}
`;

export const PLAYER_CONTEXT_SELECT = `
  coalesce(p.full_name, w.player_name) as player_name,
  coalesce(p.position, w.position) as position,
  coalesce(p.id, w.id) as player_id,
  coalesce(nullif(p.photo_url, ''), baseline.photo_url) as photo_url,
  t.name as team_name, t.abbreviation as team_abbreviation,
  coalesce(nullif(pu.display_name, ''), pu.username) as user_name,
  coalesce(tgs.user_id, pa.user_id) as user_id,
  ot.name as opponent_team_name, ot.abbreviation as opponent_team_abbreviation,
  coalesce(nullif(ou.display_name, ''), ou.username) as opponent_user_name,
  tgs.result as result, tgs.points_for as points_for, tgs.points_against as points_against
`;
