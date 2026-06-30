import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType, Client, EmbedBuilder, GatewayIntentBits, Interaction, MessageFlags, ModalBuilder, ModalSubmitInteraction, Partials, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { env } from "./config/env.js";
import { registerApplicationCommands, registerGuildCommands } from "./commands.js";
import { isCoCommissionerInteraction, isDiscordAdminInteraction, isFullLeagueAdminInteraction } from "./lib/admin.js";
import { recApi } from "./lib/rec-api.js";
import { getAnnouncementsChannel, getVotingPollsChannel } from "./lib/route-channels.js";
import { ExpiringSessionStore } from "./lib/session-timeout.js";
import { DEV_TIER_EMOJIS } from "./lib/tier-emojis.js";
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
import { handlePlayerIdentities, handlePlayerIdentityBack, handlePlayerIdentityNav, handlePostOpenTeams, handleSnapshotConferenceSelect, handleSnapshotPageNav, handleSnapshotTeamSelect, handleTeamsPage, renderTeamsMenu, renderUserSnapshotPicker } from "./flows/rosters.js";
import {
  handleManualScheduleBack,
  handleManualScheduleComplete,
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
  renderSchedulePlaceholder,
  handleScheduleSos,
  handleSchedulePowerRankings,
  SCHEDULE_MGMT_CUSTOM_IDS,
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
import { stageLabel } from "./lib/league-stage.js";
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
  handlePurchaseAllTimeCapModal,
  handleAttributeCapModal,
  handleSetupModal,
  leagueSetupSessions
} from "./flows/league-setup.js";
import { RULES_CUSTOM_IDS, buildRulesPanel } from "./ui/rules.js";
import { handleSimpleTeamLinkSelect, handleSimpleTeamLinkUserSelect, handleSimpleTeamLinkRoleSelect, handleClearAllTeamLinks, handleCustomTeamModal, handleCustomTeamNoLink, renderLeagueMgmtTeams, handleLeagueTeamsAddRemove, handleLeagueTeamsEdit, handleLeagueTeamsConferenceSelect, handleLeagueTeamsTeamSelect, handleLeagueTeamsEditConferenceSelect, handleLeagueTeamsEditTeamSelect, handleLeagueTeamsResetDefaults, handleLeagueTeamsConfirmBack, handleLeagueTeamsConfirmUnlink, handleTeamLinkSelect } from "./flows/team-linking.js";
import { TEAM_LINK_CUSTOM_IDS } from "./ui/team-options.js";
import {
  handleManageWallet,
  handleWalletCustomTransferModal,
  handleWalletTransactions,
  handleWalletTransferAll,
  handleWalletTransferDirection,
  handleWalletTransferOpen,
  handlePlaceWager,
  handleWalletPendingPurchases
} from "./handlers/wallet.js";
import { handleHighlightChannelMessage, handleHighlightReactionRestrict, handleHighlightReviewButton, HIGHLIGHT_REVIEW_PREFIX, settleHighlightAwardsForGuild } from "./handlers/highlights.js";
import { handlePurchaseButton, handlePurchaseModal, handlePurchaseSelect, openPurchaseStore } from "./flows/purchases.js";
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
  handleBoxScoreInbox,
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
  SCHEDULE_IMPORT_CUSTOM_IDS,
  startScheduleImportWizard,
  startScheduleImportOneWeek,
  handleScheduleImportWeekSelect,
  handleScheduleImportUploadMessage,
  handleScheduleImportSave,
  handleScheduleImportCancel,
} from "./flows/schedule-import.js";

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
const ADVANCE_CUSTOM_IDS = {
  gotwSelect: "rec:advance:gotw_select",
  gotwConfirm: "rec:advance:gotw_confirm",
  regularWeekSelect: "rec:advance:regular_week_select",
  stageSelect: "rec:advance:stage_select",
  seasonSelect: "rec:advance:season_select",
  seasonManualModal: "rec:advance:season_manual_modal",
  seasonManualInput: "rec:advance:season_manual_input"
} as const;
const EOS_PAYOUT_CUSTOM_IDS = {
  issueBatchPrefix: "rec:eos_payouts:issue:",
  approveUserPrefix: "rec:eos:ap:",
  denyUserPrefix: "rec:eos:dn:"
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

function replyFullAdminOnly(interaction: { reply: (options: any) => Promise<any> }, action: string) {
  return interaction.reply({
    content: `Only commissioners or server admins can ${action}.`,
    flags: MessageFlags.Ephemeral,
  });
}

setInterval(() => {
  menuSessions.cleanup();
  leagueSetupSessions.cleanup();
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

    if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && !menuSessions.touch(interaction.user.id)) {
      leagueSetupSessions.delete(interaction.user.id);
      await expireWindow(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const { TEAM_LINK_CUSTOM_IDS } = await import("./ui/team-options.js");
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
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.adminWeekSelect) return handleBoxScoreAdminWeekSelect(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.adminGameSelect) return handleBoxScoreAdminGameSelect(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctFieldPrefix)) return handleBoxScoreCorrectionsFieldSelect(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctMatchupPrefix)) return handleBoxScoreCorrectionsMatchupSelect(interaction);
      if (interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.correctGameSelectPrefix)) return handleWeeklyScoresCorrectGameSelect(interaction);
      if (interaction.customId === SCHEDULE_IMPORT_CUSTOM_IDS.weekSelect) return handleScheduleImportWeekSelect(interaction);
      if (interaction.customId === ADVANCE_TIME_CUSTOM_IDS.dateSelect) return handleAdvanceTimeDateSelect(interaction);
      if (interaction.customId === ADVANCE_TIME_CUSTOM_IDS.tzSelect) return handleAdvanceTimeTzSelect(interaction);
      if (interaction.customId === ADVANCE_TIME_CUSTOM_IDS.timeSelect) return handleAdvanceTimeTimeSelect(interaction);
      if (interaction.customId.startsWith(ADVANCE_WIZARD_CUSTOM_IDS.divisionWinnerSelectPrefix)) return handleAdvanceWizardDivisionWinnerSelect(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualWeekSelect) return handleManualScheduleWeekSelect(interaction);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualAfcSelect || interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualNfcSelect) return handleManualScheduleTeamSelect(interaction);
      if (interaction.customId === ADVANCE_CUSTOM_IDS.gotwSelect) return handleGotwSelect(interaction);
      if (interaction.customId === ADVANCE_CUSTOM_IDS.regularWeekSelect || interaction.customId === ADVANCE_CUSTOM_IDS.stageSelect) return handleSetWeekSelect(interaction);
      if (interaction.customId === ADVANCE_CUSTOM_IDS.seasonSelect) return handleSetSeasonSelect(interaction);
      if (Object.values(LEAGUE_SETUP_CUSTOM_IDS).includes(interaction.customId as any)) return handleLeagueSetupSelect(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.purchaseCapPrefix}:`)) return handleLeagueSetupSelect(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.coreAttrsPrefix}:`)) return handleLeagueSetupSelect(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.attrCapGroupPrefix}:`)) return handleLeagueSetupSelect(interaction);
      if (interaction.customId.startsWith("rec:purchase:")) return handlePurchaseSelect(interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.clearAllLinks) return handleClearAllTeamLinks(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.customTeamNoLink) return handleCustomTeamNoLink(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsAddRemove) return handleLeagueTeamsAddRemove(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsEdit) return handleLeagueTeamsEdit(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsResetDefaults) return handleLeagueTeamsResetDefaults(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsBack) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsEditBack) return renderLeagueMgmtTeams(interaction);
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
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.cancelWizard ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.serverSetupDone ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.purchaseCoreAttrsOpen ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.purchaseCoreAttrsDone ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.attrCapOverrideOpen ||
        interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.attrCapOverrideDone ||
        interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.purchaseAllTimeCapOpenPrefix}:`) ||
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
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleManual) return startManualScheduleEntry(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleView) return startScheduleViewer(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleBack) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtAdvance) return handleLeagueMgmtAdvance(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtAdvanceWeek) return startAdvanceWeekWizard(interaction, buildAdvanceMgmtRows);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtActiveCheck) return handleActiveCheck(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSetGotw) return handleSetGotw(interaction);
      if (interaction.customId.startsWith(`${ADVANCE_CUSTOM_IDS.gotwConfirm}:`)) return handleGotwConfirm(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtGameChannels) return handleGameChannels(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSetWeek) return handleSetWeek(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSetSeason) return handleSetSeason(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtEosActions) return handleEosActions(interaction);
      if (interaction.customId.startsWith(EOS_PAYOUT_CUSTOM_IDS.issueBatchPrefix)) return handleIssueEosPayoutBatch(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtEosPayouts) return handleEosPayouts(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtEosAwards) return replyMenuPlaceholder(interaction, "EOS Awards", "EOS Awards is intentionally a placeholder for now.");
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtPotyTallies) return handlePotyTallies(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtAdvanceBack) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSettings) return handleLeagueMgmtSettings(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtFirstTimeSetup) return handleLeagueMgmtFirstTimeSetup(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtDeleteLeague) return handleLeagueMgmtDeleteLeague(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtRoles) return handleLeagueMgmtRoles(interaction);
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
      if (interaction.customId === MENU_CUSTOM_IDS.schedulePowerRankings) return handleSchedulePowerRankings(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleSos) return handleScheduleSos(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleStats) {
        return renderSchedulePlaceholder(interaction, "Stats", "Season stats for your schedule view are coming soon.");
      }
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
      if (interaction.customId === MENU_CUSTOM_IDS.placeWager) return handlePlaceWager(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.manageWallet) return handleManageWallet(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.makePurchase) return openPurchaseStore(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.viewUserProfiles) return renderUserSnapshotPicker(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.stream) return handleStreamMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.streamBack) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.uploadScoringSummary) return replyMenuPlaceholder(interaction, "Scoring Summary", "Scoring summary uploads are not active yet. Box score uploads are currently used for game results, stats, and payout review.");
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
      if (interaction.customId.startsWith(SCHEDULE_IMPORT_CUSTOM_IDS.savePrefix)) return handleScheduleImportSave(interaction);
      if (interaction.customId === SCHEDULE_IMPORT_CUSTOM_IDS.cancel) return handleScheduleImportCancel(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.denyModalPrefix)) return handleBoxScoreDenyModal(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.helpRules) return interaction.update(buildRulesPanel());
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmt) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId.startsWith(`${MENU_CUSTOM_IDS.teamsPage}:`)) return handleTeamsPage(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.teamsPostOpen) return handlePostOpenTeams(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.requestTeam) return startTeamRequestFlow(interaction);
      if (interaction.customId.startsWith(`${TEAM_REQUEST_CUSTOM_IDS.conferenceSelect}:`)) return handleTeamRequestConference(interaction);
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
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.back) return renderMainMenuFromComponent(interaction);
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
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.purchaseAllTimeCapModalPrefix}:`)) return handlePurchaseAllTimeCapModal(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_SETUP_CUSTOM_IDS.attrCapModalPrefix}:`)) return handleAttributeCapModal(interaction);
      if (interaction.customId.startsWith(`${MANAGE_WALLET_CUSTOM_IDS.transferCustomModal}:`)) return handleWalletCustomTransferModal(interaction, interaction.customId.endsWith(":from_savings") ? "from_savings" : "to_savings");
      if (interaction.customId.startsWith(`${STREAM_CUSTOM_IDS.linkModal}:`)) return handleStreamLinkModal(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.customTeamModal}:`) || interaction.customId === TEAM_LINK_CUSTOM_IDS.editTeamModal) return handleCustomTeamModal(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.correctModalPrefix)) return handleBoxScoreCorrectionsModal(interaction);
      if (interaction.customId.startsWith(WEEKLY_SCORES_CUSTOM_IDS.correctModalPrefix)) return handleWeeklyScoresCorrectModal(interaction);
      if (interaction.customId.startsWith(ADVANCE_WIZARD_CUSTOM_IDS.scoreModalPrefix)) return handleAdvanceWizardScoreModal(interaction, buildAdvanceMgmtRows);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.denyModalPrefix)) return handleBoxScoreDenySubmit(interaction);
      if (interaction.customId === ADVANCE_CUSTOM_IDS.seasonManualModal) return handleSetSeasonManual(interaction);
      if (interaction.customId.startsWith("rec:purchase:")) return handlePurchaseModal(interaction);
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

async function replyMenuPlaceholder(interaction: ButtonInteraction, title: string, description: string) {
  return interaction.reply({
    embeds: [new EmbedBuilder().setTitle(title).setDescription(description)],
    flags: MessageFlags.Ephemeral
  });
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

async function handleLeagueMgmtSchedule(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "manage league schedule imports");
  }
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Schedule")
      .setDescription([
        "Build, review, or publish the league schedule.",
        "",
        "**Schedule Wizard** - upload schedule screenshots in order, starting at Week 1.",
        "**Upload One Week** - upload screenshots for one selected week.",
        "**Set Manually** - choose teams from league-loaded AFC/NFC dropdowns and save matchups.",
        "**View Schedule** - page through every week and optionally post a week publicly."
      ].join("\n"))],
    components: buildScheduleMgmtRows()
  });
}

function buildScheduleMgmtRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleWizard).setLabel("Schedule Wizard").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleOneWeek).setLabel("Upload One Week").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleManual).setLabel("Set Manually").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleView).setLabel("View Schedule").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleBack).setLabel("Back").setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function handleLeagueMgmtScheduleWizard(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "manage league schedule imports");
  }
  return startScheduleImportWizard(interaction, buildScheduleMgmtRows);
}

async function handleLeagueMgmtScheduleOneWeek(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "manage league schedule imports");
  }
  return startScheduleImportOneWeek(interaction, buildScheduleMgmtRows);
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
        "**Advance Week** changes only the league week/stage.",
        "**Active Check** posts the 24-hour activity prompt.",
        "**Set GOTW** posts the current week's GOTW poll to the voting polls channel.",
        "**Game Channels** creates private channels for scheduled H2H games with two linked users.",
        "**Set Week / Set Season** manually correct the league clock.",
        "**EOS Actions** opens postseason payout tools (Wild Card through Super Bowl week)."
      ].join("\n"))],
    components: buildAdvanceMgmtRows()
  });
}

function buildAdvanceMgmtRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvanceWeek).setLabel("Advance Week").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtActiveCheck).setLabel("Active Check").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSetGotw).setLabel("Set GOTW").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtGameChannels).setLabel("Game Channels").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSetWeek).setLabel("Set Week").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSetSeason).setLabel("Set Season").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosActions).setLabel("EOS Actions").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvanceBack).setLabel("Back").setStyle(ButtonStyle.Danger)
    )
  ];
}

function buildEosActionsRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosPayouts).setLabel("Payouts").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosAwards).setLabel("Awards").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtPotyTallies).setLabel("POTY Votes").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvance).setLabel("Back").setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function handleEosActions(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "run EOS actions");
  const week = interaction.guildId ? await recApi.viewLeagueWeek(interaction.guildId).catch(() => null) : null;
  const currentWeek = Number(week?.league?.current_week ?? 1);
  if (currentWeek < 19 || currentWeek > 22) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle("EOS Actions").setColor(0xe74c3c).setDescription("EOS Actions are only available during the postseason — from Week 19 (Wild Card) through Week 22 (Super Bowl). Week 18 is the final week of the regular season.")],
      flags: MessageFlags.Ephemeral,
    });
  }
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("EOS Actions")
      .setDescription([
        "End-of-season payout tools for the postseason.",
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

async function getRouteChannels(guildId: string) {
  const cfg = await recApi.getEconomyConfig(guildId).catch(() => null);
  return cfg?.routes ?? {};
}

async function handleActiveCheck(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "run active checks");
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Posting Active Check...").setDescription("Finding the announcements channel and preparing the active-check prompt.")], components: [] });
  const routes = await getRouteChannels(interaction.guildId);
  const channel = await getAnnouncementsChannel(interaction.guild, routes);
  if (!channel) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Active Check").setDescription("No announcements channel is configured.")], components: buildAdvanceMgmtRows() });
  }
  await channel.send({
    content: "@everyone",
    embeds: [new EmbedBuilder().setTitle("Active Check").setDescription("You have 24 hours to respond: **Yes, I'm Active.**")],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("rec:active_check:yes").setLabel("Yes, I'm Active").setStyle(ButtonStyle.Success)
    )],
    allowedMentions: { parse: ["everyone"] }
  });
  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Active Check Posted").setDescription("The active-check prompt has been posted in announcements. Members can click **Yes, I'm Active** for the next 24 hours.")], components: buildAdvanceMgmtRows() });
}

function teamDisplay(team: any) {
  if (!team) return "TBD";
  if (team.display_city || team.display_nick) return `${team.display_city ?? ""} ${team.display_nick ?? team.name}`.trim();
  return team.display_abbr ?? team.abbreviation ?? team.name ?? "Team";
}

// Nickname only (no city) — used for game channel names, e.g. "frost-bite-vs-cowboys".
function teamNick(team: any) {
  if (!team) return "TBD";
  return team.display_nick ?? team.name ?? team.display_abbr ?? team.abbreviation ?? "Team";
}

async function currentSchedule(interaction: ButtonInteraction) {
  const week = await recApi.viewLeagueWeek(interaction.guildId!);
  const seasonNumber = Number(week?.league?.season_number ?? week?.league?.display_season_number ?? 1);
  const currentWeek = Number(week?.league?.current_week ?? 1);
  const stage = String(week?.league?.season_stage ?? "regular_season");
  const schedule = await recApi.listScheduleSeason({ guildId: interaction.guildId!, seasonNumber });
  const page = (schedule?.weeks ?? []).find((row: any) => Number(row.weekNumber) === currentWeek);
  const games = page?.games ?? [];
  return { seasonNumber, currentWeek, stage, games };
}

async function handleSetGotw(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set GOTW");
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading GOTW Matchups...").setDescription("Checking the active week's logged schedule for games where both teams have linked users.")], components: [] });
  const { currentWeek, stage, games } = await currentSchedule(interaction);
  const h2h = games.filter((g: any) => g.away_discord_id && g.home_discord_id);
  if (!h2h.length) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Set GOTW").setDescription(`No H2H matchups are scheduled for ${stageLabel(stage, currentWeek)}.`)],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvanceBack).setLabel("Back").setStyle(ButtonStyle.Secondary))]
    });
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Set GOTW").setDescription("Select the current-week H2H matchup to post as Game of the Week.")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ADVANCE_CUSTOM_IDS.gotwSelect)
          .setPlaceholder("Select GOTW matchup")
          .addOptions(h2h.slice(0, 25).map((game: any) => ({
            label: `${teamDisplay(game.away_team)} at ${teamDisplay(game.home_team)}`.slice(0, 100),
            value: game.id,
            description: `Week ${currentWeek}`.slice(0, 100)
          })))
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvanceBack).setLabel("Back").setStyle(ButtonStyle.Secondary))
    ]
  });
}

async function handleGotwSelect(interaction: any) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set GOTW");
  // Selecting a matchup does NOT post immediately. Discord only fires this
  // interaction when the selected value changes, so re-picking the same option
  // would silently do nothing. We render an explicit Confirm step instead, which
  // also guards against accidentally publishing an @everyone poll.
  await interaction.deferUpdate();
  const selectedGameId = interaction.values[0];
  const { currentWeek, stage, games } = await currentSchedule(interaction as any);
  const game = games.find((g: any) => g.id === selectedGameId);
  if (!game) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Set GOTW").setDescription("That matchup is no longer available. Reopen **Set GOTW** and try again.")], components: buildAdvanceMgmtRows() });
  }
  const awayLabel = teamDisplay(game.away_team);
  const homeLabel = teamDisplay(game.home_team);
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Confirm Game of the Week").setDescription([
      `**${awayLabel} at ${homeLabel}**`,
      stageLabel(stage, currentWeek),
      "",
      "Confirming posts an @everyone poll to the voting polls channel asking members to pick the winner.",
    ].join("\n"))],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${ADVANCE_CUSTOM_IDS.gotwConfirm}:${selectedGameId}`).setLabel("Confirm & Post GOTW").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSetGotw).setLabel("Pick Different Matchup").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvanceBack).setLabel("Back").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

