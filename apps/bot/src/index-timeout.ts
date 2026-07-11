import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType, Client, EmbedBuilder, GatewayIntentBits, Interaction, MessageFlags, ModalBuilder, ModalSubmitInteraction, Partials, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { env } from "./config/env.js";
import { registerGuildCommands } from "./commands.js";
import { isCoCommissionerInteraction, isDiscordAdminInteraction, isFullLeagueAdminInteraction, replyFullAdminOnly } from "./lib/admin.js";
import { COLORS } from "./lib/colors.js";
import { userFacingError } from "./lib/errors.js";
import { recApi } from "./lib/rec-api.js";
import { getAnnouncementsChannel, getRouteChannels, getVotingPollsChannel } from "./lib/route-channels.js";
import { GAME_CHANNEL_PAGE_PREFIX, handleGameChannelPage } from "./flows/game-channel-pages.js";
import { ACTIVE_CHECK_CUSTOM_IDS, handleActiveCheck, handleActiveCheckEditSelect, handleActiveCheckReviewButton, recoverOpenActiveChecks } from "./flows/active-check.js";
import { GOTW_CUSTOM_IDS, handleGotwConfirm, handleGotwPollsMenu, handleGotwSelect, handleRerunGotwPolls, handleSetGotw } from "./flows/gotw.js";
import { handleGameChannels } from "./flows/game-channels.js";
import {
  EOS_PAYOUT_CUSTOM_IDS,
  TROUBLESHOOT_EOS_CUSTOM_IDS,
  eosProjectionSessions,
  handleEosPayouts,
  handleEosProjectionPage,
  handleEosProjections,
  handleIssueEosPayoutBatch,
  handleReviewEosUserPayouts,
} from "./flows/eos-payouts.js";
import {
  ADVANCE_CUSTOM_IDS,
  handleSetSeason,
  handleSetSeasonManual,
  handleSetSeasonSelect,
  handleSetWeek,
  handleSetWeekSelect,
} from "./flows/set-week-season.js";
import { isEosPayoutEligibleStage } from "@rec/shared";
import { REC_MANAGED_ROLES, ensureRecBaseRoles } from "./lib/role-sync.js";
import { ExpiringSessionStore } from "./lib/session-timeout.js";
import {
  buildAdminPanelEmbed,
  buildAdminPanelRows,
  buildLeagueMenuEmbed,
  buildLeagueMenuRows,
  buildWalletTransferCustomModal,
  buildSetupDangerModal,
  buildDeleteLeagueWarningPayload,
  buildDeleteLeagueModal,
  LEAGUE_MGMT_BOX_SCORE_INBOX_ID,
  MENU_CUSTOM_IDS,
  ROSTERS_CUSTOM_IDS,
  STREAM_CUSTOM_IDS,
  MANAGE_WALLET_CUSTOM_IDS
} from "./ui/menu.js";
import { SERVER_SETUP_CUSTOM_IDS, buildServerSetupPanel } from "./ui/server-setup-admin.js";
import { NAV_CUSTOM_IDS } from "./ui/navigation.js";
import {
  buildActivityRequirementsModal,
  buildLeagueSetupWindow,
  buildSettingsPickerWindow,
  getNextLeagueSetupStep,
  getPreviousLeagueSetupStep,
  LEAGUE_SETUP_CUSTOM_IDS,
  type LeagueSetupDraft,
} from "./ui/league-setup.js";
import { cleanupRosterSessions, handlePlayerIdentities, handlePlayerIdentityBack, handlePlayerIdentityNav, handlePostOpenTeams, handleSnapshotConferenceSelect, handleSnapshotPageNav, handleSnapshotTeamSelect, handleTeamsPage, renderTeamsMenu, renderUserSnapshotPicker } from "./flows/rosters.js";
import {
  handleManualScheduleBack,
  handleManualScheduleComplete,
  handleManualScheduleConferenceSelect,
  handleManualScheduleNextMatchup,
  handleManualScheduleNextWeek,
  handleManualScheduleTeamSelect,
  handleManualScheduleWeekSelect,
  handleScheduleViewBack,
  handleScheduleViewPage,
  handleScheduleViewPostPublicly,
  handlePostSetupScheduleFinish,
  handlePostSetupScheduleViewPage,
  POST_SETUP_SCHEDULE_CUSTOM_IDS,
  renderScheduleMenu,
  handleScheduleSos,
  handleScheduleStats,
  handleScheduleStatsTeamSelect,
  handleScheduleTeamSelect,
  handleSchedulePowerRankings,
  SCHEDULE_MGMT_CUSTOM_IDS,
  startPreviousSeasonScheduleViewer,
  startPublicLeagueScheduleViewer,
  startScheduleTeamSelect,
  startManualScheduleEntry,
  startPostSetupManualScheduleEntry,
  startPostSetupScheduleStep,
  startScheduleViewer
} from "./flows/schedule.js";
import {
  ADVANCE_WIZARD_CUSTOM_IDS,
  handleAdvanceWizardCancel,
  handleAdvanceWizardDivisionWinnerSelect,
  handleAdvanceWizardOutcome,
  handleAdvanceWizardScoreModal,
  startAdvanceWeekWizard,
} from "./flows/advance-wizard.js";
import {
  ADVANCE_TIME_CUSTOM_IDS,
  ADVANCE_DM_CUSTOM_IDS,
  HEADLINES_CUSTOM_IDS,
  handleAdvanceTimeDateSelect,
  handleAdvanceTimeTzSelect,
  handleAdvanceTimeTimeSelect,
  handleAdvanceTimeSet,
  handleAdvanceTimeSkip,
  handleAdvanceTimeBack,
  handleAdvanceDmSend,
  handleAdvanceDmSkip,
  handleHeadlinesNav,
} from "./flows/advance-time.js";
import { handleEosAwards, recoverOpenEosAwardPolls } from "./flows/eos-awards.js";
import {
  TEAM_REQUEST_CUSTOM_IDS,
  handleTeamRequestApprove,
  handleTeamRequestConference,
  handleTeamRequestReject,
  handleTeamRequestRole,
  handleTeamRequestSelect,
  startTeamRequestFlow,
} from "./flows/team-request.js";
import { handleRulesSelect } from "./flows/rules.js";
import {
  handleActivityRequirementsModal,
  handleCoachAbilitiesRestrictionModal,
  handleCpuTradingRestrictionModal,
  handleDifficultyCustomModal,
  handleFourthDownCustomModal,
  handleLeagueSetupButton,
  handleLeagueSetupSave,
  handleLeagueSetupSelect,
  handleLeagueSetupServerChannelModal,
  handlePositionRestrictionModal,
  handleAttributeCapModal,
  handleSetupModal,
  leagueSetupSessions
} from "./flows/league-setup.js";
import { RULES_CUSTOM_IDS, buildRulesPanel } from "./ui/rules.js";
import { handleSimpleTeamLinkSelect, handleSimpleTeamLinkUserSelect, handleSimpleTeamLinkRoleSelect, handleClearAllTeamLinks, handleCustomTeamModal, handleCustomTeamNoLink, renderLeagueMgmtTeams, handleLeagueTeamsAddRemove, handleLeagueTeamsEdit, handleLeagueTeamsConferenceSelect, handleLeagueTeamsTeamSelect, handleLeagueTeamsEditConferenceSelect, handleLeagueTeamsEditTeamSelect, handleLeagueTeamsEditActionDetails, handleLeagueTeamsEditActionRelocate, handleLeagueTeamsRelocateConferenceSelect, handleLeagueTeamsEditActionBack, handleLeagueTeamsResetDefaults, handleLeagueTeamsConfirmBack, handleLeagueTeamsConfirmUnlink, handleTeamLinkSelect } from "./flows/team-linking.js";
import { TEAM_LINK_CUSTOM_IDS } from "./ui/team-options.js";
import {
  handleManageWallet,
  handleWalletCustomTransferModal,
  handleWalletTransactions,
  handleWalletTransferAll,
  handleWalletTransferDirection,
  handleWalletTransferOpen,
  handleWalletPendingPurchases
} from "./handlers/wallet.js";
import {
  WAGER_CUSTOM_IDS,
  handlePlaceWager,
  handleWagerModeHouse,
  handleWagerModeOpen,
  handleWagerModeDirect,
  handleWagerModeParlay,
  handleWagerCoachSelect,
  handleWagerCoachConferenceSelect,
  handleWagerGameSelect,
  handleWagerMarketSelect,
  handleWagerSideSelect,
  handleWagerParlayPickSelect,
  handleWagerParlayAddGame,
  handleWagerParlayPlace,
  handleWagerStakeModal,
  handleWagerApprove,
  handleWagerCancel,
  handleWagerAccept,
  handleWagerCounter,
  handleCounterAccept,
  handleCounterDeny,
} from "./flows/wagers.js";
import { handleHighlightChannelMessage, handleHighlightReactionRestrict, handleHighlightReviewButton, HIGHLIGHT_REVIEW_PREFIX, settleHighlightAwardsForGuild } from "./handlers/highlights.js";
import { handlePurchaseButton, handlePurchaseModal, handlePurchaseSelect, openPurchaseStore } from "./flows/purchases.js";
import {
  LEGENDS_CUSTOM_IDS,
  handleLegendAvailableSelect,
  handleLegendBackToBrowse,
  handleLegendConfirmPurchase,
  handleLegendDetailNav,
  handleLegendGroupSelect,
  handleLegendPageButton,
  handleLegendReplaceModalSubmit,
} from "./flows/legends.js";
import { handleStreamChannelMessage, handleStreamLinkModal, handleStreamMenu, handleStreamServiceSelect } from "./handlers/stream.js";
import {
  BOX_SCORE_CUSTOM_IDS,
  handleBoxScoreApprove,
  handleBoxScoreAdminCancel,
  handleBoxScoreAdminAnother,
  handleBoxScoreAdminGameSelect,
  handleBoxScoreAdminWeekSelect,
  handleBoxScoreCancel,
  handleBoxScoreChannelMessage,
  handleBoxScoreSubmissions,
  handleCommissionerBoxScoreSubmissionMessage,
  handleBoxScoreDenyModal,
  handleBoxScoreDenySubmit,
  handleBoxScoreCorrectionsOpen,
  handleBoxScoreCorrectionsFieldSelect,
  handleBoxScoreCorrectionsMatchupSelect,
  handleBoxScoreCorrectionsModal,
  handleBoxScoreCorrectionsCancel,
  handleBoxScoreSubmitConfirm,
  sweepBoxScoreExchanges,
} from "./flows/box-score.js";
import {
  WEEKLY_SCORES_CUSTOM_IDS,
  handleWeeklyScoresUploadOpen,
  handleWeeklyScoresUploadMessage,
  handleWeeklyScoresApprove,
  handleWeeklyScoresCancel,
  handleWeeklyScoresCorrectOpen,
  handleWeeklyScoresCorrectGameSelect,
  handleWeeklyScoresCorrectModal,
} from "./flows/schedule-scores.js";
import {
  MANUAL_SCORES_CUSTOM_IDS,
  handleManualScoresOpen,
  handleManualScoresWeekSelect,
  handleManualScoresGameSelect,
  handleManualScoresOutcome,
  handleManualScoresScoreModal,
  handleManualScoresAnother,
} from "./flows/manual-scores.js";
import {
  SCHEDULE_IMPORT_CUSTOM_IDS,
  startScheduleImportWizard,
  startScheduleImportOneWeek,
  handleScheduleImportWeekSelect,
  handleScheduleImportUploadMessage,
  handleScheduleImportSave,
  handleScheduleImportCancel,
} from "./flows/schedule-import.js";
import {
  CFB_TEAM_SCHEDULE_CUSTOM_IDS,
  startCfbTeamScheduleImport,
  handleCfbTeamScheduleConferenceSelect,
  handleCfbTeamScheduleTeamSelect,
  handleCfbTeamScheduleUploadMessage,
  handleCfbTeamScheduleEditWeekSelect,
  handleCfbTeamScheduleEditTeamSelect,
  handleCfbTeamScheduleEditHome,
  handleCfbTeamScheduleEditAway,
  handleCfbTeamScheduleEditBack,
  handleCfbTeamScheduleApprove,
  handleCfbTeamScheduleCancel,
} from "./flows/cfb-team-schedule-import.js";
import {
  CFB_SCHEDULE_MANUAL_CUSTOM_IDS,
  startCfbTeamScheduleManualEntry,
  handleCfbScheduleManualTeamSelect,
  handleCfbScheduleManualTeamPagePrev,
  handleCfbScheduleManualTeamPageNext,
  handleCfbScheduleManualConferenceSelect,
  handleCfbScheduleManualOpponentSelect,
  handleCfbScheduleManualHome,
  handleCfbScheduleManualAway,
  handleCfbScheduleManualSkip,
  handleCfbScheduleManualContinue,
  handleCfbScheduleManualCancel,
} from "./flows/cfb-team-schedule-manual.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  // Partials so reaction events fire on messages not in cache (older highlights).
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
client.setMaxListeners(50);
const menuSessions = new ExpiringSessionStore<true>();
const serverSetupChannelSessions = new Map<string, string>();
type RoleMgmtRoleKey = keyof typeof REC_MANAGED_ROLES;
type RoleMgmtAction = "add" | "remove";
const ROLE_MGMT_CUSTOM_IDS = {
  roleSelect: "rec:roles:role",
  actionSelect: "rec:roles:action",
  userSelect: "rec:roles:users",
  prev: "rec:roles:prev",
  next: "rec:roles:next",
  confirm: "rec:roles:confirm",
  back: "rec:roles:back",
} as const;
const roleMgmtSessions = new Map<string, {
  roleKey?: RoleMgmtRoleKey;
  action?: RoleMgmtAction;
  selectedUserIds: string[];
  page: number;
}>();
const reverseTxnSessions = new Map<string, { discordId: string; transactions: any[] }>();
const TROUBLESHOOT_CUSTOM_IDS = {
  reverseUserSelect: "rec:trouble:reverse:user",
  reverseTxnSelect: "rec:trouble:reverse:txn",
} as const;

