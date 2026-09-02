import { FAIR_SIM_RULE_OPTIONS, FORCE_WIN_RULE_OPTIONS } from "@rec/shared";
import type { LeagueSettingsDraft } from "../../../types/api.js";

const FORCE_WIN_OPTIONS = FORCE_WIN_RULE_OPTIONS.map((o) => ({ value: o.key, label: o.label }));
const FAIR_SIM_OPTIONS = FAIR_SIM_RULE_OPTIONS.map((o) => ({ value: o.key, label: o.label }));

// Declarative field schema driving a single generic form renderer (SettingsHome.tsx)
// instead of ~8 hand-built screens — apps/api/src/modules/setup/setup.schemas.ts's
// CreateLeagueSchema has ~90 fields, most following one of a handful of repeating shapes
// (a toggle gating a numeric cap, an enum gating a free-text explanation, etc.), so one
// schema-driven renderer covers far more ground than bespoke components would in the same
// amount of code.
//
// Deliberately NOT covered by this schema (each has a genuinely different editor shape):
// conferenceAssignments (team->conference map), and
// the ~11 *_channel_id fields — channel routing saves through a different API path entirely
// (apps/api/src/modules/server-config/), not updateLeagueConfig, matching how the Discord
// flow itself separates them (see apps/bot/src/flows/league-setup.ts's saveChannelEditIfNeeded).
// Pending reviews (custom players, box scores, payouts) live in Notifications, not Settings.

export type SettingsFieldType = "toggle" | "number" | "text" | "textarea" | "enum" | "multiselect";

export type SettingsNavGroup = "discord" | "league" | "ops";

export const SETTINGS_NAV_GROUPS: { key: SettingsNavGroup; label: string }[] = [
  { key: "discord", label: "Discord" },
  { key: "league", label: "League" },
  { key: "ops", label: "Operations" },
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
  // right before submit — mirrors the cascading zero-out rules in the Discord flow's
  // applyLeagueSetupDependencies.
  dependsOn?: (draft: LeagueSettingsDraft) => boolean;
  resetTo?: unknown;
  // Field only applies to certain games (e.g. CFB-only or Madden-only settings).
  gameFilter?: (game: string) => boolean;
};

export type SettingsCategory = {
  key: string;
  label: string;
  fields: SettingsField[];
  group: SettingsNavGroup;
  // Hidden from the tab strip (fields still save). Used to merge Play Call into Rules.
  navHidden?: boolean;
};