// Posts one native Discord GOTW poll (away vs home) to the voting-polls channel
// and records it so the advance can settle it. Shared by the manual Set GOTW
// flow and the postseason auto-create. Returns true on success.
async function postGotwPollForGame(args: { guildId: string; channel: any; game: any; weekNumber: number }): Promise<boolean> {
  const { guildId, channel, game, weekNumber } = args;
  const gameId = game.id;
  const awayTeamId = game.away_team?.id ?? game.away_team_id;
  const homeTeamId = game.home_team?.id ?? game.home_team_id;
  if (!gameId || !awayTeamId || !homeTeamId) return false;
  const awayLabel = teamDisplay(game.away_team).slice(0, 55);
  const homeLabel = teamDisplay(game.home_team).slice(0, 55);
  const pollDurationHours = 8;
  const expiresAt = new Date(Date.now() + pollDurationHours * 60 * 60 * 1000).toISOString();
  const pollMsg = await channel.send({
    content: "@everyone",
    poll: {
      question: { text: `Who will win this week's GOTW? ${awayLabel} at ${homeLabel}`.slice(0, 300) },
      answers: [
        { poll_media: { text: awayLabel } },  // answer_id 1 = away
        { poll_media: { text: homeLabel } },  // answer_id 2 = home
      ],
      duration: pollDurationHours,
      allow_multiselect: false,
    },
    allowedMentions: { parse: ["everyone"] },
  } as any).catch((err: unknown) => { console.error("[ERROR] Failed to post GOTW poll:", err); return null; });
  if (!pollMsg) return false;
  // Create DB record so the advance can settle this poll and pay out correct guessers.
  await recApi.createGotwPoll({
    guildId,
    gameId,
    awayTeamId,
    homeTeamId,
    awayUserId: game.away_user_id ?? null,
    homeUserId: game.home_user_id ?? null,
    awayTeamName: awayLabel,
    homeTeamName: homeLabel,
    discordChannelId: channel.id,
    discordMessageId: pollMsg.id,
    weekNumber,
    expiresAt,
  }).catch((err: unknown) => console.error("[ERROR] Failed to create GOTW poll record (non-fatal):", err));
  return true;
}