const CO_COMMISSIONER_ALLOWED_LEAGUE_MGMT_IDS = new Set<string>([
  MENU_CUSTOM_IDS.leagueMgmt,
  MENU_CUSTOM_IDS.leagueMgmtTeams,
  LEAGUE_MGMT_BOX_SCORE_INBOX_ID,
  MENU_CUSTOM_IDS.leagueMgmtBack,
]);

function isRestrictedLeagueMgmtButton(customId: string) {
  if (customId === BOX_SCORE_CUSTOM_IDS.inboxBack) return false;
  if (!customId.startsWith("rec:league_mgmt:")) return false;
  return !CO_COMMISSIONER_ALLOWED_LEAGUE_MGMT_IDS.has(customId);
}

function coCommissionerLimited(interaction: ButtonInteraction) {
  return isCoCommissionerInteraction(interaction);
}

function buildAdminPanelPayload(interaction: ButtonInteraction) {
  const limited = coCommissionerLimited(interaction);
  return {
    embeds: [buildAdminPanelEmbed({ coCommissionerLimited: limited })],
    components: buildAdminPanelRows({ coCommissionerLimited: limited }),
  };
}

setInterval(() => {
  menuSessions.cleanup();
  leagueSetupSessions.cleanup();
  eosProjectionSessions.cleanup();
  cleanupRosterSessions();
  sweepBoxScoreExchanges();
}, 60_000).unref();

const EXPIRED_WINDOW_MESSAGE = "This window has expired due to inactivity. Please reopen /menu to proceed.";

