import { FAIR_SIM_RULE_OPTIONS, FORCE_WIN_RULE_OPTIONS } from "@rec/shared";
import type { LeagueSettingsDraft } from "../../../types/api.js";

const FORCE_WIN_OPTIONS = FORCE_WIN_RULE_OPTIONS.map((o) => ({ value: o.key, label: o.label }));
const FAIR_SIM_OPTIONS = FAIR_SIM_RULE_OPTIONS.map((o) => ({ value: o.key, label: o.label }));

// Declarative field schema driving a single generic form renderer (SettingsHome.tsx).
//
// Deliberately NOT covered by this schema (each has a genuinely different editor shape):
// conferenceAssignments (team->conference map), custom rules (its own list editor), the
// league logo (its own upload control), and every *_channel_id field — channel routing is
// the Discord tab, a completely separate save path (apps/api/src/modules/server-config/).
// Pending reviews (custom players, payouts) live in Notifications, not Settings.
//
// Season caps (custom players/legends/dev upgrades/age resets/attributes/contracts) were
// removed platform-wide in favor of the upcoming progression-tree system — every purchase
// type is a plain Enabled/Disabled toggle now, no per-season limit to configure.

export type SettingsFieldType = "toggle" | "number" | "text" | "textarea" | "enum" | "multiselect";

export type SettingsNavGroup = "league";

export const SETTINGS_NAV_GROUPS: { key: SettingsNavGroup; label: string }[] = [
  { key: "league", label: "League Settings" },
];

export type SettingsField = {
  key: string;
  label: string;
  type: SettingsFieldType;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  hint?: string;
  // Field is shown (and editable) only when this returns true for the current draft.
  // When false, the field's value is reset to `resetTo` (or left untouched if omitted)
  // right before submit.
  dependsOn?: (draft: LeagueSettingsDraft) => boolean;
  resetTo?: unknown;
};