const notCfb = (game: string) => game !== "cfb_27";
const isCfb = (game: string) => game === "cfb_27";

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { key: "channels", label: "Channels", group: "discord", fields: [] },
  { key: "integrations", label: "Integrations", group: "discord", fields: [] },
  // Only shown when the league is Rise to Immortality (SettingsHome.tsx filters this in
  // addition to isSettingsCategoryVisible, which only knows about `game`) -- intro video URL
  // + rookie draft scheduling, the only Origins-facing commissioner controls RTI still needs.
  { key: "rise", label: "Rise to Immortality", group: "league", fields: [] },
  {
    key: "purchases",
    label: "Economy",
    group: "league",
    fields: [
      { key: "coinEconomyEnabled", label: "Coin Economy Enabled", type: "toggle", hint: "Master switch — turning this off disables every purchase type below." },
      { key: "customPlayersEnabled", label: "Custom Players Enabled", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled), hint: "Pending custom player builds are reviewed from Notifications, not this page." },
      { key: "customPlayersSeasonCap", label: "Custom Players Season Cap", type: "number", min: 0, max: 5, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.customPlayersEnabled), resetTo: 0 },
      { key: "legendsEnabled", label: "Legends Enabled", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "legendsSeasonCap", label: "Legends Season Cap", type: "number", min: 0, max: 5, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.legendsEnabled), resetTo: 0 },
      { key: "devUpgradesEnabled", label: "Dev Upgrades Enabled", type: "toggle", gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "devUpgradesSeasonCap", label: "Dev Upgrades Season Cap (tiers per team, per season)", type: "number", min: 0, max: 20, gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.devUpgradesEnabled), hint: "A multi-tier jump (e.g. Star straight to X-Factor) counts as 2 against this cap, same as buying two separate one-tier upgrades.", resetTo: 0 },
      { key: "ageResetsEnabled", label: "Age Resets Enabled", type: "toggle", gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "ageResetsSeasonCap", label: "Age Resets Season Cap", type: "number", min: 0, max: 5, gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.ageResetsEnabled), resetTo: 0 },
      { key: "attributePurchasesEnabled", label: "Attribute Purchases Enabled", type: "toggle", gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "coreAttributePurchasesSeasonCap", label: "Core Attribute Default Cap (points, per attribute)", type: "number", min: 0, max: 99, gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.attributePurchasesEnabled), resetTo: 0 },
      { key: "nonCoreAttributeCapMode", label: "Non-Core Cap Mode", type: "enum", gameFilter: notCfb, options: [{ value: "group", label: "As a group" }, { value: "individual", label: "Individual caps" }], dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.attributePurchasesEnabled) },
      { key: "nonCoreAttributePurchasesSeasonCap", label: "Non-Core Attribute Group Cap (points, total across all Non-Core)", type: "number", min: 0, max: 99, gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.attributePurchasesEnabled && d.nonCoreAttributeCapMode !== "individual"), resetTo: 0 },
      { key: "contractAdjustmentPurchasesEnabled", label: "Contract Adjustment Purchases Enabled", type: "toggle", gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "contractPurchasesSeasonCap", label: "Contract Adjustment Season Cap", type: "number", min: 0, max: 5, gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.contractAdjustmentPurchasesEnabled), resetTo: 0 },
    ],
  },
  {
    key: "rules",
    label: "Rules & Policies",
    group: "league",
    fields: [
      { key: "forceWinRulesRegular", label: "Force Win Rules — Regular Season", type: "multiselect", options: FORCE_WIN_OPTIONS, hint: "When any of these apply, a coach can request (or a commissioner can grant) a Force Win." },
      { key: "forceWinRulesPostseason", label: "Force Win Rules — Postseason", type: "multiselect", options: FORCE_WIN_OPTIONS },
      { key: "fairSimRulesRegular", label: "Fair Sim Rules — Regular Season", type: "multiselect", options: FAIR_SIM_OPTIONS, hint: "When any of these apply, the game is settled as a Fair Sim instead of played." },
      { key: "fairSimRulesPostseason", label: "Fair Sim Rules — Postseason", type: "multiselect", options: FAIR_SIM_OPTIONS },
      { key: "regularSeasonStreamingRequirement", label: "Regular Season Streaming", type: "enum", options: [{ value: "required", label: "Required" }, { value: "recommended", label: "Recommended" }, { value: "disabled", label: "Disabled" }] },
      { key: "regularSeasonStreamingSide", label: "Regular Season Streaming Side", type: "enum", options: [{ value: "home", label: "Home" }, { value: "away", label: "Away" }, { value: "either", label: "Either" }, { value: "both", label: "Both" }] },
      { key: "postseasonStreamingRequirement", label: "Postseason Streaming", type: "enum", options: [{ value: "required", label: "Required" }, { value: "recommended", label: "Recommended" }, { value: "disabled", label: "Disabled" }] },
      { key: "postseasonStreamingSide", label: "Postseason Streaming Side", type: "enum", options: [{ value: "home", label: "Home" }, { value: "away", label: "Away" }, { value: "either", label: "Either" }, { value: "both", label: "Both" }] },
      { key: "gotwStreamingRequirement", label: "GOTW Streaming Requirement", type: "enum", options: [{ value: "required", label: "Required" }, { value: "recommended", label: "Recommended" }, { value: "disabled", label: "Disabled" }] },
      { key: "gotwStreamingSide", label: "GOTW Streaming Side", type: "enum", options: [{ value: "home", label: "Home" }, { value: "away", label: "Away" }, { value: "either", label: "Either" }, { value: "both", label: "Both" }] },
      { key: "fourthDownRuleTypeRegular", label: "4th Down Rule (Regular Season)", type: "enum", hint: "Standard REC: only go for it past midfield on 4th-and-3 or shorter; a team trailing in the second half may go for it at any time.", options: [{ value: "none", label: "None" }, { value: "standard_rec", label: "Standard REC" }, { value: "custom", label: "Custom" }] },
      { key: "customFourthDownRuleRegular", label: "Custom 4th Down Rule (Regular)", type: "textarea", dependsOn: (d) => d.fourthDownRuleTypeRegular === "custom" },
      { key: "fourthDownRuleTypePlayoff", label: "4th Down Rule (Playoffs)", type: "enum", hint: "Standard REC: only go for it past midfield on 4th-and-3 or shorter; a team trailing in the second half may go for it at any time.", options: [{ value: "none", label: "None" }, { value: "standard_rec", label: "Standard REC" }, { value: "custom", label: "Custom" }] },
      { key: "customFourthDownRulePlayoff", label: "Custom 4th Down Rule (Playoffs)", type: "textarea", dependsOn: (d) => d.fourthDownRuleTypePlayoff === "custom" },
      { key: "customCoachesRequired", label: "Custom Coaches Required", type: "toggle" },
      { key: "customPlaybooksAllowed", label: "Custom Playbooks Allowed", type: "toggle" },
      { key: "coachAbilitiesRestricted", label: "Coach Abilities Restricted", type: "toggle", gameFilter: notCfb },
      { key: "coachAbilitiesRestrictionNotes", label: "Coach Abilities Restriction Notes", type: "textarea", gameFilter: notCfb, dependsOn: (d) => Boolean(d.coachAbilitiesRestricted) },
      { key: "positionChangePolicy", label: "Position Change Policy", type: "enum", gameFilter: notCfb, options: [{ value: "open", label: "Open" }, { value: "restricted", label: "Restricted" }, { value: "highly_restricted", label: "Highly Restricted" }] },
      { key: "positionChangePolicyDescription", label: "Position Change Policy Details", type: "textarea", gameFilter: notCfb, dependsOn: (d) => d.positionChangePolicy !== "open" },
      { key: "tradeApprovalPolicy", label: "Trade Approval Policy", type: "enum", gameFilter: notCfb, hint: "Controls whether user trades are immediate or must be approved by league staff.", options: [{ value: "no_approval_required", label: "No Approval Required" }, { value: "commissioner_review", label: "Commissioner Review" }, { value: "competition_committee_review", label: "Comp. Committee Review" }] },
      { key: "cpuTradingPolicy", label: "CPU Trading Policy", type: "enum", gameFilter: notCfb, hint: "Controls whether users may trade with CPU-controlled Madden teams.", options: [{ value: "allowed", label: "Allowed" }, { value: "restricted", label: "Restricted" }, { value: "not_allowed", label: "Not Allowed" }] },
      { key: "cpuTradesSeasonCap", label: "CPU Trades Per Team, Per Season", type: "enum", gameFilter: notCfb, hint: "Counts only trades where at least one side is CPU-controlled. Unlimited is stored as zero.", options: [{ value: "0", label: "Unlimited" }, { value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }, { value: "5", label: "5" }], dependsOn: (d) => d.cpuTradingPolicy !== "not_allowed", resetTo: 0 },
      { key: "injuryPolicy", label: "Injury Policy", type: "enum", options: [{ value: "off", label: "Off" }, { value: "on_standard", label: "On (Standard)" }, { value: "on_reduced", label: "On (Reduced)" }] },
      { key: "crossPlayEnabled", label: "Cross-Platform Members Allowed", type: "toggle", hint: "Off restricts this league to one console." },
      { key: "requiredConsole", label: "Required Console", type: "enum", dependsOn: (d) => d.crossPlayEnabled === false, options: [{ value: "ps5", label: "PS5" }, { value: "xbox", label: "Xbox" }, { value: "pc", label: "PC" }] },
    ],
  },
  {
    key: "gameplay",
    label: "Gameplay",
    group: "league",
    fields: [
      { key: "slidersAdjusted", label: "Custom Sliders Enabled", type: "toggle", hint: "When enabled, choose a sourced community template or enter every slider value below." },
      { key: "difficulty", label: "Difficulty", type: "enum", gameFilter: notCfb, options: [{ value: "rookie", label: "Rookie" }, { value: "pro", label: "Pro" }, { value: "all_pro", label: "All-Pro" }, { value: "all_madden", label: "All-Madden" }] },
      { key: "cfbDifficulty", label: "Difficulty", type: "enum", gameFilter: isCfb, options: [{ value: "freshman", label: "Freshman" }, { value: "varsity", label: "Varsity" }, { value: "all_american", label: "All-American" }, { value: "heisman", label: "Heisman" }] },
      { key: "tradeDifficulty", label: "Trade Difficulty", type: "enum", gameFilter: notCfb, hint: "Mirrors the in-game 'Trade Difficulty' league setting — how willing CPU teams are to accept trades.", options: [{ value: "very_easy", label: "Very Easy" }, { value: "easy", label: "Easy" }, { value: "normal", label: "Normal" }, { value: "hard", label: "Hard" }, { value: "very_hard", label: "Very Hard" }] },
      { key: "freeAgentMotivationImpact", label: "Free Agent Motivation Impact", type: "enum", gameFilter: (game) => game === "madden_26", hint: "Mirrors the Madden 26 'Free Agent Motivation Impact' league setting — how much factors like money, playing time, and championship odds weigh in free-agent signings. Does not exist in Madden 27.", options: [{ value: "off", label: "Off (None)" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "very_high", label: "Very High" }] },
      { key: "difficultyCustomSettings", label: "Custom Difficulty Settings", type: "textarea" },
      { key: "quarterLengthMinutes", label: "Quarter Length (minutes)", type: "number", min: 1, max: 15 },
      { key: "acceleratedClockEnabled", label: "Accelerated Clock Enabled", type: "toggle" },
      { key: "acceleratedClockMinimumSeconds", label: "Accelerated Clock Minimum (seconds)", type: "number", min: 0, max: 40, dependsOn: (d) => Boolean(d.acceleratedClockEnabled), resetTo: 0 },
      { key: "wearAndTearEnabled", label: "Wear & Tear Enabled", type: "toggle" },
      { key: "salaryCapEnabled", label: "Salary Cap Enabled", type: "toggle", gameFilter: notCfb },
      { key: "tradeDeadlineEnabled", label: "Trade Deadline Enabled", type: "toggle", gameFilter: notCfb },
      { key: "abilitiesEnabled", label: "Abilities Enabled", type: "toggle" },
      { key: "ballHawk", label: "Ball Hawk", type: "enum", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "keep_individual", label: "Keep Individual" }] },
      { key: "heatSeeker", label: "Heat Seeker", type: "enum", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "keep_individual", label: "Keep Individual" }] },
      { key: "switchAssist", label: "Switch Assist", type: "enum", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "keep_individual", label: "Keep Individual" }] },
    ],
  },
  {
    key: "franchise",
    label: "Franchise",
    group: "league",
    fields: [
      { key: "dynastyType", label: "Dynasty Type", type: "enum", gameFilter: isCfb, options: [{ value: "real", label: "Real Rosters" }, { value: "mixed", label: "Mixed (Team Builder Allowed)" }] },
      { key: "recruitingDifficulty", label: "Recruiting Difficulty", type: "enum", gameFilter: isCfb, options: [{ value: "easy", label: "Easy" }, { value: "normal", label: "Normal" }, { value: "hard", label: "Hard" }] },
      { key: "coachXpSetting", label: "Coach XP Setting", type: "enum", gameFilter: isCfb, options: [{ value: "casual", label: "Casual" }, { value: "career", label: "Career" }, { value: "simulation", label: "Simulation" }] },
      { key: "playerEditPermission", label: "Player Edit Permission", type: "enum", gameFilter: isCfb, hint: "Informational only — who is expected to edit player info/ratings in-game.", options: [{ value: "commish_only", label: "Commissioner Only" }, { value: "any_player", label: "Any Player" }, { value: "none", label: "None" }] },
      { key: "manualXpProgressionPenaltyPct", label: "Manual XP Progression Penalty (%)", type: "number", min: 0, max: 100, gameFilter: isCfb, hint: "Coin/points penalty applied when progression is done manually instead of automatically." },
      { key: "verbalCommitInfluencePct", label: "Verbal Commit Influence (%)", type: "number", min: 0, max: 100, gameFilter: isCfb, hint: "How much a verbal commitment influences a recruit's final decision." },
      { key: "userTransferChancePct", label: "User Player Transfer Chance (%)", type: "number", min: 0, max: 100, gameFilter: isCfb },
      { key: "cpuTransferChancePct", label: "CPU Player Transfer Chance (%)", type: "number", min: 0, max: 100, gameFilter: isCfb },
      { key: "transferPortalMaxPerTeam", label: "Transfer Portal Max Transfers Per Team", type: "number", min: 0, max: 30, gameFilter: isCfb, hint: "0 turns the transfer portal off. Max 30." },
      { key: "minimumPlayClockSeconds", label: "Minimum Play Clock (seconds)", type: "number", min: 10, max: 25, gameFilter: isCfb },
      { key: "seasonExperience", label: "Season Experience", type: "enum", gameFilter: isCfb, hint: "How much manual control users have over season-to-season decisions.", options: [{ value: "full_control", label: "Full Control" }, { value: "customized", label: "Customized" }, { value: "simple", label: "Simple" }] },
      { key: "transferPortalEnabled", label: "Transfer Portal Enabled", type: "toggle", gameFilter: isCfb },
      { key: "coachCarouselEnabled", label: "Coach Carousel Enabled", type: "toggle", gameFilter: isCfb },
      { key: "homeFieldAdvantageEnabled", label: "Home-Field Advantage Enabled", type: "toggle", gameFilter: isCfb },
      { key: "stadiumPulseEnabled", label: "Stadium Pulse Enabled", type: "toggle", gameFilter: isCfb },
      { key: "conferenceRealignment", label: "Conference Realignment", type: "enum", gameFilter: isCfb, options: [{ value: "allowed", label: "Allowed" }, { value: "locked", label: "Locked" }] },
      { key: "coachFiringPolicy", label: "Coach Firing Policy", type: "enum", options: [{ value: "off", label: "Off" }, { value: "on", label: "On" }, { value: "cpu_only", label: "CPU Teams Only" }] },
      { key: "preorderBonusesEnabled", label: "Preorder Bonuses Enabled", type: "toggle" },
      { key: "coachModeEnabled", label: "Coach Mode Enabled", type: "toggle" },
      { key: "coachModeAutoPassEnabled", label: "Coach Mode: Auto-Pass", type: "toggle", dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "coachModeAutoSnapEnabled", label: "Coach Mode: Auto-Snap", type: "toggle", dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "coachModeCoachSuggestionsEnabled", label: "Coach Mode: Coach Suggestions", type: "toggle", dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "coachModeRecruitFlippingEnabled", label: "Coach Mode: Recruit Flipping", type: "toggle", gameFilter: isCfb, dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "coachModeAutoRecruitingEnabled", label: "Coach Mode: Auto-Recruiting", type: "toggle", gameFilter: isCfb, dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "coachModeAutoProgressPlayersEnabled", label: "Coach Mode: Auto-Progress Players", type: "toggle", gameFilter: isCfb, dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "coachModeUserAutoProgressionEnabled", label: "Coach Mode: User Auto-Progression", type: "toggle", gameFilter: isCfb, dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "coachModeCpuManageBudgetEnabled", label: "Coach Mode: CPU Manages Budget", type: "toggle", gameFilter: isCfb, dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "coachModeCpuManageStaffEnabled", label: "Coach Mode: CPU Manages Staff", type: "toggle", gameFilter: isCfb, dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
      { key: "coachModeCpuManageFacilitiesEnabled", label: "Coach Mode: CPU Manages Facilities", type: "toggle", gameFilter: isCfb, dependsOn: (d) => Boolean(d.coachModeEnabled), resetTo: false },
    ],
  },
  { key: "moderation", label: "Bans & Restrictions", group: "league", fields: [] },
  {
    key: "play_call",
    label: "Play Call Settings",
    group: "league",
    navHidden: true,
    fields: [
      { key: "offensivePlayCallLimitsEnabled", label: "Offensive Play Call Limits Enabled", type: "toggle" },
      { key: "offensivePlayCallLimit", label: "Offensive Play Call Limit", type: "number", min: 1, max: 50, dependsOn: (d) => Boolean(d.offensivePlayCallLimitsEnabled), resetTo: null },
      { key: "offensivePlayCallCooldownEnabled", label: "Offensive Play Call Cooldown Enabled", type: "toggle" },
      { key: "offensivePlayCallCooldown", label: "Offensive Play Call Cooldown (seconds)", type: "number", min: 1, max: 50, dependsOn: (d) => Boolean(d.offensivePlayCallCooldownEnabled), resetTo: null },
      { key: "defensivePlayCallLimitsEnabled", label: "Defensive Play Call Limits Enabled", type: "toggle" },
      { key: "defensivePlayCallLimit", label: "Defensive Play Call Limit", type: "number", min: 1, max: 50, dependsOn: (d) => Boolean(d.defensivePlayCallLimitsEnabled), resetTo: null },
      { key: "defensivePlayCallCooldownEnabled", label: "Defensive Play Call Cooldown Enabled", type: "toggle" },
      { key: "defensivePlayCallCooldown", label: "Defensive Play Call Cooldown (seconds)", type: "number", min: 1, max: 50, dependsOn: (d) => Boolean(d.defensivePlayCallCooldownEnabled), resetTo: null },
    ],
  },
  // Special-cased in SettingsHome.tsx to render <EosPayoutMaintenance /> instead of the
  // generic field list.
  { key: "eos-payouts", label: "Maintenance", group: "ops", fields: [] },
  // Special-cased in SettingsHome.tsx — commissioners leave the league from here because the
  // league top nav only shows Retire for non-commissioner members.
  { key: "retire", label: "Retire", group: "ops", fields: [] },
  // Special-cased in SettingsHome.tsx to render <DeleteLeagueHome /> instead of the generic
  // field list — a destructive standalone action, not a settings form.
  { key: "delete-league", label: "Delete League", group: "ops", fields: [] },
];

const MERGED_INTO_RULES = new Set(["features", "play_call"]);

export function resolveSettingsCategoryKey(key: string | null): string {
  if (!key) return SETTINGS_CATEGORIES.find((c) => !c.navHidden)?.key ?? "channels";
  if (MERGED_INTO_RULES.has(key)) return "rules";
  if (SETTINGS_CATEGORIES.some((c) => c.key === key && !c.navHidden)) return key;
  return SETTINGS_CATEGORIES.find((c) => !c.navHidden)?.key ?? "channels";
}

export function settingsCategoryNavLabel(category: SettingsCategory, game: string): string {
  if (category.key === "franchise") return isCfb(game) ? "Dynasty" : "Franchise";
  return category.label;
}

export function isSettingsCategoryVisible(category: SettingsCategory, game: string): boolean {
  if (category.navHidden) return false;
  if (category.fields.length === 0) return true;
  return category.fields.some((field) => !field.gameFilter || field.gameFilter(game));
}
