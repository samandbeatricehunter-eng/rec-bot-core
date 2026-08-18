// Frozen future-pick transfers used to seed a new Madden league. Each baseline starts with
// every franchise owning rounds 1-7 for each of its first three drafts, then replays the
// transactions known at that game's snapshot date. Calendar draft years are converted to
// league season ordinals (1-3) when inserted into rec_draft_picks.
//
// Primary source: nflverse/nfldata trades.csv (Pro Football Reference trade ledger).
// Madden 26 cutoff: 2025-08-14. Madden 27 cutoff: 2026-08-10.
export type MaddenPickTransfer = readonly [draftYear: number, round: number, from: string, to: string, conditional: 0 | 1];
export type MaddenSupplementalPick = Readonly<{ draftYear: number; round: number; original: string; assetKey: string }>;

// PROVISIONAL — M27_PICK_TRANSFERS below (m27_2026-08-18_v2) was transcribed from a manual
// screenshot pass and has NOT been re-audited year-by-year against the original screenshots'
// year headers. Do not run seedMaddenDraftPicks("madden_27", ...) against a real league until
// that audit replaces this comment with a confirmation note (or a corrected v3 baseline).
export const MADDEN_PICK_BASELINE_META = {
  madden_26: { firstDraftYear: 2026, snapshotDate: "2025-08-14", version: "m26_release_v1" },
  madden_27: { firstDraftYear: 2027, snapshotDate: "2026-08-18", version: "m27_2026-08-18_v2" },
} as const;

export const M26_PICK_TRANSFERS: MaddenPickTransfer[] = [
  [2026,7,"DET","JAX",1],[2026,3,"NYJ","PHI",1],
  [2026,6,"DEN","NYJ",0],[2026,6,"HOU","LAR",0],[2026,7,"LAR","HOU",0],[2026,6,"CLE","SEA",0],
  [2026,7,"SEA","CLE",0],[2026,6,"DAL","NYG",0],[2026,7,"NYG","DAL",0],[2026,6,"LAR","TEN",0],
  [2026,5,"TEN","LAR",0],[2026,7,"KC","DAL",1],[2026,6,"BUF","NYJ",0],[2026,7,"NYJ","BUF",0],
  [2026,7,"LAC","TEN",0],[2026,6,"SEA","JAX",0],[2026,7,"BUF","CLE",0],[2026,7,"HOU","MIN",1],
  [2026,6,"MIN","HOU",1],[2026,6,"KC","NE",0],[2026,7,"JAX","MIN",1],[2026,4,"MIN","JAX",1],
  [2026,7,"CLE","DET",0],[2026,6,"DET","CLE",0],[2026,7,"BAL","LAR",0],[2027,7,"LAR","BAL",0],
  [2026,7,"SF","HOU",0],[2026,4,"CHI","KC",0],[2026,7,"HOU","JAX",0],[2026,4,"WAS","HOU",0],
  [2026,2,"WAS","HOU",0],[2026,7,"NO","NE",0],[2026,5,"HOU","PHI",0],[2026,6,"PHI","HOU",0],
  [2026,7,"DAL","BUF",0],[2026,6,"HOU","MIN",0],[2026,6,"MIN","SF",0],[2027,5,"HOU","CLE",0],
  [2026,1,"JAX","CLE",0],[2026,3,"NYG","HOU",0],[2026,1,"ATL","LAR",0],[2026,3,"DET","JAX",0],
  [2026,3,"DET","JAX",0],[2026,6,"JAX","DET",0],[2026,4,"KC","NE",0],[2026,5,"ATL","PHI",0],
  [2026,3,"HOU","MIA",0],[2026,4,"LAR","CHI",0],[2026,6,"BAL","NYJ",0],[2026,5,"NYJ","BAL",0],
  [2027,5,"DAL","PIT",0],[2026,3,"DAL","PIT",0],[2027,6,"PIT","DAL",0],[2026,4,"SF","PHI",1],
  [2027,7,"MIA","PIT",0],[2027,5,"PIT","MIA",0],[2026,6,"MIA","NYG",0],[2027,7,"NYG","MIA",1],
];

export const M26_SUPPLEMENTAL_PICKS: MaddenSupplementalPick[] = [
  { draftYear: 2026, round: 3, original: "DET", assetKey: "DET:2026:R3:COMP" },
];