export type SettingsCategory = {
  key: string;
  label: string;
  fields: SettingsField[];
  group: SettingsNavGroup;
  navHidden?: boolean;
};

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  // Only shown when the league is Rise to Immortality (SettingsHome.tsx filters this in
  // addition to isSettingsCategoryVisible) -- intro video URL + rookie draft scheduling, the
  // only Origins-facing commissioner controls RTI still needs.
  { key: "rise", label: "Rise to Immortality", group: "league", fields: [] },
  {
    key: "economy",
    label: "Economy & XP",
    group: "league",
    fields: [
      { key: "coinEconomyEnabled", label: "Coin Economy & XP", type: "toggle", hint: "Master switch — turning this off disables every purchase type below regardless of its own toggle. Also grayed out below the 8-linked-member floor, whether from this switch or that floor not being reached yet." },
      { key: "customPlayersEnabled", label: "Custom Players", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "legendsEnabled", label: "Legends", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "devUpgradesEnabled", label: "Dev Upgrades", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "ageResetsEnabled", label: "Age Resets", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "attributePurchasesEnabled", label: "Attribute Upgrades", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "contractAdjustmentPurchasesEnabled", label: "Contract Purchases", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
    ],
  },
  {
    key: "league_info",
    label: "League Info",
    group: "league",
    fields: [
      { key: "name", label: "League Name", type: "text" },
      { key: "leaguePassword", label: "League Password", type: "text", hint: "Shown to members claiming a team — leave blank for no password." },
    ],
  },
  {
    key: "rules",
    label: "Rules",
    group: "league",
    fields: [
      { key: "forceWinRulesRegular", label: "Force Win Rules — Regular Season", type: "multiselect", options: FORCE_WIN_OPTIONS, hint: "When any of these apply, a coach can request (or a commissioner can grant) a Force Win." },
      { key: "forceWinRulesPostseason", label: "Force Win Rules — Postseason", type: "multiselect", options: FORCE_WIN_OPTIONS },
      { key: "fairSimRulesRegular", label: "Fair Sim Rules — Regular Season", type: "multiselect", options: FAIR_SIM_OPTIONS, hint: "When any of these apply, the game is settled as a Fair Sim instead of played." },
      { key: "fairSimRulesPostseason", label: "Fair Sim Rules — Postseason", type: "multiselect", options: FAIR_SIM_OPTIONS },
      { key: "regularSeasonStreamingRequirement", label: "Regular Season Streaming", type: "enum", options: [{ value: "required", label: "Required" }, { value: "recommended", label: "Recommended" }, { value: "disabled", label: "Disabled" }] },
      { key: "postseasonStreamingRequirement", label: "Post-Season Streaming", type: "enum", options: [{ value: "required", label: "Required" }, { value: "recommended", label: "Recommended" }, { value: "disabled", label: "Disabled" }] },
      { key: "gotwStreamingRequirement", label: "GOTW Streaming", type: "enum", hint: "Overrides Regular Season Streaming for Game of the Week matchups only — Post-Season Streaming still governs a GOTW that falls in the postseason.", options: [{ value: "required", label: "Required" }, { value: "recommended", label: "Recommended" }, { value: "disabled", label: "Disabled" }] },
      { key: "regularSeasonStreamingSide", label: "Required Streaming Side", type: "enum", hint: "Applies to Regular Season, Post-Season, and GOTW streaming alike.", options: [{ value: "home", label: "Home" }, { value: "away", label: "Away" }, { value: "either", label: "Either" }] },
      { key: "positionChangePolicy", label: "Position Change Policy", type: "enum", options: [{ value: "open", label: "Open" }, { value: "restricted", label: "Restricted" }, { value: "highly_restricted", label: "Highly Restricted" }] },
      { key: "positionChangePolicyDescription", label: "Position Change Details", type: "textarea", dependsOn: (d) => d.positionChangePolicy !== "open" },
      { key: "tradesAllowed", label: "Trades Allowed", type: "toggle", hint: "When on, every trade — GM or CPU — goes through competition-committee voting on the Proposed Trades Discord channel. There's no unreviewed or single-commissioner-approved trade path anymore." },
    ],
  },
  {
    key: "gameplay",
    label: "Gameplay",
    group: "league",
    fields: [
      { key: "coachModeEnabled", label: "Coach Mode", type: "toggle" },
      { key: "coachModeAutoPassEnabled", label: "Coach Mode: Auto-Pass", type: "toggle", dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "coachModeAutoSnapEnabled", label: "Coach Mode: Auto-Snap", type: "toggle", dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "coachModeCoachSuggestionsEnabled", label: "Coach Mode: Coach Suggestions", type: "toggle", dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "preorderBonusesEnabled", label: "Preorder Bonuses", type: "toggle" },
      { key: "difficulty", label: "Difficulty", type: "enum", options: [{ value: "rookie", label: "Rookie" }, { value: "pro", label: "Pro" }, { value: "all_pro", label: "All-Pro" }, { value: "all_madden", label: "All-Madden" }] },
      { key: "quarterLengthMinutes", label: "Quarter Length (minutes)", type: "number", min: 1, max: 15 },
      { key: "acceleratedClockEnabled", label: "Accelerated Clock", type: "toggle" },
      { key: "acceleratedClockMinimumSeconds", label: "Accelerated Clock Minimum (seconds)", type: "number", min: 0, max: 40, dependsOn: (d) => Boolean(d.acceleratedClockEnabled), resetTo: 0 },
      { key: "injuryPolicy", label: "Injuries", type: "enum", options: [{ value: "off", label: "Off" }, { value: "on_reduced", label: "Reduced Slightly" }, { value: "on_standard", label: "Reduced Heavily" }] },
      { key: "wearAndTearEnabled", label: "Wear & Tear", type: "toggle" },
      { key: "fatiguePolicy", label: "Fatigue", type: "enum", options: [{ value: "off", label: "Off" }, { value: "on_reduced", label: "Reduced Slightly" }, { value: "on_standard", label: "Reduced Heavily" }] },
      { key: "ballHawk", label: "Ball Hawk", type: "enum", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "keep_individual", label: "Keep Individual" }] },
      { key: "heatSeeker", label: "Heat Seeker", type: "enum", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "keep_individual", label: "Keep Individual" }] },
      { key: "switchAssist", label: "Switch Assist", type: "enum", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "keep_individual", label: "Keep Individual" }] },
      { key: "customCoachesRequired", label: "Custom Coaches Required", type: "toggle" },
      { key: "coachFiringPolicy", label: "Coach Firing Policy", type: "enum", options: [{ value: "off", label: "Off" }, { value: "on", label: "On" }, { value: "cpu_only", label: "CPU Teams Only" }] },
      { key: "customPlaybooksAllowed", label: "Custom Playbooks Allowed", type: "toggle" },
      { key: "offensivePlayCallCooldownEnabled", label: "Offensive Play Call Cooldown", type: "toggle" },
      { key: "offensivePlayCallCooldown", label: "Offensive Play Call Cooldown (seconds)", type: "number", min: 1, max: 50, dependsOn: (d) => Boolean(d.offensivePlayCallCooldownEnabled), resetTo: null },
      { key: "defensivePlayCallCooldownEnabled", label: "Defensive Play Call Cooldown", type: "toggle" },
      { key: "defensivePlayCallCooldown", label: "Defensive Play Call Cooldown (seconds)", type: "number", min: 1, max: 50, dependsOn: (d) => Boolean(d.defensivePlayCallCooldownEnabled), resetTo: null },
      { key: "offensivePlayCallLimitsEnabled", label: "Offensive Play Call Limit", type: "toggle" },
      { key: "offensivePlayCallLimit", label: "Offensive Play Call Limit (count)", type: "number", min: 1, max: 50, dependsOn: (d) => Boolean(d.offensivePlayCallLimitsEnabled), resetTo: null },
      { key: "defensivePlayCallLimitsEnabled", label: "Defensive Play Call Limit", type: "toggle" },
      { key: "defensivePlayCallLimit", label: "Defensive Play Call Limit (count)", type: "number", min: 1, max: 50, dependsOn: (d) => Boolean(d.defensivePlayCallLimitsEnabled), resetTo: null },
      { key: "fourthDownRuleTypeRegular", label: "4th Down Rules (Regular Season)", type: "enum", hint: "Standard REC: only go for it past midfield on 4th-and-3 or shorter; a team trailing in the second half may go for it at any time.", options: [{ value: "none", label: "None" }, { value: "standard_rec", label: "Standard REC" }, { value: "custom", label: "Custom" }] },
      { key: "customFourthDownRuleRegular", label: "Custom 4th Down Rule (Regular)", type: "textarea", dependsOn: (d) => d.fourthDownRuleTypeRegular === "custom" },
      { key: "fourthDownRuleTypePlayoff", label: "4th Down Rules (Post-Season)", type: "enum", hint: "Standard REC: only go for it past midfield on 4th-and-3 or shorter; a team trailing in the second half may go for it at any time.", options: [{ value: "none", label: "None" }, { value: "standard_rec", label: "Standard REC" }, { value: "custom", label: "Custom" }] },
      { key: "customFourthDownRulePlayoff", label: "Custom 4th Down Rule (Post-Season)", type: "textarea", dependsOn: (d) => d.fourthDownRuleTypePlayoff === "custom" },
    ],
  },
];

const MERGED_INTO_RULES = new Set(["features", "play_call"]);

export function resolveSettingsCategoryKey(key: string | null): string {
  if (!key) return SETTINGS_CATEGORIES.find((c) => !c.navHidden)?.key ?? "economy";
  if (MERGED_INTO_RULES.has(key)) return "rules";
  if (SETTINGS_CATEGORIES.some((c) => c.key === key && !c.navHidden)) return key;
  return SETTINGS_CATEGORIES.find((c) => !c.navHidden)?.key ?? "economy";
}

export function settingsCategoryNavLabel(category: SettingsCategory): string {
  return category.label;
}

export function isSettingsCategoryVisible(category: SettingsCategory): boolean {
  if (category.navHidden) return false;
  return true;
}