async function expireWindow(interaction: Interaction) {
  if (!interaction.isRepliable()) return;
  const payload = { content: EXPIRED_WINDOW_MESSAGE, embeds: [], components: [] };
  if (interaction.isMessageComponent()) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => undefined);
    const deleted = await interaction.deleteReply().then(() => true).catch(() => false);
    if (deleted) return;
    if ("message" in interaction && interaction.message?.deletable) {
      const messageDeleted = await interaction.message.delete().then(() => true).catch(() => false);
      if (messageDeleted) return;
    }
    await interaction.editReply(payload).catch(() => undefined);
    return;
  }
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => undefined);
  else await interaction.reply({ content: EXPIRED_WINDOW_MESSAGE, flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

async function safeInteractionError(interaction: Interaction, error: unknown) {
  console.error("Interaction handling failed", error);
  if (!interaction.isRepliable()) return;
  const content = "REC Bot hit an error while handling that action. Please reopen /menu and try again.";
  if (interaction.isMessageComponent()) {
    const payload = { content, embeds: [], components: [] };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => undefined);
    else await interaction.update(payload).catch(async () => interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined));
    return;
  }
  if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

client.once("clientReady", async () => {
  // Log the deployed commit so it's easy to confirm Railway is running the latest build.
  const deployedCommit = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "unknown";
  console.log(`REC Bot logged in as ${client.user?.tag ?? "unknown"} - build ${deployedCommit.slice(0, 12)}`);
  try {
    const health = await recApi.health();
    console.log(`Connected to ${health.service}`);
  } catch (error) {
    console.error("REC Core API health check failed", error);
  }
  await registerCommandsForVisibleGuilds();
  await recoverOpenActiveChecks(client);
  await recoverOpenEosAwardPolls(client, { buildRows: buildEosActionsRows, loadRouteChannels: getRouteChannels });
});

client.on("error", (error) => {
  console.error("Discord client error", error);
});

client.on("guildCreate", async (guild) => {
  await registerGuildCommands(guild.id).catch((error) => {
    console.error(`Failed to register commands for newly joined guild ${guild.id}`, error);
  });
});

async function registerCommandsForVisibleGuilds() {
  const guildIds = [...client.guilds.cache.keys()];
  if (!guildIds.length) {
    console.warn("No guilds were visible while refreshing guild commands.");
    return;
  }
  let registered = 0;
  for (const guildId of guildIds) {
    try {
      await registerGuildCommands(guildId);
      registered += 1;
    } catch (error) {
      console.error(`Failed to register commands for guild ${guildId}`, error);
    }
  }
  console.log(`Refreshed guild application commands for ${registered}/${guildIds.length} visible guilds.`);
}

client.on("interactionCreate", async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "menu") {
      await handleMenuCommand(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("rec:stream_review:")) {
      await handleStreamReviewButton(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(HIGHLIGHT_REVIEW_PREFIX)) {
      await handleHighlightReviewButton(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === "rec:active_check:yes") {
      await interaction.reply({ content: "Active response received.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("rec:gotw_vote:")) {
      await interaction.reply({ content: "GOTW vote received.", flags: MessageFlags.Ephemeral });
      return;
    }

    // Game-channel page flips are public and persistent (no menu session): route
    // them before the session-touch guard so any player can use them anytime.
    if (interaction.isButton() && interaction.customId.startsWith(GAME_CHANNEL_PAGE_PREFIX)) {
      return handleGameChannelPage(interaction);
    }

    // EOS payout reviews live on public pending-payouts messages with no menu
    // session, so route them before the session-touch guard (the issue-batch
    // button stays after — it's on the admin's ephemeral message).
    if (interaction.isButton() && interaction.customId.startsWith(EOS_PAYOUT_CUSTOM_IDS.approveUserPrefix)) return handleReviewEosUserPayouts(interaction, "approve");
    if (interaction.isButton() && interaction.customId.startsWith(EOS_PAYOUT_CUSTOM_IDS.denyUserPrefix)) return handleReviewEosUserPayouts(interaction, "deny");

    if (interaction.isButton() && interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.approvePrefix)) return handleWeeklyScoresApprove(interaction);
    if (interaction.isButton() && interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.correctOpenPrefix)) return handleWeeklyScoresCorrectOpen(interaction);
    if (interaction.isButton() && interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.cancelPrefix)) return handleWeeklyScoresCancel(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.correctGameSelectPrefix)) return handleWeeklyScoresCorrectGameSelect(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.correctModalPrefix)) return handleWeeklyScoresCorrectModal(interaction);

    // Box score payout reviews live on public pending-payouts messages with no menu
    // session, so route them before the session-touch guard (otherwise the guard
    // expires the window, deleting the embed without ever issuing the payout). The
    // pull-inbox versions share these custom IDs and route here harmlessly too.
    if (interaction.isButton() && interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.approvePrefix)) return handleBoxScoreApprove(interaction);
    if (interaction.isButton() && interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.denyModalPrefix)) return handleBoxScoreDenyModal(interaction);
    if (interaction.isButton() && interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctOpenPrefix)) return handleBoxScoreCorrectionsOpen(interaction);
    if (interaction.isButton() && interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctCancelPrefix)) return handleBoxScoreCorrectionsCancel(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctFieldPrefix)) return handleBoxScoreCorrectionsFieldSelect(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctMatchupPrefix)) return handleBoxScoreCorrectionsMatchupSelect(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctModalPrefix)) return handleBoxScoreCorrectionsModal(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.denyModalPrefix)) return handleBoxScoreDenySubmit(interaction);

    // Wagers run on public messages (pending-payouts, announcements) and in DMs
    // (counter offers), and the placement/counter flows shouldn't depend on an
    // active menu session — so route all wager interactions before the guard.
    if (interaction.isButton() && interaction.customId.startsWith(WAGER_CUSTOM_IDS.approvePrefix)) return handleWagerApprove(interaction);
    if (interaction.isButton() && interaction.customId.startsWith(WAGER_CUSTOM_IDS.cancelPrefix)) return handleWagerCancel(interaction);
    if (interaction.isButton() && interaction.customId.startsWith(WAGER_CUSTOM_IDS.acceptPrefix)) return handleWagerAccept(interaction);
    if (interaction.isButton() && interaction.customId.startsWith(WAGER_CUSTOM_IDS.counterAcceptPrefix)) return handleCounterAccept(interaction);
    if (interaction.isButton() && interaction.customId.startsWith(WAGER_CUSTOM_IDS.counterDenyPrefix)) return handleCounterDeny(interaction);
    if (interaction.isButton() && interaction.customId.startsWith(WAGER_CUSTOM_IDS.counterPrefix)) return handleWagerCounter(interaction);
    if (interaction.isButton() && interaction.customId === WAGER_CUSTOM_IDS.modeHouse) return handleWagerModeHouse(interaction);
    if (interaction.isButton() && interaction.customId === WAGER_CUSTOM_IDS.modeOpen) return handleWagerModeOpen(interaction);
    if (interaction.isButton() && interaction.customId === WAGER_CUSTOM_IDS.modeDirect) return handleWagerModeDirect(interaction);
    if (interaction.isButton() && interaction.customId === WAGER_CUSTOM_IDS.modeParlay) return handleWagerModeParlay(interaction);
    if (interaction.isStringSelectMenu() && (interaction.customId === WAGER_CUSTOM_IDS.coachAfcSelect || interaction.customId === WAGER_CUSTOM_IDS.coachNfcSelect || interaction.customId === WAGER_CUSTOM_IDS.coachSelect)) return handleWagerCoachSelect(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId === WAGER_CUSTOM_IDS.coachConferenceSelect) return handleWagerCoachConferenceSelect(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId === WAGER_CUSTOM_IDS.gameSelect) return handleWagerGameSelect(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId === WAGER_CUSTOM_IDS.marketSelect) return handleWagerMarketSelect(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId === WAGER_CUSTOM_IDS.sideSelect) return handleWagerSideSelect(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId === WAGER_CUSTOM_IDS.parlayPickSelect) return handleWagerParlayPickSelect(interaction);
    if (interaction.isButton() && interaction.customId === WAGER_CUSTOM_IDS.parlayAddGame) return handleWagerParlayAddGame(interaction);
    if (interaction.isButton() && interaction.customId === WAGER_CUSTOM_IDS.parlayPlace) return handleWagerParlayPlace(interaction);
    if (interaction.isModalSubmit() && interaction.customId === WAGER_CUSTOM_IDS.stakeModal) return handleWagerStakeModal(interaction);

    if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && !menuSessions.touch(interaction.user.id)) {
      leagueSetupSessions.delete(interaction.user.id);
      await expireWindow(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const { TEAM_LINK_CUSTOM_IDS } = await import("./ui/team-options.js");
      if (
        interaction.customId === ROLE_MGMT_CUSTOM_IDS.roleSelect ||
        interaction.customId === ROLE_MGMT_CUSTOM_IDS.actionSelect ||
        interaction.customId === ROLE_MGMT_CUSTOM_IDS.userSelect
      ) return handleRoleMgmtSelect(interaction);
      if (interaction.customId.startsWith(ACTIVE_CHECK_CUSTOM_IDS.editSelectPrefix)) return handleActiveCheckEditSelect(interaction);
      if (
        interaction.customId === TEAM_LINK_CUSTOM_IDS.simpleConferenceSelect ||
        interaction.customId === TEAM_LINK_CUSTOM_IDS.simpleAfcTeamSelect ||
        interaction.customId === TEAM_LINK_CUSTOM_IDS.simpleNfcTeamSelect ||
        interaction.customId === TEAM_LINK_CUSTOM_IDS.simpleTeamSelect
      ) return handleSimpleTeamLinkSelect(interaction);
      if (
        interaction.customId === TEAM_LINK_CUSTOM_IDS.userSelect ||
        interaction.customId === TEAM_LINK_CUSTOM_IDS.authoritySelect ||
        interaction.customId === TEAM_LINK_CUSTOM_IDS.conferenceSelect ||
        interaction.customId === TEAM_LINK_CUSTOM_IDS.afcTeamSelect ||
        interaction.customId === TEAM_LINK_CUSTOM_IDS.nfcTeamSelect ||
        interaction.customId === TEAM_LINK_CUSTOM_IDS.teamSelect
      ) return handleTeamLinkSelect(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsConferenceSelect) return handleLeagueTeamsConferenceSelect(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.leagueTeamsTeamSelect}:`)) return handleLeagueTeamsTeamSelect(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsEditConferenceSelect) return handleLeagueTeamsEditConferenceSelect(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.leagueTeamsEditTeamSelect}:`)) return handleLeagueTeamsEditTeamSelect(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.leagueTeamsRelocateConferenceSelect}:`)) return handleLeagueTeamsRelocateConferenceSelect(interaction);

      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.simpleUserSelect) return handleSimpleTeamLinkUserSelect(interaction);

      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.roleSelect) return handleSimpleTeamLinkRoleSelect(interaction);

      if (interaction.customId === SERVER_SETUP_CUSTOM_IDS.selectChannelType) {
        const channelType = interaction.values[0];
        serverSetupChannelSessions.set(interaction.user.id, channelType);
        const { buildChannelIdModal } = await import("./ui/server-setup-admin.js");
        return interaction.showModal(buildChannelIdModal(channelType));
      }

      if (interaction.customId === RULES_CUSTOM_IDS.select) return handleRulesSelect(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.teamsConferenceSelect) return handleTeamsPage(interaction);
      if (interaction.customId.startsWith(`${MENU_CUSTOM_IDS.scheduleTeamSelect}:`)) return handleScheduleTeamSelect(interaction);
      if (interaction.customId.startsWith(`${MENU_CUSTOM_IDS.scheduleStatsTeamSelect}:`)) return handleScheduleStatsTeamSelect(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotConferenceSelect) return handleSnapshotConferenceSelect(interaction, buildMainMenuPayload);
      if (interaction.customId.startsWith(`${ROSTERS_CUSTOM_IDS.snapshotTeamSelect}:`)) return handleSnapshotTeamSelect(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsConferenceSelect) return handleLeagueTeamsConferenceSelect(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.leagueTeamsTeamSelect}:`)) return handleLeagueTeamsTeamSelect(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsEditConferenceSelect) return handleLeagueTeamsEditConferenceSelect(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.leagueTeamsEditTeamSelect}:`)) return handleLeagueTeamsEditTeamSelect(interaction);
      if (interaction.customId.startsWith(`${TEAM_REQUEST_CUSTOM_IDS.teamSelectPrefix}:`)) return handleTeamRequestSelect(interaction);
      if (interaction.customId === TEAM_REQUEST_CUSTOM_IDS.conferenceSelect) return handleTeamRequestConference(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.transferDirection) return handleWalletTransferDirection(interaction);
      if (interaction.customId === STREAM_CUSTOM_IDS.serviceSelect) return handleStreamServiceSelect(interaction);
      if (interaction.customId === TROUBLESHOOT_CUSTOM_IDS.reverseUserSelect) return handleReverseTxnUserSelect(interaction);
      if (interaction.customId === TROUBLESHOOT_CUSTOM_IDS.reverseTxnSelect) return handleReverseTxnSelect(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.adminWeekSelect) return handleBoxScoreAdminWeekSelect(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.adminGameSelect) return handleBoxScoreAdminGameSelect(interaction);
      if (interaction.customId === MANUAL_SCORES_CUSTOM_IDS.weekSelect) return handleManualScoresWeekSelect(interaction);
      if (interaction.customId === MANUAL_SCORES_CUSTOM_IDS.gameSelect) return handleManualScoresGameSelect(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctFieldPrefix)) return handleBoxScoreCorrectionsFieldSelect(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctMatchupPrefix)) return handleBoxScoreCorrectionsMatchupSelect(interaction);
      if (interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.correctGameSelectPrefix)) return handleWeeklyScoresCorrectGameSelect(interaction);
      if (interaction.customId === SCHEDULE_IMPORT_CUSTOM_IDS.weekSelect) return handleScheduleImportWeekSelect(interaction);
      if (interaction.customId === CFB_TEAM_SCHEDULE_CUSTOM_IDS.conferenceSelect) return handleCfbTeamScheduleConferenceSelect(interaction);
      if (interaction.customId === CFB_TEAM_SCHEDULE_CUSTOM_IDS.teamSelect) return handleCfbTeamScheduleTeamSelect(interaction);
      if (interaction.customId === CFB_TEAM_SCHEDULE_CUSTOM_IDS.editWeekSelect) return handleCfbTeamScheduleEditWeekSelect(interaction);
      if (interaction.customId === CFB_TEAM_SCHEDULE_CUSTOM_IDS.editTeamSelect) return handleCfbTeamScheduleEditTeamSelect(interaction);
      if (interaction.customId === CFB_SCHEDULE_MANUAL_CUSTOM_IDS.teamSelect) return handleCfbScheduleManualTeamSelect(interaction);
      if (interaction.customId === CFB_SCHEDULE_MANUAL_CUSTOM_IDS.conferenceSelect) return handleCfbScheduleManualConferenceSelect(interaction);
      if (interaction.customId === CFB_SCHEDULE_MANUAL_CUSTOM_IDS.opponentSelect) return handleCfbScheduleManualOpponentSelect(interaction);
      if (interaction.customId === ADVANCE_TIME_CUSTOM_IDS.dateSelect) return handleAdvanceTimeDateSelect(interaction);
      if (interaction.customId === ADVANCE_TIME_CUSTOM_IDS.tzSelect) return handleAdvanceTimeTzSelect(interaction);
      if (interaction.customId === ADVANCE_TIME_CUSTOM_IDS.timeSelect) return handleAdvanceTimeTimeSelect(interaction);
      if (interaction.customId.startsWith(ADVANCE_WIZARD_CUSTOM_IDS.divisionWinnerSelectPrefix)) return handleAdvanceWizardDivisionWinnerSelect(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualWeekSelect) return handleManualScheduleWeekSelect(interaction);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualAfcSelect || interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualNfcSelect || interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualTeamSelect) return handleManualScheduleTeamSelect(interaction);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualConferenceSelect) return handleManualScheduleConferenceSelect(interaction);
      if (interaction.customId === GOTW_CUSTOM_IDS.select) return handleGotwSelect(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === ADVANCE_CUSTOM_IDS.regularWeekSelect || interaction.customId === ADVANCE_CUSTOM_IDS.stageSelect) return handleSetWeekSelect(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === ADVANCE_CUSTOM_IDS.seasonSelect) return handleSetSeasonSelect(interaction, buildAdvanceMgmtRows);
      if (Object.values(LEAGUE_SETUP_CUSTOM_IDS).includes(interaction.customId as any)) return handleLeagueSetupSelect(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.purchaseCapPrefix}:`)) return handleLeagueSetupSelect(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.coreAttrsPrefix}:`)) return handleLeagueSetupSelect(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.attrCapGroupPrefix}:`)) return handleLeagueSetupSelect(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignGroupPrefix}:`)) return handleLeagueSetupSelect(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignTargetSelect}:`)) return handleLeagueSetupSelect(interaction);
      if (interaction.customId.startsWith("rec:purchase:")) return handlePurchaseSelect(interaction);
      if (interaction.customId === LEGENDS_CUSTOM_IDS.groupSelect) return handleLegendGroupSelect(interaction);
      if (interaction.customId === LEGENDS_CUSTOM_IDS.availableSelect) return handleLegendAvailableSelect(interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.clearAllLinks) return handleClearAllTeamLinks(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.customTeamNoLink) return handleCustomTeamNoLink(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsAddRemove) return handleLeagueTeamsAddRemove(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsEdit) return handleLeagueTeamsEdit(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsResetDefaults) return handleLeagueTeamsResetDefaults(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsBack) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsEditBack) return renderLeagueMgmtTeams(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.leagueTeamsEditActionDetails}:`)) return handleLeagueTeamsEditActionDetails(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.leagueTeamsEditActionRelocate}:`)) return handleLeagueTeamsEditActionRelocate(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsEditActionBack) return handleLeagueTeamsEditActionBack(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsConfirmBack) return handleLeagueTeamsConfirmBack(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsConfirmUnlink) return handleLeagueTeamsConfirmUnlink(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.deleteLeagueCancel) return interaction.update(buildAdminPanelPayload(interaction));
      if (interaction.customId === MENU_CUSTOM_IDS.deleteLeagueConfirm) {
        if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "delete league data");
        const week = interaction.guildId ? await recApi.viewLeagueWeek(interaction.guildId).catch(() => null) : null;
        const leagueName = week?.league?.name;
        if (!leagueName) return interaction.reply({ content: "No league is set up for this server.", flags: MessageFlags.Ephemeral });
        return interaction.showModal(buildDeleteLeagueModal(leagueName));
      }
      if (
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.featureActivate ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.featureDeactivate ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.purchaseFeatureDone ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.cancelWizard ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.serverSetupDone ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.purchaseCoreAttrsOpen ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.purchaseCoreAttrsDone ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.attrCapOverrideOpen ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.attrCapOverrideDone ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignDone ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.conferenceAssignCancel ||
        interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.reviewJump}:`)
      ) return handleLeagueSetupButton(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.save) return handleLeagueSetupSave(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.activityRequirementsOpen) {
        const draft = leagueSetupSessions.get(interaction.user.id);
        if (!draft) return interaction.reply({ content: "Session expired. Reopen /menu.", flags: MessageFlags.Ephemeral });
        return interaction.showModal(buildActivityRequirementsModal(draft));
      }
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.activityRequirementsSkip) {
        const draft = leagueSetupSessions.get(interaction.user.id);
        if (!draft) return interaction.reply({ content: "Session expired. Reopen /menu.", flags: MessageFlags.Ephemeral });
        draft.step = draft.editMode ? "settings_picker" : getNextLeagueSetupStep(draft.step, draft);
        leagueSetupSessions.set(interaction.user.id, draft);
        return interaction.update(buildLeagueSetupWindow(draft));
      }
      if (
        interaction.customId === "rec:league_setup:skip_team_linking"
        || interaction.customId === POST_SETUP_SCHEDULE_CUSTOM_IDS.continueFromTeams
      ) {
        return startPostSetupScheduleStep(interaction);
      }
      if (interaction.customId === POST_SETUP_SCHEDULE_CUSTOM_IDS.enterManual) return startPostSetupManualScheduleEntry(interaction);
      if (interaction.customId === POST_SETUP_SCHEDULE_CUSTOM_IDS.prev) return handlePostSetupScheduleViewPage(interaction, -1);
      if (interaction.customId === POST_SETUP_SCHEDULE_CUSTOM_IDS.next) return handlePostSetupScheduleViewPage(interaction, 1);
      if (interaction.customId === POST_SETUP_SCHEDULE_CUSTOM_IDS.finish) return handlePostSetupScheduleFinish(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.mainMenu) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.adminPanel) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.back) return handleBackNavigation(interaction);
      if (isRestrictedLeagueMgmtButton(interaction.customId) && !isFullLeagueAdminInteraction(interaction)) {
        return interaction.reply({
          content: "Co-Commissioners can only use League Mgmt > Teams, League Mgmt > Box Scores, and Back to Menu.",
          flags: MessageFlags.Ephemeral,
        });
      }
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtTeams) return handleLeagueMgmtTeams(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtServerSetup) return handleLeagueMgmtServerSetup(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSchedule) return handleLeagueMgmtSchedule(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleWizard) return handleLeagueMgmtScheduleWizard(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleOneWeek) return handleLeagueMgmtScheduleOneWeek(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleManual) return handleLeagueMgmtScheduleManual(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleView) return startScheduleViewer(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleBack) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtAdvance) return handleLeagueMgmtAdvance(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtUploadScores) return handleLeagueMgmtUploadScores(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtAdvanceWeek) return startAdvanceWeekWizard(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtActiveCheck) return handleActiveCheck(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtGotwPolls) return handleGotwPollsMenu(interaction, buildAdvanceBackRows);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSetGotw) return handleSetGotw(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtRerunGotw) return handleRerunGotwPolls(interaction, buildAdvanceMgmtRows);
      if (interaction.customId.startsWith(`${GOTW_CUSTOM_IDS.confirmPrefix}:`)) return handleGotwConfirm(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtGameChannels) return handleGameChannels(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSetWeek) return handleSetWeek(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSetSeason) return handleSetSeason(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtEosActions) return handleEosActions(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtTroubleshoot) return handleTroubleshootMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtTroubleshootSchedule) return handleLeagueMgmtSchedule(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtTroubleshootEos) return handleEosProjections(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtTroubleshootReverseTxn) return handleReverseTransactionOpen(interaction);
      if (interaction.customId === TROUBLESHOOT_EOS_CUSTOM_IDS.eosPrev) return handleEosProjectionPage(interaction, -1);
      if (interaction.customId === TROUBLESHOOT_EOS_CUSTOM_IDS.eosNext) return handleEosProjectionPage(interaction, 1);
      if (interaction.customId.startsWith(EOS_PAYOUT_CUSTOM_IDS.issueBatchPrefix)) return handleIssueEosPayoutBatch(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtEosPayouts) return handleEosPayouts(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtEosAwards) return handleEosAwards(interaction, { buildRows: buildEosActionsRows, loadRouteChannels: getRouteChannels });
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtPotyTallies) return handlePotyTallies(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtAdvanceBack) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSettings) return handleLeagueMgmtSettings(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtFirstTimeSetup) return handleLeagueMgmtFirstTimeSetup(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtDeleteLeague) return handleLeagueMgmtDeleteLeague(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtRoles) return handleLeagueMgmtRoles(interaction);
      if (
        interaction.customId === ROLE_MGMT_CUSTOM_IDS.prev ||
        interaction.customId === ROLE_MGMT_CUSTOM_IDS.next ||
        interaction.customId === ROLE_MGMT_CUSTOM_IDS.confirm ||
        interaction.customId === ROLE_MGMT_CUSTOM_IDS.back
      ) return handleRoleMgmtButton(interaction);
      if (
        interaction.customId.startsWith(ACTIVE_CHECK_CUSTOM_IDS.bootPrefix) ||
        interaction.customId.startsWith(ACTIVE_CHECK_CUSTOM_IDS.editPrefix) ||
        interaction.customId.startsWith(ACTIVE_CHECK_CUSTOM_IDS.editPagePrefix)
      ) return handleActiveCheckReviewButton(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtBack) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotPrev) return handleSnapshotPageNav(interaction, -1);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotNext) return handleSnapshotPageNav(interaction, +1);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotBack) return renderUserSnapshotPicker(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.identities) return handlePlayerIdentities(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.identitiesPrev) return handlePlayerIdentityNav(interaction, -1);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.identitiesNext) return handlePlayerIdentityNav(interaction, +1);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.identitiesBack) return handlePlayerIdentityBack(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.openTeams) return renderTeamsMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.schedule) return renderScheduleMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleSelectTeam) return startScheduleTeamSelect(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleLeague) return startPublicLeagueScheduleViewer(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleHistory) return startPreviousSeasonScheduleViewer(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.schedulePowerRankings) return handleSchedulePowerRankings(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleSos) return handleScheduleSos(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleStats) return handleScheduleStats(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleBack) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualNextMatchup) return handleManualScheduleNextMatchup(interaction);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualNextWeek) return handleManualScheduleNextWeek(interaction);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualContinueNextWeek) return handleManualScheduleNextWeek(interaction, true);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualComplete) return handleManualScheduleComplete(interaction);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualBack) return handleManualScheduleBack(interaction);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.viewPrev) return handleScheduleViewPage(interaction, -1);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.viewNext) return handleScheduleViewPage(interaction, 1);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.viewPostPublicly) return handleScheduleViewPostPublicly(interaction);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.viewBack) return handleScheduleViewBack(interaction);
      if (interaction.customId.startsWith("rec:purchase:")) return handlePurchaseButton(interaction);
      if (interaction.customId.startsWith(LEGENDS_CUSTOM_IDS.pagePrefix)) return handleLegendPageButton(interaction);
      if (interaction.customId === LEGENDS_CUSTOM_IDS.detailPrev || interaction.customId === LEGENDS_CUSTOM_IDS.detailNext) return handleLegendDetailNav(interaction);
      if (interaction.customId === LEGENDS_CUSTOM_IDS.backToBrowse) return handleLegendBackToBrowse(interaction);
      if (interaction.customId === LEGENDS_CUSTOM_IDS.confirmPurchase) return handleLegendConfirmPurchase(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.placeWager) return handlePlaceWager(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.manageWallet) return handleManageWallet(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.makePurchase) return openPurchaseStore(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.viewUserProfiles) return renderUserSnapshotPicker(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.stream) return handleStreamMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.streamBack) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.cancel) return handleBoxScoreCancel(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.submissionsOpen) return handleBoxScoreSubmissions(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.adminCancel) return handleBoxScoreAdminCancel(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.adminAnotherPrefix)) return handleBoxScoreAdminAnother(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.inboxBack) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.submitConfirm) return handleBoxScoreSubmitConfirm(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.approvePrefix)) return handleBoxScoreApprove(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctOpenPrefix)) return handleBoxScoreCorrectionsOpen(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctCancelPrefix)) return handleBoxScoreCorrectionsCancel(interaction);
      if (interaction.customId === WEEKLY_SCORES_CUSTOM_IDS.uploadOpen) return handleWeeklyScoresUploadOpen(interaction);
      if (interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.approvePrefix)) return handleWeeklyScoresApprove(interaction);
      if (interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.correctOpenPrefix)) return handleWeeklyScoresCorrectOpen(interaction);
      if (interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.cancelPrefix)) return handleWeeklyScoresCancel(interaction);
      if (interaction.customId === MANUAL_SCORES_CUSTOM_IDS.open) return handleManualScoresOpen(interaction);
      if (interaction.customId === MANUAL_SCORES_CUSTOM_IDS.cancel) return handleLeagueMgmtUploadScores(interaction);
      if (interaction.customId.startsWith(MANUAL_SCORES_CUSTOM_IDS.homeWinPrefix)) return handleManualScoresOutcome(interaction, "home", interaction.customId.slice(MANUAL_SCORES_CUSTOM_IDS.homeWinPrefix.length));
      if (interaction.customId.startsWith(MANUAL_SCORES_CUSTOM_IDS.awayWinPrefix)) return handleManualScoresOutcome(interaction, "away", interaction.customId.slice(MANUAL_SCORES_CUSTOM_IDS.awayWinPrefix.length));
      if (interaction.customId.startsWith(MANUAL_SCORES_CUSTOM_IDS.tiePrefix)) return handleManualScoresOutcome(interaction, "tie", interaction.customId.slice(MANUAL_SCORES_CUSTOM_IDS.tiePrefix.length));
      if (interaction.customId.startsWith(MANUAL_SCORES_CUSTOM_IDS.anotherPrefix)) return handleManualScoresAnother(interaction, Number(interaction.customId.slice(MANUAL_SCORES_CUSTOM_IDS.anotherPrefix.length)));
      if (interaction.customId.startsWith(SCHEDULE_IMPORT_CUSTOM_IDS.savePrefix)) return handleScheduleImportSave(interaction);
      if (interaction.customId === SCHEDULE_IMPORT_CUSTOM_IDS.cancel) return handleScheduleImportCancel(interaction);
      if (interaction.customId === CFB_TEAM_SCHEDULE_CUSTOM_IDS.editHome) return handleCfbTeamScheduleEditHome(interaction);
      if (interaction.customId === CFB_TEAM_SCHEDULE_CUSTOM_IDS.editAway) return handleCfbTeamScheduleEditAway(interaction);
      if (interaction.customId === CFB_TEAM_SCHEDULE_CUSTOM_IDS.editBack) return handleCfbTeamScheduleEditBack(interaction);
      if (interaction.customId === CFB_TEAM_SCHEDULE_CUSTOM_IDS.approve) return handleCfbTeamScheduleApprove(interaction, buildScheduleMgmtRows);
      if (interaction.customId === CFB_TEAM_SCHEDULE_CUSTOM_IDS.cancel) return handleCfbTeamScheduleCancel(interaction, buildScheduleMgmtRows);
      if (interaction.customId === CFB_SCHEDULE_MANUAL_CUSTOM_IDS.teamPagePrev) return handleCfbScheduleManualTeamPagePrev(interaction);
      if (interaction.customId === CFB_SCHEDULE_MANUAL_CUSTOM_IDS.teamPageNext) return handleCfbScheduleManualTeamPageNext(interaction);
      if (interaction.customId === CFB_SCHEDULE_MANUAL_CUSTOM_IDS.home) return handleCfbScheduleManualHome(interaction);
      if (interaction.customId === CFB_SCHEDULE_MANUAL_CUSTOM_IDS.away) return handleCfbScheduleManualAway(interaction);
      if (interaction.customId === CFB_SCHEDULE_MANUAL_CUSTOM_IDS.skip) return handleCfbScheduleManualSkip(interaction);
      if (interaction.customId === CFB_SCHEDULE_MANUAL_CUSTOM_IDS.continue) return handleCfbScheduleManualContinue(interaction);
      if (interaction.customId === CFB_SCHEDULE_MANUAL_CUSTOM_IDS.cancel) return handleCfbScheduleManualCancel(interaction, buildScheduleMgmtRows);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.denyModalPrefix)) return handleBoxScoreDenyModal(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.helpRules) return interaction.update(buildRulesPanel());
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmt) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId.startsWith(`${MENU_CUSTOM_IDS.teamsPage}:`)) return handleTeamsPage(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.teamsPostOpen) return handlePostOpenTeams(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.requestTeam) return startTeamRequestFlow(interaction);
      if (interaction.customId.startsWith(`${TEAM_REQUEST_CUSTOM_IDS.approvePrefix}:`)) return handleTeamRequestApprove(interaction);
      if (interaction.customId.startsWith(`${TEAM_REQUEST_CUSTOM_IDS.rejectPrefix}:`)) return handleTeamRequestReject(interaction);
      if (interaction.customId.startsWith(`${TEAM_REQUEST_CUSTOM_IDS.rolePrefix}:`)) return handleTeamRequestRole(interaction);
      if (interaction.customId.startsWith(`${ADVANCE_WIZARD_CUSTOM_IDS.homeWinPrefix}`)) return handleAdvanceWizardOutcome(interaction, "home", buildAdvanceMgmtRows);
      if (interaction.customId.startsWith(`${ADVANCE_WIZARD_CUSTOM_IDS.awayWinPrefix}`)) return handleAdvanceWizardOutcome(interaction, "away", buildAdvanceMgmtRows);
      if (interaction.customId.startsWith(`${ADVANCE_WIZARD_CUSTOM_IDS.tiePrefix}`)) return handleAdvanceWizardOutcome(interaction, "tie", buildAdvanceMgmtRows);
      if (interaction.customId.startsWith(`${ADVANCE_WIZARD_CUSTOM_IDS.cancelPrefix}`)) return handleAdvanceWizardCancel(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === ADVANCE_TIME_CUSTOM_IDS.setBtn) return handleAdvanceTimeSet(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === ADVANCE_TIME_CUSTOM_IDS.skipBtn) return handleAdvanceTimeSkip(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === ADVANCE_TIME_CUSTOM_IDS.backBtn) return handleAdvanceTimeBack(interaction, buildAdvanceMgmtRows);
      if (interaction.customId.startsWith(ADVANCE_DM_CUSTOM_IDS.send)) return handleAdvanceDmSend(interaction, buildAdvanceMgmtRows);
      if (interaction.customId.startsWith(ADVANCE_DM_CUSTOM_IDS.skip)) return handleAdvanceDmSkip(interaction, buildAdvanceMgmtRows);
      if (interaction.customId.startsWith(HEADLINES_CUSTOM_IDS.prevPrefix)) return handleHeadlinesNav(interaction, "prev");
      if (interaction.customId.startsWith(HEADLINES_CUSTOM_IDS.nextPrefix)) return handleHeadlinesNav(interaction, "next");
      if (interaction.customId === MENU_CUSTOM_IDS.teamsBack) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.transfer) return handleWalletTransferOpen(interaction);
      if (interaction.customId.startsWith(`${MANAGE_WALLET_CUSTOM_IDS.transferAll}:`)) return handleWalletTransferAll(interaction, interaction.customId.endsWith(":from_savings") ? "from_savings" : "to_savings");
      if (interaction.customId.startsWith(`${MANAGE_WALLET_CUSTOM_IDS.transferCustom}:`)) return interaction.showModal(buildWalletTransferCustomModal(interaction.customId.endsWith(":from_savings") ? "from_savings" : "to_savings"));
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.transactions) return handleWalletTransactions(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.mainMenu) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.back) return handleManageWallet(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.pendingPurchases) return handleWalletPendingPurchases(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.makePurchase) return openPurchaseStore(interaction);
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === SERVER_SETUP_CUSTOM_IDS.channelIdModal) return handleServerSetupChannelIdModal(interaction);
      if (interaction.customId.startsWith(`${MENU_CUSTOM_IDS.setupModal}:`)) return handleSetupModal(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.deleteLeagueModal) return handleDeleteLeagueModal(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.activityRequirementsModal) return handleActivityRequirementsModal(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.coachAbilitiesRestrictionModal) return handleCoachAbilitiesRestrictionModal(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.serverSetupChannelModal}:`)) return handleLeagueSetupServerChannelModal(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.fourthDownCustomModal}:`)) return handleFourthDownCustomModal(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.positionChangeRestrictionModal) return handlePositionRestrictionModal(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.cpuTradingRestrictionModal) return handleCpuTradingRestrictionModal(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.difficultyCustomModal) return handleDifficultyCustomModal(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.attrCapModalPrefix}:`)) return handleAttributeCapModal(interaction);
      if (interaction.customId.startsWith(`${MANAGE_WALLET_CUSTOM_IDS.transferCustomModal}:`)) return handleWalletCustomTransferModal(interaction, interaction.customId.endsWith(":from_savings") ? "from_savings" : "to_savings");
      if (interaction.customId.startsWith(`${STREAM_CUSTOM_IDS.linkModal}:`)) return handleStreamLinkModal(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.customTeamModal}:`) || interaction.customId === TEAM_LINK_CUSTOM_IDS.editTeamModal) return handleCustomTeamModal(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctModalPrefix)) return handleBoxScoreCorrectionsModal(interaction);
      if (interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.correctModalPrefix)) return handleWeeklyScoresCorrectModal(interaction);
      if (interaction.customId.startsWith(ADVANCE_WIZARD_CUSTOM_IDS.scoreModalPrefix)) return handleAdvanceWizardScoreModal(interaction, buildAdvanceMgmtRows);
      if (interaction.customId.startsWith(MANUAL_SCORES_CUSTOM_IDS.scoreModalPrefix)) {
        const [outcome, gameId] = interaction.customId.slice(MANUAL_SCORES_CUSTOM_IDS.scoreModalPrefix.length).split(":");
        return handleManualScoresScoreModal(interaction, outcome as "home" | "away" | "tie", gameId);
      }
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.denyModalPrefix)) return handleBoxScoreDenySubmit(interaction);
      if (interaction.customId === ADVANCE_CUSTOM_IDS.seasonManualModal) return handleSetSeasonManual(interaction, buildAdvanceMgmtRows);
      if (interaction.customId.startsWith("rec:purchase:")) return handlePurchaseModal(interaction);
      if (interaction.customId === LEGENDS_CUSTOM_IDS.replaceModal) return handleLegendReplaceModalSubmit(interaction);
    }
  } catch (error) {
    await safeInteractionError(interaction, error);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (await handleStreamChannelMessage(message).catch(() => false)) return;
  if (await handleHighlightChannelMessage(message).catch(() => false)) return;
  if (await handleWeeklyScoresUploadMessage(message).catch(() => false)) return;
  if (await handleScheduleImportUploadMessage(message).catch(() => false)) return;
  if (await handleCfbTeamScheduleUploadMessage(message).catch(() => false)) return;
  if (await handleCommissionerBoxScoreSubmissionMessage(message).catch(() => false)) return;
  await handleBoxScoreChannelMessage(message).catch(() => undefined);
});

client.on("messageReactionAdd", async (reaction, user) => {
  await handleHighlightReactionRestrict(reaction, user).catch(() => undefined);
});

async function buildMainMenuPayload(userId: string, guildId: string | null, isAdmin: boolean) {
  let menuEmbed = buildLeagueMenuEmbed({ discordUsername: "Loading REC profile..." });
  let isLinkedToTeamForRows = false;
  const unregisteredNotice = "You are not currently registered in the REC League's database. Open **Teams** below to select an open team. Once a Commissioner/League Manager approves your request, you'll be added to the database.";

  if (!guildId) {
    return {
      embeds: [buildLeagueMenuEmbed({ discordUsername: "Open /menu inside a REC Discord server", canManageLeague: isAdmin })],
      components: buildLeagueMenuRows(isAdmin, false)
    };
  }

  try {
    const profile = await recApi.getMenuProfile(userId, guildId);
    const display = profile?.display ?? {};
    const hasResolvedProfile = Boolean(profile?.user || profile?.discord || profile?.league || profile?.team || display.discordUsername);
    const isLinkedToTeam = Boolean(profile?.team);
    isLinkedToTeamForRows = isLinkedToTeam;

    menuEmbed = buildLeagueMenuEmbed({
      ...display,
      discordUsername: display.discordUsername ?? profile?.discord?.global_name ?? profile?.discord?.username ?? "Linked REC User",
      teamName: display.teamName ?? profile?.team?.name ?? null,
      wallet: display.wallet ?? profile?.wallet?.wallet_balance ?? 0,
      savings: display.savings ?? profile?.wallet?.savings_balance ?? 0,
      leagueName: display.leagueName ?? profile?.league?.name ?? "Current League",
      seasonNumber: display.seasonNumber ?? profile?.league?.season_number ?? profile?.league?.display_season_number ?? null,
      currentWeek: display.currentWeek ?? profile?.league?.current_week ?? null,
      seasonStage: display.seasonStage ?? profile?.league?.season_stage ?? profile?.league?.current_phase ?? "regular_season",
      hideLeagueInfo: !isLinkedToTeam,
      noticeText: isLinkedToTeam ? undefined : buildUnlinkedTeamNotice(profile),
      canManageLeague: isAdmin
    });

    if (!hasResolvedProfile) {
      console.warn("REC menu profile returned no resolved data", { userId, guildId, profile });
    }
  } catch (error) {
    console.warn("Failed to load REC menu profile", { userId, guildId, error });
    const message = error instanceof Error ? error.message : String(error);
    const isMissingRecUser = message.includes("404") || /Discord account not found/i.test(message);
    menuEmbed = buildLeagueMenuEmbed({
      discordUsername: isMissingRecUser ? `<@${userId}>` : "REC profile failed to load",
      wallet: isMissingRecUser ? "No Balance" : 0,
      savings: isMissingRecUser ? "No Balance" : 0,
      projectedInterest: isMissingRecUser ? "None" : 0,
      teamName: isMissingRecUser ? null : "Check API logs",
      leagueName: isMissingRecUser ? "REC League" : "Profile endpoint error",
      seasonStage: "regular_season",
      hideLeagueInfo: isMissingRecUser,
      noticeText: isMissingRecUser ? unregisteredNotice : undefined,
      canManageLeague: isAdmin
    });
  }

  return {
    embeds: [menuEmbed],
    components: buildLeagueMenuRows(isAdmin, isLinkedToTeamForRows)
  };
}

async function handleMenuCommand(interaction: Extract<Interaction, { isChatInputCommand(): boolean }>) {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  menuSessions.set(interaction.user.id, true);
  await interaction.editReply(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isDiscordAdminInteraction(interaction)));
}

async function renderMainMenuFromComponent(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  await interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isDiscordAdminInteraction(interaction)));
}

async function renderAdminPanelFromComponent(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can open the Admin Panel.", flags: MessageFlags.Ephemeral });
  await interaction.update(buildAdminPanelPayload(interaction));
}

async function handleLeagueMgmtTeams(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can manage league teams.", flags: MessageFlags.Ephemeral });
  }
  return renderLeagueMgmtTeams(interaction);
}

async function handleLeagueMgmtServerSetup(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "manage server setup");
  }
  return interaction.update(buildServerSetupPanel());
}

async function isCfbLeagueForGuild(guildId: string | null): Promise<boolean> {
  if (!guildId) return false;
  const week = await recApi.viewLeagueWeek(guildId).catch(() => null);
  return week?.league?.game === "cfb_27";
}

async function handleLeagueMgmtSchedule(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "manage league schedule imports");
  }
  const isCfbLeague = await isCfbLeagueForGuild(interaction.guildId);
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Schedule")
      .setDescription(isCfbLeague ? [
        "Build, review, or publish the league schedule.",
        "",
        "**Schedule Wizard** / **Upload One Week** - upload a team's in-game **Team Schedule** screenshot (1-2 images cover a full season); pick a conference, then the team. Saving a team's schedule also populates each opponent's matching week.",
        "**Set Manually** - choose teams from league-loaded conference dropdowns and save matchups.",
        "**View Schedule** - page through every week and optionally post a week publicly.",
      ].join("\n") : [
        "Build, review, or publish the league schedule.",
        "",
        "**Schedule Wizard** - upload schedule screenshots in order, starting at Week 1.",
        "**Upload One Week** - upload screenshots for one selected week.",
        "**Set Manually** - choose teams from league-loaded AFC/NFC dropdowns and save matchups.",
        "**View Schedule** - page through every week and optionally post a week publicly.",
      ].join("\n"))],
    components: buildScheduleMgmtRows()
  });
}

function buildScheduleMgmtRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleView).setLabel("View Schedule").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleManual).setLabel("Set Manually").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleOneWeek).setLabel("Upload One Week").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleWizard).setLabel("Schedule Wizard").setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleBack).setLabel("Back to League Mgmt").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtBack).setLabel("Main Menu").setStyle(ButtonStyle.Danger),
    ),
  ];
}

// Both "Schedule Wizard" and "Upload One Week" route to the CFB Team Schedule import
// (conference -> team -> upload) for CFB leagues — CFB's in-game schedule screen is per-team,
// full-season, not per-week/all-teams like Madden's, so there's no CFB equivalent of a
// single-week screenshot to route "Upload One Week" to separately.
async function handleLeagueMgmtScheduleWizard(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "manage league schedule imports");
  }
  if (await isCfbLeagueForGuild(interaction.guildId)) return startCfbTeamScheduleImport(interaction, buildScheduleMgmtRows);
  return startScheduleImportWizard(interaction, buildScheduleMgmtRows);
}

async function handleLeagueMgmtScheduleOneWeek(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "manage league schedule imports");
  }
  if (await isCfbLeagueForGuild(interaction.guildId)) return startCfbTeamScheduleImport(interaction, buildScheduleMgmtRows);
  return startScheduleImportOneWeek(interaction, buildScheduleMgmtRows);
}

// CFB's "Set Manually" routes to the team-first weekly wizard (pick a user-controlled team,
// then walk its whole season one week at a time) instead of the older week-first/all-teams
// matchup-by-matchup flow, which stays the default for Madden leagues.
async function handleLeagueMgmtScheduleManual(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "manage league schedule imports");
  }
  if (await isCfbLeagueForGuild(interaction.guildId)) return startCfbTeamScheduleManualEntry(interaction, buildScheduleMgmtRows);
  return startManualScheduleEntry(interaction);
}

async function handleLeagueMgmtAdvance(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "advance the league");
  }
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Advance")
      .setDescription([
        "Run weekly league operations from one place.",
        "",
        "**Advance in-game first.** REC should be advanced after the console league is advanced so score uploads and new playoff schedules are available.",
        "",
        "**Upload Scores** opens commissioner score catch-up tools.",
        "**Advance Week** changes only the league week/stage.",
        "**GOTW Polls** sets or reruns voting polls.",
        "**Game Channels** creates private channels for scheduled H2H games with two linked users.",
        "**Set Week / Set Season** manually correct the league clock.",
        "**EOS Actions** opens postseason tools; actions stay gated until the right week.",
        "**Troubleshoot** checks schedule, payout, transaction, and blocker workflows."
      ].join("\n"))],
    components: buildAdvanceMgmtRows()
  });
}

function buildAdvanceMgmtRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtUploadScores).setLabel("Upload Scores").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvanceWeek).setLabel("Advance Week").setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtGotwPolls).setLabel("GOTW Polls").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtGameChannels).setLabel("Game Channels").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSetWeek).setLabel("Set Week").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSetSeason).setLabel("Set Season").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosActions).setLabel("EOS Actions").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtTroubleshoot).setLabel("Troubleshoot").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvanceBack).setLabel("Back to League Mgmt").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtBack).setLabel("Main Menu").setStyle(ButtonStyle.Danger)
    ),
  ];
}

function buildAdvanceBackRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvance).setLabel("Back").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtBack).setLabel("Main Menu").setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function handleLeagueMgmtUploadScores(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "upload score data");
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Upload Scores")
      .setDescription([
        "Use these tools after the in-game week has been advanced enough for the needed screenshots to exist.",
        "",
        "**Box Scores** - submit or review individual game box scores on behalf of users.",
        "**Weekly Scores** - upload weekly scoreboard screenshots for the current week.",
        "**Manual Scores** - type in a game's result by hand when a screenshot isn't available (full score, or just W/L/T)."
      ].join("\n"))],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(BOX_SCORE_CUSTOM_IDS.submissionsOpen).setLabel("Box Scores").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(WEEKLY_SCORES_CUSTOM_IDS.uploadOpen).setLabel("Weekly Scores").setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(MANUAL_SCORES_CUSTOM_IDS.open).setLabel("Manual Scores").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvance).setLabel("Back").setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

async function handleTroubleshootMenu(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "open advance troubleshooting");
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Troubleshoot")
      .setDescription([
        "Use these when an advance is blocked or something needs repair before the next REC advance.",
        "",
        "**Weekly Schedule** opens schedule repair tools.",
        "**EOS Projections** will page through projected EOS payouts.",
        "**Reverse Transaction** will refund or reverse a recent wallet transaction."
      ].join("\n"))],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtTroubleshootSchedule).setLabel("Weekly Schedule").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtTroubleshootEos).setLabel("EOS Projections").setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtTroubleshootReverseTxn).setLabel("Reverse Transaction").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvance).setLabel("Back").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

function formatMoney(n: unknown) {
  return `$${Number(n ?? 0).toLocaleString("en-US")}`;
}

function formatTxnOption(txn: any) {
  const amount = Number(txn.amount ?? 0);
  const type = String(txn.transaction_type ?? "transaction").replaceAll("_", " ");
  return `${amount >= 0 ? "+" : ""}$${amount} ${type}`.slice(0, 100);
}

async function handleReverseTransactionOpen(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "reverse transactions");
  await interaction.deferUpdate();
  const coaches = (await recApi.getLeagueCoaches(interaction.guildId).catch(() => null))?.coaches ?? [];
  const linked = coaches.filter((coach: any) => coach.discordId).slice(0, 25);
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Reverse Transaction").setDescription("Select an active linked coach, then choose one of their last 24 league transactions to reverse.")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TROUBLESHOOT_CUSTOM_IDS.reverseUserSelect)
          .setPlaceholder("Select linked coach")
          .setDisabled(!linked.length)
          .addOptions(...(linked.length ? linked.map((coach: any) => new StringSelectMenuOptionBuilder()
            .setLabel(`${coach.teamAbbreviation ?? coach.teamName ?? "Team"} - ${coach.displayName ?? coach.discordId}`.slice(0, 100))
            .setValue(coach.discordId)
          ) : [new StringSelectMenuOptionBuilder().setLabel("No linked coaches").setValue("none")])),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtTroubleshoot).setLabel("Back").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function handleReverseTxnUserSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const discordId = interaction.values[0];
  if (!discordId || discordId === "none") return interaction.reply({ content: "No coach selected.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  const result = await recApi.listReversibleTransactions({ guildId: interaction.guildId, discordId });
  const transactions = (result.transactions ?? []).filter((txn: any) => txn.reversible).slice(0, 24);
  reverseTxnSessions.set(interaction.user.id, { discordId, transactions });
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Reverse Transaction").setDescription(`Selected <@${discordId}>. Choose one transaction to reverse.`)],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TROUBLESHOOT_CUSTOM_IDS.reverseTxnSelect)
          .setPlaceholder("Select transaction")
          .setDisabled(!transactions.length)
          .addOptions(...(transactions.length ? transactions.map((txn: any) => new StringSelectMenuOptionBuilder()
            .setLabel(formatTxnOption(txn))
            .setDescription(String(txn.description ?? txn.source ?? "No description").slice(0, 100))
            .setValue(txn.id)
          ) : [new StringSelectMenuOptionBuilder().setLabel("No reversible transactions").setValue("none")])),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtTroubleshootReverseTxn).setLabel("Back").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function handleReverseTxnSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = reverseTxnSessions.get(interaction.user.id);
  const ledgerId = interaction.values[0];
  if (!session || !ledgerId || ledgerId === "none") return interaction.reply({ content: "Transaction selection expired.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  const result = await recApi.reverseTransaction({ guildId: interaction.guildId, discordId: session.discordId, ledgerId, requestedByDiscordId: interaction.user.id });
  reverseTxnSessions.delete(interaction.user.id);
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Transaction Reversed")
      .setDescription(`Posted a compensating transaction for <@${session.discordId}>: **${formatMoney(result.amount)}**.`)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtTroubleshoot).setLabel("Back").setStyle(ButtonStyle.Secondary),
    )],
  });
}

function buildEosActionsRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosPayouts).setLabel("Payouts").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosAwards).setLabel("Awards").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtPotyTallies).setLabel("POTY Votes").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvance).setLabel("Back").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function handleEosActions(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "run EOS actions");
  const week = interaction.guildId ? await recApi.viewLeagueWeek(interaction.guildId).catch(() => null) : null;
  const currentStage = String(week?.league?.season_stage ?? "regular_season");
  const gated = !isEosPayoutEligibleStage(currentStage, week?.league?.game ?? null);
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("EOS Actions")
      .setDescription([
        gated
          ? "**Postseason action gates are active.** You can open this menu now, but payout/POTY workflows unlock once the postseason begins."
          : "**Postseason action gates are open.**",
        "",
        "**Payouts** issues end-of-season stat/award payouts for review.",
        "**Awards** prepares end-of-season award reviews.",
        "**POTY Votes** tallies the Play of the Year emoji votes and prepares category payout reviews.",
      ].join("\n"))],
    components: buildEosActionsRows(),
  });
}

function buildUnlinkedTeamNotice(profile: any) {
  const wallet = Number(profile?.wallet?.wallet_balance ?? profile?.display?.wallet ?? 0);
  const savings = Number(profile?.wallet?.savings_balance ?? profile?.display?.savings ?? 0);
  const globalWins = Number(profile?.globalRecord?.wins ?? 0);
  const globalLosses = Number(profile?.globalRecord?.losses ?? 0);
  const hasRecHistory = wallet > 0 || savings > 0 || globalWins + globalLosses > 0;

  if (hasRecHistory) {
    return "You have a REC account but are not linked to a team in this league. Open **Teams** below to request an open team. Once a Commissioner/League Manager approves your link, you'll appear on this league's roster.";
  }

  return "You are registered in REC but not linked to a team in this league yet. Open **Teams** below to select an open team. Once approved, you'll be added to this league's roster.";
}

async function handlePotyTallies(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "run POTY tallies");
  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  const currentStage = String(week?.league?.season_stage ?? "regular_season");
  if (!isEosPayoutEligibleStage(currentStage, week?.league?.game ?? null)) {
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle("POTY Tallies").setDescription("POTY Tallies are only available during the postseason (after the regular season ends, through the championship game).")], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Running POTY Tallies...").setDescription("Fetching eligible highlights, counting category reactions, and preparing payout reviews for any unpaid winners.")] });
  const result = await settleHighlightAwardsForGuild(interaction.guildId, interaction.client as any);
  if (result.alreadyFinalized) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("POTY Tallies").setDescription("Play of the Year is already finalized for this season — reaction changes no longer affect results. It resets when the league advances to a new season.")] });
  }
  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("POTY Tallies").setDescription(`Tallied Play of the Year reactions and prepared ${result.winners.length} category review(s). Ties split the $500 evenly.`)] });
}

async function handleLeagueMgmtSettings(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "manage league settings");
  }
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "This action requires a guild context.", flags: MessageFlags.Ephemeral });

  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading League Settings...").setDescription("Fetching current league configuration.")], components: [] });
  try {
    const result = await recApi.getLeagueConfig(interaction.guildId);
    const draft = { ...result.draft, step: "settings_picker" as const, editMode: true };
    leagueSetupSessions.set(interaction.user.id, draft as LeagueSetupDraft);
    const window = buildSettingsPickerWindow(draft as LeagueSetupDraft);
    return interaction.editReply({ ...window, components: window.components });
  } catch {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Settings").setDescription("No league configuration found. Run First-Time Setup first.")], components: buildAdminPanelRows() });
  }
}

async function handleLeagueMgmtFirstTimeSetup(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "run first-time setup");
  }
  return interaction.showModal(buildSetupDangerModal("league_setup"));
}

async function getRoleMgmtMembers(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return [];
  const members = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
  return [...members.values()]
    .filter((member) => !member.user.bot)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function buildRoleMgmtPanel(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  const session = roleMgmtSessions.get(interaction.user.id) ?? { selectedUserIds: [], page: 0 };
  const members = await getRoleMgmtMembers(interaction);
  const totalPages = Math.max(1, Math.ceil(members.length / 25));
  session.page = Math.max(0, Math.min(session.page, totalPages - 1));
  roleMgmtSessions.set(interaction.user.id, session);

  const start = session.page * 25;
  const pageMembers = members.slice(start, start + 25);
  const roleName = session.roleKey ? REC_MANAGED_ROLES[session.roleKey].name : "Not selected";
  const actionLabel = session.action === "add" ? "Add role" : session.action === "remove" ? "Remove role" : "Not selected";

  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ROLE_MGMT_CUSTOM_IDS.roleSelect)
        .setPlaceholder("Select REC role")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel(REC_MANAGED_ROLES.member.name).setValue("member").setDefault(session.roleKey === "member"),
          new StringSelectMenuOptionBuilder().setLabel(REC_MANAGED_ROLES.compCommittee.name).setValue("compCommittee").setDefault(session.roleKey === "compCommittee"),
          new StringSelectMenuOptionBuilder().setLabel(REC_MANAGED_ROLES.commissioner.name).setValue("commissioner").setDefault(session.roleKey === "commissioner"),
        )
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ROLE_MGMT_CUSTOM_IDS.actionSelect)
        .setPlaceholder("Add or remove")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("Add Role").setValue("add").setDefault(session.action === "add"),
          new StringSelectMenuOptionBuilder().setLabel("Remove Role").setValue("remove").setDefault(session.action === "remove"),
        )
    ),
  ];

  if (pageMembers.length) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ROLE_MGMT_CUSTOM_IDS.userSelect)
        .setPlaceholder(`Select users (${start + 1}-${start + pageMembers.length} of ${members.length})`)
        .setMinValues(1)
        .setMaxValues(pageMembers.length)
        .addOptions(...pageMembers.map((member) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(member.displayName.slice(0, 100))
            .setDescription(member.user.username.slice(0, 100))
            .setValue(member.id)
            .setDefault(session.selectedUserIds.includes(member.id))
        ))
    ));
  }

  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ROLE_MGMT_CUSTOM_IDS.prev).setLabel("Prev").setStyle(ButtonStyle.Secondary).setDisabled(session.page <= 0),
    new ButtonBuilder().setCustomId(ROLE_MGMT_CUSTOM_IDS.next).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(session.page >= totalPages - 1),
    new ButtonBuilder().setCustomId(ROLE_MGMT_CUSTOM_IDS.confirm).setLabel("Confirm").setStyle(ButtonStyle.Success).setDisabled(!session.roleKey || !session.action || !session.selectedUserIds.length),
    new ButtonBuilder().setCustomId(ROLE_MGMT_CUSTOM_IDS.back).setLabel("Back").setStyle(ButtonStyle.Danger),
  ));

  return {
    embeds: [new EmbedBuilder()
      .setTitle("League Roles")
      .setDescription([
        `Role: **${roleName}**`,
        `Action: **${actionLabel}**`,
        `Selected users: **${session.selectedUserIds.length}**`,
        `Page: **${session.page + 1}/${totalPages}**`,
      ].join("\n"))],
    components: rows,
  };
}

async function handleLeagueMgmtRoles(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "manage league roles");
  }
  roleMgmtSessions.set(interaction.user.id, { selectedUserIds: [], page: 0 });
  return interaction.update(await buildRoleMgmtPanel(interaction));
}

async function handleRoleMgmtSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "manage league roles");
  await interaction.deferUpdate();
  const session = roleMgmtSessions.get(interaction.user.id) ?? { selectedUserIds: [], page: 0 };
  if (interaction.customId === ROLE_MGMT_CUSTOM_IDS.roleSelect) {
    session.roleKey = interaction.values[0] as RoleMgmtRoleKey;
  } else if (interaction.customId === ROLE_MGMT_CUSTOM_IDS.actionSelect) {
    session.action = interaction.values[0] as RoleMgmtAction;
  } else if (interaction.customId === ROLE_MGMT_CUSTOM_IDS.userSelect) {
    const visible = new Set<string>(interaction.values);
    const members = await getRoleMgmtMembers(interaction);
    const pageIds = new Set(members.slice(session.page * 25, session.page * 25 + 25).map((member) => member.id));
    session.selectedUserIds = [
      ...session.selectedUserIds.filter((id) => !pageIds.has(id)),
      ...visible,
    ];
  }
  roleMgmtSessions.set(interaction.user.id, session);
  return interaction.editReply(await buildRoleMgmtPanel(interaction));
}

async function handleRoleMgmtButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "manage league roles");
  await interaction.deferUpdate();
  const session = roleMgmtSessions.get(interaction.user.id) ?? { selectedUserIds: [], page: 0 };

  if (interaction.customId === ROLE_MGMT_CUSTOM_IDS.back) {
    roleMgmtSessions.delete(interaction.user.id);
    return interaction.editReply(buildAdminPanelPayload(interaction));
  }

  if (interaction.customId === ROLE_MGMT_CUSTOM_IDS.prev) session.page -= 1;
  if (interaction.customId === ROLE_MGMT_CUSTOM_IDS.next) session.page += 1;

  if (interaction.customId !== ROLE_MGMT_CUSTOM_IDS.confirm) {
    roleMgmtSessions.set(interaction.user.id, session);
    return interaction.editReply(await buildRoleMgmtPanel(interaction));
  }

  if (!session.roleKey || !session.action || !session.selectedUserIds.length) {
    roleMgmtSessions.set(interaction.user.id, session);
    return interaction.editReply(await buildRoleMgmtPanel(interaction));
  }

  const roles = await ensureRecBaseRoles(interaction.guild);
  const role = session.roleKey === "member" ? roles.member : session.roleKey === "compCommittee" ? roles.compCommittee : roles.commissioner;
  let changed = 0;
  for (const userId of session.selectedUserIds) {
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    if (session.action === "add") {
      await member.roles.add(role, `REC League Mgmt Roles by ${interaction.user.tag}`).catch(() => undefined);
      changed += 1;
    } else {
      await member.roles.remove(role, `REC League Mgmt Roles by ${interaction.user.tag}`).catch(() => undefined);
      changed += 1;
    }
  }

  roleMgmtSessions.delete(interaction.user.id);
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("League Roles Updated")
      .setDescription(`${session.action === "add" ? "Added" : "Removed"} **${role.name}** for **${changed}** user(s).`)],
    components: buildAdminPanelRows(),
  });
}

async function handleLeagueMgmtDeleteLeague(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "delete league data");
  }
  const week = interaction.guildId ? await recApi.viewLeagueWeek(interaction.guildId).catch(() => null) : null;
  const leagueName = week?.league?.name;
  if (!leagueName) {
    return interaction.update({ embeds: [new EmbedBuilder().setTitle("Delete League").setDescription("No league is set up for this server, so there is nothing to delete.")], components: buildAdminPanelRows() });
  }
  return interaction.update(buildDeleteLeagueWarningPayload(leagueName));
}

async function handleDeleteLeagueModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "delete league data");
  }
  const confirmationText = interaction.fields.getTextInputValue(MENU_CUSTOM_IDS.deleteLeagueNameInput);
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Deleting League Data...").setDescription("Erasing all league records, links, and data. This may take a moment.")], components: [] });
  try {
    const result = await recApi.deleteLeagueData({ guildId: interaction.guildId, requestedByDiscordId: interaction.user.id, confirmationText });
    const rows = result?.result?.rows_deleted ?? 0;
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("League Data Deleted").setColor(COLORS.success).setDescription([
        `**${result?.leagueName ?? "The league"}** has been permanently erased (${rows} row${rows === 1 ? "" : "s"} removed across league tables).`,
        "",
        "Run the League Setup Wizard to set up a new league for this server."
      ].join("\n"))],
      components: buildAdminPanelRows()
    });
  } catch (error) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Delete Failed").setColor(COLORS.error).setDescription(userFacingError(error))],
      components: buildAdminPanelRows()
    });
  }
}

async function handleBackNavigation(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (draft) {
    const previous = getPreviousLeagueSetupStep(draft.step, draft);
    if (previous === "admin_panel") {
      leagueSetupSessions.delete(interaction.user.id);
      return interaction.update(buildAdminPanelPayload(interaction));
    }
    draft.step = previous;
    leagueSetupSessions.set(interaction.user.id, draft);
    if (draft.editMode && previous === "settings_picker") {
      return interaction.update(buildSettingsPickerWindow(draft));
    }
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  await renderMainMenuFromComponent(interaction);
}

async function handleServerSetupChannelIdModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit() || !interaction.inCachedGuild()) return;

  // The modal is always opened from the channel-type select menu, so this updates that same
  // message in place rather than posting a new ephemeral "Channel Assigned" message each time.
  const canUpdate = interaction.isFromMessage();
  if (canUpdate) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { getRecRouteChannel } = await import("@rec/shared");
    const { SERVER_SETUP_CUSTOM_IDS, buildServerSetupPanel } = await import("./ui/server-setup-admin.js");
    const channelId = interaction.fields.getTextInputValue(SERVER_SETUP_CUSTOM_IDS.channelIdInput).trim();
    const channelType = serverSetupChannelSessions.get(interaction.user.id);

    if (!channelType) {
      return interaction.editReply({ content: "Channel type selection expired. Please try again.", embeds: [], components: [] });
    }

    const routeChannel = getRecRouteChannel(channelType);
    if (!routeChannel) {
      return interaction.editReply({ content: `Unknown channel type: ${channelType}`, embeds: [], components: [] });
    }

    await recApi.setEconomyConfig({ guildId: interaction.guildId, [routeChannel.inputField]: channelId });

    serverSetupChannelSessions.delete(interaction.user.id);

    return interaction.editReply(buildServerSetupPanel(`Assigned <#${channelId}> to **${channelType.replace(/_/g, " ")}**.`));
  } catch (error) {
    console.error("[ERROR] Server setup channel assignment failed:", error);
    return interaction.editReply({ content: `Error assigning channel: ${userFacingError(error)}`, embeds: [], components: [] });
  }
}

