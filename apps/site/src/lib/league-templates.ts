export type LeagueTemplateId =
  | "rec_recommended"
  | "normal_regs"
  | "hardcore_regs"
  | "fantasy_free_for_all"
  | "normal_fantasy";

export interface LeagueTemplateMeta {
  id: LeagueTemplateId;
  name: string;
  tagline: string;
  description: string;
}

export const LEAGUE_TEMPLATES: LeagueTemplateMeta[] = [
  {
    id: "rec_recommended",
    name: "REC Recommended",
    tagline: "The default REC experience",
    description:
      "The full REC experience out of the box. Gameplay runs at All-Madden with a fantasy draft, the REC standard 4th-down rule in the regular season and none in the playoffs. Trading uses competition committee review with CPU trades allowed and no salary cap. Streaming is recommended in the regular season and required in the playoffs and Game of the Week. Economy is fully on with moderate caps — 2 custom players, 2 legends, 2 dev upgrades, 2 age resets, and 2 contracts per season, plus attribute purchases capped per Core attribute.",
  },
  {
    id: "normal_regs",
    name: "Normal Regs",
    tagline: "Realistic, human-only trading",
    description:
      "The most realistic setup. Gameplay runs at All-Madden with regular rosters and the REC standard 4th-down rule. Trading is human-only with the salary cap and trade deadline on and committee review of every deal. Streaming is recommended in the regular season and required in the playoffs and Game of the Week. Economy is on but limited — 2 dev upgrades and 1 custom player per season, no legends, attribute purchases capped tightly, and 1 contract adjustment.",
  },
  {
    id: "hardcore_regs",
    name: "Hardcore Regs",
    tagline: "Competitive, highly regulated",
    description:
      "For leagues that want the tightest possible rules. Gameplay runs at All-Madden with regular rosters, hard trade difficulty, restricted CPU trading, and highly restricted position changes. Streaming is required for every phase and both play-call sides are limited (5 plays, 10-play cooldown). Economy is intentionally thin — 1 dev upgrade and 1 custom player per season, no legends, no contracts, and a 1-point-per-attribute / 5-total attribute cap with every attribute treated as Core.",
  },
  {
    id: "fantasy_free_for_all",
    name: "Fantasy Free-For-All",
    tagline: "Casual and wide open",
    description:
      "The most casual, permissive setup. Gameplay runs at All-Pro with a fantasy draft, no 4th-down rules, and open position changes. Trading requires no approval and is easy, with CPU trades allowed and no salary cap. Streaming is recommended in the regular season and required in the playoffs. Economy is fully on with no caps anywhere — every purchase type is unlimited — and no contract purchases.",
  },
  {
    id: "normal_fantasy",
    name: "Normal Fantasy",
    tagline: "Realistic rules, fantasy rosters",
    description:
      "Fantasy rosters under the realistic Normal Regs ruleset. Gameplay runs at All-Madden with a fantasy draft and the REC standard 4th-down rule. Trading is human-only with the salary cap and trade deadline on. Streaming is recommended in the regular season and required in the playoffs and Game of the Week. Economy is on and generous — 3 dev upgrades, 3 custom players, 3 legends, and 2 age resets per season, with 2 contract adjustments and a 4-point-per-attribute / 40-total attribute cap.",
  },
];

