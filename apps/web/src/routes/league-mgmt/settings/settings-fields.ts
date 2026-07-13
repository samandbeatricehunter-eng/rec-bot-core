import type { LeagueSettingsDraft } from "../../../types/api.js";

// Declarative field schema driving a single generic form renderer (SettingsHome.tsx)
// instead of ~8 hand-built screens — apps/api/src/modules/setup/setup.schemas.ts's
// CreateLeagueSchema has ~90 fields, most following one of a handful of repeating shapes
// (a toggle gating a numeric cap, an enum gating a free-text explanation, etc.), so one
// schema-driven renderer covers far more ground than bespoke components would in the same
// amount of code.
//
// Deliberately NOT covered here (left for a follow-up pass, each is a genuinely different
// editor shape from everything below): coreAttributes / coreAttributeCapOverrides (per-
// attribute multi-select + override map), conferenceAssignments (team->conference map), and
// the ~11 *_channel_id fields — channel routing saves through a different API path entirely
// (apps/api/src/modules/server-config/), not updateLeagueConfig, matching how the Discord
// flow itself separates them (see apps/bot/src/flows/league-setup.ts's saveChannelEditIfNeeded).

export type SettingsFieldType = "toggle" | "number" | "text" | "textarea" | "enum";

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

export type SettingsCategory = { key: string; label: string; fields: SettingsField[] };

