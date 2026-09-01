import { useState, useMemo, useCallback } from "react";
import {
  AFC_TEAMS, CFB_27_TEAMS, LEAGUE_SLIDER_CATALOG_VERSION, NFL_TEAMS, NFC_TEAMS, defaultLeagueSliderValues,
  applyRiseToImmortalityLockedSettings,
} from "@rec/shared";
import { type SiteOpenTeam } from "../../lib/site-api.js";
import {
  BASE_TEMPLATE_PRESET,
  getLeagueTemplatePreset,
  type LeagueTemplateId,
  type LeagueTemplatePreset,
} from "../../lib/league-templates.js";
import {
  CFB_SEASON_STAGES, MADDEN_SEASON_STAGES,
  type GameKey,
} from "./options.js";

const PURCHASE_DEADLINE_TYPES: Record<string, string> = {
  custom_player: "Custom Players",
  legend: "Legends",
  dev_upgrade: "Dev Upgrades",
  attribute_purchase: "Attribute Purchases",
  age_reset: "Age Resets (Madden Only)",
  contract_adjustment: "Contract Adjustments (Madden Only)",
};

const PURCHASE_DEADLINE_STAGES = [
  "preseason", "regular_season", "wild_card", "divisional",
  "conference_championship", "super_bowl", "offseason", "draft",
];