export interface LeagueTemplatePreset {
  leagueType?: string;
  difficulty?: string;
  cfbDifficulty?: string;
  recruitingDifficulty?: string;
  dynastyType?: string;
  quarterLengthMinutes?: number;
  acceleratedClockEnabled?: boolean;
  acceleratedClockMinimumSeconds?: number;
  tradeDifficulty?: string;
  salaryCapEnabled?: boolean;
  tradeDeadlineEnabled?: boolean;
  tradeApprovalPolicy?: string;
  cpuTradingPolicy?: string;
  positionChangePolicy?: string;
  coinEconomyEnabled?: boolean;
  coinEconomyMinimumLinkedUsers?: number;
  customPlayersEnabled?: boolean;
  customPlayersSeasonCap?: number;
  legendsEnabled?: boolean;
  legendsSeasonCap?: number;
  devUpgradesEnabled?: boolean;
  devUpgradeCapMode?: string;
  devUpgradesSeasonCap?: number;
  devUpgradesPlayerCap?: number;
  ageResetsEnabled?: boolean;
  ageResetsSeasonCap?: number;
  attributePurchasesEnabled?: boolean;
  coreAttributePurchasesSeasonCap?: number;
  coreAttributeGroupCap?: number;
  nonCoreAttributePurchasesSeasonCap?: number;
  coreAttributes?: string[];
  contractAdjustmentPurchasesEnabled?: boolean;
  contractPurchasesSeasonCap?: number;
  regularSeasonStreamingRequirement?: string;
  regularSeasonStreamingSide?: string;
  postseasonStreamingRequirement?: string;
  postseasonStreamingSide?: string;
  gotwStreamingRequirement?: string;
  gotwStreamingSide?: string;
  fourthDownRuleTypeRegular?: string;
  fourthDownRuleTypePlayoff?: string;
  offensivePlayCallLimitsEnabled?: boolean;
  offensivePlayCallLimit?: number;
  offensivePlayCallCooldownEnabled?: boolean;
  offensivePlayCallCooldown?: number;
  defensivePlayCallLimitsEnabled?: boolean;
  defensivePlayCallLimit?: number;
  defensivePlayCallCooldownEnabled?: boolean;
  defensivePlayCallCooldown?: number;
}

export const BASE_TEMPLATE_PRESET: LeagueTemplatePreset = {
  regularSeasonStreamingRequirement: "recommended",
  regularSeasonStreamingSide: "either",
  postseasonStreamingRequirement: "required",
  postseasonStreamingSide: "home",
  gotwStreamingRequirement: "required",
  gotwStreamingSide: "home",
  quarterLengthMinutes: 8,
  acceleratedClockEnabled: true,
  acceleratedClockMinimumSeconds: 25,
  coinEconomyMinimumLinkedUsers: 8,
};

// Core attribute designations (Madden attribute codes). These define which
// attributes users can boost at the premium Core (200 coin) rate; every
// attribute not listed is treated as Non-Core (100 coin).
export const REC_RECOMMENDED_CORE_ATTRIBUTES = [
  "SPD", "ACC", "AGI", "COD", "AWR", "STR", "JMP", "STA", "INJ",
  "THP", "RLS", "BTK", "POW", "MCV", "ZCV",
];

export const NORMAL_CORE_ATTRIBUTES = [
  "SPD", "ACC", "AGI", "COD", "STR", "THP", "JMP",
];

export const ALL_MADDEN_ATTRIBUTE_CODES = [
  "ACC", "AGI", "AWR", "BCV", "BSH", "BSK", "BTK", "CAR", "CIT", "COD", "CTH",
  "DAC", "DRR", "FMV", "IBL", "INJ", "JKM", "JMP", "KAC", "KPW", "LBK", "MAC",
  "MCV", "MRR", "PAC", "PBF", "PBP", "PBK", "PMV", "POW", "PRC", "PRS", "PUR",
  "RBF", "RBP", "RBK", "RET", "RLS", "RUN", "SAC", "SFA", "SPC", "SPD", "SPM",
  "SRR", "STA", "STR", "TAK", "THP", "TOU", "TRK", "TUP", "ZCV",
];

// Shared economy block for REC Recommended. Age resets and contract purchases
// are Madden-only and are stripped out of the CFB presets below.
const REC_RECOMMENDED_ECONOMY: LeagueTemplatePreset = {
  coinEconomyEnabled: true,
  customPlayersEnabled: true,
  customPlayersSeasonCap: 2,
  legendsEnabled: true,
  legendsSeasonCap: 2,
  devUpgradesEnabled: true,
  devUpgradeCapMode: "total_purchases",
  devUpgradesSeasonCap: 2,
  devUpgradesPlayerCap: 0,
  ageResetsEnabled: true,
  ageResetsSeasonCap: 2,
  attributePurchasesEnabled: true,
  coreAttributePurchasesSeasonCap: 5,
  coreAttributeGroupCap: 20,
  nonCoreAttributePurchasesSeasonCap: 40,
  coreAttributes: REC_RECOMMENDED_CORE_ATTRIBUTES,
  contractAdjustmentPurchasesEnabled: true,
  contractPurchasesSeasonCap: 2,
};

