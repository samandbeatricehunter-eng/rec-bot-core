export type LeagueTemplateId = "rec_recommended" | "normal_regs" | "hardcore_regs" | "normal_fantasy" | "fantasy_free_for_all";
export type LeagueTemplateGame = "madden" | "cfb";

export interface LeagueTemplateMeta {
  id: LeagueTemplateId;
  name: string;
  tagline: string;
  description: string;
}

export interface LeagueTemplatePreset {
  leagueType: string;
  difficulty: string;
  cfbDifficulty: string;
  recruitingDifficulty: string;
  dynastyType: string;
  quarterLengthMinutes: number;
  acceleratedClockEnabled: boolean;
  acceleratedClockMinimumSeconds: number;
  abilitiesEnabled: boolean;
  wearAndTearEnabled: boolean;
  tradeDifficulty: string;
  freeAgentMotivationImpact: string;
  salaryCapEnabled: boolean;
  tradeDeadlineEnabled: boolean;
  tradeApprovalPolicy: string;
  cpuTradingPolicy: string;
  cpuTradesSeasonCap: number;
  positionChangePolicy: string;
  coachFiringPolicy: string;
  preorderBonusesEnabled: boolean;
  ballHawk: string;
  heatSeeker: string;
  switchAssist: string;
  injuryPolicy: string;
  regularSeasonStreamingRequirement: string;
  regularSeasonStreamingSide: string;
  postseasonStreamingRequirement: string;
  postseasonStreamingSide: string;
  gotwStreamingRequirement: string;
  gotwStreamingSide: string;
  fourthDownRuleTypeRegular: string;
  fourthDownRuleTypePlayoff: string;
  customFourthDownRuleRegular: string;
  customFourthDownRulePlayoff: string;
  offensivePlayCallLimitsEnabled: boolean;
  offensivePlayCallLimit: number;
  offensivePlayCallCooldownEnabled: boolean;
  offensivePlayCallCooldown: number;
  defensivePlayCallLimitsEnabled: boolean;
  defensivePlayCallLimit: number;
  defensivePlayCallCooldownEnabled: boolean;
  defensivePlayCallCooldown: number;
  customCoachesRequired: boolean;
  customPlaybooksAllowed: boolean;
  coinEconomyEnabled: boolean;
  coinEconomyMinimumLinkedUsers: number;
  customPlayersEnabled: boolean;
  customPlayersSeasonCap: number;
  legendsEnabled: boolean;
  legendsSeasonCap: number;
  devUpgradesEnabled: boolean;
  devUpgradeCapMode: "total_purchases";
  devUpgradesSeasonCap: number;
  devUpgradesPlayerCap: number;
  ageResetsEnabled: boolean;
  ageResetsSeasonCap: number;
  attributePurchasesEnabled: boolean;
  coreAttributePurchasesSeasonCap: number;
  coreAttributeGroupCap: 0;
  nonCoreAttributePurchasesSeasonCap: number;
  coreAttributes: string[];
  coreAttributeCapOverrides: Record<string, number>;
  nonCoreAttributeCapMode: "group" | "individual";
  nonCoreAttributeCapOverrides: Record<string, number>;
  contractAdjustmentPurchasesEnabled: boolean;
  contractPurchasesSeasonCap: number;
  purchaseDeadlineStage: string;
  purchaseDeadlineWeek: number;
}

const CORE_STANDARD = ["SPD","AGI","ACC","COD","STR","THP","JMP","MCV","ZCV","POW","AWR","INJ","STA","RLS","BTK"];
const CORE_HARDCORE = ["SPD","AGI","ACC","COD","STR","THP","JMP","MCV","ZCV","POW","AWR","INJ","STA"];

export const MADDEN_LEAGUE_TEMPLATES: LeagueTemplateMeta[] = [
  { id:"rec_recommended", name:"REC Recommended", tagline:"The default REC experience", description:"Fantasy draft by default, REC gameplay rules, full economy, and moderate purchase caps." },
  { id:"normal_regs", name:"Normal Regs", tagline:"Structured regular rosters", description:"Regular rosters, realistic trades, reduced injuries, and a controlled economy." },
  { id:"hardcore_regs", name:"Hardcore Regs", tagline:"Competitive and highly regulated", description:"Strict play calling, standard injuries, difficult CPU trades, and narrow purchase limits." },
  { id:"normal_fantasy", name:"Normal Fantasy", tagline:"Structured fantasy rosters", description:"Fantasy rosters with normal REC rules and the full Madden economy." },
  { id:"fantasy_free_for_all", name:"Fantasy Free-For-All", tagline:"Casual and wide open", description:"Fantasy rosters, open gameplay and trading, and unlimited enabled purchases." },
];