async function handleGotwConfirm(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set GOTW");
  await interaction.deferUpdate();
  const selectedGameId = interaction.customId.slice(`${ADVANCE_CUSTOM_IDS.gotwConfirm}:`.length);
  const { currentWeek, stage, games } = await currentSchedule(interaction as any);
  const game = games.find((g: any) => g.id === selectedGameId);
  const routes = await getRouteChannels(interaction.guildId);
  const channel = await getVotingPollsChannel(interaction.guild, routes);
  if (!game || !channel) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Set GOTW").setDescription("Unable to post GOTW poll. Check the selected game and voting polls channel.")], components: buildAdvanceMgmtRows() });
  }
  const posted = await postGotwPollForGame({ guildId: interaction.guildId, channel, game, weekNumber: currentWeek });
  if (!posted) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Set GOTW").setDescription("Unable to post GOTW poll. Check the selected game and voting polls channel.")], components: buildAdvanceMgmtRows() });
  }
  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("GOTW Posted").setDescription(`Posted GOTW poll to the voting polls channel for ${stageLabel(stage, currentWeek)}.`)], components: buildAdvanceMgmtRows() });
}

async function handleGameChannels(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "create game channels");
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Creating Game Channels...").setDescription("Checking the active week's logged schedule for H2H matchups where both teams have linked Discord users.")], components: [] });
  const routes = await getRouteChannels(interaction.guildId);
  const categoryId = routes?.game_channels_category_id;
  const category = categoryId ? await interaction.guild.channels.fetch(categoryId).catch(() => null) : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Game Channels").setDescription("No game channels category is configured.")], components: buildAdvanceMgmtRows() });
  }

  await interaction.guild.channels.fetch();
  const tracked = await recApi.listTrackedGameChannels(interaction.guildId).catch(() => ({ discordChannelIds: [] as string[] }));
  const trackedIds = new Set(tracked.discordChannelIds ?? []);
  let deletedCount = 0;
  const deletedDiscordIds: string[] = [];
  for (const channelId of trackedIds) {
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) continue;
    if (channel.parentId !== category.id) continue;
    const deleted = await channel.delete("Replacing tracked REC game channels for the current week schedule.").then(() => true).catch(() => false);
    if (deleted) {
      deletedCount += 1;
      deletedDiscordIds.push(channelId);
    }
  }
  if (deletedDiscordIds.length) {
    await recApi.markGameChannelsDeleted(deletedDiscordIds).catch(() => undefined);
  }

  const { seasonNumber, currentWeek, stage, games } = await currentSchedule(interaction);
  const h2h = games.filter((g: any) => g.away_discord_id && g.home_discord_id);
  if (!h2h.length) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle("Game Channels")
        .setDescription([
          deletedCount > 0 ? `Removed ${deletedCount} previous game channel${deletedCount === 1 ? "" : "s"}.` : null,
          `No H2H matchups are available for **${stageLabel(stage, currentWeek)}**.`,
          "",
          "Game channels are created only from the logged weekly schedule, and only when both scheduled teams have linked Discord users.",
          "If this is unexpected, check League Mgmt > Schedule and League Mgmt > Teams."
        ].filter(Boolean).join("\n"))],
      components: buildAdvanceMgmtRows()
    });
  }
  const created: string[] = [];
  const config = await recApi.getLeagueConfig(interaction.guildId).catch(() => null);
  const isPlayoff = currentWeek >= 19;
  const rulesLines = gameRulesLines(config?.draft ?? null, isPlayoff);
  const boxScoresMention = routes?.box_scores_channel_id ? `<#${routes.box_scores_channel_id}>` : "the box scores channel";
  // Create + register every channel first, then fetch all matchups in ONE batched
  // call (the league-wide identity/power-ranking/config work is computed once for
  // the whole week instead of once per channel), then post the intro messages.
  const pending: Array<{ ch: any; game: any; away: string; home: string }> = [];
  for (const game of h2h) {
    const away = teamDisplay(game.away_team);
    const home = teamDisplay(game.home_team);
    // Channel title is team nicknames only (no city), e.g. "frost-bite-vs-cowboys".
    const name = `${teamNick(game.away_team)} vs ${teamNick(game.home_team)}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
    const ch = await interaction.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
    }).catch((err) => { console.error("[ERROR] Failed to create game channel:", err?.message ?? err); return null; });
    if (!ch?.isTextBased()) continue;
    // Sync the channel's permissions to its parent category rather than scoping
    // it to just the two matchup users.
    await ch.lockPermissions().catch((err) => console.error("[ERROR] Failed to sync game channel permissions:", err?.message ?? err));
    created.push(`<#${ch.id}>`);
    await recApi.registerGameChannel({
      guildId: interaction.guildId,
      gameId: game.id ?? null,
      discordChannelId: ch.id,
      seasonNumber,
      weekNumber: currentWeek,
      awayTeamId: game.away_team_id ?? game.away_team?.id ?? null,
      homeTeamId: game.home_team_id ?? game.home_team?.id ?? null,
      awayUserId: game.away_user_id ?? null,
      homeUserId: game.home_user_id ?? null,
    }).catch(() => undefined);
    pending.push({ ch, game, away, home });
  }

  // One batched fetch for all matchups, keyed by channel id. Page-flip buttons
  // later re-fetch a single channel on demand via getGameChannelMatchup.
  const matchupMap = await recApi
    .getGameChannelMatchups({ guildId: interaction.guildId })
    .then((r) => r?.matchups ?? {})
    .catch((err) => { console.error("[ERROR] Failed to load game channel matchups:", err?.message ?? err); return {} as Record<string, any>; });

  for (const { ch, game, away, home } of pending) {
    const matchup = matchupMap[ch.id] ?? null;
    const fallbackEmbed = new EmbedBuilder().setTitle("Game Channel").setDescription([
      "Play your game here and coordinate respectfully.",
      "",
      ...rulesLines,
      "",
      `After the game, post your box score screenshot in ${boxScoresMention} — not in this channel.`,
      "Failure to post your box score image WILL result in no payouts and no stat accumulation for awards and EOS payouts."
    ].join("\n"));
    await ch.send({
      content: `${game.away_discord_id ? `<@${game.away_discord_id}>` : away} VS ${game.home_discord_id ? `<@${game.home_discord_id}>` : home}`,
      embeds: [matchup ? buildGameChannelPage(matchup, 0) : fallbackEmbed],
      components: matchup ? [buildGameChannelNavRow(0)] : []
    }).catch(() => undefined);
  }
  if (created.length) {
    const announcements = await getAnnouncementsChannel(interaction.guild, routes);
    if (announcements?.isTextBased() && "send" in announcements) {
      const boxScores = routes?.box_scores_channel_id ? `<#${routes.box_scores_channel_id}>` : "the Box Scores channel";
      await announcements.send({
        content: "@everyone",
        embeds: [new EmbedBuilder().setTitle("Weekly Box Scores Required").setDescription([
          `Game channels have been created for ${stageLabel(stage, currentWeek)}.`,
          "",
          `Even if you do not have an H2H matchup this week, upload a box score screenshot to ${boxScores} before the league advances if you want payouts and stats logged.`,
          "Retroactive box scores will not be accepted. Fair Sims and Force Wins receive no payout.",
          "If your opponent cannot make it, request a 1-week autopilot to get your stats and payout IF you play and submit the box score."
        ].join("\n"))],
        allowedMentions: { parse: ["everyone"] }
      }).catch(() => undefined);
    }
  }

  // Postseason: every playoff matchup is a Game of the Week, so auto-post a GOTW
  // poll per H2H game to the voting-polls channel. Idempotent — skips games that
  // already have an open poll, so re-running Game Channels won't double-post.
  let gotwPostedCount = 0;
  if (isPlayoff && h2h.length) {
    const votingChannel = await getVotingPollsChannel(interaction.guild, routes);
    if (votingChannel) {
      const existing = await recApi.getActiveGotwPolls({ guildId: interaction.guildId, weekNumber: currentWeek }).then((r) => r?.polls ?? []).catch(() => []);
      const polledGameIds = new Set((existing as any[]).map((p) => p.game_id).filter(Boolean));
      for (const game of h2h) {
        if (!game.id || polledGameIds.has(game.id)) continue;
        const posted = await postGotwPollForGame({ guildId: interaction.guildId, channel: votingChannel, game, weekNumber: currentWeek });
        if (posted) gotwPostedCount += 1;
      }
    }
  }

  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Game Channels").setDescription([
      deletedCount > 0 ? `Removed ${deletedCount} previous game channel${deletedCount === 1 ? "" : "s"}.` : "No previous game channels were found in the category.",
      created.length ? `Created:\n${created.join("\n")}` : "No H2H game channels were created.",
      isPlayoff ? (gotwPostedCount > 0 ? `Posted ${gotwPostedCount} playoff GOTW poll${gotwPostedCount === 1 ? "" : "s"} to the voting polls channel.` : "No new playoff GOTW polls were posted (already posted, or no voting polls channel).") : null
    ].filter(Boolean).join("\n\n"))],
    components: buildAdvanceMgmtRows()
  });
}

