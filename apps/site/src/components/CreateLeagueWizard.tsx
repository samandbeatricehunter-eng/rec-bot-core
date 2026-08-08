import { useEffect, useState, useMemo, useCallback } from "react";
import { CONFERENCE_ORDER } from "@rec/shared";
import { siteApi, type SiteOpenTeam } from "../lib/site-api.js";
import { useAuth } from "../lib/auth-context.js";

type GameKey = "madden_26" | "madden_27" | "cfb_27";
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const GAME_OPTIONS: { value: GameKey; label: string }[] = [
  { value: "madden_26", label: "Madden 26" },
  { value: "madden_27", label: "Madden 27" },
  { value: "cfb_27", label: "CFB 27" },
];

const MADDEN_LEAGUE_TYPES = [
  { value: "regular_rosters", label: "Regular Rosters", desc: "Start with real NFL rosters. Trades, free agency, and the draft work as expected." },
  { value: "fantasy_draft", label: "Fantasy Draft", desc: "Every team is emptied and users draft brand-new rosters from scratch. You can schedule a draft date at the end of setup." },
  { value: "custom_rosters", label: "Custom Rosters", desc: "Import a custom roster file before starting. Useful for roster sharing communities." },
] as const;

const CFB_ROSTER_OPTIONS = [
  { value: "activeRosters", label: "Active Rosters", desc: "Seed the league with the current CFB baseline dataset. Recommended for most leagues." },
  { value: "trackRosters", label: "Track Rosters", desc: "Enable recruiting, transfer portal, and roster progression tracking. Only check this if your league uses REC's dynasty tracking features." },
] as const;

const MADDEN_DIFFICULTY = [
  { value: "rookie", label: "Rookie" },
  { value: "pro", label: "Pro" },
  { value: "all_pro", label: "All-Pro" },
  { value: "all_madden", label: "All-Madden" },
];

const CFB_DIFFICULTY = [
  { value: "freshman", label: "Freshman" },
  { value: "varsity", label: "Varsity" },
  { value: "all_american", label: "All-American" },
  { value: "heisman", label: "Heisman" },
];

const MADDEN_SEASON_STAGES = [
  "preseason_training_camp", "regular_season", "wild_card", "divisional",
  "conference_championship", "super_bowl", "offseason", "draft",
] as const;

const CFB_SEASON_STAGES = [
  "preseason", "regular_season", "wild_card", "divisional",
  "conference_championship", "national_championship", "offseason", "draft",
] as const;

const STREAMING_OPTIONS = [
  { value: "required", label: "Required" },
  { value: "recommended", label: "Recommended" },
  { value: "disabled", label: "Disabled" },
];

const STREAMING_SIDE_OPTIONS = [
  { value: "home", label: "Home" },
  { value: "away", label: "Away" },
  { value: "either", label: "Either" },
  { value: "both", label: "Both" },
];

const FOURTH_DOWN_OPTIONS = [
  { value: "none", label: "None" },
  { value: "standard_rec", label: "Standard REC" },
  { value: "custom", label: "Custom" },
];

const INJURY_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on_standard", label: "On (Standard)" },
  { value: "on_reduced", label: "On (Reduced)" },
];

const ADVANCE_TIMING_OPTIONS = [
  { value: "24hr", label: "24 Hours" },
  { value: "48hr", label: "48 Hours" },
  { value: "72hr", label: "72 Hours" },
  { value: "other", label: "Custom" },
];

const BALL_HAWK_OPTIONS = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
  { value: "keep_individual", label: "Keep Individual" },
];

const COACH_FIRING_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
  { value: "cpu_only", label: "CPU Teams Only" },
];

const POSITION_CHANGE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "restricted", label: "Restricted" },
  { value: "highly_restricted", label: "Highly Restricted" },
];

const TRADE_APPROVAL_OPTIONS = [
  { value: "no_approval_required", label: "No Approval Required" },
  { value: "commissioner_review", label: "Commissioner Review" },
  { value: "competition_committee_review", label: "Competition Committee Review" },
];

const CPU_TRADING_OPTIONS = [
  { value: "allowed", label: "Allowed" },
  { value: "restricted", label: "Restricted" },
  { value: "not_allowed", label: "Not Allowed" },
];

const CFB_RECRUITING_DIFFICULTY = [
  { value: "easy", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Hard" },
];

const CFB_DYNASTY_TYPE = [
  { value: "real", label: "Real Rosters" },
  { value: "mixed", label: "Mixed (Team Builder Allowed)" },
];

const PLAYER_EDIT_PERMISSION_OPTIONS = [
  { value: "commish_only", label: "Commissioner Only" },
  { value: "any_player", label: "Any Player" },
  { value: "none", label: "None" },
];

const SEASON_EXPERIENCE_OPTIONS = [
  { value: "full_control", label: "Full Control" },
  { value: "customized", label: "Customized" },
  { value: "simple", label: "Simple" },
];

const CHAMP_GAME_LOCATION_OPTIONS = [
  { value: "conference_leader_home", label: "Conference Leader's Home Stadium" },
  { value: "any_stadium", label: "Any Stadium" },
];

const CHAMP_GAME_CRITERIA_OPTIONS = [
  { value: "conference_record", label: "Conference Record" },
  { value: "division_winners", label: "Division Winners" },
];

const CFB_CONFERENCE_REALIGNMENT = [
  { value: "allowed", label: "Allowed" },
  { value: "locked", label: "Locked" },
];

function Tooltip({ text }: { text: string }) {
  return (
    <span className="wizard-tooltip" title={text} style={{ cursor: "help", marginLeft: 4, fontSize: "0.85em", opacity: 0.6 }}>?</span>
  );
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <label className="site-field-label">
      {label}
      {hint && <Tooltip text={hint} />}
    </label>
  );
}

function SelectField({ label, hint, value, onChange, options }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="site-field">
      <FieldLabel label={label} hint={hint} />
      <select className="site-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function ToggleField({ label, hint, checked, onChange, disabled }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className="site-field site-field-checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span>{label}</span>
      {hint && <Tooltip text={hint} />}
    </label>
  );
}

function NumberField({ label, hint, value, onChange, min, max, disabled }: {
  label: string; hint?: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; disabled?: boolean;
}) {
  return (
    <label className="site-field">
      <FieldLabel label={label} hint={hint} />
      <input className="site-input" type="number" value={value} min={min} max={max} disabled={disabled}
        onChange={(e) => onChange(Math.max(min ?? 0, Math.min(max ?? 999, Number(e.target.value))))} />
    </label>
  );
}

function TextField({ label, hint, value, onChange, placeholder, disabled, maxLength }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean; maxLength?: number;
}) {
  return (
    <label className="site-field">
      <FieldLabel label={label} hint={hint} />
      <input className="site-input" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled} maxLength={maxLength} />
    </label>
  );
}

