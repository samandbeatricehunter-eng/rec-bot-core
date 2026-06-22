import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType, Client, EmbedBuilder, GatewayIntentBits, Interaction, MessageFlags, ModalBuilder, ModalSubmitInteraction, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { env } from "./config/env.js";
import { registerApplicationCommands, registerGuildCommands } from "./commands.js";
import { isDiscordAdminInteraction } from "./lib/admin.js";
import { recApi } from "./lib/rec-api.js";
import { getAnnouncementsChannel, getVotingPollsChannel } from "./lib/route-channels.js";
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
import { handleSnapshotConferenceSelect, handleSnapshotPageNav, handleSnapshotTeamSelect, handleTeamsPage, renderTeamsMenu, renderUserSnapshotPicker } from "./flows/rosters.js";
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
  SCHEDULE_MGMT_CUSTOM_IDS,
  startManualScheduleEntry,
  startPostSetupManualScheduleEntry,
  startPostSetupScheduleStep,
  startScheduleViewer
} from "./flows/schedule.js";
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
  handleSetupModal,
  leagueSetupSessions
} from "./flows/league-setup.js";
import { RULES_CUSTOM_IDS, buildRulesPanel } from "./ui/rules.js";
import { handleSimpleTeamLinkSelect, handleSimpleTeamLinkUserSelect, handleSimpleTeamLinkRoleSelect, handleClearAllTeamLinks, handleCustomTeamModal, handleCustomTeamNoLink, renderLeagueMgmtTeams, handleLeagueTeamsAddRemove, handleLeagueTeamsEdit, handleLeagueTeamsConferenceSelect, handleLeagueTeamsTeamSelect, handleLeagueTeamsEditConferenceSelect, handleLeagueTeamsEditTeamSelect, handleLeagueTeamsResetDefaults, handleLeagueTeamsConfirmBack, handleLeagueTeamsConfirmUnlink } from "./flows/team-linking.js";
import { TEAM_LINK_CUSTOM_IDS } from "./ui/team-options.js";
import {
  handleManageWallet,
  handleWalletCustomTransferModal,
  handleWalletTransactions,
  handleWalletTransferAll,
  handleWalletTransferDirection,
  handleWalletTransferOpen,
  handlePlaceWager,
  handleWalletMakePurchase,
  handleWalletPendingPurchases
} from "./handlers/wallet.js";
import { handleHighlightChannelMessage, handleHighlightReviewButton, HIGHLIGHT_REVIEW_PREFIX, settleHighlightAwardsForGuild } from "./handlers/highlights.js";
import { handleStreamLinkModal, handleStreamMenu, handleStreamServiceSelect } from "./handlers/stream.js";
import {
  BOX_SCORE_CUSTOM_IDS,
  handleBoxScoreApprove,
  handleBoxScoreAdminCancel,
  handleBoxScoreAdminGameSelect,
  handleBoxScoreAdminWeekSelect,
  handleBoxScoreButton,
  handleBoxScoreCancel,
  handleBoxScoreChannelMessage,
  handleBoxScoreSubmissions,
  handleCommissionerBoxScoreSubmissionMessage,
  handleBoxScoreDenyModal,
  handleBoxScoreDenySubmit,
  handleBoxScoreInbox,
  handleBoxScoreSubmitConfirm,
  sweepBoxScoreExchanges,
} from "./flows/box-score.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
client.setMaxListeners(50);
const menuSessions = new ExpiringSessionStore<true>();
const serverSetupChannelSessions = new Map<string, string>();
const ADVANCE_CUSTOM_IDS = {
  gotwSelect: "rec:advance:gotw_select",
  regularWeekSelect: "rec:advance:regular_week_select",
  stageSelect: "rec:advance:stage_select",
  seasonSelect: "rec:advance:season_select",
  seasonManualModal: "rec:advance:season_manual_modal",
  seasonManualInput: "rec:advance:season_manual_input"
} as const;

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
        interaction.customId === TEAM_LINK_CUSTOM_IDS.simpleNfcTeamSelect
      ) return handleSimpleTeamLinkSelect(interaction);
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
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotConferenceSelect) return handleSnapshotConferenceSelect(interaction, buildMainMenuPayload);
      if (interaction.customId.startsWith(`${ROSTERS_CUSTOM_IDS.snapshotTeamSelect}:`)) return handleSnapshotTeamSelect(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsConferenceSelect) return handleLeagueTeamsConferenceSelect(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.leagueTeamsTeamSelect}:`)) return handleLeagueTeamsTeamSelect(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.leagueTeamsEditConferenceSelect) return handleLeagueTeamsEditConferenceSelect(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.leagueTeamsEditTeamSelect}:`)) return handleLeagueTeamsEditTeamSelect(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.transferDirection) return handleWalletTransferDirection(interaction);
      if (interaction.customId === STREAM_CUSTOM_IDS.serviceSelect) return handleStreamServiceSelect(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.adminWeekSelect) return handleBoxScoreAdminWeekSelect(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.adminGameSelect) return handleBoxScoreAdminGameSelect(interaction);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualWeekSelect) return handleManualScheduleWeekSelect(interaction);
      if (interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualAfcSelect || interaction.customId === SCHEDULE_MGMT_CUSTOM_IDS.manualNfcSelect) return handleManualScheduleTeamSelect(interaction);
      if (interaction.customId === ADVANCE_CUSTOM_IDS.gotwSelect) return handleGotwSelect(interaction);
      if (interaction.customId === ADVANCE_CUSTOM_IDS.regularWeekSelect || interaction.customId === ADVANCE_CUSTOM_IDS.stageSelect) return handleSetWeekSelect(interaction);
      if (interaction.customId === ADVANCE_CUSTOM_IDS.seasonSelect) return handleSetSeasonSelect(interaction);
      if (Object.values(LEAGUE_SETUP_CUSTOM_IDS).includes(interaction.customId as any)) return handleLeagueSetupSelect(interaction);
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
      if (interaction.customId === MENU_CUSTOM_IDS.deleteLeagueCancel) return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
      if (interaction.customId === MENU_CUSTOM_IDS.deleteLeagueConfirm) {
        if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can delete league data.", flags: MessageFlags.Ephemeral });
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
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtTeams) return handleLeagueMgmtTeams(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtServerSetup) return handleLeagueMgmtServerSetup(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSchedule) return handleLeagueMgmtSchedule(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleWizard) return handleLeagueMgmtScheduleWizard(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleOneWeek) return handleLeagueMgmtScheduleOneWeek(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleManual) return startManualScheduleEntry(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleView) return startScheduleViewer(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtScheduleBack) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtAdvance) return handleLeagueMgmtAdvance(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtAdvanceWeek) return handleAdvanceWeek(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtActiveCheck) return handleActiveCheck(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSetGotw) return handleSetGotw(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtGameChannels) return handleGameChannels(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSetWeek) return handleSetWeek(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSetSeason) return handleSetSeason(interaction);
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
      if (interaction.customId === MENU_CUSTOM_IDS.openTeams) return renderTeamsMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.schedule) return renderScheduleMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleSelectTeam) return renderSchedulePlaceholder(interaction, "Select Team", "Team schedule selection is not active yet. Commissioners can view the full league schedule from League Mgmt > Schedule > View Schedule.");
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleSos) return renderSchedulePlaceholder(interaction, "SOS", "Strength of schedule is not active yet. This will be calculated from logged schedules once the SOS view is connected.");
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleHistory) return renderSchedulePlaceholder(interaction, "History", "Schedule history is not active yet. Current-season schedule pages are available from the main Schedule view and League Mgmt schedule viewer.");
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
      if (interaction.customId === MENU_CUSTOM_IDS.placeWager) return handlePlaceWager(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.manageWallet) return handleManageWallet(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.makePurchase) return replyMenuPlaceholder(interaction, "Purchase", "Store tools are not active yet. When enabled, this menu will show only purchase types allowed by this league's settings.");
      if (interaction.customId === MENU_CUSTOM_IDS.viewUserProfiles) return renderUserSnapshotPicker(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.stream) return handleStreamMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.streamBack) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.uploadBoxScore) return handleBoxScoreButton(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.uploadScoringSummary) return replyMenuPlaceholder(interaction, "Scoring Summary", "Scoring summary uploads are not active yet. Box score uploads are currently used for game results, stats, and payout review.");
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.cancel) return handleBoxScoreCancel(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.submissionsOpen) return handleBoxScoreSubmissions(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.adminCancel) return handleBoxScoreAdminCancel(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.inboxBack) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.submitConfirm) return handleBoxScoreSubmitConfirm(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.approvePrefix)) return handleBoxScoreApprove(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.denyModalPrefix)) return handleBoxScoreDenyModal(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.helpRules) return interaction.update(buildRulesPanel());
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmt) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId.startsWith(`${MENU_CUSTOM_IDS.teamsPage}:`)) return handleTeamsPage(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.requestTeam) return replyMenuPlaceholder(interaction, "Request Team", "Team request approvals are not active yet. Commissioners can assign teams from League Mgmt > Teams.");
      if (interaction.customId === MENU_CUSTOM_IDS.teamsBack) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.transfer) return handleWalletTransferOpen(interaction);
      if (interaction.customId.startsWith(`${MANAGE_WALLET_CUSTOM_IDS.transferAll}:`)) return handleWalletTransferAll(interaction, interaction.customId.endsWith(":from_savings") ? "from_savings" : "to_savings");
      if (interaction.customId.startsWith(`${MANAGE_WALLET_CUSTOM_IDS.transferCustom}:`)) return interaction.showModal(buildWalletTransferCustomModal(interaction.customId.endsWith(":from_savings") ? "from_savings" : "to_savings"));
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.transactions) return handleWalletTransactions(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.back) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.pendingPurchases) return handleWalletPendingPurchases(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.makePurchase) return handleWalletMakePurchase(interaction);
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
      if (interaction.customId.startsWith(`${MANAGE_WALLET_CUSTOM_IDS.transferCustomModal}:`)) return handleWalletCustomTransferModal(interaction, interaction.customId.endsWith(":from_savings") ? "from_savings" : "to_savings");
      if (interaction.customId.startsWith(`${STREAM_CUSTOM_IDS.linkModal}:`)) return handleStreamLinkModal(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.customTeamModal}:`) || interaction.customId === TEAM_LINK_CUSTOM_IDS.editTeamModal) return handleCustomTeamModal(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.denyModalPrefix)) return handleBoxScoreDenySubmit(interaction);
      if (interaction.customId === ADVANCE_CUSTOM_IDS.seasonManualModal) return handleSetSeasonManual(interaction);
    }
  } catch (error) {
    await safeInteractionError(interaction, error);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (await handleHighlightChannelMessage(message).catch(() => false)) return;
  if (await handleCommissionerBoxScoreSubmissionMessage(message).catch(() => false)) return;
  await handleBoxScoreChannelMessage(message).catch(() => undefined);
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
  await interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
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
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can manage server setup.", flags: MessageFlags.Ephemeral });
  }
  return interaction.update(buildServerSetupPanel());
}

async function handleLeagueMgmtSchedule(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can manage league schedule imports.", flags: MessageFlags.Ephemeral });
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
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can manage league schedule imports.", flags: MessageFlags.Ephemeral });
  }
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Schedule Wizard")
      .setDescription([
        "Schedule screenshot parsing is not connected yet.",
        "",
        "When enabled, this flow will collect two screenshots per regular-season week, ask you to confirm the parsed games, and then advance through Week 18.",
        "",
        "Use **Set Manually** today if you need to enter matchups now."
      ].join("\n"))],
    components: buildScheduleMgmtRows()
  });
}

async function handleLeagueMgmtScheduleOneWeek(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can manage league schedule imports.", flags: MessageFlags.Ephemeral });
  }
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Upload One Week")
      .setDescription([
        "One-week screenshot parsing is not connected yet.",
        "",
        "When enabled, this flow will let you choose one eligible week, upload its schedule screenshots, confirm the parsed games, and save only that week.",
        "",
        "Use **Set Manually** today if you need to enter matchups now."
      ].join("\n"))],
    components: buildScheduleMgmtRows()
  });
}

async function handleLeagueMgmtAdvance(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can advance the league.", flags: MessageFlags.Ephemeral });
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
        "**EOS Payouts / POTY Tallies** are postseason-only payout tools."
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
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosPayouts).setLabel("EOS Payouts").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosAwards).setLabel("EOS Awards").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtPotyTallies).setLabel("POTY Tallies").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvanceBack).setLabel("Back").setStyle(ButtonStyle.Secondary)
    )
  ];
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

function nextLeagueStage(weekNumber: number, seasonStage: string) {
  if (seasonStage === "preseason_training_camp" || seasonStage === "preseason") {
    return { weekNumber: 1, seasonStage: "regular_season" };
  }
  if (seasonStage === "regular_season" && weekNumber < 18) return { weekNumber: weekNumber + 1, seasonStage: "regular_season" };
  if (seasonStage === "regular_season" && weekNumber >= 18) return { weekNumber: 19, seasonStage: "wild_card" };
  if (seasonStage === "wild_card") return { weekNumber: 20, seasonStage: "divisional" };
  if (seasonStage === "divisional") return { weekNumber: 21, seasonStage: "conference_championship" };
  if (seasonStage === "conference_championship") return { weekNumber: 22, seasonStage: "super_bowl" };
  return { weekNumber: Math.max(1, weekNumber + 1), seasonStage };
}

function stageLabel(stage: string, week: number) {
  if (stage === "preseason_training_camp") return "Preseason Training Camp";
  if (stage === "preseason") return "Preseason";
  if (stage === "regular_season") return `Week ${week}`;
  if (stage === "wild_card") return "Wild Card";
  if (stage === "divisional") return "Divisional";
  if (stage === "conference_championship") return "Conference Championship";
  if (stage === "super_bowl") return "Super Bowl";
  return stage.replace(/_/g, " ");
}

async function handleAdvanceWeek(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can advance the league.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Advancing Week...").setDescription("Updating the league week/stage and applying 3.5% savings interest for linked users.")], components: [] });
  const current = await recApi.viewLeagueWeek(interaction.guildId);
  const currentWeek = Number(current?.league?.current_week ?? 1);
  const currentStage = String(current?.league?.season_stage ?? "regular_season");
  const next = nextLeagueStage(currentWeek, currentStage);
  const result = await recApi.setLeagueWeek({ guildId: interaction.guildId, ...next });
  const interest = result?.savingsInterest;
  const interestLine = interest?.applied && interest.usersCredited > 0
    ? `\n\nSavings interest credited: **$${interest.totalInterest}** across **${interest.usersCredited}** user${interest.usersCredited === 1 ? "" : "s"} (3.5%, floored).`
    : interest?.reason === "interest_disabled"
      ? "\n\nSavings interest was skipped because this league exceeded the 24-hour advance limit."
      : "";
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Week Advanced")
      .setDescription(`League advanced from **${stageLabel(currentStage, currentWeek)}** to **${stageLabel(next.seasonStage, next.weekNumber)}**.${interestLine}${result?.highlightAwardsDue ? "\n\nPOTY Tallies are now available from this Advance menu." : ""}`)],
    components: buildAdvanceMgmtRows()
  });
}

async function getRouteChannels(guildId: string) {
  const cfg = await recApi.getEconomyConfig(guildId).catch(() => null);
  return cfg?.routes ?? {};
}

async function handleActiveCheck(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can run active checks.", flags: MessageFlags.Ephemeral });
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
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can set GOTW.", flags: MessageFlags.Ephemeral });
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
  await interaction.deferUpdate();
  const selectedGameId = interaction.values[0];
  const { currentWeek, stage, games } = await currentSchedule(interaction as any);
  const game = games.find((g: any) => g.id === selectedGameId);
  const routes = await getRouteChannels(interaction.guildId);
  const channel = await getVotingPollsChannel(interaction.guild, routes);
  if (!game || !channel) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Set GOTW").setDescription("Unable to post GOTW poll. Check the selected game and voting polls channel.")], components: buildAdvanceMgmtRows() });
  }
  await channel.send({
    content: "@everyone",
    embeds: [new EmbedBuilder()
      .setTitle("Who will win this week's GOTW?")
      .setDescription(`**${teamDisplay(game.away_team)}** at **${teamDisplay(game.home_team)}**\n\nVote with the buttons below. Poll closes in 8 hours.`)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`rec:gotw_vote:${selectedGameId}:away`).setLabel(teamDisplay(game.away_team).slice(0, 80)).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rec:gotw_vote:${selectedGameId}:home`).setLabel(teamDisplay(game.home_team).slice(0, 80)).setStyle(ButtonStyle.Primary)
    )],
    allowedMentions: { parse: ["everyone"] }
  });
  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("GOTW Posted").setDescription(`Posted GOTW poll to the voting polls channel for ${stageLabel(stage, currentWeek)}.`)], components: buildAdvanceMgmtRows() });
}