// ─── Game channel paginated matchup embed (5 looping pages) ──────────────────
// Pages are rendered purely from the matchup payload returned by
// recApi.getGameChannelMatchup, so any page can be (re)built on a button press.
const GAME_CHANNEL_PAGE_PREFIX = "rec:gamech:page:";
const GAME_CHANNEL_PAGE_COUNT = 5;
const GAME_CHANNEL_PAGE_TITLES = ["Main Matchup", "Posting & Payouts", "Weekly Challenges", "Matchup Identities", "Matchup Breakdown"];

function gcRankLabel(side: any) {
  return side?.rank ? `#${side.rank}` : "Unranked";
}

function gcShortName(side: any) {
  return String(side?.teamName ?? "Team").slice(0, 18);
}

function gcChannelMention(channelId: string | null | undefined, fallback: string) {
  return channelId ? `<#${channelId}>` : fallback;
}

function gcNum(stats: any, pick: (s: any) => number, signed = false) {
  if (!stats || !stats.gamesLogged) return "—";
  const value = Math.round(pick(stats) * 10) / 10;
  return signed && value > 0 ? `+${value}` : `${value}`;
}

// Fixed-width comparison table inside a code block so the two columns align.
function gcStatTable(awayHead: string, homeHead: string, rows: Array<[string, string, string]>) {
  const labelW = Math.max(11, ...rows.map((r) => r[0].length));
  const colW = Math.max(awayHead.length, homeHead.length, ...rows.map((r) => Math.max(r[1].length, r[2].length)));
  const pad = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));
  const padStart = (s: string, w: number) => (s.length >= w ? s : " ".repeat(w - s.length) + s);
  const header = `${pad("", labelW)}  ${padStart(awayHead, colW)}  ${padStart(homeHead, colW)}`;
  const body = rows.map((r) => `${pad(r[0], labelW)}  ${padStart(r[1], colW)}  ${padStart(r[2], colW)}`);
  return ["```", header, ...body, "```"].join("\n");
}