// Shared economy block for Normal Regs / Normal Fantasy. Age resets and
// contract purchases are Madden-only and stripped out of the CFB presets.
const NORMAL_ECONOMY: LeagueTemplatePreset = {
  coinEconomyEnabled: true,
  customPlayersEnabled: true,
  customPlayersSeasonCap: 1,
  legendsEnabled: false,
  legendsSeasonCap: 0,
  devUpgradesEnabled: true,
  devUpgradeCapMode: "total_purchases",
  devUpgradesSeasonCap: 2,
  devUpgradesPlayerCap: 0,
  ageResetsEnabled: false,
  ageResetsSeasonCap: 0,
  attributePurchasesEnabled: true,
  coreAttributePurchasesSeasonCap: 2,
  coreAttributeGroupCap: 20,
  nonCoreAttributePurchasesSeasonCap: 20,
  coreAttributes: NORMAL_CORE_ATTRIBUTES,
  contractAdjustmentPurchasesEnabled: true,
  contractPurchasesSeasonCap: 1,
};

export const MADDEN_TEMPLATE_PRESETS: Record<LeagueTemplateId, LeagueTemplatePreset> = {
  rec_recommended: {
    ...BASE_TEMPLATE_PRESET,
    ...REC_RECOMMENDED_ECONOMY,
    leagueType: "fantasy_draft",
    difficulty: "all_madden",
    tradeDifficulty: "normal",
    salaryCapEnabled: false,
    tradeDeadlineEnabled: false,
    tradeApprovalPolicy: "competition_committee_review",
    cpuTradingPolicy: "allowed",
    positionChangePolicy: "restricted",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
  },
  normal_regs: {
    ...BASE_TEMPLATE_PRESET,
    ...NORMAL_ECONOMY,
    leagueType: "regular_rosters",
    difficulty: "all_madden",
    tradeDifficulty: "normal",
    salaryCapEnabled: true,
    tradeDeadlineEnabled: true,
    tradeApprovalPolicy: "competition_committee_review",
    cpuTradingPolicy: "not_allowed",
    positionChangePolicy: "restricted",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
  },
  hardcore_regs: {
    ...BASE_TEMPLATE_PRESET,
    coinEconomyEnabled: true,
    customPlayersEnabled: true,
    customPlayersSeasonCap: 1,
    legendsEnabled: false,
    legendsSeasonCap: 0,
    devUpgradesEnabled: true,
    devUpgradeCapMode: "total_purchases",
    devUpgradesSeasonCap: 1,
    devUpgradesPlayerCap: 0,
    ageResetsEnabled: false,
    ageResetsSeasonCap: 0,
    attributePurchasesEnabled: true,
    coreAttributePurchasesSeasonCap: 1,
    coreAttributeGroupCap: 5,
    nonCoreAttributePurchasesSeasonCap: 0,
    coreAttributes: ALL_MADDEN_ATTRIBUTE_CODES,
    contractAdjustmentPurchasesEnabled: false,
    contractPurchasesSeasonCap: 0,
    leagueType: "regular_rosters",
    difficulty: "all_madden",
    tradeDifficulty: "hard",
    salaryCapEnabled: true,
    tradeDeadlineEnabled: true,
    tradeApprovalPolicy: "competition_committee_review",
    cpuTradingPolicy: "restricted",
    positionChangePolicy: "highly_restricted",
    regularSeasonStreamingRequirement: "required",
    regularSeasonStreamingSide: "home",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
    offensivePlayCallLimitsEnabled: true,
    offensivePlayCallLimit: 5,
    offensivePlayCallCooldownEnabled: true,
    offensivePlayCallCooldown: 10,
    defensivePlayCallLimitsEnabled: true,
    defensivePlayCallLimit: 5,
    defensivePlayCallCooldownEnabled: true,
    defensivePlayCallCooldown: 10,
  },
  fantasy_free_for_all: {
    ...BASE_TEMPLATE_PRESET,
    coinEconomyEnabled: true,
    customPlayersEnabled: true,
    customPlayersSeasonCap: 0,
    legendsEnabled: true,
    legendsSeasonCap: 0,
    devUpgradesEnabled: true,
    devUpgradeCapMode: "total_purchases",
    devUpgradesSeasonCap: 0,
    devUpgradesPlayerCap: 0,
    ageResetsEnabled: true,
    ageResetsSeasonCap: 0,
    attributePurchasesEnabled: true,
    coreAttributePurchasesSeasonCap: 0,
    coreAttributeGroupCap: 0,
    nonCoreAttributePurchasesSeasonCap: 0,
    coreAttributes: [],
    contractAdjustmentPurchasesEnabled: false,
    contractPurchasesSeasonCap: 0,
    leagueType: "fantasy_draft",
    difficulty: "all_pro",
    tradeDifficulty: "easy",
    salaryCapEnabled: false,
    tradeDeadlineEnabled: false,
    tradeApprovalPolicy: "no_approval_required",
    cpuTradingPolicy: "allowed",
    positionChangePolicy: "open",
    fourthDownRuleTypeRegular: "none",
    fourthDownRuleTypePlayoff: "none",
  },
  normal_fantasy: {
    ...BASE_TEMPLATE_PRESET,
    coinEconomyEnabled: true,
    customPlayersEnabled: true,
    customPlayersSeasonCap: 3,
    legendsEnabled: true,
    legendsSeasonCap: 3,
    devUpgradesEnabled: true,
    devUpgradeCapMode: "total_purchases",
    devUpgradesSeasonCap: 3,
    devUpgradesPlayerCap: 0,
    ageResetsEnabled: true,
    ageResetsSeasonCap: 2,
    attributePurchasesEnabled: true,
    coreAttributePurchasesSeasonCap: 4,
    coreAttributeGroupCap: 40,
    nonCoreAttributePurchasesSeasonCap: 40,
    coreAttributes: NORMAL_CORE_ATTRIBUTES,
    contractAdjustmentPurchasesEnabled: true,
    contractPurchasesSeasonCap: 2,
    leagueType: "fantasy_draft",
    difficulty: "all_madden",
    tradeDifficulty: "normal",
    salaryCapEnabled: true,
    tradeDeadlineEnabled: true,
    tradeApprovalPolicy: "competition_committee_review",
    cpuTradingPolicy: "not_allowed",
    positionChangePolicy: "restricted",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
  },
};

