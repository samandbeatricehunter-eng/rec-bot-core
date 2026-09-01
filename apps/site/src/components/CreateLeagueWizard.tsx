import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  CONFERENCE_ORDER, FAIR_SIM_RULE_OPTIONS, FORCE_WIN_RULE_OPTIONS, MADDEN_ATTRIBUTE_BY_CODE, MADDEN_ATTRIBUTE_DEFINITIONS,
  NFL_TEAMS,
  type MaddenAttributeCode,
} from "@rec/shared";
import { siteApi } from "../lib/site-api.js";
import { useAuth } from "../lib/auth-context.js";
import {
  CFB_LEAGUE_TEMPLATES,
  describeTemplateSettings,
  getLeagueTemplatePreset,
  MADDEN_LEAGUE_TEMPLATES,
} from "../lib/league-templates.js";
import {
  CheckboxGroupField, CoreAttributePicker, CounterField, NumberField, Section, SelectField,
  TextField, TextareaField, ToggleField,
} from "./wizard/fields.js";
import {
  ADVANCE_TIMING_OPTIONS, BALL_HAWK_OPTIONS, CFB_CONFERENCE_REALIGNMENT, CFB_DIFFICULTY,
  CFB_DYNASTY_TYPE, CFB_RECRUITING_DIFFICULTY,
  CHAMP_GAME_CRITERIA_OPTIONS, CHAMP_GAME_LOCATION_OPTIONS, COACH_FIRING_OPTIONS,
  CPU_TRADING_OPTIONS, FA_MOTIVATION_IMPACT_OPTIONS, FOURTH_DOWN_OPTIONS, GAME_OPTIONS,
  IMMORTALITY_DEFENSE_POSITIONS, IMMORTALITY_OFFENSE_POSITIONS,
  INJURY_OPTIONS, MADDEN_DIFFICULTY, MADDEN_LEAGUE_TYPES,
  PLAYER_EDIT_PERMISSION_OPTIONS, POSITION_CHANGE_OPTIONS, SEASON_EXPERIENCE_OPTIONS,
  STREAMING_OPTIONS, STREAMING_SIDE_OPTIONS, TRADE_APPROVAL_OPTIONS, TRADE_DIFFICULTY_OPTIONS,
} from "./wizard/options.js";
import { useLeagueWizardState } from "./wizard/useLeagueWizardState.js";

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export function CreateLeagueWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (leagueId: string) => void }) {
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
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
  } = useLeagueWizardState();

  const isRise = leagueType === "rise_to_immortality" || templateId === "rise_to_immortality";

  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const [inviteFriends, setInviteFriends] = useState<Array<{ userId: string; username: string; displayName: string }>>([]);
  const [sentInvites, setSentInvites] = useState<Array<{ inviteId: string; status: string; invitee: { userId: string; username: string; displayName: string } }>>([]);
  const [inviteSearchQuery, setInviteSearchQuery] = useState("");
  const [inviteSearchResults, setInviteSearchResults] = useState<Array<{ userId: string; username: string; displayName: string }>>([]);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    if (step !== 9 || !leagueId) return;
    let cancelled = false;
    Promise.all([
      siteApi.listFriends(),
      siteApi.listLeagueInvites(leagueId),
    ])
      .then(([friends, invites]) => {
        if (cancelled) return;
        setInviteFriends(friends.accepted.map((f) => f.peer));
        setSentInvites(invites.invites.map((i) => ({
          inviteId: i.inviteId,
          status: i.status,
          invitee: i.invitee,
        })));
      })
      .catch((err) => {
        if (!cancelled) setInviteError(err instanceof Error ? err.message : "Could not load friends.");
      });
    return () => { cancelled = true; };
  }, [step, leagueId]);

  useEffect(() => {
    if (step !== 9) return;
    const q = inviteSearchQuery.trim();
    if (!q) {
      setInviteSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      siteApi.searchInviteTargets({ query: q, limit: 8 })
        .then((result) => { if (!cancelled) setInviteSearchResults(result.users); })
        .catch(() => { if (!cancelled) setInviteSearchResults([]); });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [step, inviteSearchQuery]);

  const alreadyInvitedIds = useMemo(() => new Set(sentInvites.map((i) => i.invitee.userId)), [sentInvites]);

  async function sendInvite(target: { userId: string; username: string; displayName: string }) {
    if (!leagueId || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    try {
      const result = await siteApi.sendLeagueInvite({
        leagueId,
        userId: target.userId,
        message: inviteMessage.trim() || undefined,
      });
      setSentInvites((current) => [
        { inviteId: result.inviteId, status: result.status, invitee: target },
        ...current,
      ]);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not send the invite.");
    } finally {
      setInviteBusy(false);
    }
  }

  const auth = useAuth();

  const [discordLinked, setDiscordLinked] = useState<boolean | null>(null);
  const [discordGuilds, setDiscordGuilds] = useState<Array<{ id: string; name: string; icon: string | null }>>([]);
  const [discordProviderToken, setDiscordProviderToken] = useState<string | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState("");
  const [discordBusy, setDiscordBusy] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [discordConnectResult, setDiscordConnectResult] = useState<{ serverName: string; inviteUrl: string } | null>(null);
  const [postInviteBusy, setPostInviteBusy] = useState(false);
  const [postInviteResult, setPostInviteResult] = useState<{ botJoined: boolean; nicknameSet: boolean; channels: Array<{ key: string; label: string; configured: boolean; maddenOnly: boolean }> } | null>(null);
  const [postInviteError, setPostInviteError] = useState<string | null>(null);

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
          setDiscordProviderToken(event.data.providerToken);
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
    if (!leagueId || !selectedGuildId || !discordProviderToken) return;
    setDiscordBusy(true);
    setDiscordError(null);
    try {
      const guild = discordGuilds.find((g) => g.id === selectedGuildId);
      const [linked, invite] = await Promise.all([
        siteApi.linkLeagueServer({
          leagueId,
          providerToken: discordProviderToken,
          guildId: selectedGuildId,
          serverName: guild?.name,
        }),
        siteApi.getBotInviteUrl(selectedGuildId),
      ]);
      setDiscordConnectResult({
        serverName: linked.server?.name ?? guild?.name ?? selectedGuildId,
        inviteUrl: invite.inviteUrl,
      });
      setDiscordBusy(false);
    } catch (err) {
      setDiscordBusy(false);
      setDiscordError(err instanceof Error ? err.message : "Failed to connect the Discord server.");
    }
  }

  async function confirmBotJoined() {
    if (!leagueId) return;
    setPostInviteBusy(true);
    setPostInviteError(null);
    try {
      const result = await siteApi.completeDiscordPostInviteSetup(leagueId);
      setPostInviteResult(result);
      if (!result.botJoined) setPostInviteError("The bot hasn't joined that server yet — click \"Invite the REC bot\" above, complete the Discord authorization, then check again.");
    } catch (err) {
      setPostInviteError(err instanceof Error ? err.message : "Failed to check Discord setup.");
    } finally {
      setPostInviteBusy(false);
    }
  }

  function advance(nextStep: Step) {
    setStep(nextStep);
  }

  // The league row is NOT created until the final step — the whole wizard's config lives in
  // component state (collectConfig) and is sent in one shot at the end, so abandoning the
  // wizard at any earlier step leaves nothing behind in the database.
  async function finishWizard() {
    if (!game || !name.trim() || !selectedTeamId) {
      setError("Choose your team before creating the league.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let createdId = leagueId;
      if (!createdId) {
        const payload = isRise
          ? { name: name.trim(), game, templateId: templateId ?? undefined, ...collectConfig() }
          : { name: name.trim(), game, templateId: templateId ?? undefined, initialTeamAbbreviation: selectedTeamId, ...collectConfig() };
        const result = await siteApi.createLeague(payload);
        createdId = result.league.id;
        setLeagueId(createdId);
      }
      if (leagueLogoFile && createdId) {
        await siteApi.uploadLeagueLogo(createdId, leagueLogoFile);
        setLeagueLogoFile(null);
      }
      if (createdId) {
        const uploads = Object.entries(immortalityTeamLogoFiles).flatMap(([slot, files]) =>
          Object.entries(files).flatMap(([kind, file]) => file
            ? [siteApi.uploadLeagueTeamIdentityLogo(createdId!, slot, kind as "primary" | "secondary" | "wordmark", file)]
            : []));
        await Promise.all(uploads);
        if (uploads.length) setImmortalityTeamLogoFiles({});
      }
      // Uses createdId (this call's freshly-created league, if any), not the leagueId state
      // variable -- setLeagueId above won't be visible on this closure until the next render,
      // so checking leagueId here would skip team assignment entirely on the very first click.
      if (selectedTeamId && createdId) {
        const open = await siteApi.listOpenLeagueTeams(createdId);
        const team = open.teams.find((t) => t.abbreviation === selectedTeamId);
        if (!team) throw new Error("That team is no longer available in this league. Try assigning a team again.");
        await siteApi.completeWizard({ leagueId: createdId, teamId: team.id });
      }
      setStep(8);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the league.");
    } finally {
      setBusy(false);
    }
  }

  // Any way of dismissing the wizard (backdrop click, the × button, "Cancel") must still tell
  // the caller a league was created if one actually was — onCreated is what refreshes the site
  // nav/sidebar's league list, and it was only ever wired to the step-8 "Done" button. A user
  // who clicks × or clicks away after seeing the success screen (the intuitive way to dismiss
  // a "you're done" modal) got a created league that didn't show up until a manual page refresh.
  function dismiss() {
    if (leagueId) onCreated(leagueId);
    else onClose();
  }

  function leaveWizard() {
    if (!leagueId) return;
    if (slidersAdjusted) {
      window.location.assign(`/l/${leagueId}/mgmt/settings?category=gameplay&configureSliders=1`);
      return;
    }
    onCreated(leagueId);
  }

  return createPortal(
    <div className="site-modal site-modal-wizard" role="presentation" onMouseDown={dismiss}>
      <section
        className={`site-modal-wide site-modal-wizard-panel ${step === 0 ? "site-modal-wizard-panel-compact" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-league-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="site-modal-close" onClick={dismiss} aria-label="Close">&times;</button>
        <header className="site-modal-wizard-header">
          <h2 id="create-league-title">Create League</h2>
          {step > 0 && step < 8 && <p className="site-muted">Step {step} of 7</p>}
          {error && <p className="site-auth-error">{error}</p>}
        </header>
        <div className="site-modal-wizard-body">

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
              <p className="site-muted">Choose the game first so REC can offer only compatible templates and settings.</p>
              <div className="wizard-game-grid">
                {GAME_OPTIONS.map((option) => (
                  <button key={option.value} type="button"
                    className={`wizard-game-card ${game === option.value ? "wizard-game-card-active" : ""}`}
                    onClick={() => {
                      setGame(option.value);
                      setTemplateId("rec_recommended");
                      const preset = getLeagueTemplatePreset(option.value, "rec_recommended");
                      if (preset) applyTemplate(preset);
                      setCoachModeEnabled(false);
                      if (option.value !== "madden_27" && leagueType === "rise_to_immortality") {
                        setLeagueType("");
                      }
                    }}>{option.label}</button>
                ))}
              </div>
            </Section>
            {(game === "madden_27" || game === "cfb_27") && (
              <Section title="Coach Mode">
                <ToggleField label="Is this a Coach Mode-only league?" hint="Coach Mode leagues are identified in league search and league advertisements."
                  checked={coachModeEnabled} onChange={setCoachModeEnabled} />
              </Section>
            )}
            {game && <>
            <Section title="Start From a Template">
              <p className="site-muted">
                Templates prefill the league's rules, difficulty, streaming, and economy settings. You can still
                change anything after picking one — or start blank and set everything yourself. Every card below
                reflects the selected game's actual defaults; incompatible templates are not offered.
              </p>
              <div className="wizard-template-grid">
                {(isCfb ? CFB_LEAGUE_TEMPLATES : MADDEN_LEAGUE_TEMPLATES).map((template) => {
                  const preset = getLeagueTemplatePreset(game, template.id);
                  if (!preset) return null;
                  const settingsGroups = describeTemplateSettings(preset, isCfb ? "cfb" : "madden");
                  const selected = templateId === template.id;
                  return (
                    <div key={template.id}
                      role="button" tabIndex={0}
                      className={`wizard-template-card ${templateId === template.id ? "wizard-template-card-active" : ""}`}
                      onClick={() => handleTemplateSelect(template.id)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleTemplateSelect(template.id); } }}>
                      <div className="wizard-template-card-select">
                        <strong>{template.name}</strong>
                        {selected && <><span className="site-muted wizard-template-tagline">{template.tagline}</span>
                        <span className="site-muted wizard-template-desc">{template.description}</span></>}
                      </div>
                      {selected && <details className="wizard-template-settings" open onClick={(event) => event.stopPropagation()}>
                        <summary>View settings</summary>
                        <div className="wizard-template-settings-groups">
                          {settingsGroups.map((group) => (
                            <div key={group.key} className="wizard-template-settings-group">
                              <strong>{group.label}</strong>
                              <p className="site-muted wizard-template-settings-blurb">{group.blurb}</p>
                              <dl className="wizard-template-settings-list">
                                {group.rows.map((row) => (
                                  <div key={row.label} className="wizard-template-settings-row">
                                    <dt>{row.label}</dt>
                                    <dd>{row.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          ))}
                        </div>
                      </details>}
                    </div>
                  );
                })}
                <div className={`wizard-template-card ${templateId === null ? "wizard-template-card-active" : ""}`}>
                  <button type="button" className="wizard-template-card-select" onClick={() => handleTemplateSelect(null)}>
                    <strong>Blank Setup</strong>
                    <span className="site-muted wizard-template-tagline">No template</span>
                    <span className="site-muted wizard-template-desc">Start with every setting at its default and configure the league yourself.</span>
                  </button>
                </div>
              </div>
            </Section>
            </>}
            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={() => setStep(0)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={!game} onClick={() => setStep(2)}>Next</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
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

            {isMadden && (templateId === null || templateId === "rec_recommended") && (
              <Section title="League Type">
                <p className="site-muted">Choose how rosters are populated. This cannot be changed after creation.</p>
                {MADDEN_LEAGUE_TYPES.filter((option) => option.value !== "rise_to_immortality" || game === "madden_27").map((option) => (
                  <label key={option.value} className={`wizard-option-card ${leagueType === option.value ? "wizard-option-card-active" : ""}`}>
                    <input type="radio" name="leagueType" value={option.value} checked={leagueType === option.value}
                      disabled={option.value === "custom_rosters"} onChange={() => setLeagueType(option.value)} className="sr-only" />
                    <strong>{option.label}{option.value === "custom_rosters" ? " (Coming Soon)" : ""}</strong>
                    <span className="site-muted">{option.desc}</span>
                  </label>
                ))}
              </Section>
            )}

            {isRise && game === "madden_27" && (
              <Section title="Cornerstone Positions">
                <p className="site-muted">
                  Every user creates one offensive and one defensive cornerstone at these league-wide positions.
                  The other positions on each side are not available.
                </p>
                <SelectField label="Offensive position" hint="Universal for the whole league."
                  value={immortalityOffensePosition} onChange={setImmortalityOffensePosition}
                  options={[...IMMORTALITY_OFFENSE_POSITIONS]} />
                <SelectField label="Defensive position" hint="Universal for the whole league. MIKE maps to MLB in Madden."
                  value={immortalityDefensePosition} onChange={setImmortalityDefensePosition}
                  options={[...IMMORTALITY_DEFENSE_POSITIONS]} />
              </Section>
            )}

            {isCfb && (
              <div className="wizard-notice">
                <strong>CFB roster setup is automatic.</strong> REC seeds the current baseline roster and enables recruiting, transfer-portal, progression, and roster-history tracking for every CFB league.
              </div>
            )}

            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={() => setStep(1)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={!game || (isMadden && !leagueType) || (isRise && (!immortalityOffensePosition || !immortalityDefensePosition))} onClick={() => setStep(3)}>Next</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <Section title="League Name">
              <TextField label="League name" value={name} onChange={setName} placeholder="e.g. REC OG" maxLength={80} />
              <label className="site-field">
                <span>League logo (optional)</span>
                <input className="site-input" type="file" accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setLeagueLogoFile(event.target.files?.[0] ?? null)} />
                <small>PNG, JPEG, or WebP. GIFs are rejected. If omitted, REC displays the league abbreviation.</small>
              </label>
            </Section>
            <Section title="Maximum Members">
              <ToggleField label="Set a custom member limit" hint="Leagues default to 32. Registered users, commissioners, and Discord-only users assigned to teams all count toward this limit. Economy features require at least eight linked users."
                checked={customMaxMembers} onChange={setCustomMaxMembers} />
              {customMaxMembers && <NumberField label="Maximum members" value={maxMembers} onChange={setMaxMembers} min={2} max={32} />}
            </Section>
            <Section title="League Password (Optional)">
              <p className="site-muted">Optional — users never need it to request an open team. If set, the password is stored with your league and shared with a user once you approve their request.</p>
              <TextField label="Password" value={leaguePassword} onChange={setLeaguePassword} placeholder="Optional" />
            </Section>
            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={() => setStep(2)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={!name.trim()} onClick={() => advance(4)}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === 4 && (
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
              <button type="button" className="site-btn site-btn-ghost" onClick={() => setStep(3)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" onClick={() => advance(5)}>Next</button>
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
              <SelectField label="Injury policy" hint={isRise ? "Locked off for Rise to Immortality. Wear & tear stays on." : "Controls in-game injury frequency."}
                value={isRise ? "off" : injuryPolicy} onChange={setInjuryPolicy} options={INJURY_OPTIONS} />
              <CheckboxGroupField label="Force win rules — regular season" hint="When any of these apply, a coach can request (or a commissioner can grant) a Force Win."
                value={forceWinRulesRegular} onChange={setForceWinRulesRegular}
                options={FORCE_WIN_RULE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} />
              <CheckboxGroupField label="Force win rules — postseason"
                value={forceWinRulesPostseason} onChange={setForceWinRulesPostseason}
                options={FORCE_WIN_RULE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} />
              <CheckboxGroupField label="Fair sim rules — regular season" hint="When any of these apply, the game is settled as a Fair Sim instead of played."
                value={fairSimRulesRegular} onChange={setFairSimRulesRegular}
                options={FAIR_SIM_RULE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} />
              <CheckboxGroupField label="Fair sim rules — postseason"
                value={fairSimRulesPostseason} onChange={setFairSimRulesPostseason}
                options={FAIR_SIM_RULE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} />
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

            {isRise ? (
              <Section title="Economy">
                <div className="wizard-notice">
                  <strong>Store purchases are off.</strong> Player XP upgrades ratings, then Team XP. Coins are annual contract payments only — not weekly, EOS, highlight, or GOTW payouts. Age resets, legends, custom players, contract buys, and coin attribute purchases are not available.
                </div>
              </Section>
            ) : (
            <Section title="Economy">
              <ToggleField label="Enable coin economy" hint="Master switch — turning this on enables a points-based economy where users spend coins on custom players, legends, dev upgrades, and more."
                desc="The coin economy gives every user a coin balance they earn from activity, then spend on roster upgrades. Keep this off if you want a no-transaction league."
                checked={coinEconomyEnabled} onChange={setCoinEconomyEnabled} />
              {coinEconomyEnabled && (
                <>
                  <p className="wizard-field-desc">
                    The coin economy requires at least 8 users linked to teams before it activates — this is a fixed
                    platform-wide minimum and isn't configurable per league. Below that threshold the economy stays
                    dormant: no coins flow and no purchases can be made.
                  </p>

                  <ToggleField label="Custom players" hint="Allow users to spend coins to create custom players for their roster."
                    desc="Users buy a custom player build (position, size, ratings) and add them to their team. Capped by the season cap below."
                    checked={customPlayersEnabled} onChange={setCustomPlayersEnabled} />
                  {customPlayersEnabled && (
                    <CounterField label="Custom players season cap" hint="Max custom players per team per season. 0 = unlimited."
                      value={customPlayersSeasonCap} onChange={setCustomPlayersSeasonCap} min={0} max={5} unlimitedLabel />
                  )}

                  <ToggleField label="Legends" hint="Allow users to spend coins to add retired legend players."
                    desc="Users add retired superstars (e.g. Hall of Fame players) to their roster. Capped by the season cap below."
                    checked={legendsEnabled} onChange={setLegendsEnabled} />
                  {legendsEnabled && (
                    <CounterField label="Legends season cap" hint="Max legends per team per season. 0 = unlimited."
                      value={legendsSeasonCap} onChange={setLegendsSeasonCap} min={0} max={5} unlimitedLabel />
                  )}

                  {isMadden && <>
                  <ToggleField label="Dev upgrades" hint="Allow users to spend coins to upgrade a player's development trait (e.g. Normal to Star, Star to Superstar)."
                    desc="Upgrading a player's dev trait lets them earn XP and progress faster. Choose how these are capped below."
                    checked={devUpgradesEnabled} onChange={setDevUpgradesEnabled} />
                  {devUpgradesEnabled && (
                    <>
                      <CounterField label="Dev upgrades season cap (total purchases per team)" hint="0 = unlimited."
                        value={devUpgradesSeasonCap} onChange={setDevUpgradesSeasonCap} min={0} max={20} unlimitedLabel />
                    </>
                  )}

                  <ToggleField label="Attribute purchases" hint="Allow users to spend coins to boost individual player attributes (e.g. +1 Speed, +1 Throw Power)."
                    desc="Users spend points to raise individual player attributes. Attributes are split into Core and Non-Core groups with separate caps and pricing."
                    checked={attributePurchasesEnabled} onChange={setAttributePurchasesEnabled} />
                  {attributePurchasesEnabled && (
                    <>
                      <CounterField label="Core attribute default cap (points per attribute)"
                        hint="Max points a user can spend on a single core attribute per season, unless that attribute has its own override below. 0 = unlimited."
                        value={coreAttributePurchasesSeasonCap} onChange={setCoreAttributePurchasesSeasonCap} min={0} max={99} unlimitedLabel />
                      <SelectField label="Non-Core cap mode" hint="Use one pooled cap for all Non-Core attributes, or configure individual caps. The two modes are mutually exclusive."
                        value={nonCoreAttributeCapMode} onChange={(value) => setNonCoreAttributeCapMode(value as "group" | "individual")}
                        options={[{ value: "group", label: "As a group" }, { value: "individual", label: "Individual caps" }]} />
                      {nonCoreAttributeCapMode === "group" && <CounterField label="Non-core attribute group cap (total across all non-core)"
                        hint="Total points usable across all non-core attributes combined. 0 = unlimited."
                        value={nonCoreAttributePurchasesSeasonCap} onChange={setNonCoreAttributePurchasesSeasonCap} min={0} max={99} unlimitedLabel />}

                      <CoreAttributePicker value={coreAttributes} onChange={setCoreAttributes} />

                      {coreAttributes.length > 0 && (
                        <div className="wizard-override-list">
                          <p className="wizard-override-heading">Per-core-attribute overrides</p>
                          <p className="site-muted wizard-override-hint">
                            Set an individual cap for a specific core attribute. Leave a counter at its default ({coreAttributePurchasesSeasonCap === 0 ? "unlimited" : `${coreAttributePurchasesSeasonCap} points`}) to keep that attribute on the group default; 0 means unlimited.
                          </p>
                          {coreAttributes.map((code) => {
                            const def = MADDEN_ATTRIBUTE_BY_CODE.get(code as MaddenAttributeCode);
                            const override = coreAttributeCapOverrides[code];
                            const current = override ?? coreAttributePurchasesSeasonCap;
                            return (
                              <div key={code} className="wizard-override-row">
                                <span className="wizard-override-label"><strong>{code}</strong>{def ? ` — ${def.name}` : ""}</span>
                                <CounterField label={`Cap for ${code}`} value={current}
                                  onChange={(v) => {
                                    const next = { ...coreAttributeCapOverrides };
                                    if (v === coreAttributePurchasesSeasonCap) delete next[code];
                                    else next[code] = v;
                                    setCoreAttributeCapOverrides(next);
                                  }}
                                  min={0} max={99} unlimitedLabel />
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {nonCoreAttributeCapMode === "individual" && (
                        <div className="wizard-override-list">
                          <p className="wizard-override-heading">Individual Non-Core caps</p>
                          <p className="site-muted wizard-override-hint">Each Non-Core attribute is capped independently. Attributes without a value remain unlimited.</p>
                          {MADDEN_ATTRIBUTE_DEFINITIONS.filter((def) => !coreAttributes.includes(def.code)).map((def) => (
                            <div key={def.code} className="wizard-override-row">
                              <span className="wizard-override-label"><strong>{def.code}</strong> — {def.name}</span>
                              <CounterField label={`Cap for ${def.name}`} value={nonCoreAttributeCapOverrides[def.code] ?? 0}
                                onChange={(value) => {
                                  const next = { ...nonCoreAttributeCapOverrides };
                                  if (value === 0) delete next[def.code]; else next[def.code] = value;
                                  setNonCoreAttributeCapOverrides(next);
                                }} min={0} max={99} unlimitedLabel />
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  </>}
                  {isMadden && (
                    <>
                      <ToggleField label="Contract adjustment purchases" hint="Allow users to spend coins to restructure or adjust player contracts."
                        desc="Users pay coins to reshape a player's contract (length, guaranteed money). Capped by the season cap below."
                        checked={contractAdjustmentPurchasesEnabled} onChange={setContractAdjustmentPurchasesEnabled} />
                      {contractAdjustmentPurchasesEnabled && (
                        <CounterField label="Contract adjustment season cap" hint="0 = unlimited."
                          value={contractPurchasesSeasonCap} onChange={setContractPurchasesSeasonCap} min={0} max={5} unlimitedLabel />
                      )}
                      <ToggleField label="Age resets" hint="Allow users to spend coins to reset a player's age, extending their career."
                        desc="Users pay coins to roll a player back to a younger age, keeping them productive for more seasons. Capped by the season cap below."
                        checked={ageResetsEnabled} onChange={setAgeResetsEnabled} />
                      {ageResetsEnabled && (
                        <CounterField label="Age resets season cap" hint="0 = unlimited."
                          value={ageResetsSeasonCap} onChange={setAgeResetsSeasonCap} min={0} max={5} unlimitedLabel />
                      )}
                    </>
                  )}
                </>
              )}
            </Section>
            )}

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
              <button type="button" className="site-btn site-btn-primary" onClick={() => advance(6)}>Next</button>
            </div>
          </>
        )}

        {step === 6 && (
          <>
            {isMadden && (
              <>
                <Section title="Difficulty &amp; Gameplay">
                  <SelectField label="Difficulty" value={difficulty} onChange={setDifficulty} options={MADDEN_DIFFICULTY} />
                  <ToggleField label="Custom sliders" hint="After Discord linking and the rest of setup are complete, you will be routed to League Management → Settings → Gameplay to choose a community template or enter values." checked={slidersAdjusted} onChange={setSlidersAdjusted} />
                  <NumberField label="Quarter length (minutes)" value={quarterLengthMinutes} onChange={setQuarterLengthMinutes} min={1} max={15} />
                  <ToggleField label="Accelerated clock" checked={acceleratedClockEnabled} onChange={setAcceleratedClockEnabled} />
                  {acceleratedClockEnabled && (
                    <NumberField label="Minimum play clock (seconds)" value={acceleratedClockMinimumSeconds} onChange={setAcceleratedClockMinimumSeconds} min={0} max={40} />
                  )}
                  <ToggleField label="Abilities enabled" hint="Show X-Factor and Superstar abilities in-game." checked={abilitiesEnabled} onChange={setAbilitiesEnabled} />
                  <ToggleField label="Wear and tear" hint="Enable the wear-and-tear injury system." checked={wearAndTearEnabled} onChange={setWearAndTearEnabled} />
                </Section>

                <Section title="League Sim Settings">
                  <SelectField label="Trade difficulty" hint="Controls how willing CPU teams are to accept trades. Very Easy makes it easy to swing deals with the CPU; Very Hard makes CPU teams much tougher negotiators."
                    value={tradeDifficulty} onChange={setTradeDifficulty} options={TRADE_DIFFICULTY_OPTIONS} />
                  {game === "madden_26" && (
                    <SelectField label="Free agent motivation impact" hint="Controls how much factors like money, playing time, and championship odds weigh in free-agent signings. Off means free agents mostly sign with the highest bidder. This setting does not exist in Madden 27."
                      value={freeAgentMotivationImpact} onChange={setFreeAgentMotivationImpact} options={FA_MOTIVATION_IMPACT_OPTIONS} />
                  )}
                </Section>

                <Section title="Salary Cap &amp; Trades">
                  {isRise ? (
                    <div className="wizard-notice">
                      <strong>Locked for Rise to Immortality.</strong> Salary cap off, trades off, CPU trading not allowed. Franchises are assigned in the virtual rookie draft.
                    </div>
                  ) : (
                    <>
                  <ToggleField label="Salary cap enabled" hint="Enforce the NFL salary cap in-game." checked={salaryCapEnabled} onChange={setSalaryCapEnabled} />
                  <ToggleField label="Trade deadline enabled" hint="Lock trades after the NFL trade deadline passes." checked={tradeDeadlineEnabled} onChange={setTradeDeadlineEnabled} />
                  <SelectField label="Trade approval policy" hint="Controls whether user trades are immediate or must be approved."
                    value={tradeApprovalPolicy} onChange={setTradeApprovalPolicy} options={TRADE_APPROVAL_OPTIONS} />
                  <SelectField label="CPU trading policy" hint="Controls whether users may trade with CPU-controlled teams."
                    value={cpuTradingPolicy} onChange={setCpuTradingPolicy} options={CPU_TRADING_OPTIONS} />
                  {cpuTradingPolicy !== "not_allowed" && (
                    <SelectField label="CPU trades allowed per team, per season" hint="Counts only trades where at least one side is CPU-controlled. Zero means unlimited."
                      value={String(cpuTradesSeasonCap)} onChange={(value) => setCpuTradesSeasonCap(Number(value))}
                      options={[0, 1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: value === 0 ? "Unlimited" : String(value) }))} />
                  )}
                    </>
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
                  <ToggleField label="Custom sliders" hint="After Discord linking and the rest of setup are complete, you will be routed to League Management → Settings → Gameplay to choose a community template or enter values." checked={slidersAdjusted} onChange={setSlidersAdjusted} />
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
                    value={dynastyType} onChange={(v) => { setDynastyType(v); setTeamBuilderAllowed(v === "mixed"); }} options={CFB_DYNASTY_TYPE} />
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
                  <ToggleField label="Team Builder allowed" hint="Follows Dynasty type — Mixed allows Team Builder teams, Real Rosters does not."
                    checked={teamBuilderAllowed} onChange={setTeamBuilderAllowed} disabled desc="Set by Dynasty type above." />
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

            {coachModeEnabled && (
              <Section title="Coach Mode">
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
              </Section>
            )}

            <Section title="Ball Hawk / Heat Seeker / Switch Assist">
              <SelectField label="Ball Hawk" hint="Assists user in intercepting passes." value={ballHawk} onChange={setBallHawk} options={BALL_HAWK_OPTIONS} />
              <SelectField label="Heat Seeker" hint="Assists user in tackling ball carriers." value={heatSeeker} onChange={setHeatSeeker} options={BALL_HAWK_OPTIONS} />
              <SelectField label="Switch Assist" hint="Automatically switches to the best defender near the ball." value={switchAssist} onChange={setSwitchAssist} options={BALL_HAWK_OPTIONS} />
            </Section>

            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={() => setStep(5)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" onClick={() => setStep(7)}>Next</button>
            </div>
          </>
        )}

        {step === 7 && (
          <>
            {isRise ? (
              <Section title="Team Identity Setup">
                <p className="site-muted">
                  Skip a personal team for now. Registered users go into a pool. After the virtual rookie draft they are linked to franchises on the site and Discord automatically. Unused clubs stay CPU.
                </p>
                <div className="wizard-team-grid">
                  <button type="button"
                    className={`wizard-team-card ${immortalityTeamPool === "default_nfl" ? "wizard-team-card-active" : ""}`}
                    onClick={() => setImmortalityTeamPool("default_nfl")}>
                    <strong>Default 32 NFL teams</strong>
                    <span className="site-muted">Keep the named NFL clubs. Humans are assigned at the rookie draft.</span>
                  </button>
                  <button type="button"
                    className={`wizard-team-card ${immortalityTeamPool === "custom_32" ? "wizard-team-card-active" : ""}`}
                    onClick={() => setImmortalityTeamPool("custom_32")}>
                    <strong>Custom identity overrides</strong>
                    <span className="site-muted">Replace any 0–32 NFL slots. Blank rows keep their real NFL identity.</span>
                  </button>
                </div>
                {immortalityTeamPool === "custom_32" ? (
                  <p className="site-muted">Conference, division, schedules, imports, rosters, and stats remain attached to the NFL slot shown on the left.</p>
                ) : null}
                {immortalityTeamPool === "custom_32" ? (
                  <div className="wizard-custom-team-list" style={{ marginTop: 16, display: "grid", gap: 8, maxHeight: 360, overflow: "auto" }}>
                    {NFL_TEAMS.map((team) => {
                      const slot = immortalityCustomTeams[team.abbreviation] ?? {
                        city: "", nick: "", abbreviation: "", primaryLogoUrl: "", secondaryLogoUrl: "",
                        wordmarkUrl: "", primaryColor: "", secondaryColor: "", tertiaryColor: "",
                      };
                      const update = (patch: Partial<typeof slot>) => setImmortalityCustomTeams((current) => ({
                        ...current,
                        [team.abbreviation]: { ...slot, ...patch },
                      }));
                      return (
                        <div key={team.abbreviation} className="site-field" style={{ display: "grid", gridTemplateColumns: "8rem repeat(3, minmax(7rem, 1fr))", gap: 8, alignItems: "center", padding: 12, border: "1px solid var(--site-border)", borderRadius: 10 }}>
                          <span><strong>{team.abbreviation}</strong><small className="site-muted" style={{ display: "block" }}>{team.conference} {team.division}</small></span>
                          <input className="site-input" placeholder="City" value={slot.city} onChange={(event) => update({ city: event.target.value })} />
                          <input className="site-input" placeholder="Nickname" value={slot.nick} onChange={(event) => update({ nick: event.target.value })} />
                          <input className="site-input" placeholder="Abbr" maxLength={5} value={slot.abbreviation} onChange={(event) => update({ abbreviation: event.target.value })} />
                          <span className="site-muted">Branding</span>
                          <input className="site-input" type="url" placeholder="Primary logo URL" value={slot.primaryLogoUrl} onChange={(event) => update({ primaryLogoUrl: event.target.value })} />
                          <input className="site-input" type="url" placeholder="Secondary logo URL" value={slot.secondaryLogoUrl} onChange={(event) => update({ secondaryLogoUrl: event.target.value })} />
                          <input className="site-input" type="url" placeholder="Wordmark URL" value={slot.wordmarkUrl} onChange={(event) => update({ wordmarkUrl: event.target.value })} />
                          <span className="site-muted">Upload</span>
                          {(["primary", "secondary", "wordmark"] as const).map((kind) => (
                            <label key={kind} className="site-btn site-btn-secondary site-btn-sm" style={{ overflow: "hidden" }}>
                              {immortalityTeamLogoFiles[team.abbreviation]?.[kind]?.name ?? `${kind} image`}
                              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (!file) return;
                                setImmortalityTeamLogoFiles((current) => ({
                                  ...current,
                                  [team.abbreviation]: { ...current[team.abbreviation], [kind]: file },
                                }));
                              }} />
                            </label>
                          ))}
                          <span className="site-muted">Colors</span>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input className="site-input" placeholder="#Primary" pattern="#[0-9A-Fa-f]{6}" value={slot.primaryColor} onChange={(event) => update({ primaryColor: event.target.value })} />
                            <EyeDropperButton onPick={(hex) => update({ primaryColor: hex })} />
                          </div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input className="site-input" placeholder="#Secondary" pattern="#[0-9A-Fa-f]{6}" value={slot.secondaryColor} onChange={(event) => update({ secondaryColor: event.target.value })} />
                            <EyeDropperButton onPick={(hex) => update({ secondaryColor: hex })} />
                          </div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input className="site-input" placeholder="#Tertiary" pattern="#[0-9A-Fa-f]{6}" value={slot.tertiaryColor} onChange={(event) => update({ tertiaryColor: event.target.value })} />
                            <EyeDropperButton onPick={(hex) => update({ tertiaryColor: hex })} />
                          </div>
                          {(() => {
                            const primaryFile = immortalityTeamLogoFiles[team.abbreviation]?.primary;
                            const previewSrc = primaryFile ? URL.createObjectURL(primaryFile) : (slot.primaryLogoUrl.trim() || null);
                            if (!previewSrc) return null;
                            return (
                              <>
                                <span className="site-muted">Preview</span>
                                <div style={{ gridColumn: "span 3" }}>
                                  <img src={previewSrc} alt="" style={{ maxHeight: 64, maxWidth: 120, background: "#222", borderRadius: 6 }} />
                                  <span className="site-muted" style={{ marginLeft: 8, fontSize: "0.85em" }}>Click "Pick" above, then click a pixel on this logo.</span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div style={{ marginTop: 16 }}>
                  <strong>Final division preview</strong>
                  <div className="wizard-team-grid" style={{ marginTop: 8 }}>
                    {(["AFC", "NFC"] as const).flatMap((conference) => ["East", "North", "South", "West"].map((division) => (
                      <div key={`${conference}-${division}`} className="wizard-team-card" style={{ cursor: "default" }}>
                        <strong>{conference} {division}</strong>
                        {NFL_TEAMS.filter((team) => team.conference === conference && team.division === division).map((team) => {
                          const custom = immortalityCustomTeams[team.abbreviation];
                          const display = custom?.city.trim() && custom?.nick.trim()
                            ? `${custom.city.trim()} ${custom.nick.trim()}`
                            : team.name;
                          return <span key={team.abbreviation} className="site-muted">{display} ({custom?.abbreviation.trim().toUpperCase() || team.abbreviation})</span>;
                        })}
                      </div>
                    )))}
                  </div>
                </div>
              </Section>
            ) : null}
            <Section title="Team Assignment">
              <p className="site-muted">
                {isRise
                  ? "Pick your franchise. You're the only one who chooses directly, since you need a team set up in-game to run the league — everyone else creates their players and an owner first, then gets 4 random franchises to choose from once they're done."
                  : "Pick your team. You will be assigned as the head commissioner for this team."}
                {isRise && immortalityTeamPool === "custom_32" ? " If a custom identity replaces this slot, the franchise will show its custom name once the league is created." : null}
              </p>
              <div className="wizard-team-grid">
                {teamOptions.map((team) => (
                  <button key={team.id} type="button"
                    className={`wizard-team-card ${selectedTeamId === team.id ? "wizard-team-card-active" : ""}`}
                    onClick={() => setSelectedTeamId(team.id)}>
                    <strong>{team.name}</strong>
                    {team.mascot && <span className="site-muted">{team.mascot}</span>}
                    {team.abbreviation && <span className="site-muted">{team.abbreviation}</span>}
                  </button>
                ))}
              </div>
            </Section>
            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" disabled={busy} onClick={() => setStep(6)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={busy || !selectedTeamId} onClick={() => void finishWizard()}>
                {busy ? "Finishing..." : "Assign Team & Finish"}
              </button>
            </div>
          </>
        )}

        {step === 8 && (
          <>
            <Section title="Your League is Ready">
              <p className="site-muted">
                <strong>{name || "Your league"}</strong> was created{selectedTeamId ? ` and you were assigned the ${selectedTeamId}` : ""}
                {isRise ? ". Everyone else creates their players and an owner, then gets 4 random franchises to choose from once they're done. Unused teams stay CPU." : ""}. You can manage settings, add users, and assign teams anytime from the league hub.
              </p>
            </Section>

            <Section title="Connect a Discord Server (Optional)">
              {discordLinked === null ? (
                <p className="site-muted">Checking your Discord connection…</p>
              ) : !discordLinked ? (
                <p className="site-muted">
                  Your Discord account isn't linked yet — open{" "}
                  <a href="/account?tab=linked">My Account → Linked accounts</a>
                  {" "}to connect Discord, then come back here (or use League Settings) to connect a server.
                </p>
              ) : discordConnectResult ? (
                <>
                  <p className="site-muted">Connected to <strong>{discordConnectResult.serverName}</strong>.</p>
                  <p className="site-muted">Last step — add the REC bot to that server:</p>
                  <a className="site-btn site-btn-primary" href={discordConnectResult.inviteUrl} target="_blank" rel="noreferrer">
                    Invite the REC bot
                  </a>
                  <p className="site-muted">Once you've added it, come back here and confirm:</p>
                  <button type="button" className="site-btn site-btn-secondary" disabled={postInviteBusy} onClick={() => void confirmBotJoined()}>
                    {postInviteBusy ? "Checking…" : "I've invited the bot"}
                  </button>
                  {postInviteError && <p className="site-auth-error">{postInviteError}</p>}
                  {postInviteResult?.botJoined && (
                    <>
                      <p className="site-muted">
                        The bot is in your server{postInviteResult.nicknameSet ? " — your commissioner nickname and role are set." : "."}
                      </p>
                      <aside className="site-discord-owner-notice" role="note" aria-label="Discord server owner nickname limitation">
                        <strong>Server owner nickname</strong>
                        <p>
                          If you are the current Discord server owner, Discord does not allow REC Scout—or any bot—to change your nickname, even with Administrator permission. Change your own server nickname manually to your {game === "cfb_27" ? "school" : "team"} name. REC Scout can still assign and reconcile your Commissioner, Member, and team roles normally.
                        </p>
                      </aside>
                      <p className="site-muted">Channel routing:</p>
                      <ul className="site-public-league-list">
                        {postInviteResult.channels.map((c) => (
                          <li key={c.key}>
                            <span>{c.label}</span>
                            <strong>{c.configured ? "Connected" : "Not set yet"}</strong>
                          </li>
                        ))}
                      </ul>
                      <p className="site-muted">Finish assigning any unset channels anytime from League Management → Settings → Channels.</p>
                    </>
                  )}
                </>
              ) : discordGuilds.length > 0 ? (
                <>
                  <p className="site-muted">Pick one of your servers to connect this league to:</p>
                  <label className="site-field">
                    <span>Server</span>
                    <select className="site-select" value={selectedGuildId} onChange={(e) => setSelectedGuildId(e.target.value)}>
                      {discordGuilds.map((guild) => (
                        <option key={guild.id} value={guild.id}>{guild.name}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="site-btn site-btn-primary" disabled={discordBusy || !selectedGuildId} onClick={() => void connectGuildToLeague()}>
                    {discordBusy ? "Connecting…" : "Connect this server"}
                  </button>
                </>
              ) : (
                <button type="button" className="site-btn site-btn-primary" disabled={discordBusy} onClick={() => void startDiscordPicker()}>
                  {discordBusy ? "Opening Discord…" : "Connect a Discord Server"}
                </button>
              )}
              {discordError && <p className="site-auth-error">{discordError}</p>}
            </Section>

            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={leaveWizard}>
                {slidersAdjusted ? "Configure Sliders" : "Done"}
              </button>
              <button type="button" className="site-btn site-btn-primary" disabled={!leagueId} onClick={() => setStep(9)}>
                Invite Friends
              </button>
            </div>
          </>
        )}

        {step === 9 && (
          <>
            <Section title="Invite Friends">
              <p className="site-muted">
                Invite users to your league. They'll get a notification and an inbox message; once they accept they
                join as a member and can pick a team.
              </p>
              {inviteError && <p className="site-auth-error">{inviteError}</p>}

              <label className="site-field">
                <span>Personal message (optional)</span>
                <input className="site-input" placeholder="e.g. Hey! We need a QB for our new league." maxLength={500}
                  value={inviteMessage} onChange={(e) => setInviteMessage(e.target.value)} />
              </label>

              <Section title="Search by username">
                <input className="site-input" placeholder="Type a username…" value={inviteSearchQuery}
                  onChange={(e) => setInviteSearchQuery(e.target.value)} />
                {inviteSearchResults.length > 0 && (
                  <div className="wizard-invite-results">
                    {inviteSearchResults.map((user) => (
                      <div key={user.userId} className="wizard-invite-row">
                        <span className="wizard-invite-name">
                          <strong>{user.username}</strong>
                          <span className="site-muted">{user.displayName !== user.username ? user.displayName : ""}</span>
                        </span>
                        {alreadyInvitedIds.has(user.userId) ? (
                          <span className="site-muted">Invited</span>
                        ) : (
                          <button type="button" className="site-btn site-btn-secondary site-btn-sm" disabled={inviteBusy}
                            onClick={() => void sendInvite(user)}>
                            {inviteBusy ? "Sending…" : "Invite"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Your Friends">
                {inviteFriends.length === 0 ? (
                  <p className="site-muted">No accepted friends yet — add friends from the Friends page, or invite by username above.</p>
                ) : (
                  <div className="wizard-invite-results">
                    {inviteFriends.map((user) => (
                      <div key={user.userId} className="wizard-invite-row">
                        <span className="wizard-invite-name">
                          <strong>{user.username}</strong>
                          <span className="site-muted">{user.displayName !== user.username ? user.displayName : ""}</span>
                        </span>
                        {alreadyInvitedIds.has(user.userId) ? (
                          <span className="site-muted">Invited</span>
                        ) : (
                          <button type="button" className="site-btn site-btn-secondary site-btn-sm" disabled={inviteBusy}
                            onClick={() => void sendInvite(user)}>
                            {inviteBusy ? "Sending…" : "Invite"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {sentInvites.length > 0 && (
                <Section title="Sent Invites">
                  <div className="wizard-invite-results">
                    {sentInvites.map((invite) => (
                      <div key={invite.inviteId} className="wizard-invite-row">
                        <span className="wizard-invite-name">
                          <strong>{invite.invitee.username}</strong>
                          <span className="site-muted">{invite.invitee.displayName !== invite.invitee.username ? invite.invitee.displayName : ""}</span>
                        </span>
                        <span className={`site-muted wizard-invite-status-${invite.status}`}>{invite.status}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </Section>

            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={() => setStep(8)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" onClick={leaveWizard}>
                {slidersAdjusted ? "Continue to Slider Settings" : "Done"}
              </button>
            </div>
          </>
        )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

type EyeDropperResult = { sRGBHex: string };
type EyeDropperInstance = { open: () => Promise<EyeDropperResult> };
declare global {
  interface Window { EyeDropper?: new () => EyeDropperInstance; }
}

/** Samples a color from anywhere on screen (Chrome/Edge's native EyeDropper API) -- pair with
 * an on-page logo preview so a commissioner can pick a hex value straight off the uploaded
 * artwork instead of guessing. Hidden on browsers without the API (Firefox, Safari) rather than
 * showing a button that would just throw when clicked. */
function EyeDropperButton({ onPick }: { onPick: (hex: string) => void }) {
  const supported = typeof window !== "undefined" && Boolean(window.EyeDropper);
  if (!supported) return null;
  return (
    <button type="button" className="site-btn site-btn-secondary site-btn-sm" title="Pick a color from anywhere on screen"
      onClick={async () => {
        try {
          const result = await new window.EyeDropper!().open();
          onPick(result.sRGBHex);
        } catch {
          // User pressed Escape to cancel the pick -- not an error.
        }
      }}>
      🎨 Pick
    </button>
  );
}