function gcPageMain(m: any) {
  const away = m.away;
  const home = m.home;
  const awayHead = gcShortName(away);
  const homeHead = gcShortName(home);
  const ptDiff = (s: any) => Number(s?.pointsForAvg ?? 0) - Number(s?.pointsAgainstAvg ?? 0);
  const table = gcStatTable(awayHead, homeHead, [
    ["Record", away.record.text, home.record.text],
    ["Pts/G", gcNum(away.stats, (s) => s.pointsForAvg), gcNum(home.stats, (s) => s.pointsForAvg)],
    ["Pts Allowed", gcNum(away.stats, (s) => s.pointsAgainstAvg), gcNum(home.stats, (s) => s.pointsAgainstAvg)],
    ["Avg Pt Diff", gcNum(away.stats, ptDiff, true), gcNum(home.stats, ptDiff, true)],
    ["Pass Yds/G", gcNum(away.stats, (s) => s.passingYardsAvg), gcNum(home.stats, (s) => s.passingYardsAvg)],
    ["Rush Yds/G", gcNum(away.stats, (s) => s.rushingYardsAvg), gcNum(home.stats, (s) => s.rushingYardsAvg)],
    ["Turnover +/-", gcNum(away.stats, (s) => s.turnoverDifferential, true), gcNum(home.stats, (s) => s.turnoverDifferential, true)],
  ]);
  const rules = gameRulesLines(m.draft ?? null, m.isPlayoff);
  const boxScores = gcChannelMention(m.routes?.boxScoresChannelId, "the box scores channel");
  return new EmbedBuilder().setTitle("Game of the Week Matchup").setDescription([
    `**${gcRankLabel(away)} ${away.teamName} (${away.record.text})**`,
    "**vs**",
    `**${gcRankLabel(home)} ${home.teamName} (${home.record.text})**`,
    "",
    "__Season Comparison__",
    table,
    ...rules,
    "",
    `After the game, post your box score screenshot in ${boxScores} — see the **Posting & Payouts** page for details.`,
  ].join("\n").slice(0, 4096));
}

function gcPagePosting(m: any) {
  const boxScores = gcChannelMention(m.routes?.boxScoresChannelId, "the box scores channel");
  const streams = gcChannelMention(m.routes?.streamsChannelId, "the streams channel");
  const highlights = gcChannelMention(m.routes?.highlightsChannelId, "the highlights channel");
  return new EmbedBuilder().setTitle("Posting & Payouts").setDescription([
    "__Box Score__",
    `After the game, post your box score screenshot in ${boxScores} — **not** in this channel.`,
    "Failure to post your box score image WILL result in no payouts and no stat accumulation for awards and EOS payouts.",
    "Retroactive box scores will not be accepted. Fair Sims and Force Wins receive no payout.",
    "",
    "__Stream Payout — $50/week__",
    `Post your stream link or go Discord Live, then drop it in ${streams}. Worth **$50**, once per game week.`,
    "",
    "__Highlight Payout — $25 each__",
    `Post your in-game highlights in ${highlights}. Each is worth **$25**, with up to **2 paid highlights per week**.`,
    "Highlights also enter Play of the Year voting (regular season) for a shot at the season-end award.",
  ].join("\n").slice(0, 4096));
}

function gcPageChallenges(_m: any) {
  return weeklyChallengesEmbed();
}

function gcCoachIdentityBlock(side: any) {
  const who = side.discordId ? `<@${side.discordId}>` : side.displayName ?? "Coach";
  const identity = side.identity;
  const label = identity?.label ?? "Unscouted Coach";
  const conf = identity?.confidence ? ` (${identity.confidence}%)` : "";
  const summary = identity?.summary ?? "Not enough approved box-score history to scout an identity yet.";
  const evidence = (identity?.evidence ?? []).slice(0, 3).map((line: string) => `• ${line}`).join("\n");
  const allTime = side.allTimeGameRecord;
  const allTimeLine = allTime
    ? `**All-Time (${allTime.label}):** ${allTime.text}${allTime.playoffText !== "0-0" ? ` • Playoffs ${allTime.playoffText}` : ""}${allTime.superbowlWins ? ` • ${allTime.superbowlWins}× SB` : ""}`
    : null;
  const fmtBadges = (badges: any[]) => badges.map((b) => (b.tier ? `${b.tier} ${b.label}` : b.label) + (b.earnedCount > 1 ? ` ×${b.earnedCount}` : "")).join(", ");
  const weekly = side.weeklyBadges?.length ? `**Active badges:** ${fmtBadges(side.weeklyBadges)}` : "**Active badges:** none yet";
  const season = side.seasonBadges?.length ? `**Season badges:** ${fmtBadges(side.seasonBadges)}` : null;
  return [
    `**${who} — ${label}${conf}**`,
    summary,
    allTimeLine,
    weekly,
    season,
    evidence,
  ].filter(Boolean).join("\n");
}

function gcPageIdentities(m: any) {
  return new EmbedBuilder().setTitle("Matchup Identities").setDescription([
    gcCoachIdentityBlock(m.away),
    "",
    gcCoachIdentityBlock(m.home),
  ].join("\n").slice(0, 4096));
}

function gcEdge(label: string, m: any, pick: (s: any) => number, higherIsBetter = true) {
  const a = m.away.stats;
  const h = m.home.stats;
  if (!a?.gamesLogged || !h?.gamesLogged) return null;
  const av = Math.round(pick(a) * 10) / 10;
  const hv = Math.round(pick(h) * 10) / 10;
  const awayLeads = higherIsBetter ? av > hv : av < hv;
  const homeLeads = higherIsBetter ? hv > av : hv < av;
  const leader = awayLeads ? gcShortName(m.away) : homeLeads ? gcShortName(m.home) : "Even";
  return `**${label}:** ${leader} (${av} vs ${hv})`;
}

function gcPageBreakdown(m: any) {
  const edges = [
    gcEdge("Passing", m, (s) => s.passingYardsAvg),
    gcEdge("Rushing", m, (s) => s.rushingYardsAvg),
    gcEdge("Scoring", m, (s) => s.pointsForAvg),
    gcEdge("Defense (pts allowed)", m, (s) => s.pointsAgainstAvg, false),
    gcEdge("Ball Security (TOs/G)", m, (s) => s.turnoversCommittedAvg, false),
    gcEdge("Explosiveness (total yds/G)", m, (s) => s.totalYardsAvg),
  ].filter(Boolean) as string[];

  const body = edges.length
    ? ["__Statistical Edges__", ...edges, ""]
    : ["Not enough logged games on both sides to compare yet — check back once Week 1 box scores are in.", ""];

  return new EmbedBuilder().setTitle("Matchup Breakdown").setDescription([
    `**${gcShortName(m.away)}** — ${m.away.identity?.label ?? "Unscouted Coach"}`,
    m.away.identity?.summary ?? "No scouting identity yet.",
    "",
    `**${gcShortName(m.home)}** — ${m.home.identity?.label ?? "Unscouted Coach"}`,
    m.home.identity?.summary ?? "No scouting identity yet.",
    "",
    ...body,
  ].join("\n").slice(0, 4096));
}