// CFB variants. CFB has no age resets and no contract purchases, so those
// fields are omitted entirely here. Attribute core designations are the same
// as their Madden counterparts.
export const CFB_TEMPLATE_PRESETS: Record<LeagueTemplateId, LeagueTemplatePreset> = {
  rec_recommended: {
    ...BASE_TEMPLATE_PRESET,
    ...REC_RECOMMENDED_ECONOMY,
    ageResetsEnabled: undefined,
    ageResetsSeasonCap: undefined,
    contractAdjustmentPurchasesEnabled: undefined,
    contractPurchasesSeasonCap: undefined,
    cfbDifficulty: "heisman",
    recruitingDifficulty: "normal",
    dynastyType: "real",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
  },
  normal_regs: {
    ...BASE_TEMPLATE_PRESET,
    ...NORMAL_ECONOMY,
    ageResetsEnabled: undefined,
    ageResetsSeasonCap: undefined,
    contractAdjustmentPurchasesEnabled: undefined,
    contractPurchasesSeasonCap: undefined,
    cfbDifficulty: "heisman",
    recruitingDifficulty: "normal",
    dynastyType: "real",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
  },
  hardcore_regs: {
    ...BASE_TEMPLATE_PRESET,
    coinEconomyEnabled: true,
    customPlayersEnabled: true,
    customPlayersSeasonCap: 1,
    legendsEnabled: false,
    legendsSeasonCap: 0,
    devUpgradesEnabled: true,
    devUpgradeCapMode: "total_purchases",
    devUpgradesSeasonCap: 1,
    devUpgradesPlayerCap: 0,
    attributePurchasesEnabled: true,
    coreAttributePurchasesSeasonCap: 1,
    coreAttributeGroupCap: 5,
    nonCoreAttributePurchasesSeasonCap: 0,
    coreAttributes: ALL_MADDEN_ATTRIBUTE_CODES,
    cfbDifficulty: "heisman",
    recruitingDifficulty: "hard",
    dynastyType: "real",
    regularSeasonStreamingRequirement: "required",
    regularSeasonStreamingSide: "home",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
    offensivePlayCallLimitsEnabled: true,
    offensivePlayCallLimit: 5,
    offensivePlayCallCooldownEnabled: true,
    offensivePlayCallCooldown: 10,
    defensivePlayCallLimitsEnabled: true,
    defensivePlayCallLimit: 5,
    defensivePlayCallCooldownEnabled: true,
    defensivePlayCallCooldown: 10,
  },
  fantasy_free_for_all: {
    ...BASE_TEMPLATE_PRESET,
    coinEconomyEnabled: true,
    customPlayersEnabled: true,
    customPlayersSeasonCap: 0,
    legendsEnabled: true,
    legendsSeasonCap: 0,
    devUpgradesEnabled: true,
    devUpgradeCapMode: "total_purchases",
    devUpgradesSeasonCap: 0,
    devUpgradesPlayerCap: 0,
    attributePurchasesEnabled: true,
    coreAttributePurchasesSeasonCap: 0,
    coreAttributeGroupCap: 0,
    nonCoreAttributePurchasesSeasonCap: 0,
    coreAttributes: [],
    cfbDifficulty: "all_american",
    recruitingDifficulty: "easy",
    dynastyType: "mixed",
    fourthDownRuleTypeRegular: "none",
    fourthDownRuleTypePlayoff: "none",
  },
  normal_fantasy: {
    ...BASE_TEMPLATE_PRESET,
    coinEconomyEnabled: true,
    customPlayersEnabled: true,
    customPlayersSeasonCap: 3,
    legendsEnabled: true,
    legendsSeasonCap: 3,
    devUpgradesEnabled: true,
    devUpgradeCapMode: "total_purchases",
    devUpgradesSeasonCap: 3,
    devUpgradesPlayerCap: 0,
    attributePurchasesEnabled: true,
    coreAttributePurchasesSeasonCap: 4,
    coreAttributeGroupCap: 40,
    nonCoreAttributePurchasesSeasonCap: 40,
    coreAttributes: NORMAL_CORE_ATTRIBUTES,
    cfbDifficulty: "heisman",
    recruitingDifficulty: "normal",
    dynastyType: "mixed",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
  },
};