// Sourced from the commissioner's Madden 27 "new franchise" ownership ledger (2026-08-18),
// derived from in-game screenshots for a brand-new M27 franchise's first three draft classes.
// Multi-hop chains (e.g. 2027 BAL R7 #206 -> DAL -> PHI) are encoded as two consecutive
// transfers so seedMaddenDraftPicks's from-team matching resolves them in order.
export const M27_PICK_TRANSFERS: MaddenPickTransfer[] = [
  // 2027
  [2027,7,"ATL","SEA",0],
  [2027,6,"BAL","SF",0],
  [2027,7,"DAL","PHI",0],[2027,7,"BAL","DAL",0],[2027,7,"DAL","PHI",0],
  [2027,5,"CAR","MIN",0],
  [2027,5,"CHI","NE",0],
  [2027,6,"CLE","HOU",0],
  [2027,1,"DAL","NYJ",0],
  [2027,4,"DAL","GB",0],
  [2027,5,"DAL","PIT",0],
  [2027,1,"GB","DAL",0],
  [2027,6,"GB","PHI",0],
  [2027,5,"HOU","CLE",0],[2027,7,"HOU","CLE",0],
  [2027,6,"HOU","NE",0],
  [2027,1,"IND","NYJ",0],
  [2027,6,"KC","NYJ",0],
  [2027,7,"KC","SF",0],
  [2027,6,"LAC","NO",0],
  [2027,7,"LAC","DET",0],
  [2027,1,"LAR","CLE",0],
  [2027,3,"LAR","KC",0],
  [2027,7,"LAR","LAC",0],
  [2027,7,"LV","BUF",0],
  [2027,7,"MIA","PIT",0],
  [2027,4,"MIN","CAR",0],
  [2027,6,"MIN","NE",0],
  [2027,7,"MIN","ATL",0],
  [2027,5,"NE","PHI",0],
  [2027,7,"NE","HOU",0],
  [2027,6,"NO","NE",0],
  [2027,7,"NO","DEN",0],
  [2027,4,"NYG","CLE",0],
  [2027,7,"NYG","MIA",0],
  [2027,6,"NYJ","MIN",0],
  [2027,7,"NYJ","CAR",0],
  [2027,3,"PHI","MIN",0],[2027,7,"PHI","MIN",0],
  [2027,6,"PHI","NYJ",0],
  [2027,5,"PIT","MIA",0],
  [2027,6,"PIT","DAL",0],
  [2027,4,"SEA","CLE",0],
  [2027,6,"SF","KC",0],
  // 2028
  [2028,7,"CLE","LAR",0],
  [2028,7,"DAL","NO",0],
  [2028,6,"HOU","NO",0],
  [2028,2,"LAR","CLE",0],
  [2028,1,"NE","PHI",0],
  [2028,7,"NE","NO",0],
  [2028,6,"NO","DAL",0],
  [2028,7,"NO","HOU",0],
  [2028,7,"NYJ","LAC",0],
  [2028,7,"SEA","NYJ",0],
  // 2029
  [2029,3,"LAR","CLE",0],
];

export function transfersForMaddenGame(game: "madden_26" | "madden_27") {
  return game === "madden_26" ? M26_PICK_TRANSFERS : M27_PICK_TRANSFERS;
}

export function supplementalPicksForMaddenGame(game: "madden_26" | "madden_27") {
  return game === "madden_26" ? M26_SUPPLEMENTAL_PICKS : [];
}

// Projected year-1 draft slot by ORIGINAL franchise (1 = first overall). Ownership transfers
// are applied separately — pick_number follows the original team, so a traded Colts pick
// keeps IND's slot even when Jets currently own it. Source for M27: the 2026-08-18 commissioner
// ledger (R1 pick numbers per franchise, cross-checked against each team's "missing own R1"
// / "R1 from X" notes to recover the original owner of traded slots).
export const M27_YEAR1_ORIGINAL_PICK_ORDER: readonly string[] = [
  "LV", "NYJ", "ARI", "TEN", "NYG", "CLE", "WAS", "NO", "KC", "CIN",
  "MIA", "DAL", "ATL", "BAL", "TB", "IND", "DET", "MIN", "CAR", "GB",
  "PIT", "LAC", "PHI", "JAX", "CHI", "BUF", "SF", "HOU", "LAR", "DEN",
  "NE", "SEA",
];

// M26 year-1 (2026 draft) used the same pre-season futures-style board relative to that
// game's snapshot; keep a dedicated list so the two baselines can diverge later.
export const M26_YEAR1_ORIGINAL_PICK_ORDER: readonly string[] = [
  "NE", "TEN", "CLE", "NYG", "JAX", "LV", "NYJ", "CAR", "NO", "CHI",
  "SF", "DAL", "MIA", "IND", "ATL", "ARI", "CIN", "SEA", "TB", "DEN",
  "PIT", "LAC", "GB", "MIN", "HOU", "LAR", "BAL", "DET", "WAS", "BUF",
  "PHI", "KC",
];

export function year1OriginalPickOrderForMaddenGame(game: "madden_26" | "madden_27"): readonly string[] {
  return game === "madden_26" ? M26_YEAR1_ORIGINAL_PICK_ORDER : M27_YEAR1_ORIGINAL_PICK_ORDER;
}

export function year1PickNumberByAbbreviation(game: "madden_26" | "madden_27"): Map<string, number> {
  return new Map(year1OriginalPickOrderForMaddenGame(game).map((abbr, index) => [abbr, index + 1]));
}