function buildGameChannelPage(m: any, page: number) {
  const p = ((page % GAME_CHANNEL_PAGE_COUNT) + GAME_CHANNEL_PAGE_COUNT) % GAME_CHANNEL_PAGE_COUNT;
  const builders = [gcPageMain, gcPagePosting, gcPageChallenges, gcPageIdentities, gcPageBreakdown];
  const embed = builders[p](m);
  return embed.setFooter({ text: `Page ${p + 1}/${GAME_CHANNEL_PAGE_COUNT} • ${GAME_CHANNEL_PAGE_TITLES[p]} • ${stageLabel(m.stage, m.week)}` });
}

function buildGameChannelNavRow(page: number) {
  const p = ((page % GAME_CHANNEL_PAGE_COUNT) + GAME_CHANNEL_PAGE_COUNT) % GAME_CHANNEL_PAGE_COUNT;
  const prev = (p + GAME_CHANNEL_PAGE_COUNT - 1) % GAME_CHANNEL_PAGE_COUNT;
  const next = (p + 1) % GAME_CHANNEL_PAGE_COUNT;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${GAME_CHANNEL_PAGE_PREFIX}${prev}`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("rec:gamech:indicator").setLabel(`${p + 1}/${GAME_CHANNEL_PAGE_COUNT}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`${GAME_CHANNEL_PAGE_PREFIX}${next}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary),
  );
}

// Public, restart-proof page flip: anyone in the game channel can page through.
// Re-fetches the matchup by channel id (no menu session needed) so the data
// stays current as box scores come in during the week.
async function handleGameChannelPage(interaction: ButtonInteraction) {
  const page = Number(interaction.customId.slice(GAME_CHANNEL_PAGE_PREFIX.length)) || 0;
  await interaction.deferUpdate().catch(() => undefined);
  if (!interaction.guildId) return;
  const matchup = await recApi
    .getGameChannelMatchup({ guildId: interaction.guildId, discordChannelId: interaction.channelId })
    .catch(() => null);
  if (!matchup) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Matchup").setDescription("Couldn't load matchup data right now. Try again in a moment.")],
      components: [buildGameChannelNavRow(page)],
    }).catch(() => undefined);
  }
  return interaction.editReply({
    embeds: [buildGameChannelPage(matchup, page)],
    components: [buildGameChannelNavRow(page)],
  }).catch(() => undefined);
}

function stageFromWeekNumber(weekNumber: number) {
  if (weekNumber <= 18) return "regular_season";
  if (weekNumber === 19) return "wild_card";
  if (weekNumber === 20) return "divisional";
  if (weekNumber === 21) return "conference_championship";
  if (weekNumber === 22) return "super_bowl";
  return "regular_season";
}

function buildSetWeekRows() {
  const regularOptions = Array.from({ length: 18 }, (_, idx) => {
    const week = idx + 1;
    return new StringSelectMenuOptionBuilder().setLabel(`Week ${week}`).setValue(`regular:${week}`);
  });
  const stageOptions = [
    ["Wild Card", "wild_card:19"],
    ["Divisional", "divisional:20"],
    ["Conference Championship", "conference_championship:21"],
    ["Super Bowl", "super_bowl:22"],
    ["Coach Hiring", "coach_hiring:1"],
    ["Final Re-Signing", "final_resigning:1"],
    ["Free Agency", "free_agency:1"],
    ["Draft", "draft:1"],
    ["Training Camp", "preseason_training_camp:1"],
  ].map(([label, value]) => new StringSelectMenuOptionBuilder().setLabel(label).setValue(value));

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ADVANCE_CUSTOM_IDS.regularWeekSelect)
        .setPlaceholder("Select regular season week")
        .addOptions(regularOptions)
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ADVANCE_CUSTOM_IDS.stageSelect)
        .setPlaceholder("Select postseason or offseason stage")
        .addOptions(stageOptions)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvance).setLabel("Back").setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function handleSetWeek(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set the league week");
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Set Week")
      .setDescription("Choose a regular season week, postseason week, or offseason stage. Regular season weeks use Week 1-18; postseason and offseason stages are listed separately.")],
    components: buildSetWeekRows()
  });
}

function formatSavingsInterestSummary(result: any) {
  const interest = result?.savingsInterest;
  if (!interest?.applied || Number(interest.usersCredited ?? 0) <= 0) return "";
  const usersCredited = Number(interest.usersCredited ?? 0);
  const totalInterest = Number(interest.totalInterest ?? 0);
  return `\n\nSavings interest credited: **$${totalInterest}** across **${usersCredited}** user${usersCredited === 1 ? "" : "s"} (3.5%, floored).`;
}

async function handleSetWeekSelect(interaction: any) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set the league week");
  await interaction.deferUpdate();
  const [rawStage, rawWeek] = String(interaction.values[0] ?? "regular:1").split(":");
  const weekNumber = Math.max(1, Number(rawWeek) || 1);
  const seasonStage = rawStage === "regular" ? stageFromWeekNumber(weekNumber) : rawStage;
  const result = await recApi.setLeagueWeek({ guildId: interaction.guildId, weekNumber, seasonStage });
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Week Set").setDescription(`League is now set to **${stageLabel(seasonStage, weekNumber)}**.${formatSavingsInterestSummary(result)}`)],
    components: buildAdvanceMgmtRows()
  });
}

function buildSetSeasonRows() {
  const options = Array.from({ length: 24 }, (_, idx) => {
    const season = idx + 1;
    return new StringSelectMenuOptionBuilder().setLabel(`Season ${season}`).setValue(String(season));
  });
  options.push(new StringSelectMenuOptionBuilder().setLabel("Manual Season Number").setValue("manual").setDescription("Enter season 25 or higher."));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ADVANCE_CUSTOM_IDS.seasonSelect)
        .setPlaceholder("Select season")
        .addOptions(options)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvance).setLabel("Back").setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function handleSetSeason(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set the league season");
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Set Season")
      .setDescription("Select seasons 1-24, or choose Manual Season Number for season 25 or higher.")],
    components: buildSetSeasonRows()
  });
}

async function handleSetSeasonSelect(interaction: any) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set the league season");
  const selected = String(interaction.values[0] ?? "");
  if (selected === "manual") {
    return interaction.showModal(new ModalBuilder()
      .setCustomId(ADVANCE_CUSTOM_IDS.seasonManualModal)
      .setTitle("Set Season")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(ADVANCE_CUSTOM_IDS.seasonManualInput)
          .setLabel("Season number")
          .setPlaceholder("25")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(3)
      )));
  }
  await interaction.deferUpdate();
  await updateLeagueSeason(interaction.guildId, Number(selected));
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Season Set").setDescription(`League season is now **Season ${Number(selected)}**.`)],
    components: buildAdvanceMgmtRows()
  });
}

async function handleSetSeasonManual(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set the league season");
  const seasonNumber = Number(interaction.fields.getTextInputValue(ADVANCE_CUSTOM_IDS.seasonManualInput));
  if (!Number.isInteger(seasonNumber) || seasonNumber < 25) {
    return interaction.reply({ content: "Manual season number must be 25 or higher.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  await updateLeagueSeason(interaction.guildId, seasonNumber);
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Season Set").setDescription(`League season is now **Season ${seasonNumber}**.`)],
    components: buildAdvanceMgmtRows()
  });
}

async function updateLeagueSeason(guildId: string, seasonNumber: number) {
  const current = await recApi.viewLeagueWeek(guildId);
  const weekNumber = Number(current?.league?.current_week ?? 1);
  const seasonStage = String(current?.league?.season_stage ?? current?.league?.current_phase ?? stageFromWeekNumber(weekNumber));
  return recApi.setLeagueWeek({ guildId, weekNumber, seasonStage, seasonNumber });
}

// Render the league's configured 4th-down and streaming rules as displayable
// lines for the game channel embed, using the regular-season or postseason
// values depending on the current phase. Falls back to generic wording when the
// league config can't be loaded.
function gameRulesLines(draft: any, isPlayoff: boolean): string[] {
  const fourthType = isPlayoff ? draft?.fourthDownRuleTypePlayoff : draft?.fourthDownRuleTypeRegular;
  const fourthCustom = isPlayoff ? draft?.customFourthDownRulePlayoff : draft?.customFourthDownRuleRegular;
  let fourthText: string;
  if (!draft || fourthType == null) fourthText = "Follow the current league 4th down rules.";
  else if (fourthType === "none") fourthText = "No 4th down restrictions.";
  else if (fourthType === "standard_rec") fourthText = "Standard REC Rule — only go for it past midfield on 4th & 3 or less; if trailing in the second half you may go for it anytime.";
  else fourthText = fourthCustom && String(fourthCustom).trim() ? String(fourthCustom).trim() : "Custom league 4th down rules apply.";

  const req = isPlayoff ? draft?.postseasonStreamingRequirement : draft?.regularSeasonStreamingRequirement;
  const side = isPlayoff ? draft?.postseasonStreamingSide : draft?.regularSeasonStreamingSide;
  let streamText: string;
  if (!draft || req == null) streamText = "Follow this week's league streaming requirements.";
  else if (req === "disabled") streamText = "Not required.";
  else {
    // "Required" streams are mandatory ("must"); "Recommended" streams are
    // encouraged but optional ("should").
    const isRequired = req === "required";
    const reqLabel = isRequired ? "Required" : "Recommended";
    const verb = isRequired ? "must" : "should";
    const sideLabel =
      side === "home" ? `the home team ${verb} stream`
      : side === "away" ? `the away team ${verb} stream`
      : side === "both" ? `both teams ${verb} stream`
      : `at least one team ${verb} stream`;
    streamText = `${reqLabel} — ${sideLabel}.`;
  }

  return [`**4th Down Rules:** ${fourthText}`, `**Streaming:** ${streamText}`];
}

function weeklyChallengesEmbed() {
  const star = DEV_TIER_EMOJIS.silver;
  const superstar = DEV_TIER_EMOJIS.gold;
  const xfactor = DEV_TIER_EMOJIS.xf;
  return new EmbedBuilder().setTitle("Weekly Challenges").setDescription([
    "**Tiered Challenges**",
    `${star} Total Yards: 400 +$10 | ${superstar} 600 +$15 | ${xfactor} 800 +$25`,
    `${star} Passing Yards: 250 +$10 | ${superstar} 400 +$15 | ${xfactor} 550 +$25`,
    `${star} Rushing Yards: 150 +$10 | ${superstar} 250 +$15 | ${xfactor} 350 +$25`,
    `${star} First Downs: 10 +$10 | ${superstar} 15 +$15 | ${xfactor} 20 +$25`,
    `${star} Generated Turnovers: 1 +$10 | ${superstar} 2 +$15 | ${xfactor} 3 +$25`,
    `${star} Committed Turnovers: 1 -$10 | ${superstar} 2 -$15 | ${xfactor} 3 -$25`,
    "Differential: Positive +$25 | Negative -$25",
    `Offensive Redzone: ${star} >65% +$10 | ${superstar} >85% +$15 | ${xfactor} 100% +$25`,
    `Defensive Redzone Stop Rate: ${star} >65% +$10 | ${superstar} >85% +$15 | ${xfactor} 100% +$25`,
    "",
    "**Game Bonuses And Penalties**",
    "4th Quarter Comeback +$50 — win after trailing entering the 4th quarter.",
    "Upset +$25 — beat any opponent ranked above you in the power rankings.",
    "Major Upset +$50 — beat an opponent 10+ spots above you in the power rankings.",
    "Shut-Out +$50 — hold your opponent to 0 points.",
    "Slow-Starter -$10 — score 0 points in the 1st quarter.",
    "Weak-Closer -$10 — lead entering the 4th quarter but lose by 14+ points."
  ].join("\n"));
}

function eosPayoutLine(item: any) {
  const tier = item.qualified_tier ? ` [${item.qualified_tier}]` : "";
  const value = item.qualified_value != null ? ` (${item.qualified_value})` : "";
  return `- **$${Number(item.amount ?? 0)}** - ${item.payout_label}${tier}${value}`;
}

function eosUserGroups(items: any[]) {
  const groups = new Map<string, any[]>();
  for (const item of items) {
    if (item.status !== "pending" || !item.user_id) continue;
    const rows = groups.get(item.user_id) ?? [];
    rows.push(item);
    groups.set(item.user_id, rows);
  }
  return groups;
}

async function postEosReviewEmbeds(interaction: ButtonInteraction, result: any) {
  if (!interaction.guild || !result?.pendingPayoutsChannelId || !result?.batch?.id) return 0;
  const channel = await interaction.guild.channels.fetch(result.pendingPayoutsChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return 0;
  let posted = 0;
  for (const [userId, items] of eosUserGroups(result.items ?? [])) {
    const total = items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    const payeeDiscordId = items.find((item) => item.payee_discord_id)?.payee_discord_id ?? null;
    const coach = payeeDiscordId ? `<@${payeeDiscordId}>` : `REC user ${userId}`;
    const lines = items.map(eosPayoutLine);
    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle("EOS PAYOUT REVIEW")
        .setColor(0xf1c40f)
        .setDescription([
          `Coach: ${coach}`,
          `Season: **${result.batch.season_number}**`,
          `Total pending: **$${total}**`,
          "",
          lines.join("\n").slice(0, 3000),
        ].join("\n"))],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${EOS_PAYOUT_CUSTOM_IDS.approveUserPrefix}${result.batch.id}:${userId}`).setLabel("Approve & Pay").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${EOS_PAYOUT_CUSTOM_IDS.denyUserPrefix}${result.batch.id}:${userId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
      )],
      allowedMentions: { users: payeeDiscordId ? [payeeDiscordId] : [] },
    }).catch(() => undefined);
    posted += 1;
  }
  return posted;
}