export interface TemplateSettingRow {
  label: string;
  value: string;
}

export interface TemplateSettingGroup {
  key: string;
  label: string;
  blurb: string;
  rows: TemplateSettingRow[];
}

const STREAMING_LABEL: Record<string, string> = {
  required: "Required",
  recommended: "Recommended",
  disabled: "Disabled",
};

const STREAMING_SIDE_LABEL: Record<string, string> = {
  home: "Home",
  away: "Away",
  either: "Either",
  both: "Both",
};

const LEAGUE_TYPE_LABEL: Record<string, string> = {
  fantasy_draft: "Fantasy draft",
  regular_rosters: "Regular rosters",
  custom_rosters: "Custom rosters",
};

const DIFFICULTY_LABEL: Record<string, string> = {
  rookie: "Rookie",
  pro: "Pro",
  all_pro: "All-Pro",
  all_madden: "All-Madden",
};

const CFB_DIFFICULTY_LABEL: Record<string, string> = {
  freshman: "Freshman",
  varsity: "Varsity",
  all_american: "All-American",
  heisman: "Heisman",
};

const RECRUITING_LABEL: Record<string, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
};

const DYNASTY_LABEL: Record<string, string> = {
  real: "Real",
  mixed: "Mixed",
};

const TRADE_DIFFICULTY_LABEL: Record<string, string> = {
  very_easy: "Very Easy",
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
  very_hard: "Very Hard",
};

const APPROVAL_LABEL: Record<string, string> = {
  no_approval_required: "No approval required",
  commissioner_review: "Commissioner review",
  competition_committee_review: "Competition committee review",
};

const CPU_TRADING_LABEL: Record<string, string> = {
  allowed: "Allowed",
  restricted: "Restricted",
  not_allowed: "Not allowed",
};

const POSITION_LABEL: Record<string, string> = {
  open: "Open",
  restricted: "Restricted",
  highly_restricted: "Highly restricted",
};

const FOURTH_DOWN_LABEL: Record<string, string> = {
  none: "None",
  standard_rec: "Standard REC",
  custom: "Custom",
};

function capValue(enabled: boolean | undefined, cap: number | undefined): string {
  if (!enabled) return "Off";
  if (cap === 0) return "On (unlimited)";
  return `On (${cap}/season)`;
}

function countOrList(codes: string[] | undefined, allCount: number): string {
  if (!codes) return "None designated";
  if (codes.length === 0) return "No core attributes — all are Non-Core";
  if (codes.length === allCount) return `All ${allCount} attributes`;
  return `${codes.length} core attributes`;
}