export const CFB_LEAGUE_TEMPLATES: LeagueTemplateMeta[] = MADDEN_LEAGUE_TEMPLATES
  .filter((template) => !["normal_fantasy","fantasy_free_for_all"].includes(template.id))
  .map((template) => ({ ...template, description: template.id === "rec_recommended"
    ? "Heisman gameplay, REC rules, automatic roster tracking, custom players, and Campus Legends."
    : template.id === "normal_regs"
      ? "Heisman gameplay, reduced injuries, automatic roster tracking, and custom-player purchases."
      : "Heisman gameplay with strict rules, automatic roster tracking, and no purchase types enabled." }));

const base = (): LeagueTemplatePreset => ({
  leagueType:"regular_rosters", difficulty:"all_madden", cfbDifficulty:"heisman", recruitingDifficulty:"normal", dynastyType:"real",
  quarterLengthMinutes:8, acceleratedClockEnabled:true, acceleratedClockMinimumSeconds:25, abilitiesEnabled:true, wearAndTearEnabled:true,
  tradeDifficulty:"normal", freeAgentMotivationImpact:"normal", salaryCapEnabled:false, tradeDeadlineEnabled:true,
  tradeApprovalPolicy:"no_approval_required", cpuTradingPolicy:"not_allowed", cpuTradesSeasonCap:0, positionChangePolicy:"restricted",
  coachFiringPolicy:"cpu_only", preorderBonusesEnabled:true, ballHawk:"keep_individual", heatSeeker:"keep_individual", switchAssist:"keep_individual",
  injuryPolicy:"off", regularSeasonStreamingRequirement:"recommended", regularSeasonStreamingSide:"either",
  postseasonStreamingRequirement:"required", postseasonStreamingSide:"home", gotwStreamingRequirement:"required", gotwStreamingSide:"home",
  fourthDownRuleTypeRegular:"standard_rec", fourthDownRuleTypePlayoff:"none", customFourthDownRuleRegular:"", customFourthDownRulePlayoff:"",
  offensivePlayCallLimitsEnabled:false, offensivePlayCallLimit:10, offensivePlayCallCooldownEnabled:true, offensivePlayCallCooldown:3,
  defensivePlayCallLimitsEnabled:false, defensivePlayCallLimit:10, defensivePlayCallCooldownEnabled:true, defensivePlayCallCooldown:3,
  customCoachesRequired:true, customPlaybooksAllowed:false, coinEconomyEnabled:true, coinEconomyMinimumLinkedUsers:8,
  customPlayersEnabled:false, customPlayersSeasonCap:0, legendsEnabled:false, legendsSeasonCap:0,
  devUpgradesEnabled:false, devUpgradeCapMode:"total_purchases", devUpgradesSeasonCap:0, devUpgradesPlayerCap:0,
  ageResetsEnabled:false, ageResetsSeasonCap:0, attributePurchasesEnabled:false, coreAttributePurchasesSeasonCap:0,
  coreAttributeGroupCap:0, nonCoreAttributePurchasesSeasonCap:0, coreAttributes:[], coreAttributeCapOverrides:{},
  nonCoreAttributeCapMode:"group", nonCoreAttributeCapOverrides:{}, contractAdjustmentPurchasesEnabled:false, contractPurchasesSeasonCap:0,
  purchaseDeadlineStage:"regular_season", purchaseDeadlineWeek:10,
});

