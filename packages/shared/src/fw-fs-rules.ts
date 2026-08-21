// Force Win (FW) / Fair Sim (FS) policy option keys -- season-scoped multi-selects, one array
// per league per season stage (regular/postseason), stored on rec_league_configuration. Replaces
// the old free-text fair_sim_requirements/force_win_requirements columns, which described a
// policy but had no logic behind them (e.g. the "1 hour late" check-in window was hardcoded).

export type ForceWinRuleKey =
  | "never"
  | "failure_to_schedule"
  | "missed_window"
  | "dashing"
  | "rule_violation";

export const FORCE_WIN_RULE_OPTIONS: Array<{ key: ForceWinRuleKey; label: string; description: string }> = [
  { key: "never", label: "Never granted", description: "Force Wins are disabled entirely for this stage." },
  { key: "failure_to_schedule", label: "Failure to attempt scheduling", description: "A coach never engages with scheduling at all." },
  { key: "missed_window", label: "Missed agreed scheduling window", description: "A coach is late (1hr+) to a confirmed kickoff." },
  { key: "dashing", label: "Dashing (quitting in 1st half)", description: "A coach quits out before halftime instead of conceding." },
  { key: "rule_violation", label: "Rule violations", description: "Any other reported violation of league rules." },
];

export type FairSimRuleKey =
  | "scheduling_disagreement"
  | "cant_make_game_no_autopilot"
  | "allow_autopilot_requests";

export const FAIR_SIM_RULE_OPTIONS: Array<{ key: FairSimRuleKey; label: string; description: string }> = [
  { key: "scheduling_disagreement", label: "Inability to agree on a time", description: "Coaches can't land on a shared kickoff window." },
  { key: "cant_make_game_no_autopilot", label: "Can't Make Game (no AutoPilot request)", description: "A coach can't make it and doesn't ask for AutoPilot." },
  { key: "allow_autopilot_requests", label: "Allow AutoPilot requests", description: "A coach who can't make it may ask the opponent to play that coach's team as a CPU." },
];

const FORCE_WIN_KEY_SET = new Set<string>(FORCE_WIN_RULE_OPTIONS.map((o) => o.key));
const FAIR_SIM_KEY_SET = new Set<string>(FAIR_SIM_RULE_OPTIONS.map((o) => o.key));

export function sanitizeForceWinRuleKeys(values: readonly string[] | null | undefined): ForceWinRuleKey[] {
  const keys = (values ?? []).filter((v): v is ForceWinRuleKey => FORCE_WIN_KEY_SET.has(v));
  // "never" is exclusive -- selecting it alongside anything else is contradictory, so it wins.
  return keys.includes("never") ? ["never"] : keys;
}

export function sanitizeFairSimRuleKeys(values: readonly string[] | null | undefined): FairSimRuleKey[] {
  return (values ?? []).filter((v): v is FairSimRuleKey => FAIR_SIM_KEY_SET.has(v));
}

export function forceWinRuleLabel(key: string): string {
  return FORCE_WIN_RULE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

export function fairSimRuleLabel(key: string): string {
  return FAIR_SIM_RULE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}