async function dmEosPayoutResult(interaction: ButtonInteraction, result: any) {
  if (!result?.payeeDiscordId || result.action !== "approve" || Number(result.totalAmount ?? 0) <= 0) return;
  const user = await interaction.client.users.fetch(result.payeeDiscordId).catch(() => null);
  if (!user) return;
  const lines = (result.items ?? []).map(eosPayoutLine);
  await user.send([
    `Your EOS payouts were approved for **$${Number(result.totalAmount ?? 0)}**.`,
    "",
    lines.join("\n").slice(0, 1800),
  ].join("\n")).catch(() => undefined);
}

async function handleEosPayouts(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "run EOS payouts");
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  const week = interaction.guildId ? await recApi.viewLeagueWeek(interaction.guildId).catch(() => null) : null;
  const currentWeek = Number(week?.league?.current_week ?? 1);
  if (currentWeek < 19 || currentWeek > 22) {
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle("EOS Payouts").setDescription("EOS payouts cannot be issued until the active regular season concludes. They are available from Wild Card through Super Bowl week.")], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await recApi.prepareEosPayouts({ guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
  const items: any[] = result?.items ?? [];
  const pending = items.filter((item) => item.status === "pending").length;
  const issued = items.filter((item) => item.status === "issued").length;
  const total = Number(result?.totalAmount ?? 0);
  const byCategory = new Map<string, { count: number; amount: number }>();
  for (const item of items) {
    const key = String(item.payout_category ?? "other");
    const row = byCategory.get(key) ?? { count: 0, amount: 0 };
    row.count += 1;
    row.amount += Number(item.amount ?? 0);
    byCategory.set(key, row);
  }
  const categoryLines = [...byCategory.entries()].map(([key, row]) => `${key}: **${row.count}** item${row.count === 1 ? "" : "s"} / **$${row.amount}**`);
  const batchId = result?.batch?.id ? String(result.batch.id) : null;
  const reviewEmbedsPosted = pending > 0 ? await postEosReviewEmbeds(interaction, result) : 0;
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("EOS Payouts Prepared")
      .setColor(0x2ecc71)
      .setDescription([
        `Season **${result?.batch?.season_number ?? week?.league?.season_number ?? 1}** EOS payout batch is ready.`,
        "",
        `Pending review items: **${pending}**`,
        `Issued items: **${issued}**`,
        `Total generated amount: **$${total}**`,
        `Review embeds posted: **${reviewEmbedsPosted}**`,
        "",
        categoryLines.length ? categoryLines.join("\n") : "No qualifying EOS payouts were generated.",
        "",
        "This engine uses final regular-season power rankings and approved box-score team stats. Player-level stat imports are not required."
      ].join("\n"))],
    components: batchId && pending > 0
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${EOS_PAYOUT_CUSTOM_IDS.issueBatchPrefix}${batchId}`).setLabel("Issue Pending EOS Payouts").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosActions).setLabel("Back").setStyle(ButtonStyle.Secondary),
        )]
      : [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosActions).setLabel("Back").setStyle(ButtonStyle.Secondary),
        )],
  });
}

async function handleReviewEosUserPayouts(interaction: ButtonInteraction, action: "approve" | "deny") {
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, `${action} EOS payouts`);
  const prefix = action === "approve" ? EOS_PAYOUT_CUSTOM_IDS.approveUserPrefix : EOS_PAYOUT_CUSTOM_IDS.denyUserPrefix;
  const [batchId, userId] = interaction.customId.slice(prefix.length).split(":");
  if (!batchId || !userId) return interaction.reply({ content: "EOS payout review payload was missing.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await recApi.reviewEosPayoutsForUser({
    batchId,
    userId,
    action,
    reviewedByDiscordId: interaction.user.id,
    deniedReason: action === "deny" ? "Denied by commissioner review." : null,
  });
  await dmEosPayoutResult(interaction, result);
  if (interaction.message?.editable) {
    const embeds = interaction.message.embeds.map((embed: any) => {
      const builder = EmbedBuilder.from(embed);
      const current = embed.description ?? "";
      builder.setDescription([current, "", `**${action === "approve" ? "Approved and paid" : "Denied"} by <@${interaction.user.id}>**`].join("\n"));
      builder.setColor(action === "approve" ? 0x2ecc71 : 0xe74c3c);
      return builder;
    });
    await interaction.message.edit({ embeds, components: [] }).catch(() => undefined);
  }
  const failed: any[] = result?.failed ?? [];
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle(action === "approve" ? "EOS Payouts Approved" : "EOS Payouts Denied")
      .setColor(action === "approve" ? 0x2ecc71 : 0xe74c3c)
      .setDescription([
        `Processed **${result?.items?.length ?? 0}** payout item${(result?.items?.length ?? 0) === 1 ? "" : "s"}.`,
        `Total: **$${Number(result?.totalAmount ?? 0)}**`,
        failed.length ? `Failed: **${failed.length}** item${failed.length === 1 ? "" : "s"}.` : "No failures reported.",
      ].join("\n"))],
  });
}

async function handleIssueEosPayoutBatch(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "issue EOS payouts");
  const batchId = interaction.customId.slice(EOS_PAYOUT_CUSTOM_IDS.issueBatchPrefix.length);
  if (!batchId) return interaction.reply({ content: "EOS payout batch was missing.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  const result = await recApi.issueEosPayoutBatch({ batchId, reviewedByDiscordId: interaction.user.id });
  const failed: any[] = result?.failed ?? [];
  const issuedCount = Number(result?.issuedCount ?? 0);
  const remainingPending = (result?.items ?? []).filter((item: any) => item.status === "pending").length;
  const issuedByDiscord = new Map<string, any[]>();
  for (const item of result?.issuedItems ?? []) {
    if (!item.payee_discord_id) continue;
    const rows = issuedByDiscord.get(item.payee_discord_id) ?? [];
    rows.push(item);
    issuedByDiscord.set(item.payee_discord_id, rows);
  }
  for (const [discordId, rows] of issuedByDiscord.entries()) {
    const user = await interaction.client.users.fetch(discordId).catch(() => null);
    const totalForUser = rows.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    await user?.send([
      `Your EOS payouts were issued for **$${totalForUser}**.`,
      "",
      rows.map(eosPayoutLine).join("\n").slice(0, 1800),
    ].join("\n")).catch(() => undefined);
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle(failed.length ? "EOS Payouts Partially Issued" : "EOS Payouts Issued")
      .setColor(failed.length ? 0xf1c40f : 0x2ecc71)
      .setDescription([
        `Issued **${issuedCount}** pending EOS payout${issuedCount === 1 ? "" : "s"}.`,
        `Remaining pending: **${remainingPending}**`,
        failed.length ? `Failed: **${failed.length}** item${failed.length === 1 ? "" : "s"}. Check API logs for details.` : "No failures reported."
      ].join("\n"))],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosActions).setLabel("Back").setStyle(ButtonStyle.Secondary),
    )],
  });
}

async function handlePotyTallies(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "run POTY tallies");
  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  const currentWeek = Number(week?.league?.current_week ?? 1);
  if (currentWeek < 19 || currentWeek > 22) {
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle("POTY Tallies").setDescription("POTY Tallies are available from Wild Card through Super Bowl week.")], flags: MessageFlags.Ephemeral });
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

async function handleLeagueMgmtRoles(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return replyFullAdminOnly(interaction, "manage league roles");
  }
  return replyMenuPlaceholder(interaction, "Roles", "Role management is not active yet. For now, assign Commissioner, Co Commissioner, and member roles directly in Discord or through League Mgmt > Teams where team links are managed.");
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
      embeds: [new EmbedBuilder().setTitle("League Data Deleted").setColor(0x2ecc71).setDescription([
        `**${result?.leagueName ?? "The league"}** has been permanently erased (${rows} row${rows === 1 ? "" : "s"} removed across league tables).`,
        "",
        "Run the League Setup Wizard to set up a new league for this server."
      ].join("\n"))],
      components: buildAdminPanelRows()
    });
  } catch (error) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Delete Failed").setColor(0xe74c3c).setDescription(error instanceof Error ? error.message : String(error))],
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

  try {
    const { SERVER_SETUP_CUSTOM_IDS } = await import("./ui/server-setup-admin.js");
    const channelId = interaction.fields.getTextInputValue(SERVER_SETUP_CUSTOM_IDS.channelIdInput).trim();
    const channelType = serverSetupChannelSessions.get(interaction.user.id);

    if (!channelType) {
      return interaction.reply({
        content: "Channel type selection expired. Please try again.",
        flags: MessageFlags.Ephemeral
      });
    }

    const channelTypeToApiField: Record<string, string> = {
      commissioner_office: "commissionerOfficeChannelId",
      announcements: "announcementsChannelId",
      headlines: "headlinesChannelId",
      power_rankings: "powerRankingsChannelId",
      voting_polls: "votingPollsChannelId",
      streams: "streamsChannelId",
      highlights: "highlightsChannelId",
      pending_payouts: "pendingPayoutsChannelId",
      pending_purchases: "pendingPurchasesChannelId",
      box_scores: "boxScoresChannelId",
      game_channels_category: "gameChannelsCategoryId"
    };

    const apiField = channelTypeToApiField[channelType];
    if (!apiField) {
      return interaction.reply({ content: `Unknown channel type: ${channelType}`, flags: MessageFlags.Ephemeral });
    }

    await recApi.setEconomyConfig({ guildId: interaction.guildId, [apiField]: channelId });

    serverSetupChannelSessions.delete(interaction.user.id);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Channel Assigned")
          .setDescription(`Assigned <#${channelId}> to **${channelType.replace(/_/g, " ")}**.`)
      ],
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error("[ERROR] Server setup channel assignment failed:", error);
    await interaction.reply({
      content: `Error assigning channel: ${error instanceof Error ? error.message : String(error)}`,
      flags: MessageFlags.Ephemeral
    });
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

await registerApplicationCommands().catch((error) => {
  console.error("Failed to register Discord application commands before startup", error);
});

await client.login(env.DISCORD_TOKEN);
