// Shared between HubHome.tsx's inline player-stats panel and PlayerStatsModal.tsx (game chat /
// Matchup Detail) — one definition of which numeric fields each stat category collects.
export const PLAYER_STAT_FIELDS: Record<string, Array<[string, string]>> = {
  passing: [["completions", "Completions"], ["attempts", "Attempts"], ["yards", "Passing yards"], ["touchdowns", "Passing touchdowns"], ["interceptions", "Interceptions"]],
  rushing: [["carries", "Carries"], ["yards", "Rushing yards"], ["touchdowns", "Rushing touchdowns"], ["fumbles", "Fumbles"], ["longest", "Longest rush"]],
  receiving: [["receptions", "Receptions"], ["targets", "Targets"], ["yards", "Receiving yards"], ["touchdowns", "Receiving touchdowns"], ["drops", "Drops"], ["yac", "Yards after catch"], ["longest", "Longest reception"]],
  defense_tackles: [["solo_tackles", "Solo tackles"], ["assisted_tackles", "Assisted tackles"], ["tackles", "Total tackles"], ["tfl", "Tackles for loss"], ["sacks", "Sacks"], ["qb_hits", "QB hits"]],
  defense_coverage: [["interceptions", "Interceptions"], ["interception_yards", "Interception return yards"], ["interception_tds", "Interception return TDs"], ["pass_deflections", "Pass deflections"], ["catches_allowed", "Catches allowed"], ["yards_allowed", "Receiving yards allowed"]],
  defense_turnovers: [["forced_fumbles", "Forced fumbles"], ["fumble_recoveries", "Fumble recoveries"], ["fumble_return_yards", "Fumble return yards"], ["fumble_tds", "Fumble return TDs"], ["blocked_kicks", "Blocked kicks"], ["safeties", "Safeties"]],
  offensive_line: [["pancakes", "Pancake blocks"], ["sacks_allowed", "Sacks allowed"], ["pressures_allowed", "Pressures allowed"], ["penalties", "Penalties"], ["penalty_yards", "Penalty yards"]],
  kick_returns: [["returns", "Kick returns"], ["yards", "Return yards"], ["touchdowns", "Return touchdowns"], ["longest", "Longest return"]],
  punt_returns: [["returns", "Punt returns"], ["yards", "Return yards"], ["touchdowns", "Return touchdowns"], ["longest", "Longest return"]],
  kicking: [["fg_made", "Field goals made"], ["fg_attempted", "Field goals attempted"], ["fg_blocked", "Field goals blocked"], ["longest", "Longest field goal"], ["xp_made", "Extra points made"], ["xp_attempted", "Extra points attempted"]],
  kickoffs: [["kickoffs", "Kickoffs"], ["touchbacks", "Kickoff touchbacks"], ["kickoff_yards", "Kickoff yards"], ["out_of_bounds", "Kickoffs out of bounds"], ["onside_recovered", "Onside kicks recovered"]],
  punting: [["punts", "Punts"], ["yards", "Punt yards"], ["average", "Punt average"], ["net_average", "Net punt average"], ["longest", "Longest punt"], ["inside_20", "Inside the 20"], ["touchbacks", "Touchbacks"], ["punts_blocked", "Punts blocked"], ["fair_catches", "Fair catches"], ["return_yards_allowed", "Return yards allowed"]],
};

export const PLAYER_STAT_CATEGORY_OPTIONS = Object.keys(PLAYER_STAT_FIELDS);