function TextareaField({ label, hint, value, onChange, placeholder, disabled }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean;
}) {
  return (
    <label className="site-field">
      <FieldLabel label={label} hint={hint} />
      <textarea className="site-input" rows={3} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled} />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="wizard-section">
      <h3 className="wizard-section-title">{title}</h3>
      {children}
    </div>
  );
}

export function CreateLeagueWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (leagueId: string) => void }) {
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [game, setGame] = useState<GameKey | "">("");
  const [isOnline, setIsOnline] = useState(true);
  const [crossPlayEnabled, setCrossPlayEnabled] = useState(true);
  const [requiredConsole, setRequiredConsole] = useState<"ps5" | "xbox" | "pc">("ps5");
  const [leagueType, setLeagueType] = useState("");
  const [activeRostersEnabled, setActiveRostersEnabled] = useState(true);
  const [trackRostersEnabled, setTrackRostersEnabled] = useState(false);
  const [name, setName] = useState("");
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
  const [fairSimRequirements, setFairSimRequirements] = useState("");
  const [forceWinRequirements, setForceWinRequirements] = useState("");
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
  const [coreAttributeGroupCap, setCoreAttributeGroupCap] = useState(0);
  const [nonCoreAttributePurchasesSeasonCap, setNonCoreAttributePurchasesSeasonCap] = useState(0);

  const [contractAdjustmentPurchasesEnabled, setContractAdjustmentPurchasesEnabled] = useState(false);
  const [contractPurchasesSeasonCap, setContractPurchasesSeasonCap] = useState(0);
  const [purchaseDeadlines, setPurchaseDeadlines] = useState<Record<string, { stage: string; week: number }>>({});

  const [customRules, setCustomRules] = useState<Array<{ id: string; category: string; title: string; text: string; sortOrder: number; createdAt: string; updatedAt: string }>>([]);
  const [newRuleCategory, setNewRuleCategory] = useState("");
  const [newRuleTitle, setNewRuleTitle] = useState("");
  const [newRuleText, setNewRuleText] = useState("");

  const [difficulty, setDifficulty] = useState("all_madden");
  const [cfbDifficulty, setCfbDifficulty] = useState("heisman");
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
  const [coachAbilitiesRestricted, setCoachAbilitiesRestricted] = useState(false);
  const [coachAbilitiesRestrictionNotes, setCoachAbilitiesRestrictionNotes] = useState("");
  const [difficultyCustomSettings, setDifficultyCustomSettings] = useState("");
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

  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [teams, setTeams] = useState<SiteOpenTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const auth = useAuth();

  const [discordLinked, setDiscordLinked] = useState<boolean | null>(null);
  const [discordGuilds, setDiscordGuilds] = useState<Array<{ id: string; name: string; icon: string | null }>>([]);
  const [selectedGuildId, setSelectedGuildId] = useState("");
  const [discordBusy, setDiscordBusy] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [discordConnectResult, setDiscordConnectResult] = useState<{ inviteUrl: string; token: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    siteApi
      .getLinkProfile()
      .then((profile) => {
        if (!cancelled) setDiscordLinked(Boolean(profile.discordUsername));
      })
      .catch(() => {
        if (!cancelled) setDiscordLinked(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "rec:discord-guild-token") return;
      if (!event.data.ok) {
        setDiscordBusy(false);
        setDiscordError(event.data.error ?? "Could not connect your Discord account.");
        return;
      }
      void (async () => {
        try {
          const result = await siteApi.listDiscordGuilds(event.data.providerToken);
          if (!result.guilds.length) {
            setDiscordError("No Discord servers found where you're the owner or have Manage Server permission.");
            setDiscordBusy(false);
            return;
          }
          setDiscordGuilds(result.guilds);
          setSelectedGuildId(result.guilds[0].id);
          setDiscordBusy(false);
        } catch (err) {
          setDiscordBusy(false);
          setDiscordError(err instanceof Error ? err.message : "Could not load your Discord servers.");
        }
      })();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function startDiscordPicker() {
    if (!leagueId) return;
    setDiscordBusy(true);
    setDiscordError(null);
    setDiscordConnectResult(null);
    try {
      if (auth.status === "signed-in") sessionStorage.setItem("rec_guild_picker_expected_uid", auth.user.id);
      const { url, error } = await auth.discordGuildOAuthUrl();
      if (error || !url) throw new Error(error ?? "Could not start Discord linking.");
      const popup = window.open(url, "rec-discord-guilds", "width=560,height=680");
      if (!popup) {
        setDiscordBusy(false);
        setDiscordError("Your browser blocked the popup. Allow popups for this site and try again.");
      }
    } catch (err) {
      setDiscordBusy(false);
      setDiscordError(err instanceof Error ? err.message : "Could not start Discord linking.");
    }
  }

  async function connectGuildToLeague() {
    if (!leagueId || !selectedGuildId) return;
    setDiscordBusy(true);
    setDiscordError(null);
    try {
      const [enabled, invite] = await Promise.all([
        siteApi.enableLeagueBot(leagueId),
        siteApi.getBotInviteUrl(selectedGuildId),
      ]);
      setDiscordConnectResult({ inviteUrl: invite.inviteUrl, token: enabled.league.discord_bot_invite_token ?? "" });
      setDiscordBusy(false);
    } catch (err) {
      setDiscordBusy(false);
      setDiscordError(err instanceof Error ? err.message : "Failed to enable the Discord bot.");
    }
  }

  const isCfb = game === "cfb_27";
  const isMadden = game === "madden_26" || game === "madden_27";
  const isFantasyDraft = leagueType === "fantasy_draft";
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
    return {
      isOnline,
      crossPlayEnabled,
      requiredConsole: crossPlayEnabled ? undefined : requiredConsole,
      leagueType: leagueType || undefined,
      activeRostersEnabled: isCfb ? activeRostersEnabled : undefined,
      trackRostersEnabled: isCfb ? trackRostersEnabled : undefined,
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
      coreAttributeGroupCap: coinEconomyEnabled && attributePurchasesEnabled ? coreAttributeGroupCap : 0,
      nonCoreAttributePurchasesSeasonCap: coinEconomyEnabled && attributePurchasesEnabled ? nonCoreAttributePurchasesSeasonCap : 0,
      // Player trait purchases were retired app-wide — always sent disabled.
      playerTraitPurchasesEnabled: false,
      playerTraitPurchasesSeasonCap: 0,
      contractAdjustmentPurchasesEnabled: coinEconomyEnabled && isMadden ? contractAdjustmentPurchasesEnabled : false,
      contractPurchasesSeasonCap: coinEconomyEnabled && isMadden && contractAdjustmentPurchasesEnabled ? contractPurchasesSeasonCap : 0,
      purchaseDeadlines: coinEconomyEnabled ? purchaseDeadlines : {},
      customRules,
      difficulty: isMadden ? difficulty : undefined,
      cfbDifficulty: isCfb ? cfbDifficulty : undefined,
      quarterLengthMinutes,
      acceleratedClockEnabled,
      acceleratedClockMinimumSeconds: acceleratedClockEnabled ? acceleratedClockMinimumSeconds : 20,
      salaryCapEnabled: isMadden ? salaryCapEnabled : undefined,
      tradeDeadlineEnabled: isMadden ? tradeDeadlineEnabled : undefined,
      abilitiesEnabled,
      wearAndTearEnabled,
      coachFiringPolicy,
      preorderBonusesEnabled,
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
      coachAbilitiesRestricted: isMadden ? coachAbilitiesRestricted : undefined,
      coachAbilitiesRestrictionNotes: isMadden && coachAbilitiesRestricted ? coachAbilitiesRestrictionNotes || undefined : undefined,
      difficultyCustomSettings: difficultyCustomSettings || undefined,
      coachXpSetting: isCfb ? coachXpSetting : undefined,
      leaguePassword: leaguePassword || undefined,
    };
  }, [
    game, isOnline, crossPlayEnabled, requiredConsole, leagueType, activeRostersEnabled, trackRostersEnabled, name, leaguePassword,
    seasonNumber, seasonStage, currentWeek, skipToStage, skipToStageValue,
    regularSeasonStreamingRequirement, regularSeasonStreamingSide,
    postseasonStreamingRequirement, postseasonStreamingSide,
    gotwStreamingRequirement, gotwStreamingSide,
    fourthDownRuleTypeRegular, customFourthDownRuleRegular,
    fourthDownRuleTypePlayoff, customFourthDownRulePlayoff,
    advanceTiming, advanceTimingOther, injuryPolicy,
    fairSimRequirements, forceWinRequirements,
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
    coreAttributeGroupCap, nonCoreAttributePurchasesSeasonCap,
    contractAdjustmentPurchasesEnabled, contractPurchasesSeasonCap,
    purchaseDeadlines, customRules,
    difficulty, cfbDifficulty, quarterLengthMinutes,
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
    tradeApprovalPolicy, cpuTradingPolicy, cpuTradingRestriction,
    coachAbilitiesRestricted, coachAbilitiesRestrictionNotes,
    difficultyCustomSettings, coachXpSetting,
    isCfb, isMadden, isSeasonOne,
  ]);

  async function createLeague() {
    if (!game || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { name: name.trim(), game, ...collectConfig() };
      const result = await siteApi.createLeague(payload);
      setLeagueId(result.league.id);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the league.");
    } finally {
      setBusy(false);
    }
  }

  async function saveConfigAndAdvance(nextStep: Step) {
    if (!leagueId) return;
    setBusy(true);
    setError(null);
    try {
      await siteApi.updateLeagueConfig(leagueId, collectConfig());
      setStep(nextStep);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  async function loadTeams() {
    if (!leagueId) return;
    try {
      const result = await siteApi.listOpenLeagueTeams(leagueId);
      setTeams(result.teams);
    } catch { /* ignore */ }
  }

  async function finishWizard() {
    if (!leagueId) return;
    setBusy(true);
    setError(null);
    try {
      const teamId = selectedTeamId ?? undefined;
      await siteApi.completeWizard({ leagueId, teamId: teamId || undefined });
      onCreated(leagueId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish setup.");
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <div className="site-modal" role="presentation" onMouseDown={onClose}>
      <section className="site-modal-wide" role="dialog" aria-modal="true" aria-labelledby="create-league-title" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="site-modal-close" onClick={onClose} aria-label="Close">&times;</button>
        <h2 id="create-league-title">Create League</h2>
        {step > 0 && <p className="site-muted">Step {step} of {isFantasyDraft ? "8" : "7"}</p>}
        {error && <p className="site-auth-error">{error}</p>}

        {step === 0 && (
          <div className="wizard-warning">
            <div className="wizard-warning-icon">!</div>
            <h3>Before You Begin</h3>
            <p>It is <strong>highly recommended</strong> that you only create a league for a <strong>new dynasty or franchise</strong>.</p>
            <p>The system can handle jumping into an existing in-game save, but many features — schedule seeding, draft scheduling, roster tracking, and season progression — are built around starting with a fresh franchise or dynasty.</p>
            <p>If you are setting up a league for a save that is already in progress, some settings may need to be configured manually after creation.</p>
            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="site-btn site-btn-primary" onClick={() => setStep(1)}>Create New League</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <>
            <Section title="Game">
              <p className="site-muted">Choose which game this league will use. This cannot be changed later.</p>
              <div className="wizard-game-grid">
                {GAME_OPTIONS.map((option) => (
                  <button key={option.value} type="button"
                    className={`wizard-game-card ${game === option.value ? "wizard-game-card-active" : ""}`}
                    onClick={() => { setGame(option.value); setLeagueType(""); }}>
                    {option.label}
                  </button>
                ))}
              </div>
            </Section>

            {game && (
              <Section title="Online or Offline">
                <p className="site-muted">Offline dynasties/franchises don't show up in league search, but still count toward your league-owner limit.</p>
                <div className="wizard-game-grid">
                  <button type="button" className={`wizard-game-card ${isOnline ? "wizard-game-card-active" : ""}`} onClick={() => setIsOnline(true)}>Online</button>
                  <button type="button" className={`wizard-game-card ${!isOnline ? "wizard-game-card-active" : ""}`} onClick={() => setIsOnline(false)}>Offline</button>
                </div>
              </Section>
            )}

            {game && (
              <Section title="Cross Play">
                <ToggleField label="Allow cross-platform members" hint="Off restricts this league to one console — a console badge shows in league search and requesting a team warns which console is required."
                  checked={crossPlayEnabled} onChange={setCrossPlayEnabled} />
                {!crossPlayEnabled && (
                  <label className="site-field">
                    <span>Console</span>
                    <select className="site-select" value={requiredConsole} onChange={(event) => setRequiredConsole(event.target.value as typeof requiredConsole)}>
                      <option value="ps5">PS5</option>
                      <option value="xbox">Xbox</option>
                      <option value="pc">PC</option>
                    </select>
                  </label>
                )}
              </Section>
            )}

            {isMadden && (
              <Section title="League Type">
                <p className="site-muted">Choose how rosters are populated. This cannot be changed after creation.</p>
                {MADDEN_LEAGUE_TYPES.map((option) => (
                  <label key={option.value} className={`wizard-option-card ${leagueType === option.value ? "wizard-option-card-active" : ""}`}>
                    <input type="radio" name="leagueType" value={option.value} checked={leagueType === option.value}
                      onChange={() => setLeagueType(option.value)} className="sr-only" />
                    <strong>{option.label}</strong>
                    <span className="site-muted">{option.desc}</span>
                  </label>
                ))}
              </Section>
            )}

            {isCfb && (
              <Section title="Roster Setup">
                <p className="site-muted">Choose how rosters are initialized for this dynasty.</p>
                <ToggleField label="Seed active rosters from the current CFB baseline dataset"
                  hint="Recommended — populates all teams with the latest real-world CFB rosters."
                  checked={activeRostersEnabled} onChange={setActiveRostersEnabled} />
                <ToggleField label="Enable roster tracking (recruiting, transfer portal, progression)"
                  hint="Only enable this if your league uses REC's dynasty tracking features. This adds recruiting classes, transfer portal entries, and player progression over seasons."
                  checked={trackRostersEnabled} onChange={setTrackRostersEnabled} />
              </Section>
            )}

            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={() => setStep(0)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={!game || (isMadden && !leagueType)} onClick={() => setStep(2)}>Next</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <Section title="League Name">
              <TextField label="League name" value={name} onChange={setName} placeholder="e.g. REC OG" maxLength={80} />
            </Section>
            <Section title="League Password (Optional)">
              <p className="site-muted">Optional — users never need it to request an open team. If set, the password is stored with your league and shared with a user once you approve their request.</p>
              <TextField label="Password" value={leaguePassword} onChange={setLeaguePassword} placeholder="Optional" />
            </Section>
            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={() => setStep(1)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={!name.trim() || busy} onClick={() => void createLeague()}>
                {busy ? "Creating..." : "Create League"}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <Section title="Season Setup">
              <NumberField label="Season number" hint="Set to 1 for a brand-new dynasty. Only change this if you are importing an existing save that is already past season 1."
                value={seasonNumber} onChange={setSeasonNumber} min={1} max={99} />
              <SelectField label="Season stage" hint={`Current point in the ${gameLabel} season.`}
                value={seasonStage || (isCfb ? "preseason" : "preseason_training_camp")}
                onChange={setSeasonStage}
                options={stages.map((s) => ({ value: s, label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }))} />

              {isMadden && isSeasonOne && (
                <ToggleField label="Skip to a specific week or stage in year 1"
                  hint="Use this if your Madden franchise is already past preseason in-game but you are setting up REC for the first time."
                  checked={skipToStage} onChange={setSkipToStage} />
              )}
              {isMadden && isSeasonOne && skipToStage && (
                <SelectField label="Skip to stage" value={skipToStageValue} onChange={setSkipToStageValue}
                  options={stages.map((s) => ({ value: s, label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }))} />
              )}

              {!isSeasonOne && (
                <div className="wizard-notice wizard-notice-warn">
                  <strong>Season {seasonNumber}</strong> — Since this is not the first season, the schedule will need to be imported manually. REC cannot auto-seed a schedule for seasons past year 1.
                </div>
              )}

              {isCfb && (
                <div className="wizard-notice">
                  <strong>CFB Schedule</strong> — Unlike Madden, CFB has no default schedule to seed. Your schedule must be entered manually or imported via screenshot parsing, even in season 1.
                </div>
              )}

              {isMadden && isSeasonOne && !skipToStage && (
                <div className="wizard-notice">
                  <strong>Madden Schedule</strong> — The default NFL 18-week schedule is automatically seeded for your league, whether or not it's linked to a Discord server.
                </div>
              )}
            </Section>
            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" disabled={busy} onClick={() => setStep(2)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={busy} onClick={() => saveConfigAndAdvance(4)}>Next</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <Section title="Discord Server Link (Optional)">
              {discordLinked === null ? (
                <p className="site-muted">Checking your Discord connection…</p>
              ) : discordLinked ? (
                discordConnectResult ? (
                  <>
                    <p className="site-muted">Finish linking this league to your Discord server:</p>
                    <ol className="site-muted">
                      <li>
                        <a href={discordConnectResult.inviteUrl} target="_blank" rel="noreferrer">Invite the REC bot</a> — the server is already pre-selected, just confirm the permissions.
                      </li>
                      <li>In that server, run <code>/claim-league</code> and paste this token when prompted:</li>
                    </ol>
                    <code className="site-league-card-token">{discordConnectResult.token}</code>
                    <p className="site-muted">Only that server's owner can run /claim-league — anyone else running it will be rejected.</p>
                  </>
                ) : discordGuilds.length > 0 ? (
                  <>
                    <p className="site-muted">Your Discord account is connected — pick a server to invite the REC bot to:</p>
                    <label className="site-field">
                      <span>Server</span>
                      <select className="site-select" value={selectedGuildId} onChange={(e) => setSelectedGuildId(e.target.value)}>
                        {discordGuilds.map((guild) => (
                          <option key={guild.id} value={guild.id}>{guild.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="site-modal-actions">
                      <button type="button" className="site-btn site-btn-ghost" disabled={discordBusy} onClick={() => { setDiscordGuilds([]); setSelectedGuildId(""); }}>
                        Back
                      </button>
                      <button type="button" className="site-btn site-btn-primary" disabled={discordBusy} onClick={() => void connectGuildToLeague()}>
                        {discordBusy ? "Setting things up…" : "Use this server"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="site-muted">Your Discord account is connected. Pick a server to invite the REC bot to.</p>
                    <button type="button" className="site-btn site-btn-primary" disabled={discordBusy} onClick={() => void startDiscordPicker()}>
                      {discordBusy ? "Opening Discord…" : "Connect a Discord Server"}
                    </button>
                  </>
                )
              ) : (
                <p className="site-muted">
                  Linking a Discord server is optional — bot features, streaming announcements, and draft scheduling can all be set up later from League Settings. To connect a server now, link your Discord account first on My Account.
                </p>
              )}
              {discordError && <p className="site-auth-error">{discordError}</p>}
            </Section>
            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" disabled={busy} onClick={() => setStep(3)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={busy} onClick={() => saveConfigAndAdvance(5)}>Continue</button>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <Section title="Streaming Requirements">
              <SelectField label="Regular season streaming" hint="Whether users must stream their regular season games."
                value={regularSeasonStreamingRequirement} onChange={setRegularSeasonStreamingRequirement} options={STREAMING_OPTIONS} />
              {regularSeasonStreamingRequirement !== "disabled" && (
                <SelectField label="Regular season streaming side" hint="Who must stream. 'Required' defaults to Home; 'Recommended' defaults to Either."
                  value={regularSeasonStreamingSide} onChange={setRegularSeasonStreamingSide} options={STREAMING_SIDE_OPTIONS} />
              )}
              <SelectField label="Postseason streaming" hint="Whether users must stream playoff games."
                value={postseasonStreamingRequirement} onChange={setPostseasonStreamingRequirement} options={STREAMING_OPTIONS} />
              {postseasonStreamingRequirement !== "disabled" && (
                <SelectField label="Postseason streaming side" value={postseasonStreamingSide} onChange={setPostseasonStreamingSide} options={STREAMING_SIDE_OPTIONS} />
              )}
              <SelectField label="Game of the Week streaming" hint="Special streaming requirement for featured GOTW matchups."
                value={gotwStreamingRequirement} onChange={setGotwStreamingRequirement} options={STREAMING_OPTIONS} />
              {gotwStreamingRequirement !== "disabled" && (
                <SelectField label="GOTW streaming side" value={gotwStreamingSide} onChange={setGotwStreamingSide} options={STREAMING_SIDE_OPTIONS} />
              )}
            </Section>

            <Section title="4th Down Rules">
              <SelectField label="4th down rule (regular season)" hint="Standard REC: only go for it past midfield on 4th-and-3 or shorter; a team trailing in the second half may go for it at any time."
                value={fourthDownRuleTypeRegular} onChange={setFourthDownRuleTypeRegular} options={FOURTH_DOWN_OPTIONS} />
              {fourthDownRuleTypeRegular === "custom" && (
                <TextareaField label="Custom 4th down rule (regular)" value={customFourthDownRuleRegular} onChange={setCustomFourthDownRuleRegular} placeholder="Describe your custom rule..." />
              )}
              <SelectField label="4th down rule (playoffs)" value={fourthDownRuleTypePlayoff} onChange={setFourthDownRuleTypePlayoff} options={FOURTH_DOWN_OPTIONS} />
              {fourthDownRuleTypePlayoff === "custom" && (
                <TextareaField label="Custom 4th down rule (playoffs)" value={customFourthDownRulePlayoff} onChange={setCustomFourthDownRulePlayoff} placeholder="Describe your custom rule..." />
              )}
            </Section>

            <Section title="Timing &amp; Rules">
              <SelectField label="Advance timing" hint="How long each user has to play their game before the sim advances."
                value={advanceTiming} onChange={setAdvanceTiming} options={ADVANCE_TIMING_OPTIONS} />
              {advanceTiming === "other" && (
                <TextField label="Custom timing" value={advanceTimingOther} onChange={setAdvanceTimingOther} placeholder="e.g. Sunday 8pm ET" />
              )}
              <SelectField label="Injury policy" hint="Controls in-game injury frequency."
                value={injuryPolicy} onChange={setInjuryPolicy} options={INJURY_OPTIONS} />
              <TextareaField label="Fair sim requirements" hint="Rules users must follow when simming (e.g. play caller restrictions, sim speed)."
                value={fairSimRequirements} onChange={setFairSimRequirements} placeholder="Optional" />
              <TextareaField label="Force win requirements" hint="Conditions under which a win may be awarded by admin (e.g. no-show, disconnect)."
                value={forceWinRequirements} onChange={setForceWinRequirements} placeholder="Optional" />
            </Section>

            <Section title="Play Call Limits">
              <ToggleField label="Enable offensive play call limits" hint="Restrict the number of unique plays a user can call on offense per game."
                checked={offensivePlayCallLimitsEnabled} onChange={setOffensivePlayCallLimitsEnabled} />
              {offensivePlayCallLimitsEnabled && (
                <NumberField label="Offensive play call limit" value={offensivePlayCallLimit} onChange={setOffensivePlayCallLimit} min={1} max={50} />
              )}
              <ToggleField label="Enable offensive play call cooldown" hint="After calling a play, it cannot be reused for a set number of plays."
                checked={offensivePlayCallCooldownEnabled} onChange={setOffensivePlayCallCooldownEnabled} />
              {offensivePlayCallCooldownEnabled && (
                <NumberField label="Offensive cooldown (plays)" value={offensivePlayCallCooldown} onChange={setOffensivePlayCallCooldown} min={1} max={50} />
              )}
              <ToggleField label="Enable defensive play call limits" checked={defensivePlayCallLimitsEnabled} onChange={setDefensivePlayCallLimitsEnabled} />
              {defensivePlayCallLimitsEnabled && (
                <NumberField label="Defensive play call limit" value={defensivePlayCallLimit} onChange={setDefensivePlayCallLimit} min={1} max={50} />
              )}
              <ToggleField label="Enable defensive play call cooldown" checked={defensivePlayCallCooldownEnabled} onChange={setDefensivePlayCallCooldownEnabled} />
              {defensivePlayCallCooldownEnabled && (
                <NumberField label="Defensive cooldown (plays)" value={defensivePlayCallCooldown} onChange={setDefensivePlayCallCooldown} min={1} max={50} />
              )}
            </Section>

            <Section title="Coaching Rules">
              <ToggleField label="Custom coaches required" hint="When enabled, each user must create their own custom coach rather than using the real-life coach assigned to their team."
                checked={customCoachesRequired} onChange={setCustomCoachesRequired} />
              <ToggleField label="Custom playbooks allowed" hint="When enabled, users can use custom-created playbooks. When disabled, users are restricted to the official in-game playbooks only."
                checked={customPlaybooksAllowed} onChange={setCustomPlaybooksAllowed} />
            </Section>

            <Section title="Economy">
              <ToggleField label="Enable coin economy" hint="Master switch — turning this on enables a points-based economy where users spend coins on custom players, legends, dev upgrades, and more."
                checked={coinEconomyEnabled} onChange={setCoinEconomyEnabled} />
              {coinEconomyEnabled && (
                <>
                  <ToggleField label="Custom players" hint="Allow users to spend coins to create custom players for their roster."
                    checked={customPlayersEnabled} onChange={setCustomPlayersEnabled} />
                  {customPlayersEnabled && (
                    <NumberField label="Custom players season cap" hint="Max custom players per team per season." value={customPlayersSeasonCap} onChange={setCustomPlayersSeasonCap} min={0} max={5} />
                  )}
                  <ToggleField label="Legends" hint="Allow users to spend coins to add retired legend players."
                    checked={legendsEnabled} onChange={setLegendsEnabled} />
                  {legendsEnabled && (
                    <NumberField label="Legends season cap" hint="Max legends per team per season." value={legendsSeasonCap} onChange={setLegendsSeasonCap} min={0} max={5} />
                  )}
                  <ToggleField label="Dev upgrades" hint="Allow users to spend coins to upgrade a player's development trait (e.g. Normal to Star, Star to Superstar)."
                    checked={devUpgradesEnabled} onChange={setDevUpgradesEnabled} />
                  {devUpgradesEnabled && (
                    <>
                      <SelectField label="Dev upgrade cap type" hint="How dev upgrades are limited."
                        value={devUpgradeCapMode} onChange={setDevUpgradeCapMode}
                        options={[{ value: "total_purchases", label: "Limit total upgrade purchases per team" }, { value: "players_per_season", label: "Limit number of players who can be upgraded" }]} />
                      {devUpgradeCapMode === "total_purchases" && (
                        <NumberField label="Dev upgrades season cap (total purchases)" value={devUpgradesSeasonCap} onChange={setDevUpgradesSeasonCap} min={0} max={20} />
                      )}
                      {devUpgradeCapMode === "players_per_season" && (
                        <NumberField label="Dev upgrades player cap (distinct players per team)" value={devUpgradesPlayerCap} onChange={setDevUpgradesPlayerCap} min={0} max={20} />
                      )}
                    </>
                  )}
                  <ToggleField label="Attribute purchases" hint="Allow users to spend coins to boost individual player attributes (e.g. +1 Speed, +1 Throw Power)."
                    checked={attributePurchasesEnabled} onChange={setAttributePurchasesEnabled} />
                  {attributePurchasesEnabled && (
                    <>
                      <NumberField label="Core attribute default cap (points per attribute)" hint="Max points a user can spend on a single core attribute per season. 0 = unlimited."
                        value={coreAttributePurchasesSeasonCap} onChange={setCoreAttributePurchasesSeasonCap} min={0} max={99} />
                      <NumberField label="Core attribute group cap (total across all core)" hint="Total points usable across all core attributes combined. 0 = unlimited."
                        value={coreAttributeGroupCap} onChange={setCoreAttributeGroupCap} min={0} max={99} />
                      <NumberField label="Non-core attribute group cap (total across all non-core)" hint="Total points usable across all non-core attributes combined. 0 = unlimited."
                        value={nonCoreAttributePurchasesSeasonCap} onChange={setNonCoreAttributePurchasesSeasonCap} min={0} max={99} />
                    </>
                  )}
                  {isMadden && (
                    <>
                      <ToggleField label="Contract adjustment purchases" hint="Allow users to spend coins to restructure or adjust player contracts."
                        checked={contractAdjustmentPurchasesEnabled} onChange={setContractAdjustmentPurchasesEnabled} />
                      {contractAdjustmentPurchasesEnabled && (
                        <NumberField label="Contract adjustment season cap" value={contractPurchasesSeasonCap} onChange={setContractPurchasesSeasonCap} min={0} max={5} />
                      )}
                      <ToggleField label="Age resets" hint="Allow users to spend coins to reset a player's age, extending their career."
                        checked={ageResetsEnabled} onChange={setAgeResetsEnabled} />
                      {ageResetsEnabled && (
                        <NumberField label="Age resets season cap" value={ageResetsSeasonCap} onChange={setAgeResetsSeasonCap} min={0} max={5} />
                      )}
                    </>
                  )}
                </>
              )}
            </Section>

            <Section title="Custom Rules">
              <p className="site-muted">Define league rules that users will see when reviewing league info. Rules are organized by category and displayed in order.</p>
              {customRules.length > 0 && (
                <div className="wizard-rules-list">
                  {customRules.map((rule, idx) => (
                    <div key={rule.id} className="wizard-rule-item">
                      <div className="wizard-rule-header">
                        <span className="wizard-rule-number">{idx + 1}.</span>
                        <input className="site-input site-input-sm" value={rule.category} placeholder="Category"
                          onChange={(e) => editRule(rule.id, "category", e.target.value)} />
                        <input className="site-input site-input-sm" value={rule.title} placeholder="Title"
                          onChange={(e) => editRule(rule.id, "title", e.target.value)} />
                        <div className="wizard-rule-actions">
                          <button type="button" className="site-btn site-btn-ghost site-btn-sm" disabled={idx === 0} onClick={() => moveRule(rule.id, -1)}>&uarr;</button>
                          <button type="button" className="site-btn site-btn-ghost site-btn-sm" disabled={idx === customRules.length - 1} onClick={() => moveRule(rule.id, 1)}>&darr;</button>
                          <button type="button" className="site-btn site-btn-ghost site-btn-sm site-btn-danger" onClick={() => removeRule(rule.id)}>Remove</button>
                        </div>
                      </div>
                      <textarea className="site-input" rows={2} value={rule.text} placeholder="Rule details"
                        onChange={(e) => editRule(rule.id, "text", e.target.value)} />
                      <div className="wizard-rule-meta">
                        <span>Created: {new Date(rule.createdAt).toLocaleString()}</span>
                        {rule.updatedAt !== rule.createdAt && <span>Edited: {new Date(rule.updatedAt).toLocaleString()}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="wizard-rule-add">
                <div className="wizard-rule-add-row">
                  <div style={{ position: "relative" }}>
                    <input className="site-input" placeholder="Category" value={newRuleCategory}
                      onChange={(e) => setNewRuleCategory(e.target.value)} />
                    {newRuleCategory && filteredExistingCategories.length > 0 && (
                      <div className="wizard-autocomplete">
                        {filteredExistingCategories.map((cat) => (
                          <button key={cat} type="button" className="wizard-autocomplete-item"
                            onClick={() => { setNewRuleCategory(cat); }}>
                            {cat}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input className="site-input" placeholder="Rule title" value={newRuleTitle}
                    onChange={(e) => setNewRuleTitle(e.target.value)} />
                </div>
                <textarea className="site-input" rows={2} placeholder="Rule details" value={newRuleText}
                  onChange={(e) => setNewRuleText(e.target.value)} />
                <button type="button" className="site-btn site-btn-secondary"
                  disabled={!newRuleCategory.trim() || !newRuleTitle.trim() || !newRuleText.trim()}
                  onClick={addRule}>Add Rule</button>
              </div>
            </Section>

            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={() => setStep(4)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={busy} onClick={() => saveConfigAndAdvance(6)}>
                {busy ? "Saving..." : "Next"}
              </button>
            </div>
          </>
        )}

        {step === 6 && (
          <>
            {isMadden && (
              <>
                <Section title="Difficulty &amp; Gameplay">
                  <SelectField label="Difficulty" value={difficulty} onChange={setDifficulty} options={MADDEN_DIFFICULTY} />
                  <TextareaField label="Custom difficulty settings" hint="Advanced slider overrides (paste from Madden if needed)." value={difficultyCustomSettings} onChange={setDifficultyCustomSettings} placeholder="Optional" />
                  <NumberField label="Quarter length (minutes)" value={quarterLengthMinutes} onChange={setQuarterLengthMinutes} min={1} max={15} />
                  <ToggleField label="Accelerated clock" checked={acceleratedClockEnabled} onChange={setAcceleratedClockEnabled} />
                  {acceleratedClockEnabled && (
                    <NumberField label="Minimum play clock (seconds)" value={acceleratedClockMinimumSeconds} onChange={setAcceleratedClockMinimumSeconds} min={0} max={40} />
                  )}
                  <ToggleField label="Abilities enabled" hint="Show X-Factor and Superstar abilities in-game." checked={abilitiesEnabled} onChange={setAbilitiesEnabled} />
                  <ToggleField label="Wear and tear" hint="Enable the wear-and-tear injury system." checked={wearAndTearEnabled} onChange={setWearAndTearEnabled} />
                </Section>

                <Section title="Salary Cap &amp; Trades">
                  <ToggleField label="Salary cap enabled" hint="Enforce the NFL salary cap in-game." checked={salaryCapEnabled} onChange={setSalaryCapEnabled} />
                  <ToggleField label="Trade deadline enabled" hint="Lock trades after the NFL trade deadline passes." checked={tradeDeadlineEnabled} onChange={setTradeDeadlineEnabled} />
                  <SelectField label="Trade approval policy" hint="Controls whether user trades are immediate or must be approved."
                    value={tradeApprovalPolicy} onChange={setTradeApprovalPolicy} options={TRADE_APPROVAL_OPTIONS} />
                  <SelectField label="CPU trading policy" hint="Controls whether users may trade with CPU-controlled teams."
                    value={cpuTradingPolicy} onChange={setCpuTradingPolicy} options={CPU_TRADING_OPTIONS} />
                  {cpuTradingPolicy === "restricted" && (
                    <TextareaField label="CPU trading restriction details" value={cpuTradingRestriction} onChange={setCpuTradingRestriction} placeholder="Describe the restriction..." />
                  )}
                </Section>

                <Section title="Coaching &amp; Position Rules">
                  <SelectField label="Coach firing policy" value={coachFiringPolicy} onChange={setCoachFiringPolicy} options={COACH_FIRING_OPTIONS} />
                  <ToggleField label="Preorder bonuses enabled" hint="Allow preorder bonus content (e.g. extra XP, trait unlocks)." checked={preorderBonusesEnabled} onChange={setPreorderBonusesEnabled} />
                  <SelectField label="Position change policy" hint="How strictly position changes are regulated."
                    value={positionChangePolicy} onChange={setPositionChangePolicy} options={POSITION_CHANGE_OPTIONS} />
                  {positionChangePolicy !== "open" && (
                    <TextareaField label="Position change policy details" value={positionChangePolicyDescription} onChange={setPositionChangePolicyDescription}
                      placeholder="Describe allowed position changes..." />
                  )}
                  <ToggleField label="Coach abilities restricted" hint="Limit which coach abilities users can assign." checked={coachAbilitiesRestricted} onChange={setCoachAbilitiesRestricted} />
                  {coachAbilitiesRestricted && (
                    <TextareaField label="Coach abilities restriction notes" value={coachAbilitiesRestrictionNotes} onChange={setCoachAbilitiesRestrictionNotes} placeholder="Describe restrictions..." />
                  )}
                </Section>
              </>
            )}

            {isCfb && (
              <>
                <Section title="Difficulty &amp; Gameplay">
                  <SelectField label="Difficulty" value={cfbDifficulty} onChange={setCfbDifficulty} options={CFB_DIFFICULTY} />
                  <TextareaField label="Custom difficulty settings" value={difficultyCustomSettings} onChange={setDifficultyCustomSettings} placeholder="Optional" />
                  <NumberField label="Quarter length (minutes)" value={quarterLengthMinutes} onChange={setQuarterLengthMinutes} min={1} max={15} />
                  <ToggleField label="Accelerated clock" checked={acceleratedClockEnabled} onChange={setAcceleratedClockEnabled} />
                  {acceleratedClockEnabled && (
                    <NumberField label="Minimum play clock (seconds)" value={acceleratedClockMinimumSeconds} onChange={setAcceleratedClockMinimumSeconds} min={0} max={40} />
                  )}
                  <ToggleField label="Abilities enabled" checked={abilitiesEnabled} onChange={setAbilitiesEnabled} />
                  <ToggleField label="Wear and tear" checked={wearAndTearEnabled} onChange={setWearAndTearEnabled} />
                  <SelectField label="Coach XP setting" value={coachXpSetting} onChange={setCoachXpSetting}
                    options={[{ value: "casual", label: "Casual" }, { value: "career", label: "Career" }, { value: "simulation", label: "Simulation" }]} />
                  <SelectField label="Player edit permission" hint="Informational only — who is expected to edit player info/ratings in-game."
                    value={playerEditPermission} onChange={setPlayerEditPermission} options={PLAYER_EDIT_PERMISSION_OPTIONS} />
                  <NumberField label="Manual XP progression penalty (%)" hint="Coin/points penalty applied when progression is done manually instead of automatically."
                    value={manualXpProgressionPenaltyPct} onChange={setManualXpProgressionPenaltyPct} min={0} max={100} />
                  <NumberField label="Verbal commit influence (%)" hint="How much a verbal commitment influences a recruit's final decision."
                    value={verbalCommitInfluencePct} onChange={setVerbalCommitInfluencePct} min={0} max={100} />
                  <SelectField label="Season experience" hint="How much manual control users have over season-to-season decisions."
                    value={seasonExperience} onChange={setSeasonExperience} options={SEASON_EXPERIENCE_OPTIONS} />
                </Section>

                <Section title="Dynasty / Recruiting">
                  <SelectField label="Dynasty type" hint="Whether teams use real-world rosters or allow Team Builder imports."
                    value={dynastyType} onChange={setDynastyType} options={CFB_DYNASTY_TYPE} />
                  <SelectField label="Recruiting difficulty" hint="Controls how competitive recruiting is. Hard means top recruits are much harder to land."
                    value={recruitingDifficulty} onChange={setRecruitingDifficulty} options={CFB_RECRUITING_DIFFICULTY} />
                  <NumberField label="Transfer portal — max transfers per team" hint="0 turns the transfer portal off. Max 30."
                    value={transferPortalMaxPerTeam} onChange={setTransferPortalMaxPerTeam} min={0} max={30} />
                  <NumberField label="User player transfer chance (%)" value={userTransferChancePct} onChange={setUserTransferChancePct} min={0} max={100} />
                  <NumberField label="CPU player transfer chance (%)" value={cpuTransferChancePct} onChange={setCpuTransferChancePct} min={0} max={100} />
                  <ToggleField label="Coach carousel enabled" hint="Allow coaches to move between schools during the coaching carousel phase." checked={coachCarouselEnabled} onChange={setCoachCarouselEnabled} />
                  <ToggleField label="Home-field advantage enabled" hint="Grant gameplay bonuses to the home team." checked={homeFieldAdvantageEnabled} onChange={setHomeFieldAdvantageEnabled} />
                  <ToggleField label="Stadium pulse enabled" hint="Enable the crowd noise/stadium pulse mechanic." checked={stadiumPulseEnabled} onChange={setStadiumPulseEnabled} />
                  <NumberField label="Minimum play clock (seconds)" hint="10-25 seconds." value={minimumPlayClockSeconds} onChange={setMinimumPlayClockSeconds} min={10} max={25} />
                  <SelectField label="Conference realignment" hint="Whether commissioners can move teams between conferences."
                    value={conferenceRealignment} onChange={setConferenceRealignment} options={CFB_CONFERENCE_REALIGNMENT} />
                  <ToggleField label="Team Builder allowed" hint="Allow imported Team Builder teams in the dynasty." checked={teamBuilderAllowed} onChange={setTeamBuilderAllowed} />
                </Section>

                {conferenceRealignment === "allowed" && (
                  <Section title="Individual Conference Rules">
                    <ToggleField label="Customize individual conference rules?" checked={conferenceRulesEditing} onChange={(value) => { setConferenceRulesEditing(value); if (!value) setActiveConferenceForRules(""); }} />
                    {conferenceRulesEditing && (
                      <>
                        <label className="site-field">
                          <span>Conference</span>
                          <select className="site-select" value={activeConferenceForRules} onChange={(event) => setActiveConferenceForRules(event.target.value)}>
                            <option value="">Select a conference to customize</option>
                            {CONFERENCE_ORDER.map((conf) => (
                              <option key={conf} value={conf}>{conf}{conferenceRules[conf] ? " (customized)" : ""}</option>
                            ))}
                          </select>
                        </label>
                        {activeConferenceForRules && (() => {
                          const draft = conferenceRuleDraft(activeConferenceForRules);
                          return (
                            <div className="wizard-conference-rule-panel">
                              <ToggleField label="Divisions" checked={draft.divisionsEnabled} onChange={(value) => updateConferenceRule(activeConferenceForRules, { divisionsEnabled: value })} />
                              {draft.divisionsEnabled && (
                                <>
                                  <TextField label="Division 1 name" value={draft.division1Name} onChange={(value) => updateConferenceRule(activeConferenceForRules, { division1Name: value })} maxLength={40} />
                                  <TextField label="Division 2 name" value={draft.division2Name} onChange={(value) => updateConferenceRule(activeConferenceForRules, { division2Name: value })} maxLength={40} />
                                </>
                              )}
                              <NumberField label="Number of conference games" value={draft.conferenceGames} onChange={(value) => updateConferenceRule(activeConferenceForRules, { conferenceGames: value })} min={6} max={9} />
                              <ToggleField label="Conference championship game" checked={draft.confChampGameEnabled} onChange={(value) => updateConferenceRule(activeConferenceForRules, { confChampGameEnabled: value })} />
                              {draft.confChampGameEnabled && (
                                <>
                                  <SelectField label="Championship game location" value={draft.champGameLocation} onChange={(value) => updateConferenceRule(activeConferenceForRules, { champGameLocation: value })} options={CHAMP_GAME_LOCATION_OPTIONS} />
                                  <SelectField label="Championship game selection criteria" value={draft.champGameSelectionCriteria} onChange={(value) => updateConferenceRule(activeConferenceForRules, { champGameSelectionCriteria: value })} options={CHAMP_GAME_CRITERIA_OPTIONS} />
                                </>
                              )}
                              <ToggleField label="Protected opponents" checked={draft.protectedOpponentsEnabled} onChange={(value) => updateConferenceRule(activeConferenceForRules, { protectedOpponentsEnabled: value })} />
                              {draft.protectedOpponentsEnabled && (
                                <NumberField label="Number of protected opponents" value={draft.protectedOpponentsCount} onChange={(value) => updateConferenceRule(activeConferenceForRules, { protectedOpponentsCount: value })} min={1} max={10} />
                              )}
                              <div className="site-modal-actions">
                                <button type="button" className="site-btn site-btn-secondary" onClick={() => setActiveConferenceForRules("")}>Done with {activeConferenceForRules}</button>
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </Section>
                )}
              </>
            )}

            <Section title="Coach Mode">
              <ToggleField label="Coach mode enabled" hint="When enabled, users call plays from the sideline instead of directly controlling the team."
                checked={coachModeEnabled} onChange={setCoachModeEnabled} />
              {coachModeEnabled && (
                <>
                  <ToggleField label="Auto-pass" hint="QB automatically throws to open receivers." checked={coachModeAutoPassEnabled} onChange={setCoachModeAutoPassEnabled} />
                  <ToggleField label="Auto-snap" hint="Center automatically snaps the ball on the play clock." checked={coachModeAutoSnapEnabled} onChange={setCoachModeAutoSnapEnabled} />
                  <ToggleField label="Coach suggestions" hint="Show the coach's recommended play on the play call screen." checked={coachModeCoachSuggestionsEnabled} onChange={setCoachModeCoachSuggestionsEnabled} />
                  {isCfb && (
                    <>
                      <ToggleField label="Recruit flipping" hint="Allow coaches to flip recruit commitments during recruiting." checked={coachModeRecruitFlippingEnabled} onChange={setCoachModeRecruitFlippingEnabled} />
                      <ToggleField label="Auto-recruiting" hint="Let the CPU handle recruiting tasks automatically." checked={coachModeAutoRecruitingEnabled} onChange={setCoachModeAutoRecruitingEnabled} />
                      <ToggleField label="Auto-progress players" hint="Automatically advance player development each season." checked={coachModeAutoProgressPlayersEnabled} onChange={setCoachModeAutoProgressPlayersEnabled} />
                      <ToggleField label="User auto-progression" hint="Allow users to manually trigger player progression." checked={coachModeUserAutoProgressionEnabled} onChange={setCoachModeUserAutoProgressionEnabled} />
                      <ToggleField label="CPU manages budget" hint="Let the CPU handle recruiting budget allocation." checked={coachModeCpuManageBudgetEnabled} onChange={setCoachModeCpuManageBudgetEnabled} />
                      <ToggleField label="CPU manages staff" hint="Let the CPU handle coaching staff hiring." checked={coachModeCpuManageStaffEnabled} onChange={setCoachModeCpuManageStaffEnabled} />
                      <ToggleField label="CPU manages facilities" hint="Let the CPU handle facility upgrades." checked={coachModeCpuManageFacilitiesEnabled} onChange={setCoachModeCpuManageFacilitiesEnabled} />
                    </>
                  )}
                </>
              )}
            </Section>

            <Section title="Ball Hawk / Heat Seeker / Switch Assist">
              <SelectField label="Ball Hawk" hint="Assists user in intercepting passes." value={ballHawk} onChange={setBallHawk} options={BALL_HAWK_OPTIONS} />
              <SelectField label="Heat Seeker" hint="Assists user in tackling ball carriers." value={heatSeeker} onChange={setHeatSeeker} options={BALL_HAWK_OPTIONS} />
              <SelectField label="Switch Assist" hint="Automatically switches to the best defender near the ball." value={switchAssist} onChange={setSwitchAssist} options={BALL_HAWK_OPTIONS} />
            </Section>

            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={() => saveConfigAndAdvance(5)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={busy} onClick={() => { void loadTeams(); setStep(7); }}>
                {busy ? "Saving..." : "Next"}
              </button>
            </div>
          </>
        )}

        {step === 7 && (
          <>
            <Section title="Team Assignment">
              <p className="site-muted">Pick your team from the available teams in this league. You will be assigned as the head commissioner for this team.</p>
              {teams.length === 0 ? (
                <p className="site-muted">Loading available teams...</p>
              ) : (
                <div className="wizard-team-grid">
                  {teams.map((team) => (
                    <button key={team.id} type="button"
                      className={`wizard-team-card ${selectedTeamId === team.id ? "wizard-team-card-active" : ""}`}
                      onClick={() => setSelectedTeamId(team.id)}>
                      <strong>{team.name}</strong>
                      {team.mascot && <span className="site-muted">{team.mascot}</span>}
                      {team.abbreviation && <span className="site-muted">{team.abbreviation}</span>}
                    </button>
                  ))}
                </div>
              )}
            </Section>
            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" disabled={busy} onClick={() => setStep(6)}>Back</button>
              <button type="button" className="site-btn site-btn-ghost" disabled={busy} onClick={finishWizard}>Skip for Now</button>
              <button type="button" className="site-btn site-btn-primary" disabled={busy || !selectedTeamId} onClick={finishWizard}>
                {busy ? "Finishing..." : "Assign Team &amp; Finish"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