export function useLeagueWizardState() {
  const [templateId, setTemplateId] = useState<LeagueTemplateId | null>(null);

  // Madden 26 and CFB 27 creation were removed -- Madden 27 is the only game leagues can be
  // created for now, so it's the fixed default instead of an empty choice the user has to make.
  const [game, setGame] = useState<GameKey | "">("madden_27");
  const [isOnline, setIsOnline] = useState(true);
  const [crossPlayEnabled, setCrossPlayEnabled] = useState(true);
  const [requiredConsole, setRequiredConsole] = useState<"ps5" | "xbox" | "pc">("ps5");
  const [leagueType, setLeagueType] = useState("");
  const [immortalityOffensePosition, setImmortalityOffensePosition] = useState("QB");
  const [immortalityDefensePosition, setImmortalityDefensePosition] = useState("MIKE");
  const [immortalityTeamPool, setImmortalityTeamPool] = useState<"default_nfl" | "custom_32">("default_nfl");
  const [immortalityCustomTeams, setImmortalityCustomTeams] = useState<Record<string, {
    city: string;
    nick: string;
    abbreviation: string;
    primaryLogoUrl: string;
    secondaryLogoUrl: string;
    wordmarkUrl: string;
    primaryColor: string;
    secondaryColor: string;
    tertiaryColor: string;
  }>>({});
  const [immortalityTeamLogoFiles, setImmortalityTeamLogoFiles] = useState<Record<string, Partial<Record<"primary" | "secondary" | "wordmark", File>>>>({});
  const [name, setName] = useState("");
  const [leagueLogoFile, setLeagueLogoFile] = useState<File | null>(null);
  const [customMaxMembers, setCustomMaxMembers] = useState(false);
  const [maxMembers, setMaxMembers] = useState(32);
  const [leaguePassword, setLeaguePassword] = useState("");
  const [seasonNumber, setSeasonNumber] = useState(1);
  const [seasonStage, setSeasonStage] = useState("");
  const [currentWeek, setCurrentWeek] = useState(1);
  const [skipToStage, setSkipToStage] = useState(false);
  const [skipToStageValue, setSkipToStageValue] = useState("regular_season");

  const [regularSeasonStreamingRequirement, setRegularSeasonStreamingRequirement] = useState("recommended");
  const [regularSeasonStreamingSide, setRegularSeasonStreamingSide] = useState("either");
  const [postseasonStreamingRequirement, setPostseasonStreamingRequirement] = useState("required");
  const [postseasonStreamingSide, setPostseasonStreamingSide] = useState("home");
  const [gotwStreamingRequirement, setGotwStreamingRequirement] = useState("required");
  const [gotwStreamingSide, setGotwStreamingSide] = useState("home");
  const [fourthDownRuleTypeRegular, setFourthDownRuleTypeRegular] = useState("standard_rec");
  const [customFourthDownRuleRegular, setCustomFourthDownRuleRegular] = useState("");
  const [fourthDownRuleTypePlayoff, setFourthDownRuleTypePlayoff] = useState("standard_rec");
  const [customFourthDownRulePlayoff, setCustomFourthDownRulePlayoff] = useState("");
  const [advanceTiming, setAdvanceTiming] = useState("24hr");
  const [advanceTimingOther, setAdvanceTimingOther] = useState("");
  const [injuryPolicy, setInjuryPolicy] = useState("on_standard");
  const [fairSimRequirements, setFairSimRequirements] = useState("Fair Sims are the default for any game where users fail to schedule their game prior to advance time.");
  const [forceWinRequirements, setForceWinRequirements] = useState("Force Wins can be requested if users agree to a scheduled time and one fails to appear within 1 hour of the elapsed game time.");
  const [forceWinRulesRegular, setForceWinRulesRegular] = useState<string[]>([]);
  const [forceWinRulesPostseason, setForceWinRulesPostseason] = useState<string[]>([]);
  const [fairSimRulesRegular, setFairSimRulesRegular] = useState<string[]>([]);
  const [fairSimRulesPostseason, setFairSimRulesPostseason] = useState<string[]>([]);
  const [offensivePlayCallLimitsEnabled, setOffensivePlayCallLimitsEnabled] = useState(false);
  const [offensivePlayCallLimit, setOffensivePlayCallLimit] = useState(10);
  const [offensivePlayCallCooldownEnabled, setOffensivePlayCallCooldownEnabled] = useState(false);
  const [offensivePlayCallCooldown, setOffensivePlayCallCooldown] = useState(5);
  const [defensivePlayCallLimitsEnabled, setDefensivePlayCallLimitsEnabled] = useState(false);
  const [defensivePlayCallLimit, setDefensivePlayCallLimit] = useState(10);
  const [defensivePlayCallCooldownEnabled, setDefensivePlayCallCooldownEnabled] = useState(false);
  const [defensivePlayCallCooldown, setDefensivePlayCallCooldown] = useState(5);
  const [customCoachesRequired, setCustomCoachesRequired] = useState(false);
  const [customPlaybooksAllowed, setCustomPlaybooksAllowed] = useState(false);

  const [coinEconomyEnabled, setCoinEconomyEnabled] = useState(false);
  const [customPlayersEnabled, setCustomPlayersEnabled] = useState(false);
  const [customPlayersSeasonCap, setCustomPlayersSeasonCap] = useState(0);
  const [legendsEnabled, setLegendsEnabled] = useState(false);
  const [legendsSeasonCap, setLegendsSeasonCap] = useState(0);
  const [devUpgradesEnabled, setDevUpgradesEnabled] = useState(false);
  const [devUpgradeCapMode, setDevUpgradeCapMode] = useState("total_purchases");
  const [devUpgradesSeasonCap, setDevUpgradesSeasonCap] = useState(0);
  const [devUpgradesPlayerCap, setDevUpgradesPlayerCap] = useState(0);
  const [ageResetsEnabled, setAgeResetsEnabled] = useState(false);
  const [ageResetsSeasonCap, setAgeResetsSeasonCap] = useState(0);
  const [attributePurchasesEnabled, setAttributePurchasesEnabled] = useState(false);
  const [coreAttributePurchasesSeasonCap, setCoreAttributePurchasesSeasonCap] = useState(0);
  const [nonCoreAttributePurchasesSeasonCap, setNonCoreAttributePurchasesSeasonCap] = useState(0);
  const [nonCoreAttributeCapMode, setNonCoreAttributeCapMode] = useState<"group" | "individual">("group");
  const [coreAttributes, setCoreAttributes] = useState<string[]>([]);
  const [coreAttributeCapOverrides, setCoreAttributeCapOverrides] = useState<Record<string, number>>({});
  const [nonCoreAttributeCapOverrides, setNonCoreAttributeCapOverrides] = useState<Record<string, number>>({});

  const [contractAdjustmentPurchasesEnabled, setContractAdjustmentPurchasesEnabled] = useState(false);
  const [contractPurchasesSeasonCap, setContractPurchasesSeasonCap] = useState(0);
  const [purchaseDeadlines, setPurchaseDeadlines] = useState<Record<string, { stage: string; week: number }>>({});

  const [customRules, setCustomRules] = useState<Array<{ id: string; category: string; title: string; text: string; sortOrder: number; createdAt: string; updatedAt: string }>>([]);
  const [newRuleCategory, setNewRuleCategory] = useState("");
  const [newRuleTitle, setNewRuleTitle] = useState("");
  const [newRuleText, setNewRuleText] = useState("");

  const [difficulty, setDifficulty] = useState("all_madden");
  const [cfbDifficulty, setCfbDifficulty] = useState("heisman");
  const [tradeDifficulty, setTradeDifficulty] = useState("normal");
  const [freeAgentMotivationImpact, setFreeAgentMotivationImpact] = useState("normal");
  const [quarterLengthMinutes, setQuarterLengthMinutes] = useState(8);
  const [acceleratedClockEnabled, setAcceleratedClockEnabled] = useState(true);
  const [acceleratedClockMinimumSeconds, setAcceleratedClockMinimumSeconds] = useState(20);
  const [salaryCapEnabled, setSalaryCapEnabled] = useState(false);
  const [tradeDeadlineEnabled, setTradeDeadlineEnabled] = useState(false);
  const [abilitiesEnabled, setAbilitiesEnabled] = useState(true);
  const [wearAndTearEnabled, setWearAndTearEnabled] = useState(true);
  const [coachFiringPolicy, setCoachFiringPolicy] = useState("on");
  const [preorderBonusesEnabled, setPreorderBonusesEnabled] = useState(true);
  const [coachModeEnabled, setCoachModeEnabled] = useState(false);
  const [coachModeAutoPassEnabled, setCoachModeAutoPassEnabled] = useState(false);
  const [coachModeAutoSnapEnabled, setCoachModeAutoSnapEnabled] = useState(false);
  const [coachModeCoachSuggestionsEnabled, setCoachModeCoachSuggestionsEnabled] = useState(false);
  const [ballHawk, setBallHawk] = useState("keep_individual");
  const [heatSeeker, setHeatSeeker] = useState("keep_individual");
  const [switchAssist, setSwitchAssist] = useState("keep_individual");
  const [positionChangePolicy, setPositionChangePolicy] = useState("restricted");
  const [positionChangePolicyDescription, setPositionChangePolicyDescription] = useState("");
  const [tradeApprovalPolicy, setTradeApprovalPolicy] = useState("competition_committee_review");
  const [cpuTradingPolicy, setCpuTradingPolicy] = useState("allowed");
  const [cpuTradingRestriction, setCpuTradingRestriction] = useState("");
  const [cpuTradesSeasonCap, setCpuTradesSeasonCap] = useState(0);
  const [coachAbilitiesRestricted, setCoachAbilitiesRestricted] = useState(false);
  const [coachAbilitiesRestrictionNotes, setCoachAbilitiesRestrictionNotes] = useState("");
  const [difficultyCustomSettings, setDifficultyCustomSettings] = useState("");
  const [slidersAdjusted, setSlidersAdjusted] = useState(false);
  const [coachXpSetting, setCoachXpSetting] = useState("casual");

  const [dynastyType, setDynastyType] = useState("real");
  const [recruitingDifficulty, setRecruitingDifficulty] = useState("normal");
  const [transferPortalEnabled, setTransferPortalEnabled] = useState(true);
  const [coachCarouselEnabled, setCoachCarouselEnabled] = useState(true);
  const [homeFieldAdvantageEnabled, setHomeFieldAdvantageEnabled] = useState(true);
  const [stadiumPulseEnabled, setStadiumPulseEnabled] = useState(true);
  const [conferenceRealignment, setConferenceRealignment] = useState("locked");
  const [teamBuilderAllowed, setTeamBuilderAllowed] = useState(false);
  const [coachModeRecruitFlippingEnabled, setCoachModeRecruitFlippingEnabled] = useState(false);
  const [coachModeAutoRecruitingEnabled, setCoachModeAutoRecruitingEnabled] = useState(false);
  const [coachModeAutoProgressPlayersEnabled, setCoachModeAutoProgressPlayersEnabled] = useState(false);
  const [coachModeUserAutoProgressionEnabled, setCoachModeUserAutoProgressionEnabled] = useState(false);
  const [coachModeCpuManageBudgetEnabled, setCoachModeCpuManageBudgetEnabled] = useState(false);
  const [coachModeCpuManageStaffEnabled, setCoachModeCpuManageStaffEnabled] = useState(false);
  const [coachModeCpuManageFacilitiesEnabled, setCoachModeCpuManageFacilitiesEnabled] = useState(false);

  const [playerEditPermission, setPlayerEditPermission] = useState("commish_only");
  const [manualXpProgressionPenaltyPct, setManualXpProgressionPenaltyPct] = useState(25);
  const [verbalCommitInfluencePct, setVerbalCommitInfluencePct] = useState(25);
  const [userTransferChancePct, setUserTransferChancePct] = useState(55);
  const [cpuTransferChancePct, setCpuTransferChancePct] = useState(55);
  const [transferPortalMaxPerTeam, setTransferPortalMaxPerTeam] = useState(20);
  const [minimumPlayClockSeconds, setMinimumPlayClockSeconds] = useState(15);
  const [seasonExperience, setSeasonExperience] = useState("customized");

  // Per-conference rule overrides — only conferences the commissioner actually customizes get
  // sent; everyone else inherits the league-wide defaults implicitly (no row created for them).
  const [conferenceRulesEditing, setConferenceRulesEditing] = useState(false);
  const [activeConferenceForRules, setActiveConferenceForRules] = useState("");
  const [conferenceRules, setConferenceRules] = useState<Record<string, {
    divisionsEnabled: boolean; division1Name: string; division2Name: string; conferenceGames: number;
    confChampGameEnabled: boolean; champGameLocation: string; champGameSelectionCriteria: string;
    protectedOpponentsEnabled: boolean; protectedOpponentsCount: number;
  }>>({});
  function conferenceRuleDraft(conference: string) {
    return conferenceRules[conference] ?? {
      divisionsEnabled: false, division1Name: "", division2Name: "", conferenceGames: 8,
      confChampGameEnabled: false, champGameLocation: "conference_leader_home", champGameSelectionCriteria: "division_winners",
      protectedOpponentsEnabled: false, protectedOpponentsCount: 1,
    };
  }
  function updateConferenceRule(conference: string, patch: Partial<ReturnType<typeof conferenceRuleDraft>>) {
    setConferenceRules((current) => ({ ...current, [conference]: { ...conferenceRuleDraft(conference), ...patch } }));
  }

  const isCfb = game === "cfb_27";
  const isMadden = game === "madden_26" || game === "madden_27";
  const isSeasonOne = seasonNumber === 1;

  const gameLabel = isCfb ? "CFB" : "Madden";
  const stages = isCfb ? CFB_SEASON_STAGES : MADDEN_SEASON_STAGES;

  const existingCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const rule of customRules) cats.add(rule.category);
    return Array.from(cats).sort();
  }, [customRules]);

  const filteredExistingCategories = useMemo(() => {
    if (!newRuleCategory.trim()) return existingCategories;
    return existingCategories.filter((c) => c.toLowerCase().includes(newRuleCategory.toLowerCase()));
  }, [existingCategories, newRuleCategory]);

  const collectConfig = useCallback(() => {
    const payload = {
      isOnline,
      crossPlayEnabled,
      requiredConsole: crossPlayEnabled ? undefined : requiredConsole,
      leagueType: leagueType || undefined,
      immortalityOffensePosition: leagueType === "rise_to_immortality" ? immortalityOffensePosition : undefined,
      immortalityDefensePosition: leagueType === "rise_to_immortality" ? immortalityDefensePosition : undefined,
      immortalityTeamPool: leagueType === "rise_to_immortality" ? immortalityTeamPool : undefined,
      immortalityCustomTeams: leagueType === "rise_to_immortality" && immortalityTeamPool === "custom_32"
        ? NFL_TEAMS.flatMap((team) => {
          const slot = immortalityCustomTeams[team.abbreviation];
          if (!slot?.city.trim() || !slot?.nick.trim() || !slot?.abbreviation.trim()) return [];
          return [{
            replacesAbbreviation: team.abbreviation,
            city: slot.city.trim(),
            nick: slot.nick.trim(),
            abbreviation: slot.abbreviation.trim().toUpperCase(),
            primaryLogoUrl: slot.primaryLogoUrl.trim() || undefined,
            secondaryLogoUrl: slot.secondaryLogoUrl.trim() || undefined,
            wordmarkUrl: slot.wordmarkUrl.trim() || undefined,
            primaryColor: slot.primaryColor.trim() || undefined,
            secondaryColor: slot.secondaryColor.trim() || undefined,
            tertiaryColor: slot.tertiaryColor.trim() || undefined,
          }];
        })
        : undefined,
      maxMembers: customMaxMembers ? maxMembers : 32,
      activeRostersEnabled: isCfb ? true : undefined,
      trackRostersEnabled: isCfb ? true : undefined,
      dynastyType: isCfb ? dynastyType : undefined,
      recruitingDifficulty: isCfb ? recruitingDifficulty : undefined,
      transferPortalEnabled: isCfb ? transferPortalEnabled : undefined,
      playerEditPermission: isCfb ? playerEditPermission : undefined,
      manualXpProgressionPenaltyPct: isCfb ? manualXpProgressionPenaltyPct : undefined,
      verbalCommitInfluencePct: isCfb ? verbalCommitInfluencePct : undefined,
      userTransferChancePct: isCfb ? userTransferChancePct : undefined,
      cpuTransferChancePct: isCfb ? cpuTransferChancePct : undefined,
      transferPortalMaxPerTeam: isCfb ? transferPortalMaxPerTeam : undefined,
      minimumPlayClockSeconds: isCfb ? minimumPlayClockSeconds : undefined,
      seasonExperience: isCfb ? seasonExperience : undefined,
      conferenceRules: isCfb && conferenceRulesEditing
        ? Object.entries(conferenceRules).map(([conferenceName, rule]) => ({ conferenceName, ...rule }))
        : undefined,
      coachCarouselEnabled: isCfb ? coachCarouselEnabled : undefined,
      homeFieldAdvantageEnabled: isCfb ? homeFieldAdvantageEnabled : undefined,
      stadiumPulseEnabled: isCfb ? stadiumPulseEnabled : undefined,
      conferenceRealignment: isCfb ? conferenceRealignment : undefined,
      teamBuilderAllowed: isCfb ? teamBuilderAllowed : undefined,
      seasonNumber,
      seasonStage: seasonStage || undefined,
      currentWeek: isSeasonOne ? currentWeek : 1,
      currentPhase: skipToStage && isMadden && isSeasonOne ? skipToStageValue : undefined,
      regularSeasonStreamingRequirement,
      regularSeasonStreamingSide,
      postseasonStreamingRequirement,
      postseasonStreamingSide,
      gotwStreamingRequirement,
      gotwStreamingSide,
      fourthDownRuleTypeRegular,
      customFourthDownRuleRegular: customFourthDownRuleRegular || undefined,
      fourthDownRuleTypePlayoff,
      customFourthDownRulePlayoff: customFourthDownRulePlayoff || undefined,
      advanceTiming,
      advanceTimingOther: advanceTiming === "other" ? advanceTimingOther || undefined : undefined,
      injuryPolicy,
      fairSimRequirements: fairSimRequirements || undefined,
      forceWinRequirements: forceWinRequirements || undefined,
      forceWinRulesRegular,
      forceWinRulesPostseason,
      fairSimRulesRegular,
      fairSimRulesPostseason,
      offensivePlayCallLimitsEnabled,
      offensivePlayCallLimit: offensivePlayCallLimitsEnabled ? offensivePlayCallLimit : undefined,
      offensivePlayCallCooldownEnabled,
      offensivePlayCallCooldown: offensivePlayCallCooldownEnabled ? offensivePlayCallCooldown : undefined,
      defensivePlayCallLimitsEnabled,
      defensivePlayCallLimit: defensivePlayCallLimitsEnabled ? defensivePlayCallLimit : undefined,
      defensivePlayCallCooldownEnabled,
      defensivePlayCallCooldown: defensivePlayCallCooldownEnabled ? defensivePlayCallCooldown : undefined,
      customCoachesRequired,
      customPlaybooksAllowed,
      coinEconomyEnabled,
      customPlayersEnabled: coinEconomyEnabled ? customPlayersEnabled : false,
      customPlayersSeasonCap: coinEconomyEnabled && customPlayersEnabled ? customPlayersSeasonCap : 0,
      legendsEnabled: coinEconomyEnabled ? legendsEnabled : false,
      legendsSeasonCap: coinEconomyEnabled && legendsEnabled ? legendsSeasonCap : 0,
      devUpgradesEnabled: coinEconomyEnabled ? devUpgradesEnabled : false,
      devUpgradeCapMode,
      devUpgradesSeasonCap: coinEconomyEnabled && devUpgradesEnabled && devUpgradeCapMode === "total_purchases" ? devUpgradesSeasonCap : 0,
      devUpgradesPlayerCap: coinEconomyEnabled && devUpgradesEnabled && devUpgradeCapMode === "players_per_season" ? devUpgradesPlayerCap : 0,
      ageResetsEnabled: coinEconomyEnabled && isMadden ? ageResetsEnabled : false,
      ageResetsSeasonCap: coinEconomyEnabled && isMadden && ageResetsEnabled ? ageResetsSeasonCap : 0,
      attributePurchasesEnabled: coinEconomyEnabled ? attributePurchasesEnabled : false,
      coreAttributePurchasesSeasonCap: coinEconomyEnabled && attributePurchasesEnabled ? coreAttributePurchasesSeasonCap : 0,
      coreAttributeGroupCap: 0,
      nonCoreAttributePurchasesSeasonCap: coinEconomyEnabled && attributePurchasesEnabled && nonCoreAttributeCapMode === "group" ? nonCoreAttributePurchasesSeasonCap : 0,
      nonCoreAttributeCapMode,
      coreAttributes: coinEconomyEnabled && attributePurchasesEnabled ? coreAttributes : [],
      coreAttributeCapOverrides: coinEconomyEnabled && attributePurchasesEnabled ? coreAttributeCapOverrides : {},
      nonCoreAttributeCapOverrides: coinEconomyEnabled && attributePurchasesEnabled && nonCoreAttributeCapMode === "individual" ? nonCoreAttributeCapOverrides : {},
      // Player trait purchases were retired app-wide — always sent disabled.
      playerTraitPurchasesEnabled: false,
      playerTraitPurchasesSeasonCap: 0,
      contractAdjustmentPurchasesEnabled: coinEconomyEnabled && isMadden ? contractAdjustmentPurchasesEnabled : false,
      contractPurchasesSeasonCap: coinEconomyEnabled && isMadden && contractAdjustmentPurchasesEnabled ? contractPurchasesSeasonCap : 0,
      purchaseDeadlines: coinEconomyEnabled ? purchaseDeadlines : {},
      customRules,
      difficulty: isMadden ? difficulty : undefined,
      cfbDifficulty: isCfb ? cfbDifficulty : undefined,
      tradeDifficulty: isMadden ? tradeDifficulty : undefined,
      freeAgentMotivationImpact: game === "madden_26" ? freeAgentMotivationImpact : undefined,
      quarterLengthMinutes,
      acceleratedClockEnabled,
      acceleratedClockMinimumSeconds: acceleratedClockEnabled ? acceleratedClockMinimumSeconds : 20,
      salaryCapEnabled: isMadden ? salaryCapEnabled : undefined,
      tradeDeadlineEnabled: isMadden ? tradeDeadlineEnabled : undefined,
      abilitiesEnabled,
      wearAndTearEnabled,
      coachFiringPolicy: isMadden ? coachFiringPolicy : undefined,
      preorderBonusesEnabled: isMadden ? preorderBonusesEnabled : undefined,
      coachModeEnabled,
      coachModeAutoPassEnabled: coachModeEnabled ? coachModeAutoPassEnabled : false,
      coachModeAutoSnapEnabled: coachModeEnabled ? coachModeAutoSnapEnabled : false,
      coachModeCoachSuggestionsEnabled: coachModeEnabled ? coachModeCoachSuggestionsEnabled : false,
      coachModeRecruitFlippingEnabled: isCfb && coachModeEnabled ? coachModeRecruitFlippingEnabled : undefined,
      coachModeAutoRecruitingEnabled: isCfb && coachModeEnabled ? coachModeAutoRecruitingEnabled : undefined,
      coachModeAutoProgressPlayersEnabled: isCfb && coachModeEnabled ? coachModeAutoProgressPlayersEnabled : undefined,
      coachModeUserAutoProgressionEnabled: isCfb && coachModeEnabled ? coachModeUserAutoProgressionEnabled : undefined,
      coachModeCpuManageBudgetEnabled: isCfb && coachModeEnabled ? coachModeCpuManageBudgetEnabled : undefined,
      coachModeCpuManageStaffEnabled: isCfb && coachModeEnabled ? coachModeCpuManageStaffEnabled : undefined,
      coachModeCpuManageFacilitiesEnabled: isCfb && coachModeEnabled ? coachModeCpuManageFacilitiesEnabled : undefined,
      ballHawk,
      heatSeeker,
      switchAssist,
      positionChangePolicy: isMadden ? positionChangePolicy : undefined,
      positionChangePolicyDescription: isMadden && positionChangePolicy !== "open" ? positionChangePolicyDescription || undefined : undefined,
      tradeApprovalPolicy: isMadden ? tradeApprovalPolicy : undefined,
      cpuTradingPolicy: isMadden ? cpuTradingPolicy : undefined,
      cpuTradingRestriction: isMadden && cpuTradingPolicy === "restricted" ? cpuTradingRestriction || undefined : undefined,
      cpuTradesSeasonCap: isMadden && cpuTradingPolicy !== "not_allowed" ? cpuTradesSeasonCap : 0,
      coachAbilitiesRestricted: isMadden ? coachAbilitiesRestricted : undefined,
      coachAbilitiesRestrictionNotes: isMadden && coachAbilitiesRestricted ? coachAbilitiesRestrictionNotes || undefined : undefined,
      difficultyCustomSettings: difficultyCustomSettings || undefined,
      slidersAdjusted,
      sliderCatalogVersion: game ? LEAGUE_SLIDER_CATALOG_VERSION[game] : undefined,
      sliderSettings: game ? defaultLeagueSliderValues(game) : {},
      coachXpSetting: isCfb ? coachXpSetting : undefined,
      leaguePassword: leaguePassword || undefined,
    };
    if (leagueType === "rise_to_immortality" || templateId === "rise_to_immortality") {
      return {
        ...applyRiseToImmortalityLockedSettings(payload),
        immortalityOffensePosition,
        immortalityDefensePosition,
        immortalityTeamPool,
        immortalityCustomTeams: leagueType === "rise_to_immortality" && immortalityTeamPool === "custom_32"
          ? NFL_TEAMS.flatMap((team) => {
            const slot = immortalityCustomTeams[team.abbreviation];
            if (!slot?.city.trim() || !slot?.nick.trim() || !slot?.abbreviation.trim()) return [];
            return [{
              replacesAbbreviation: team.abbreviation,
              city: slot.city.trim(),
              nick: slot.nick.trim(),
              abbreviation: slot.abbreviation.trim().toUpperCase(),
              primaryLogoUrl: slot.primaryLogoUrl.trim() || undefined,
              secondaryLogoUrl: slot.secondaryLogoUrl.trim() || undefined,
              wordmarkUrl: slot.wordmarkUrl.trim() || undefined,
              primaryColor: slot.primaryColor.trim() || undefined,
              secondaryColor: slot.secondaryColor.trim() || undefined,
              tertiaryColor: slot.tertiaryColor.trim() || undefined,
            }];
          })
          : undefined,
      };
    }
    return payload;
  }, [
    game, isOnline, crossPlayEnabled, requiredConsole, leagueType, customMaxMembers, maxMembers, name, leaguePassword,
    immortalityOffensePosition, immortalityDefensePosition, immortalityTeamPool, immortalityCustomTeams, templateId,
    seasonNumber, seasonStage, currentWeek, skipToStage, skipToStageValue,
    regularSeasonStreamingRequirement, regularSeasonStreamingSide,
    postseasonStreamingRequirement, postseasonStreamingSide,
    gotwStreamingRequirement, gotwStreamingSide,
    fourthDownRuleTypeRegular, customFourthDownRuleRegular,
    fourthDownRuleTypePlayoff, customFourthDownRulePlayoff,
    advanceTiming, advanceTimingOther, injuryPolicy,
    fairSimRequirements, forceWinRequirements,
    forceWinRulesRegular, setForceWinRulesRegular,
    forceWinRulesPostseason, setForceWinRulesPostseason,
    fairSimRulesRegular, setFairSimRulesRegular,
    fairSimRulesPostseason, setFairSimRulesPostseason,
    offensivePlayCallLimitsEnabled, offensivePlayCallLimit,
    offensivePlayCallCooldownEnabled, offensivePlayCallCooldown,
    defensivePlayCallLimitsEnabled, defensivePlayCallLimit,
    defensivePlayCallCooldownEnabled, defensivePlayCallCooldown,
    customCoachesRequired, customPlaybooksAllowed,
    coinEconomyEnabled, customPlayersEnabled, customPlayersSeasonCap,
    legendsEnabled, legendsSeasonCap, devUpgradesEnabled, devUpgradeCapMode,
    devUpgradesSeasonCap, devUpgradesPlayerCap,
    ageResetsEnabled, ageResetsSeasonCap,
    attributePurchasesEnabled, coreAttributePurchasesSeasonCap,
    nonCoreAttributePurchasesSeasonCap, nonCoreAttributeCapMode,
    coreAttributes, coreAttributeCapOverrides, nonCoreAttributeCapOverrides,
    contractAdjustmentPurchasesEnabled, contractPurchasesSeasonCap,
    purchaseDeadlines, customRules,
    difficulty, cfbDifficulty, tradeDifficulty, freeAgentMotivationImpact, quarterLengthMinutes,
    acceleratedClockEnabled, acceleratedClockMinimumSeconds,
    salaryCapEnabled, tradeDeadlineEnabled, abilitiesEnabled, wearAndTearEnabled,
    coachFiringPolicy, preorderBonusesEnabled,
    coachModeEnabled, coachModeAutoPassEnabled, coachModeAutoSnapEnabled,
    coachModeCoachSuggestionsEnabled,
    coachModeRecruitFlippingEnabled, coachModeAutoRecruitingEnabled,
    coachModeAutoProgressPlayersEnabled, coachModeUserAutoProgressionEnabled,
    coachModeCpuManageBudgetEnabled, coachModeCpuManageStaffEnabled,
    coachModeCpuManageFacilitiesEnabled,
    ballHawk, heatSeeker, switchAssist,
    positionChangePolicy, positionChangePolicyDescription,
    tradeApprovalPolicy, cpuTradingPolicy, cpuTradingRestriction, cpuTradesSeasonCap,
    coachAbilitiesRestricted, coachAbilitiesRestrictionNotes,
    difficultyCustomSettings, slidersAdjusted, coachXpSetting,
    isCfb, isMadden, isSeasonOne,
  ]);

  function applyTemplate(template: LeagueTemplatePreset) {
    if (template.leagueType !== undefined) setLeagueType(template.leagueType);
    if (template.difficulty !== undefined) setDifficulty(template.difficulty);
    if (template.cfbDifficulty !== undefined) setCfbDifficulty(template.cfbDifficulty);
    if (template.recruitingDifficulty !== undefined) setRecruitingDifficulty(template.recruitingDifficulty);
    if (template.dynastyType !== undefined) {
      setDynastyType(template.dynastyType);
      // Team Builder allowed is implied by dynasty type ("Mixed" = allowed, "Real Rosters" =
      // not) — keep them from disagreeing rather than exposing them as two settings that can
      // silently contradict each other.
      setTeamBuilderAllowed(template.dynastyType === "mixed");
    }
    if (template.quarterLengthMinutes !== undefined) setQuarterLengthMinutes(template.quarterLengthMinutes);
    if (template.acceleratedClockEnabled !== undefined) setAcceleratedClockEnabled(template.acceleratedClockEnabled);
    if (template.acceleratedClockMinimumSeconds !== undefined) setAcceleratedClockMinimumSeconds(template.acceleratedClockMinimumSeconds);
    if (template.tradeDifficulty !== undefined) setTradeDifficulty(template.tradeDifficulty);
    setFreeAgentMotivationImpact(template.freeAgentMotivationImpact);
    if (template.salaryCapEnabled !== undefined) setSalaryCapEnabled(template.salaryCapEnabled);
    if (template.tradeDeadlineEnabled !== undefined) setTradeDeadlineEnabled(template.tradeDeadlineEnabled);
    if (template.tradeApprovalPolicy !== undefined) setTradeApprovalPolicy(template.tradeApprovalPolicy);
    if (template.cpuTradingPolicy !== undefined) setCpuTradingPolicy(template.cpuTradingPolicy);
    setCpuTradesSeasonCap(template.cpuTradesSeasonCap);
    if (template.positionChangePolicy !== undefined) setPositionChangePolicy(template.positionChangePolicy);
    setCoachFiringPolicy(template.coachFiringPolicy);
    setPreorderBonusesEnabled(template.preorderBonusesEnabled);
    setAbilitiesEnabled(template.abilitiesEnabled);
    setWearAndTearEnabled(template.wearAndTearEnabled);
    setBallHawk(template.ballHawk);
    setHeatSeeker(template.heatSeeker);
    setSwitchAssist(template.switchAssist);
    setInjuryPolicy(template.injuryPolicy);
    setCustomCoachesRequired(template.customCoachesRequired);
    setCustomPlaybooksAllowed(template.customPlaybooksAllowed);
    if (template.coinEconomyEnabled !== undefined) setCoinEconomyEnabled(template.coinEconomyEnabled);
    if (template.customPlayersEnabled !== undefined) setCustomPlayersEnabled(template.customPlayersEnabled);
    if (template.customPlayersSeasonCap !== undefined) setCustomPlayersSeasonCap(template.customPlayersSeasonCap);
    if (template.legendsEnabled !== undefined) setLegendsEnabled(template.legendsEnabled);
    if (template.legendsSeasonCap !== undefined) setLegendsSeasonCap(template.legendsSeasonCap);
    if (template.devUpgradesEnabled !== undefined) setDevUpgradesEnabled(template.devUpgradesEnabled);
    if (template.devUpgradeCapMode !== undefined) setDevUpgradeCapMode(template.devUpgradeCapMode);
    if (template.devUpgradesSeasonCap !== undefined) setDevUpgradesSeasonCap(template.devUpgradesSeasonCap);
    if (template.devUpgradesPlayerCap !== undefined) setDevUpgradesPlayerCap(template.devUpgradesPlayerCap);
    if (template.ageResetsEnabled !== undefined) setAgeResetsEnabled(template.ageResetsEnabled);
    if (template.ageResetsSeasonCap !== undefined) setAgeResetsSeasonCap(template.ageResetsSeasonCap);
    if (template.attributePurchasesEnabled !== undefined) setAttributePurchasesEnabled(template.attributePurchasesEnabled);
    if (template.coreAttributePurchasesSeasonCap !== undefined) setCoreAttributePurchasesSeasonCap(template.coreAttributePurchasesSeasonCap);
    if (template.nonCoreAttributePurchasesSeasonCap !== undefined) setNonCoreAttributePurchasesSeasonCap(template.nonCoreAttributePurchasesSeasonCap);
    setNonCoreAttributeCapMode(template.nonCoreAttributeCapMode);
    if (template.coreAttributes !== undefined) {
      setCoreAttributes(template.coreAttributes);
      setCoreAttributeCapOverrides(template.coreAttributeCapOverrides);
      setNonCoreAttributeCapOverrides(template.nonCoreAttributeCapOverrides);
    }
    if (template.contractAdjustmentPurchasesEnabled !== undefined) setContractAdjustmentPurchasesEnabled(template.contractAdjustmentPurchasesEnabled);
    if (template.contractPurchasesSeasonCap !== undefined) setContractPurchasesSeasonCap(template.contractPurchasesSeasonCap);
    if (template.regularSeasonStreamingRequirement !== undefined) setRegularSeasonStreamingRequirement(template.regularSeasonStreamingRequirement);
    if (template.regularSeasonStreamingSide !== undefined) setRegularSeasonStreamingSide(template.regularSeasonStreamingSide);
    if (template.postseasonStreamingRequirement !== undefined) setPostseasonStreamingRequirement(template.postseasonStreamingRequirement);
    if (template.postseasonStreamingSide !== undefined) setPostseasonStreamingSide(template.postseasonStreamingSide);
    if (template.gotwStreamingRequirement !== undefined) setGotwStreamingRequirement(template.gotwStreamingRequirement);
    if (template.gotwStreamingSide !== undefined) setGotwStreamingSide(template.gotwStreamingSide);
    if (template.fourthDownRuleTypeRegular !== undefined) setFourthDownRuleTypeRegular(template.fourthDownRuleTypeRegular);
    if (template.fourthDownRuleTypePlayoff !== undefined) setFourthDownRuleTypePlayoff(template.fourthDownRuleTypePlayoff);
    if (template.offensivePlayCallLimitsEnabled !== undefined) setOffensivePlayCallLimitsEnabled(template.offensivePlayCallLimitsEnabled);
    if (template.offensivePlayCallLimit !== undefined) setOffensivePlayCallLimit(template.offensivePlayCallLimit);
    if (template.offensivePlayCallCooldownEnabled !== undefined) setOffensivePlayCallCooldownEnabled(template.offensivePlayCallCooldownEnabled);
    if (template.offensivePlayCallCooldown !== undefined) setOffensivePlayCallCooldown(template.offensivePlayCallCooldown);
    if (template.defensivePlayCallLimitsEnabled !== undefined) setDefensivePlayCallLimitsEnabled(template.defensivePlayCallLimitsEnabled);
    if (template.defensivePlayCallLimit !== undefined) setDefensivePlayCallLimit(template.defensivePlayCallLimit);
    if (template.defensivePlayCallCooldownEnabled !== undefined) setDefensivePlayCallCooldownEnabled(template.defensivePlayCallCooldownEnabled);
    if (template.defensivePlayCallCooldown !== undefined) setDefensivePlayCallCooldown(template.defensivePlayCallCooldown);
    const deadline = { stage: template.purchaseDeadlineStage, week: template.purchaseDeadlineWeek };
    setPurchaseDeadlines(Object.fromEntries(Object.keys(PURCHASE_DEADLINE_TYPES).map((key) => [key, deadline])));
  }

  function handleTemplateSelect(id: LeagueTemplateId | null) {
    setTemplateId(id);
    if (!game) return;
    const preset = id ? getLeagueTemplatePreset(game, id) : BASE_TEMPLATE_PRESET;
    if (preset) applyTemplate(preset);
    if (!id) {
      setLeagueType("");
      setCoinEconomyEnabled(false);
      setCustomPlayersEnabled(false);
      setLegendsEnabled(false);
      setDevUpgradesEnabled(false);
      setAttributePurchasesEnabled(false);
      setAgeResetsEnabled(false);
      setContractAdjustmentPurchasesEnabled(false);
    }
  }

  const teamOptions: SiteOpenTeam[] = useMemo(() => {
    if (game === "cfb_27") {
      return CFB_27_TEAMS.map((t) => ({
        id: t.abbreviation,
        name: t.name,
        abbreviation: t.abbreviation,
        mascot: t.isSchedulePlaceholder ? "FCS" : t.mascot,
      }));
    }
    return [...AFC_TEAMS, ...NFC_TEAMS].map((t) => ({
      id: t.abbreviation,
      name: t.name,
      abbreviation: t.abbreviation,
      mascot: null,
    }));
  }, [game]);

  function addRule() {
    if (!newRuleCategory.trim() || !newRuleTitle.trim() || !newRuleText.trim()) return;
    const now = new Date().toISOString();
    const sortIndex = customRules.length;
    setCustomRules([...customRules, {
      id: crypto.randomUUID(),
      category: newRuleCategory.trim(),
      title: newRuleTitle.trim(),
      text: newRuleText.trim(),
      sortOrder: sortIndex,
      createdAt: now,
      updatedAt: now,
    }]);
    setNewRuleTitle("");
    setNewRuleText("");
  }

  function removeRule(id: string) {
    setCustomRules(customRules.filter((r) => r.id !== id));
  }

  function moveRule(id: string, direction: -1 | 1) {
    const idx = customRules.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= customRules.length) return;
    const updated = [...customRules];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    updated.forEach((r, i) => { r.sortOrder = i; r.updatedAt = new Date().toISOString(); });
    setCustomRules(updated);
  }

  function editRule(id: string, field: "category" | "title" | "text", value: string) {
    setCustomRules(customRules.map((r) => r.id === id ? { ...r, [field]: value, updatedAt: new Date().toISOString() } : r));
  }

  function updateDeadline(type: string, stage: string, week: number) {
    const next = { ...purchaseDeadlines };
    if (!stage) { delete next[type]; } else { next[type] = { stage, week }; }
    setPurchaseDeadlines(next);
  }

  return {
    templateId,
    setTemplateId,
    game,
    setGame,
    isOnline,
    setIsOnline,
    crossPlayEnabled,
    setCrossPlayEnabled,
    requiredConsole,
    setRequiredConsole,
    leagueType,
    setLeagueType,
    immortalityOffensePosition,
    setImmortalityOffensePosition,
    immortalityDefensePosition,
    setImmortalityDefensePosition,
    immortalityTeamPool,
    setImmortalityTeamPool,
    immortalityCustomTeams,
    setImmortalityCustomTeams,
    immortalityTeamLogoFiles,
    setImmortalityTeamLogoFiles,
    name,
    setName,
    leagueLogoFile,
    setLeagueLogoFile,
    customMaxMembers,
    setCustomMaxMembers,
    maxMembers,
    setMaxMembers,
    leaguePassword,
    setLeaguePassword,
    seasonNumber,
    setSeasonNumber,
    seasonStage,
    setSeasonStage,
    currentWeek,
    setCurrentWeek,
    skipToStage,
    setSkipToStage,
    skipToStageValue,
    setSkipToStageValue,
    regularSeasonStreamingRequirement,
    setRegularSeasonStreamingRequirement,
    regularSeasonStreamingSide,
    setRegularSeasonStreamingSide,
    postseasonStreamingRequirement,
    setPostseasonStreamingRequirement,
    postseasonStreamingSide,
    setPostseasonStreamingSide,
    gotwStreamingRequirement,
    setGotwStreamingRequirement,
    gotwStreamingSide,
    setGotwStreamingSide,
    fourthDownRuleTypeRegular,
    setFourthDownRuleTypeRegular,
    customFourthDownRuleRegular,
    setCustomFourthDownRuleRegular,
    fourthDownRuleTypePlayoff,
    setFourthDownRuleTypePlayoff,
    customFourthDownRulePlayoff,
    setCustomFourthDownRulePlayoff,
    advanceTiming,
    setAdvanceTiming,
    advanceTimingOther,
    setAdvanceTimingOther,
    injuryPolicy,
    setInjuryPolicy,
    fairSimRequirements,
    setFairSimRequirements,
    forceWinRequirements,
    setForceWinRequirements,
    forceWinRulesRegular,
    setForceWinRulesRegular,
    forceWinRulesPostseason,
    setForceWinRulesPostseason,
    fairSimRulesRegular,
    setFairSimRulesRegular,
    fairSimRulesPostseason,
    setFairSimRulesPostseason,
    offensivePlayCallLimitsEnabled,
    setOffensivePlayCallLimitsEnabled,
    offensivePlayCallLimit,
    setOffensivePlayCallLimit,
    offensivePlayCallCooldownEnabled,
    setOffensivePlayCallCooldownEnabled,
    offensivePlayCallCooldown,
    setOffensivePlayCallCooldown,
    defensivePlayCallLimitsEnabled,
    setDefensivePlayCallLimitsEnabled,
    defensivePlayCallLimit,
    setDefensivePlayCallLimit,
    defensivePlayCallCooldownEnabled,
    setDefensivePlayCallCooldownEnabled,
    defensivePlayCallCooldown,
    setDefensivePlayCallCooldown,
    customCoachesRequired,
    setCustomCoachesRequired,
    customPlaybooksAllowed,
    setCustomPlaybooksAllowed,
    coinEconomyEnabled,
    setCoinEconomyEnabled,
    customPlayersEnabled,
    setCustomPlayersEnabled,
    customPlayersSeasonCap,
    setCustomPlayersSeasonCap,
    legendsEnabled,
    setLegendsEnabled,
    legendsSeasonCap,
    setLegendsSeasonCap,
    devUpgradesEnabled,
    setDevUpgradesEnabled,
    devUpgradeCapMode,
    setDevUpgradeCapMode,
    devUpgradesSeasonCap,
    setDevUpgradesSeasonCap,
    devUpgradesPlayerCap,
    setDevUpgradesPlayerCap,
    ageResetsEnabled,
    setAgeResetsEnabled,
    ageResetsSeasonCap,
    setAgeResetsSeasonCap,
    attributePurchasesEnabled,
    setAttributePurchasesEnabled,
    coreAttributePurchasesSeasonCap,
    setCoreAttributePurchasesSeasonCap,
    nonCoreAttributePurchasesSeasonCap,
    setNonCoreAttributePurchasesSeasonCap,
    nonCoreAttributeCapMode,
    setNonCoreAttributeCapMode,
    coreAttributes,
    setCoreAttributes,
    coreAttributeCapOverrides,
    setCoreAttributeCapOverrides,
    nonCoreAttributeCapOverrides,
    setNonCoreAttributeCapOverrides,
    contractAdjustmentPurchasesEnabled,
    setContractAdjustmentPurchasesEnabled,
    contractPurchasesSeasonCap,
    setContractPurchasesSeasonCap,
    purchaseDeadlines,
    setPurchaseDeadlines,
    customRules,
    setCustomRules,
    newRuleCategory,
    setNewRuleCategory,
    newRuleTitle,
    setNewRuleTitle,
    newRuleText,
    setNewRuleText,
    difficulty,
    setDifficulty,
    cfbDifficulty,
    setCfbDifficulty,
    tradeDifficulty,
    setTradeDifficulty,
    freeAgentMotivationImpact,
    setFreeAgentMotivationImpact,
    quarterLengthMinutes,
    setQuarterLengthMinutes,
    acceleratedClockEnabled,
    setAcceleratedClockEnabled,
    acceleratedClockMinimumSeconds,
    setAcceleratedClockMinimumSeconds,
    salaryCapEnabled,
    setSalaryCapEnabled,
    tradeDeadlineEnabled,
    setTradeDeadlineEnabled,
    abilitiesEnabled,
    setAbilitiesEnabled,
    wearAndTearEnabled,
    setWearAndTearEnabled,
    coachFiringPolicy,
    setCoachFiringPolicy,
    preorderBonusesEnabled,
    setPreorderBonusesEnabled,
    coachModeEnabled,
    setCoachModeEnabled,
    coachModeAutoPassEnabled,
    setCoachModeAutoPassEnabled,
    coachModeAutoSnapEnabled,
    setCoachModeAutoSnapEnabled,
    coachModeCoachSuggestionsEnabled,
    setCoachModeCoachSuggestionsEnabled,
    ballHawk,
    setBallHawk,
    heatSeeker,
    setHeatSeeker,
    switchAssist,
    setSwitchAssist,
    positionChangePolicy,
    setPositionChangePolicy,
    positionChangePolicyDescription,
    setPositionChangePolicyDescription,
    tradeApprovalPolicy,
    setTradeApprovalPolicy,
    cpuTradingPolicy,
    setCpuTradingPolicy,
    cpuTradingRestriction,
    setCpuTradingRestriction,
    cpuTradesSeasonCap,
    setCpuTradesSeasonCap,
    coachAbilitiesRestricted,
    setCoachAbilitiesRestricted,
    coachAbilitiesRestrictionNotes,
    setCoachAbilitiesRestrictionNotes,
    difficultyCustomSettings,
    setDifficultyCustomSettings,
    slidersAdjusted,
    setSlidersAdjusted,
    coachXpSetting,
    setCoachXpSetting,
    dynastyType,
    setDynastyType,
    recruitingDifficulty,
    setRecruitingDifficulty,
    transferPortalEnabled,
    setTransferPortalEnabled,
    coachCarouselEnabled,
    setCoachCarouselEnabled,
    homeFieldAdvantageEnabled,
    setHomeFieldAdvantageEnabled,
    stadiumPulseEnabled,
    setStadiumPulseEnabled,
    conferenceRealignment,
    setConferenceRealignment,
    teamBuilderAllowed,
    setTeamBuilderAllowed,
    coachModeRecruitFlippingEnabled,
    setCoachModeRecruitFlippingEnabled,
    coachModeAutoRecruitingEnabled,
    setCoachModeAutoRecruitingEnabled,
    coachModeAutoProgressPlayersEnabled,
    setCoachModeAutoProgressPlayersEnabled,
    coachModeUserAutoProgressionEnabled,
    setCoachModeUserAutoProgressionEnabled,
    coachModeCpuManageBudgetEnabled,
    setCoachModeCpuManageBudgetEnabled,
    coachModeCpuManageStaffEnabled,
    setCoachModeCpuManageStaffEnabled,
    coachModeCpuManageFacilitiesEnabled,
    setCoachModeCpuManageFacilitiesEnabled,
    playerEditPermission,
    setPlayerEditPermission,
    manualXpProgressionPenaltyPct,
    setManualXpProgressionPenaltyPct,
    verbalCommitInfluencePct,
    setVerbalCommitInfluencePct,
    userTransferChancePct,
    setUserTransferChancePct,
    cpuTransferChancePct,
    setCpuTransferChancePct,
    transferPortalMaxPerTeam,
    setTransferPortalMaxPerTeam,
    minimumPlayClockSeconds,
    setMinimumPlayClockSeconds,
    seasonExperience,
    setSeasonExperience,
    conferenceRulesEditing,
    setConferenceRulesEditing,
    activeConferenceForRules,
    setActiveConferenceForRules,
    conferenceRules,
    setConferenceRules,
    conferenceRuleDraft,
    updateConferenceRule,
    isCfb,
    isMadden,
    isSeasonOne,
    gameLabel,
    stages,
    existingCategories,
    filteredExistingCategories,
    collectConfig,
    applyTemplate,
    handleTemplateSelect,
    teamOptions,
    addRule,
    removeRule,
    moveRule,
    editRule,
    updateDeadline,
    PURCHASE_DEADLINE_TYPES,
    PURCHASE_DEADLINE_STAGES,
  };
}

export type LeagueWizardFormState = ReturnType<typeof useLeagueWizardState>;