function appendReviewActionToMessage(interaction: any, actionLabel: string) {
  const userMention = `<@${interaction.user.id}>`;
  const formatted = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date());
  const line = `${actionLabel} by ${userMention} on ${formatted} CST`;
  const embeds = interaction.message.embeds.map((embed: any) => {
    const builder = EmbedBuilder.from(embed);
    const current = embed.description ?? "";
    if (current.includes(`${actionLabel} by <@${interaction.user.id}>`)) return builder;
    builder.setDescription([current, "", `**${line}**`].filter(Boolean).join("\n"));
    return builder;
  });
  return interaction.message.edit({ embeds, components: [] }).catch(() => undefined);
}

async function handleStreamReviewButton(interaction: any) {
  if (!interaction.isButton()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can review stream payouts.", flags: MessageFlags.Ephemeral });
    return;
  }
  const parts = interaction.customId.split(":");
  const action = parts[2] === "approve" ? "approve" : "deny";
  const reviewId = parts[3];
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await recApi.reviewStreamPayout({ reviewId, action, reviewedByDiscordId: interaction.user.id, deniedReason: action === "deny" ? "Denied by commissioner review." : null });
  await interaction.editReply(result.updated ? `Stream payout ${action === "approve" ? "approved and issued" : "denied"}.` : (result.reason ?? "No update made."));
  if (result.updated && action === "approve" && result.streamLog?.discord_channel_id && result.streamLog?.discord_message_id && interaction.inCachedGuild()) {
    const sourceChannel = await interaction.guild.channels.fetch(result.streamLog.discord_channel_id).catch(() => null);
    if (sourceChannel?.isTextBased()) {
      const sourceMessage = await sourceChannel.messages.fetch(result.streamLog.discord_message_id).catch(() => null);
      await sourceMessage?.react("\u2705").catch(() => undefined);
    }
  }
  // DM the streamer that their payout was issued.
  if (result.updated && action === "approve" && result.streamerDiscordId) {
    const amount = result.amount ?? 50;
    const streamer = await interaction.client.users.fetch(result.streamerDiscordId).catch(() => null);
    await streamer?.send(`You've been paid **$${amount}** for streaming your game this week. Thanks for streaming!`).catch(() => undefined);
  }
  if (result.updated && interaction.message?.editable) {
    await appendReviewActionToMessage(interaction, action === "approve" ? "Applied" : "Denied");
  }
}

// Guild-scoped commands are registered on `clientReady` (registerCommandsForVisibleGuilds,
// covers every guild the bot is already in) and on `guildCreate` (newly joined guilds) — both
// instant. Global registration is a separate, deliberate one-time action (`pnpm --filter
// @rec/bot register`), not run automatically here: registering both scopes for every guild
// on every startup made Discord show "/menu" twice in every server (global + guild commands
// with the same name don't dedupe in Discord's UI).

await client.login(env.DISCORD_TOKEN);