export function describeTemplateSettings(
  preset: LeagueTemplatePreset,
  game: "madden" | "cfb",
): TemplateSettingGroup[] {
  const groups: TemplateSettingGroup[] = [];

  const gameplay: TemplateSettingRow[] = [];
  if (preset.leagueType) {
    gameplay.push({ label: "Roster setup", value: LEAGUE_TYPE_LABEL[preset.leagueType] ?? preset.leagueType });
  }
  if (game === "cfb" && preset.cfbDifficulty) {
    gameplay.push({ label: "Difficulty", value: CFB_DIFFICULTY_LABEL[preset.cfbDifficulty] ?? preset.cfbDifficulty });
  }
  if (game === "cfb" && preset.recruitingDifficulty) {
    gameplay.push({ label: "Recruiting difficulty", value: RECRUITING_LABEL[preset.recruitingDifficulty] ?? preset.recruitingDifficulty });
  }
  if (game === "cfb" && preset.dynastyType) {
    gameplay.push({ label: "Dynasty type", value: DYNASTY_LABEL[preset.dynastyType] ?? preset.dynastyType });
  }
  if (!preset.leagueType && preset.difficulty) {
    gameplay.push({ label: "Difficulty", value: DIFFICULTY_LABEL[preset.difficulty] ?? preset.difficulty });
  }
  if (preset.quarterLengthMinutes) {
    gameplay.push({ label: "Quarter length", value: `${preset.quarterLengthMinutes} min` });
  }
  if (preset.acceleratedClockEnabled != null) {
    gameplay.push({
      label: "Accelerated clock",
      value: preset.acceleratedClockEnabled
        ? preset.acceleratedClockMinimumSeconds
          ? `On (${preset.acceleratedClockMinimumSeconds}s min)`
          : "On"
        : "Off",
    });
  }
  if (preset.fourthDownRuleTypeRegular) {
    gameplay.push({ label: "4th down (regular)", value: FOURTH_DOWN_LABEL[preset.fourthDownRuleTypeRegular] ?? preset.fourthDownRuleTypeRegular });
  }
  if (preset.fourthDownRuleTypePlayoff) {
    gameplay.push({ label: "4th down (playoffs)", value: FOURTH_DOWN_LABEL[preset.fourthDownRuleTypePlayoff] ?? preset.fourthDownRuleTypePlayoff });
  }
  if (preset.positionChangePolicy) {
    gameplay.push({ label: "Position changes", value: POSITION_LABEL[preset.positionChangePolicy] ?? preset.positionChangePolicy });
  }
  if (preset.offensivePlayCallLimitsEnabled) {
    gameplay.push({
      label: "Offensive play-call limits",
      value: `Limit ${preset.offensivePlayCallLimit ?? "-"} plays${preset.offensivePlayCallCooldownEnabled ? `, ${preset.offensivePlayCallCooldown ?? "-"}-play cooldown` : ""}`,
    });
  }
  if (preset.defensivePlayCallLimitsEnabled) {
    gameplay.push({
      label: "Defensive play-call limits",
      value: `Limit ${preset.defensivePlayCallLimit ?? "-"} plays${preset.defensivePlayCallCooldownEnabled ? `, ${preset.defensivePlayCallCooldown ?? "-"}-play cooldown` : ""}`,
    });
  }
  if (gameplay.length > 0) {
    groups.push({
      key: "gameplay",
      label: "Gameplay & Rules",
      blurb: "How games are played — difficulty, quarter length, 4th-down rules, play-call limits, and position changes.",
      rows: gameplay,
    });
  }

  const trading: TemplateSettingRow[] = [];
  if (preset.tradeDifficulty) {
    trading.push({ label: "Trade difficulty", value: TRADE_DIFFICULTY_LABEL[preset.tradeDifficulty] ?? preset.tradeDifficulty });
  }
  if (preset.salaryCapEnabled != null) {
    trading.push({ label: "Salary cap", value: preset.salaryCapEnabled ? "On" : "Off" });
  }
  if (preset.tradeDeadlineEnabled != null) {
    trading.push({ label: "Trade deadline", value: preset.tradeDeadlineEnabled ? "On" : "Off" });
  }
  if (preset.tradeApprovalPolicy) {
    trading.push({ label: "Trade approval", value: APPROVAL_LABEL[preset.tradeApprovalPolicy] ?? preset.tradeApprovalPolicy });
  }
  if (preset.cpuTradingPolicy) {
    trading.push({ label: "CPU trading", value: CPU_TRADING_LABEL[preset.cpuTradingPolicy] ?? preset.cpuTradingPolicy });
  }
  if (trading.length > 0) {
    groups.push({
      key: "trading",
      label: "Trading",
      blurb: "How rosters change — salary cap, trade deadline, trade approval, CPU trading, and trade difficulty.",
      rows: trading,
    });
  }

  const streaming: TemplateSettingRow[] = [];
  if (preset.regularSeasonStreamingRequirement) {
    streaming.push({
      label: "Regular season",
      value: `${STREAMING_LABEL[preset.regularSeasonStreamingRequirement] ?? preset.regularSeasonStreamingRequirement}${preset.regularSeasonStreamingSide ? ` (${STREAMING_SIDE_LABEL[preset.regularSeasonStreamingSide] ?? preset.regularSeasonStreamingSide})` : ""}`,
    });
  }
  if (preset.postseasonStreamingRequirement) {
    streaming.push({
      label: "Postseason",
      value: `${STREAMING_LABEL[preset.postseasonStreamingRequirement] ?? preset.postseasonStreamingRequirement}${preset.postseasonStreamingSide ? ` (${STREAMING_SIDE_LABEL[preset.postseasonStreamingSide] ?? preset.postseasonStreamingSide})` : ""}`,
    });
  }
  if (preset.gotwStreamingRequirement) {
    streaming.push({
      label: "Game of the Week",
      value: `${STREAMING_LABEL[preset.gotwStreamingRequirement] ?? preset.gotwStreamingRequirement}${preset.gotwStreamingSide ? ` (${STREAMING_SIDE_LABEL[preset.gotwStreamingSide] ?? preset.gotwStreamingSide})` : ""}`,
    });
  }
  if (streaming.length > 0) {
    groups.push({
      key: "streaming",
      label: "Streaming",
      blurb: "Streaming expectations across the regular season, playoffs, and Game of the Week.",
      rows: streaming,
    });
  }

  const economy: TemplateSettingRow[] = [];
  if (preset.coinEconomyEnabled != null) {
    economy.push({ label: "Coin economy", value: preset.coinEconomyEnabled ? "On" : "Off" });
  }
  if (preset.coinEconomyMinimumLinkedUsers != null) {
    economy.push({ label: "Economy activation", value: `Needs ${preset.coinEconomyMinimumLinkedUsers} linked users` });
  }
  if (preset.customPlayersEnabled != null) {
    economy.push({ label: "Custom players", value: capValue(preset.customPlayersEnabled, preset.customPlayersSeasonCap) });
  }
  if (preset.legendsEnabled != null) {
    economy.push({ label: "Legends", value: capValue(preset.legendsEnabled, preset.legendsSeasonCap) });
  }
  if (preset.devUpgradesEnabled != null) {
    economy.push({ label: "Dev upgrades", value: capValue(preset.devUpgradesEnabled, preset.devUpgradesSeasonCap) });
  }
  if (preset.attributePurchasesEnabled != null) {
    const core = preset.coreAttributes ?? [];
    const per = preset.coreAttributePurchasesSeasonCap;
    const group = preset.coreAttributeGroupCap;
    const parts = [`${countOrList(core, ALL_MADDEN_ATTRIBUTE_CODES.length)}`];
    if (per) parts.push(`${per} pts/attribute`);
    if (group) parts.push(`${group} pts total`);
    economy.push({
      label: "Attribute purchases",
      value: preset.attributePurchasesEnabled ? parts.join(" · ") : "Off",
    });
  }
  if (game === "madden" && preset.ageResetsEnabled != null) {
    economy.push({ label: "Age resets", value: capValue(preset.ageResetsEnabled, preset.ageResetsSeasonCap) });
  }
  if (game === "madden" && preset.contractAdjustmentPurchasesEnabled != null) {
    economy.push({ label: "Contract adjustments", value: capValue(preset.contractAdjustmentPurchasesEnabled, preset.contractPurchasesSeasonCap) });
  }
  if (economy.length > 0) {
    groups.push({
      key: "economy",
      label: "Economy",
      blurb: "Coin-based roster purchases — what's available, the season caps, and which attributes are premium (Core).",
      rows: economy,
    });
  }

  return groups;
}