function maddenPreset(id: LeagueTemplateId): LeagueTemplatePreset {
  const p = base();
  if (id === "rec_recommended") return { ...p, leagueType:"fantasy_draft", customPlayersEnabled:true, customPlayersSeasonCap:2,
    legendsEnabled:true, legendsSeasonCap:2, devUpgradesEnabled:true, devUpgradesSeasonCap:2, ageResetsEnabled:true, ageResetsSeasonCap:1,
    attributePurchasesEnabled:true, coreAttributePurchasesSeasonCap:2, nonCoreAttributePurchasesSeasonCap:25, coreAttributes:CORE_STANDARD };
  if (id === "normal_regs") return { ...p, leagueType:"regular_rosters", injuryPolicy:"on_reduced", salaryCapEnabled:true,
    tradeApprovalPolicy:"competition_committee_review", cpuTradingPolicy:"restricted", cpuTradesSeasonCap:1,
    offensivePlayCallCooldown:5, defensivePlayCallCooldown:5, customPlayersEnabled:true, customPlayersSeasonCap:1,
    devUpgradesEnabled:true, devUpgradesSeasonCap:1, attributePurchasesEnabled:true, coreAttributePurchasesSeasonCap:2,
    nonCoreAttributePurchasesSeasonCap:10, coreAttributes:CORE_STANDARD, contractAdjustmentPurchasesEnabled:true, contractPurchasesSeasonCap:2 };
  if (id === "hardcore_regs") return { ...p, leagueType:"regular_rosters", injuryPolicy:"on_standard", tradeDifficulty:"very_hard",
    freeAgentMotivationImpact:"very_high", salaryCapEnabled:true, tradeApprovalPolicy:"competition_committee_review",
    cpuTradingPolicy:"restricted", cpuTradesSeasonCap:1, preorderBonusesEnabled:false, ballHawk:"off", heatSeeker:"off", switchAssist:"off",
    fourthDownRuleTypePlayoff:"standard_rec", customFourthDownRuleRegular:"Trailing exception applies only in the fourth quarter.",
    offensivePlayCallLimitsEnabled:true, offensivePlayCallLimit:2, offensivePlayCallCooldown:7,
    defensivePlayCallLimitsEnabled:true, defensivePlayCallLimit:5, defensivePlayCallCooldown:7,
    devUpgradesEnabled:true, devUpgradesSeasonCap:1, attributePurchasesEnabled:true, coreAttributePurchasesSeasonCap:1,
    nonCoreAttributePurchasesSeasonCap:5, coreAttributes:CORE_HARDCORE, contractAdjustmentPurchasesEnabled:true, contractPurchasesSeasonCap:1 };
  if (id === "normal_fantasy") return { ...p, leagueType:"fantasy_draft", injuryPolicy:"off", salaryCapEnabled:false, tradeDeadlineEnabled:false,
    tradeApprovalPolicy:"commissioner_review", cpuTradingPolicy:"restricted", cpuTradesSeasonCap:3, positionChangePolicy:"open",
    customPlayersEnabled:true, customPlayersSeasonCap:2, legendsEnabled:true, legendsSeasonCap:2, devUpgradesEnabled:true, devUpgradesSeasonCap:2,
    ageResetsEnabled:true, ageResetsSeasonCap:1, attributePurchasesEnabled:true, coreAttributePurchasesSeasonCap:2,
    nonCoreAttributePurchasesSeasonCap:25, coreAttributes:CORE_STANDARD, contractAdjustmentPurchasesEnabled:true, contractPurchasesSeasonCap:2 };
  return { ...p, leagueType:"fantasy_draft", difficulty:"all_pro", acceleratedClockEnabled:false, injuryPolicy:"off", wearAndTearEnabled:false,
    tradeDifficulty:"very_easy", freeAgentMotivationImpact:"off", tradeDeadlineEnabled:false, positionChangePolicy:"open",
    fourthDownRuleTypeRegular:"none", fourthDownRuleTypePlayoff:"none", offensivePlayCallCooldownEnabled:false, defensivePlayCallCooldownEnabled:false,
    customPlayersEnabled:true, legendsEnabled:true, devUpgradesEnabled:true, ageResetsEnabled:true, attributePurchasesEnabled:true };
}

