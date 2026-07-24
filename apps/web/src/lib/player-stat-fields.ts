// Shared between HubHome.tsx's inline player-stats panel and PlayerStatsModal.tsx (game chat /
// Matchup Detail) — one definition of which numeric fields each stat category collects.
export const PLAYER_STAT_FIELDS: Record<string, Array<[string, string]>> = {
  passing: [["completions", "Completions"], ["attempts", "Attempts"], ["yards", "Passing yards"], ["touchdowns", "Passing touchdowns"], ["interceptions", "Interceptions"]],
  rushing: [["carries", "Carries"], ["yards", "Rushing yards"], ["touchdowns", "Rushing touchdowns"], ["fumbles", "Fumbles"], ["longest", "Longest rush"]],
  receiving: [["receptions", "Receptions"], ["yards", "Receiving yards"], ["touchdowns", "Receiving touchdowns"], ["drops", "Drops"], ["longest", "Longest reception"]],
  defense: [["tackles", "Total tackles"], ["tfl", "Tackles for loss"], ["sacks", "Sacks"], ["interceptions", "Interceptions"], ["forced_fumbles", "Forced fumbles"]],
  kick_returns: [["returns", "Kick returns"], ["yards", "Return yards"], ["touchdowns", "Return touchdowns"], ["longest", "Longest return"]],
  punt_returns: [["returns", "Punt returns"], ["yards", "Return yards"], ["touchdowns", "Return touchdowns"], ["longest", "Longest return"]],
  kicking: [["fg_made", "Field goals made"], ["fg_attempted", "Field goals attempted"], ["longest", "Longest field goal"], ["xp_made", "Extra points made"], ["xp_attempted", "Extra points attempted"]],
  punting: [["punts", "Punts"], ["yards", "Punt yards"], ["average", "Average"], ["inside_20", "Inside the 20"], ["touchbacks", "Touchbacks"]],
};

export const PLAYER_STAT_CATEGORY_OPTIONS = Object.keys(PLAYER_STAT_FIELDS);