const notCfb = (game: string) => game !== "cfb_27";
const isCfb = (game: string) => game === "cfb_27";

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    key: "features",
    label: "Features",
    fields: [
      { key: "coinEconomyEnabled", label: "Coin Economy Enabled", type: "toggle", hint: "Master switch — turning this off disables every purchase type below." },
      { key: "fairSimRequirements", label: "Fair Sim Requirements", type: "textarea" },
      { key: "forceWinRequirements", label: "Force Win Requirements", type: "textarea" },
    ],
  },
  {
    key: "purchases",
    label: "Purchases",
    fields: [
      { key: "customPlayersEnabled", label: "Custom Players Enabled", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "customPlayersSeasonCap", label: "Custom Players Season Cap", type: "number", min: 0, max: 5, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.customPlayersEnabled), resetTo: 0 },
      { key: "legendsEnabled", label: "Legends Enabled", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "legendsSeasonCap", label: "Legends Season Cap", type: "number", min: 0, max: 5, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.legendsEnabled), resetTo: 0 },
      { key: "devUpgradesEnabled", label: "Dev Upgrades Enabled", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "devUpgradesSeasonCap", label: "Dev Upgrades Season Cap", type: "number", min: 0, max: 5, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.devUpgradesEnabled), resetTo: 0 },
      { key: "ageResetsEnabled", label: "Age Resets Enabled", type: "toggle", gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "ageResetsSeasonCap", label: "Age Resets Season Cap", type: "number", min: 0, max: 5, gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.ageResetsEnabled), resetTo: 0 },
      { key: "attributePurchasesEnabled", label: "Attribute Purchases Enabled", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "coreAttributePurchasesSeasonCap", label: "Core Attribute Season Cap (points)", type: "number", min: 0, max: 99, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.attributePurchasesEnabled), resetTo: 0 },
      { key: "nonCoreAttributePurchasesSeasonCap", label: "Non-Core Attribute Season Cap (points)", type: "number", min: 0, max: 99, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.attributePurchasesEnabled), resetTo: 0 },
      { key: "playerTraitPurchasesEnabled", label: "Player Trait Purchases Enabled", type: "toggle", dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "playerTraitPurchasesSeasonCap", label: "Player Trait Purchases Season Cap", type: "number", min: 0, max: 10, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.playerTraitPurchasesEnabled), resetTo: 0 },
      { key: "contractAdjustmentPurchasesEnabled", label: "Contract Adjustment Purchases Enabled", type: "toggle", gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled) },
      { key: "contractPurchasesSeasonCap", label: "Contract Adjustment Season Cap", type: "number", min: 0, max: 5, gameFilter: notCfb, dependsOn: (d) => Boolean(d.coinEconomyEnabled && d.contractAdjustmentPurchasesEnabled), resetTo: 0 },
    ],
  },
  {
    key: "rules",
    label: "Rules & Policies",
    fields: [
      { key: "regularSeasonStreamingRequirement", label: "Regular Season Streaming", type: "enum", options: [{ value: "required", label: "Required" }, { value: "recommended", label: "Recommended" }, { value: "disabled", label: "Disabled" }] },
      { key: "regularSeasonStreamingSide", label: "Regular Season Streaming Side", type: "enum", options: [{ value: "home", label: "Home" }, { value: "away", label: "Away" }, { value: "either", label: "Either" }, { value: "both", label: "Both" }] },
      { key: "postseasonStreamingRequirement", label: "Postseason Streaming", type: "enum", options: [{ value: "required", label: "Required" }, { value: "recommended", label: "Recommended" }, { value: "disabled", label: "Disabled" }] },
      { key: "postseasonStreamingSide", label: "Postseason Streaming Side", type: "enum", options: [{ value: "home", label: "Home" }, { value: "away", label: "Away" }, { value: "either", label: "Either" }, { value: "both", label: "Both" }] },
      { key: "fourthDownRuleTypeRegular", label: "4th Down Rule (Regular Season)", type: "enum", options: [{ value: "none", label: "None" }, { value: "standard_rec", label: "Standard REC" }, { value: "custom", label: "Custom" }] },
      { key: "customFourthDownRuleRegular", label: "Custom 4th Down Rule (Regular)", type: "textarea", dependsOn: (d) => d.fourthDownRuleTypeRegular === "custom" },
      { key: "fourthDownRuleTypePlayoff", label: "4th Down Rule (Playoffs)", type: "enum", options: [{ value: "none", label: "None" }, { value: "standard_rec", label: "Standard REC" }, { value: "custom", label: "Custom" }] },
      { key: "customFourthDownRulePlayoff", label: "Custom 4th Down Rule (Playoffs)", type: "textarea", dependsOn: (d) => d.fourthDownRuleTypePlayoff === "custom" },
      { key: "customCoachesRequired", label: "Custom Coaches Required", type: "toggle" },
      { key: "customPlaybooksAllowed", label: "Custom Playbooks Allowed", type: "toggle" },
      { key: "coachAbilitiesRestricted", label: "Coach Abilities Restricted", type: "toggle", gameFilter: notCfb },
      { key: "coachAbilitiesRestrictionNotes", label: "Coach Abilities Restriction Notes", type: "textarea", gameFilter: notCfb, dependsOn: (d) => Boolean(d.coachAbilitiesRestricted) },
      { key: "positionChangePolicy", label: "Position Change Policy", type: "enum", gameFilter: notCfb, options: [{ value: "open", label: "Open" }, { value: "restricted", label: "Restricted" }, { value: "highly_restricted", label: "Highly Restricted" }] },
      { key: "positionChangePolicyDescription", label: "Position Change Policy Details", type: "textarea", gameFilter: notCfb, dependsOn: (d) => d.positionChangePolicy !== "open" },
      { key: "tradeApprovalPolicy", label: "Trade Approval Policy", type: "enum", options: [{ value: "no_approval_required", label: "No Approval Required" }, { value: "commissioner_review", label: "Commissioner Review" }, { value: "competition_committee_review", label: "Comp. Committee Review" }] },
      { key: "cpuTradingPolicy", label: "CPU Trading Policy", type: "enum", options: [{ value: "allowed", label: "Allowed" }, { value: "restricted", label: "Restricted" }, { value: "not_allowed", label: "Not Allowed" }] },
      { key: "cpuTradingRestriction", label: "CPU Trading Restriction Details", type: "textarea", dependsOn: (d) => d.cpuTradingPolicy === "restricted" },
      { key: "injuryPolicy", label: "Injury Policy", type: "enum", options: [{ value: "off", label: "Off" }, { value: "on_standard", label: "On (Standard)" }, { value: "on_reduced", label: "On (Reduced)" }] },
    ],
  },
  {
    key: "gameplay",
    label: "Gameplay",
    fields: [
      { key: "difficulty", label: "Difficulty", type: "enum", options: [{ value: "rookie", label: "Rookie" }, { value: "pro", label: "Pro" }, { value: "all_pro", label: "All-Pro" }, { value: "all_madden", label: "All-Madden" }, { value: "custom", label: "Custom" }] },
      { key: "difficultyCustomSettings", label: "Custom Difficulty Settings", type: "textarea", dependsOn: (d) => d.difficulty === "custom" },
      { key: "quarterLengthMinutes", label: "Quarter Length (minutes)", type: "number", min: 1, max: 15 },
      { key: "acceleratedClockEnabled", label: "Accelerated Clock Enabled", type: "toggle" },
      { key: "acceleratedClockMinimumSeconds", label: "Accelerated Clock Minimum (seconds)", type: "number", min: 0, max: 40, dependsOn: (d) => Boolean(d.acceleratedClockEnabled), resetTo: 0 },
      { key: "wearAndTearEnabled", label: "Wear & Tear Enabled", type: "toggle" },
      { key: "salaryCapEnabled", label: "Salary Cap Enabled", type: "toggle", gameFilter: notCfb },
      { key: "tradeDeadlineEnabled", label: "Trade Deadline Enabled", type: "toggle", gameFilter: notCfb },
      { key: "abilitiesEnabled", label: "Abilities Enabled", type: "toggle" },
    ],
  },
  {
    key: "franchise",
    label: "Dynasty / Franchise",
    fields: [
      { key: "dynastyType", label: "Dynasty Type", type: "enum", gameFilter: isCfb, options: [{ value: "real", label: "Real Rosters" }, { value: "mixed", label: "Mixed (Team Builder Allowed)" }] },
      { key: "recruitingDifficulty", label: "Recruiting Difficulty", type: "enum", gameFilter: isCfb, options: [{ value: "easy", label: "Easy" }, { value: "normal", label: "Normal" }, { value: "hard", label: "Hard" }] },
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
      { key: "ballHawk", label: "Ball Hawk", type: "enum", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "keep_individual", label: "Keep Individual" }] },
      { key: "heatSeeker", label: "Heat Seeker", type: "enum", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "keep_individual", label: "Keep Individual" }] },
      { key: "switchAssist", label: "Switch Assist", type: "enum", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "keep_individual", label: "Keep Individual" }] },
    ],
  },
  {
    key: "play_call",
    label: "Play Call Settings",
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
  // Special-cased in SettingsHome.tsx to render <FirstTimeSetupHome /> instead of the
  // generic field list — a fundamentally different UI shape (a whole self-contained
  // create-league form/wizard, not a SettingsField[] list), so `fields` is unused here.
  {
    key: "first-time-setup",
    label: "First-Time Setup",
    fields: [],
  },
];