function cfbPreset(id: LeagueTemplateId): LeagueTemplatePreset {
  const p = base();
  if (id === "rec_recommended") return { ...p, customPlayersEnabled:true, customPlayersSeasonCap:2, legendsEnabled:true, legendsSeasonCap:2 };
  if (id === "normal_regs") return { ...p, injuryPolicy:"on_reduced", offensivePlayCallCooldown:5, defensivePlayCallCooldown:5,
    customPlayersEnabled:true, customPlayersSeasonCap:1 };
  return { ...p, recruitingDifficulty:"hard", injuryPolicy:"on_standard", preorderBonusesEnabled:false,
    ballHawk:"off", heatSeeker:"off", switchAssist:"off", fourthDownRuleTypePlayoff:"standard_rec",
    customFourthDownRuleRegular:"Trailing exception applies only in the fourth quarter.", offensivePlayCallLimitsEnabled:true,
    offensivePlayCallLimit:2, offensivePlayCallCooldown:7, defensivePlayCallLimitsEnabled:true, defensivePlayCallLimit:5, defensivePlayCallCooldown:7 };
}

export const MADDEN_TEMPLATE_PRESETS = Object.fromEntries(MADDEN_LEAGUE_TEMPLATES.map((template) => [template.id, maddenPreset(template.id)])) as Record<LeagueTemplateId, LeagueTemplatePreset>;
export const CFB_TEMPLATE_PRESETS = Object.fromEntries(CFB_LEAGUE_TEMPLATES.map((template) => [template.id, cfbPreset(template.id)])) as Partial<Record<LeagueTemplateId, LeagueTemplatePreset>>;
export const BASE_TEMPLATE_PRESET = base();
export const LEAGUE_TEMPLATES = MADDEN_LEAGUE_TEMPLATES;
export const REC_RECOMMENDED_CORE_ATTRIBUTES = CORE_STANDARD;
export const NORMAL_CORE_ATTRIBUTES = CORE_STANDARD;
export const ALL_MADDEN_ATTRIBUTE_CODES = CORE_STANDARD;

export function getLeagueTemplatePreset(game: "madden_26"|"madden_27"|"cfb_27", id: LeagueTemplateId): LeagueTemplatePreset | null {
  return game === "cfb_27" ? CFB_TEMPLATE_PRESETS[id] ?? null : MADDEN_TEMPLATE_PRESETS[id];
}

export interface TemplateSettingRow { label:string; value:string }
export interface TemplateSettingGroup { key:string; label:string; blurb:string; rows:TemplateSettingRow[] }
export function describeTemplateSettings(preset: LeagueTemplatePreset, game: LeagueTemplateGame): TemplateSettingGroup[] {
  return [
    { key:"gameplay", label:"Gameplay & Rules", blurb:"Difficulty, clocks, fourth-down and play-call rules.", rows:[
      {label:"Difficulty",value:game === "cfb" ? preset.cfbDifficulty : preset.difficulty}, {label:"Quarter length",value:`${preset.quarterLengthMinutes} min`},
      {label:"Accelerated clock",value:preset.acceleratedClockEnabled ? `${preset.acceleratedClockMinimumSeconds}s` : "Off"},
      {label:"Injuries",value:preset.injuryPolicy}, {label:"4th down (regular)",value:preset.fourthDownRuleTypeRegular}, {label:"4th down (playoffs)",value:preset.fourthDownRuleTypePlayoff},
    ]},
    { key:"streaming", label:"Streaming", blurb:"Streaming expectations by season phase.", rows:[
      {label:"Regular season",value:`${preset.regularSeasonStreamingRequirement} (${preset.regularSeasonStreamingSide})`},
      {label:"Postseason",value:`${preset.postseasonStreamingRequirement} (${preset.postseasonStreamingSide})`},
      {label:"Game of the Week",value:`${preset.gotwStreamingRequirement} (${preset.gotwStreamingSide})`},
    ]},
    { key:"economy", label:"Economy", blurb:"Enabled purchases and season limits.", rows:[
      {label:"Custom players",value:preset.customPlayersEnabled ? `${preset.customPlayersSeasonCap || "Unlimited"}/season` : "Off"},
      {label:"Legends",value:preset.legendsEnabled ? `${preset.legendsSeasonCap || "Unlimited"}/season` : "Off"},
      {label:"Attributes",value:preset.attributePurchasesEnabled ? `${preset.coreAttributePurchasesSeasonCap || "Unlimited"}/core attribute` : "Off"},
      {label:"Deadline",value:`Closes when Week ${preset.purchaseDeadlineWeek} begins`},
    ]},
  ];
}
