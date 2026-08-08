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
      "Fantasy draft with a full coin economy, competitive all-madden gameplay, and the REC house rules. Best for leagues that want everything REC offers out of the box.",
  },
  {
    id: "normal_regs",
    name: "Normal Regs",
    tagline: "Realistic, human-only trading",
    description:
      "Regular rosters with the salary cap and trade deadline on, simulation-style rules, and trading restricted to humans only. The most realistic setup.",
  },
  {
    id: "hardcore_regs",
    name: "Hardcore Regs",
    tagline: "Competitive, highly regulated",
    description:
      "Regular rosters with hard trade difficulty, restricted CPU trading, highly restricted position changes, required streaming, and play call limits.",
  },
  {
    id: "fantasy_free_for_all",
    name: "Fantasy Free-For-All",
    tagline: "Casual and wide open",
    description:
      "Fantasy draft at All-Pro difficulty with no trade approval, open position changes, and every economy feature enabled with no caps.",
  },
  {
    id: "normal_fantasy",
    name: "Normal Fantasy",
    tagline: "Realistic rules, fantasy rosters",
    description:
      "Fantasy draft rosters under the same realistic rules as Normal Regs — salary cap on, trade deadline on, human-only trading.",
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
  freeAgentMotivationImpact?: string;
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
  freeAgentMotivationImpact: "normal",
};

const REC_RECOMMENDED_ECONOMY: LeagueTemplatePreset = {
  coinEconomyEnabled: true,
  customPlayersEnabled: true,
  customPlayersSeasonCap: 2,
  legendsEnabled: true,
  legendsSeasonCap: 2,
  devUpgradesEnabled: true,
  devUpgradeCapMode: "total_purchases",
  devUpgradesSeasonCap: 5,
  devUpgradesPlayerCap: 0,
  ageResetsEnabled: true,
  ageResetsSeasonCap: 2,
  attributePurchasesEnabled: true,
  coreAttributePurchasesSeasonCap: 5,
  coreAttributeGroupCap: 20,
  nonCoreAttributePurchasesSeasonCap: 40,
  contractAdjustmentPurchasesEnabled: true,
  contractPurchasesSeasonCap: 2,
};

const NORMAL_REGS_ECONOMY: LeagueTemplatePreset = {
  coinEconomyEnabled: true,
  customPlayersEnabled: true,
  customPlayersSeasonCap: 1,
  legendsEnabled: false,
  legendsSeasonCap: 0,
  devUpgradesEnabled: true,
  devUpgradeCapMode: "total_purchases",
  devUpgradesSeasonCap: 5,
  devUpgradesPlayerCap: 0,
  ageResetsEnabled: false,
  ageResetsSeasonCap: 0,
  attributePurchasesEnabled: true,
  coreAttributePurchasesSeasonCap: 5,
  coreAttributeGroupCap: 20,
  nonCoreAttributePurchasesSeasonCap: 40,
  contractAdjustmentPurchasesEnabled: false,
  contractPurchasesSeasonCap: 0,
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
    ...NORMAL_REGS_ECONOMY,
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
    ...REC_RECOMMENDED_ECONOMY,
    leagueType: "regular_rosters",
    difficulty: "all_madden",
    tradeDifficulty: "hard",
    salaryCapEnabled: true,
    tradeDeadlineEnabled: true,
    tradeApprovalPolicy: "competition_committee_review",
    cpuTradingPolicy: "restricted",
    positionChangePolicy: "highly_restricted",
    ageResetsEnabled: false,
    ageResetsSeasonCap: 0,
    contractAdjustmentPurchasesEnabled: false,
    contractPurchasesSeasonCap: 0,
    regularSeasonStreamingRequirement: "required",
    regularSeasonStreamingSide: "home",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
    offensivePlayCallLimitsEnabled: true,
    offensivePlayCallLimit: 10,
    offensivePlayCallCooldownEnabled: true,
    offensivePlayCallCooldown: 5,
    defensivePlayCallLimitsEnabled: true,
    defensivePlayCallLimit: 10,
    defensivePlayCallCooldownEnabled: true,
    defensivePlayCallCooldown: 5,
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
    contractAdjustmentPurchasesEnabled: true,
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
    ...NORMAL_REGS_ECONOMY,
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

export const CFB_TEMPLATE_PRESETS: Record<LeagueTemplateId, LeagueTemplatePreset> = {
  rec_recommended: {
    ...BASE_TEMPLATE_PRESET,
    ...REC_RECOMMENDED_ECONOMY,
    cfbDifficulty: "heisman",
    recruitingDifficulty: "normal",
    dynastyType: "real",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
  },
  normal_regs: {
    ...BASE_TEMPLATE_PRESET,
    ...NORMAL_REGS_ECONOMY,
    cfbDifficulty: "heisman",
    recruitingDifficulty: "normal",
    dynastyType: "real",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
  },
  hardcore_regs: {
    ...BASE_TEMPLATE_PRESET,
    ...REC_RECOMMENDED_ECONOMY,
    cfbDifficulty: "heisman",
    recruitingDifficulty: "hard",
    dynastyType: "real",
    ageResetsEnabled: false,
    ageResetsSeasonCap: 0,
    contractAdjustmentPurchasesEnabled: false,
    contractPurchasesSeasonCap: 0,
    regularSeasonStreamingRequirement: "required",
    regularSeasonStreamingSide: "home",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
    offensivePlayCallLimitsEnabled: true,
    offensivePlayCallLimit: 10,
    offensivePlayCallCooldownEnabled: true,
    offensivePlayCallCooldown: 5,
    defensivePlayCallLimitsEnabled: true,
    defensivePlayCallLimit: 10,
    defensivePlayCallCooldownEnabled: true,
    defensivePlayCallCooldown: 5,
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
    contractAdjustmentPurchasesEnabled: true,
    contractPurchasesSeasonCap: 0,
    cfbDifficulty: "all_american",
    recruitingDifficulty: "easy",
    dynastyType: "mixed",
    fourthDownRuleTypeRegular: "none",
    fourthDownRuleTypePlayoff: "none",
  },
  normal_fantasy: {
    ...BASE_TEMPLATE_PRESET,
    ...NORMAL_REGS_ECONOMY,
    cfbDifficulty: "heisman",
    recruitingDifficulty: "normal",
    dynastyType: "mixed",
    fourthDownRuleTypeRegular: "standard_rec",
    fourthDownRuleTypePlayoff: "none",
  },
};