async function handleGameChannels(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can create game channels.", flags: MessageFlags.Ephemeral });
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
  for (const game of h2h) {
    const away = teamDisplay(game.away_team);
    const home = teamDisplay(game.home_team);
    const name = `${away} vs ${home}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
    const ch = await interaction.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        ...(game.away_discord_id ? [{ id: game.away_discord_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
        ...(game.home_discord_id ? [{ id: game.home_discord_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : []),
      ]
    }).catch(() => null);
    if (!ch?.isTextBased()) continue;
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
    await ch.send({
      content: `${game.away_discord_id ? `<@${game.away_discord_id}>` : away} VS ${game.home_discord_id ? `<@${game.home_discord_id}>` : home}`,
      embeds: [
        new EmbedBuilder().setTitle("Game Channel").setDescription([
          "Play your game here and coordinate respectfully.",
          "",
          "**4th Down Rules:** Follow the current league rules as configured by commissioners.",
          "**Streaming:** Follow this week's league streaming requirements.",
          "",
          "Failure to post your box score image after the game WILL result in no payouts and no stat accumulation for awards and EOS payouts."
        ].join("\n")),
        weeklyChallengesEmbed()
      ]
    }).catch(() => undefined);
  }
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
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Game Channels").setDescription([
      deletedCount > 0 ? `Removed ${deletedCount} previous game channel${deletedCount === 1 ? "" : "s"}.` : "No previous game channels were found in the category.",
      created.length ? `Created:\n${created.join("\n")}` : "No H2H game channels were created."
    ].filter(Boolean).join("\n\n"))],
    components: buildAdvanceMgmtRows()
  });
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
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can set the league week.", flags: MessageFlags.Ephemeral });
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Set Week")
      .setDescription("Choose a regular season week, postseason week, or offseason stage. Regular season weeks use Week 1-18; postseason and offseason stages are listed separately.")],
    components: buildSetWeekRows()
  });
}

async function handleSetWeekSelect(interaction: any) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can set the league week.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  const [rawStage, rawWeek] = String(interaction.values[0] ?? "regular:1").split(":");
  const weekNumber = Math.max(1, Number(rawWeek) || 1);
  const seasonStage = rawStage === "regular" ? stageFromWeekNumber(weekNumber) : rawStage;
  await recApi.setLeagueWeek({ guildId: interaction.guildId, weekNumber, seasonStage });
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Week Set").setDescription(`League is now set to **${stageLabel(seasonStage, weekNumber)}**.`)],
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
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can set the league season.", flags: MessageFlags.Ephemeral });
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Set Season")
      .setDescription("Select seasons 1-24, or choose Manual Season Number for season 25 or higher.")],
    components: buildSetSeasonRows()
  });
}

async function handleSetSeasonSelect(interaction: any) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can set the league season.", flags: MessageFlags.Ephemeral });
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
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can set the league season.", flags: MessageFlags.Ephemeral });
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

function weeklyChallengesEmbed() {
  const star = "<:dev_star:1494392249163972699>";
  const superstar = "<:dev_superstar:1494392251776897134>";
  const xfactor = "<:dev_xfactor:1494392253177663688>";
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
    "4th Quarter Comeback +$50",
    "Upset +$25 | Major Upset +$50",
    "Shut-Out +$50",
    "Slow-Starter -$10",
    "Weak-Closer -$10"
  ].join("\n"));
}

async function handleEosPayouts(interaction: ButtonInteraction) {
  const week = interaction.guildId ? await recApi.viewLeagueWeek(interaction.guildId).catch(() => null) : null;
  const currentWeek = Number(week?.league?.current_week ?? 1);
  if (currentWeek < 19 || currentWeek > 22) {
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle("EOS Payouts").setDescription("EOS payouts cannot be issued until the active regular season concludes. They are available from Wild Card through Super Bowl week.")], flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ embeds: [new EmbedBuilder().setTitle("EOS Payouts").setDescription("EOS payout calculation needs the final payout tier spec before it can issue pending payout ledgers. The button is now gated to the correct postseason window.")], flags: MessageFlags.Ephemeral });
}

async function handlePotyTallies(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can run POTY tallies.", flags: MessageFlags.Ephemeral });
  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  const currentWeek = Number(week?.league?.current_week ?? 1);
  if (currentWeek < 19 || currentWeek > 22) {
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle("POTY Tallies").setDescription("POTY Tallies are available from Wild Card through Super Bowl week.")], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Running POTY Tallies...").setDescription("Fetching eligible highlights, counting category reactions, and preparing payout reviews for any unpaid winners.")] });
  const result = await settleHighlightAwardsForGuild(interaction.guildId, interaction.client as any);
  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("POTY Tallies").setDescription(`Tallied Play of the Year reactions and prepared ${result.winners.length} category review(s).`)] });
}

async function handleLeagueMgmtSettings(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can manage league settings.", flags: MessageFlags.Ephemeral });
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
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can run first-time setup.", flags: MessageFlags.Ephemeral });
  }
  return interaction.showModal(buildSetupDangerModal("league_setup"));
}

async function handleLeagueMgmtRoles(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can manage league roles.", flags: MessageFlags.Ephemeral });
  }
  return replyMenuPlaceholder(interaction, "Roles", "Role management is not active yet. For now, assign Commissioner, Co Commissioner, and member roles directly in Discord or through League Mgmt > Teams where team links are managed.");
}

async function handleLeagueMgmtDeleteLeague(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can delete league data.", flags: MessageFlags.Ephemeral });
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
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can delete league data.", flags: MessageFlags.Ephemeral });
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
      return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
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
      await sourceMessage?.react("✅").catch(() => undefined);
    }
  }
  // DM the streamer that their payout was issued.
  if (result.updated && action === "approve" && result.streamerDiscordId) {
    const amount = result.amount ?? 50;
    const streamer = await interaction.client.users.fetch(result.streamerDiscordId).catch(() => null);
    await streamer?.send(`You've been paid **$${amount}** for streaming your game this week. Thanks for streaming! 📺`).catch(() => undefined);
  }
  if (result.updated && interaction.message?.editable) {
    await appendReviewActionToMessage(interaction, action === "approve" ? "Applied" : "Denied");
  }
}

await registerApplicationCommands().catch((error) => {
  console.error("Failed to register Discord application commands before startup", error);
});

await client.login(env.DISCORD_TOKEN);
