import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType, Client, EmbedBuilder, GatewayIntentBits, Interaction, Message, MessageFlags, ModalBuilder, ModalSubmitInteraction, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, TextChannel, TextInputBuilder, TextInputStyle } from "discord.js";
import { env } from "./config/env.js";
import { registerApplicationCommands, registerGuildCommands } from "./commands.js";
import { isDiscordAdminInteraction } from "./lib/admin.js";
import { recApi } from "./lib/rec-api.js";
import { ExpiringSessionStore } from "./lib/session-timeout.js";
import {
  buildAdminPanelEmbed,
  buildAdminPanelRows,
  buildEosFunctionsRows,
  buildCommissionerToolsRows,
  buildManageLeagueRows,
  buildServerLeagueSetupRows,
  buildLeagueMenuEmbed,
  buildLeagueMenuRows,
  buildMainMenuRows,
  buildRostersMenuEmbed,
  buildRostersMenuRows,
  buildToSavingsModal,
  buildFromSavingsModal,
  buildWalletTransferCustomModal,
  buildSetupDangerModal,
  buildDeleteLeagueWarningPayload,
  buildDeleteLeagueModal,
  MENU_CUSTOM_IDS,
  ROSTERS_CUSTOM_IDS,
  STREAM_CUSTOM_IDS,
  REC_BANK_CUSTOM_IDS,
  MANAGE_WALLET_CUSTOM_IDS
} from "./ui/menu.js";
import { SERVER_SETUP_CUSTOM_IDS, buildServerSetupPanel, buildChannelIdModal } from "./ui/server-setup-admin.js";
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
import { handleImportButton, handleImportModal, handleImportSelect, importSessions, renderImportPanel, startImportMode } from "./flows/imports.js";
import { buildCommissionerToolsEmbed, buildEosFunctionsEmbed, buildManageLeagueEmbed, buildServerLeagueSetupEmbed } from "./flows/commissioner-tools.js";
import { handleByTeamNav, handleRosterTeamSelect, handleRostersMenuSelect, handleSnapshotPageNav, handleSnapshotUserSelect, handleTeamsPage, renderRostersMenu, renderTeamsMenu, renderUserSnapshotPicker } from "./flows/rosters.js";
import { renderScheduleMenu, renderSchedulePlaceholder } from "./flows/schedule.js";
import { handleRulesSelect } from "./flows/rules.js";
import { handleActivityRequirementsModal, handleCoachAbilitiesRestrictionModal, handleLeagueSetupSave, handleLeagueSetupSelect, handleSetupModal, leagueSetupSessions } from "./flows/league-setup.js";
import { IMPORT_CUSTOM_IDS } from "./ui/imports.js";
import { buildTroubleshootMenuPanel, ADVANCE_MENU_CUSTOM_IDS } from "./ui/advance-menu.js";
import { ADVANCE_SCHEDULE_CUSTOM_IDS, ADVANCE_WIZARD_BACK_CUSTOM_ID, DEFAULT_SCHEDULE_TIMEZONE } from "./ui/advance-schedule.js";
import { handleAdvanceScheduleConfirm, handleAdvanceScheduleSelect, startAdvanceScheduleSession } from "./flows/advance-schedule.js";
import { handleAdvanceMenuSelect, handleTroubleshootMenuSelect } from "./flows/advance-menu.js";
import { advanceWizardSessions, ADVANCE_WIZARD_CUSTOM_IDS, ADVANCE_WIZARD_GOTW_CUSTOM_ID, buildAdvanceWizardEntryPayload, buildAdvanceWizardFsFwModal, buildAdvanceWizardImportPayload, buildAdvanceWizardManualPayload, buildAdvanceWizardOutcomeReviewPayload, buildAdvanceWizardStep2Payload, handleAdvanceWizardFsFwModal, handleTeamConflictSelect, handleTeamConflictResolveModal, handleTeamConflictContinue, handleWizardGotwSelect, clearCatchUpTarget } from "./flows/advance-wizard.js";
import { recordGameChannelMessage, recordHighlightMessage } from "./flows/game-channels.js";
import { handleGotwSelect, handleGotwVote, renderGotwSelection } from "./flows/gotw.js";
import { GOTW_CUSTOM_IDS } from "./ui/gotw.js";
import { RULES_CUSTOM_IDS, buildRulesPanel } from "./ui/rules.js";
import { LEAGUE_WEEK_CUSTOM_IDS, buildLeagueWeekSetModal, buildLeagueWeekStageRow } from "./ui/league-week.js";
import { ACTIVE_CHECK_CUSTOM_IDS } from "./ui/active-check.js";
import { WEEKLY_CHALLENGE_CUSTOM_IDS } from "./ui/weekly-challenges.js";
import { handleSimpleTeamLinkSelect, handleSimpleTeamLinkUserSelect, handleSimpleTeamLinkRoleSelect, handleClearAllTeamLinks, handleCustomTeamModal, handleCustomTeamNoLink } from "./flows/team-linking.js";
import { TEAM_LINK_CUSTOM_IDS } from "./ui/team-options.js";
import { buildRecAwardVotingEmbed, postEosPollsAndAwards } from "./flows/advance-wizard.js";
import { handleActiveCheckResponse, handleStartActiveCheck, startActiveCheckCloseoutLoop } from "./handlers/active-check.js";
import {
  handleManageWallet,
  handleWalletCustomTransferModal,
  handleWalletTransactions,
  handleWalletTransferAll,
  handleWalletTransferDirection,
  handleWalletTransferOpen,
  handlePlaceWager,
  handleRecBankSelect,
  handleSavingsTransferModal,
  handleTransferFunds,
  handleWalletMakePurchase,
  handleWalletPendingPurchases
} from "./handlers/wallet.js";
import { handleStreamLinkModal, handleStreamMenu, handleStreamServiceSelect } from "./handlers/stream.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
client.setMaxListeners(50);
const menuSessions = new ExpiringSessionStore<true>();
const serverSetupChannelSessions = new Map<string, string>();

setInterval(() => {
  menuSessions.cleanup();
  leagueSetupSessions.cleanup();
  advanceWizardSessions.cleanup();
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
  console.log(`REC Bot logged in as ${client.user?.tag ?? "unknown"} — build ${deployedCommit.slice(0, 12)}`);
  try {
    const health = await recApi.health();
    console.log(`Connected to ${health.service}`);
  } catch (error) {
    console.error("REC Core API health check failed", error);
  }
  await registerCommandsForVisibleGuilds();
  startActiveCheckCloseoutLoop(client);
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

    // GOTW vote buttons live on public announcement messages and must work for any league
    // member, without an active /menu session.
    if (interaction.isButton() && (interaction.customId.startsWith(GOTW_CUSTOM_IDS.voteAwayPrefix) || interaction.customId.startsWith(GOTW_CUSTOM_IDS.voteHomePrefix))) {
      return handleGotwVote(interaction);
    }

    // Active Check "Active" buttons appear in public announcements — any league member clicks them.
    if (interaction.isButton() && interaction.customId.startsWith(ACTIVE_CHECK_CUSTOM_IDS.activePrefix)) {
      return handleActiveCheckResponse(interaction);
    }

    // Nomination, voting, payout-review, and award controls appear on channel messages outside of /menu.
    if (interaction.isButton()) {
      if (interaction.customId.startsWith("highlight_payout:")) return handleHighlightPayout(interaction);
      if (interaction.customId.startsWith("rec:stream_review:")) return handleStreamReviewButton(interaction);
      if (interaction.customId.startsWith("poty_nominate_own:")) return handlePotyNominateOwn(interaction);
      if (interaction.customId.startsWith("goty_nominate_btn:")) return handleGotyNominateBtn(interaction);
      if (interaction.customId === "rec_awards_close_voting") return handleRecAwardCloseVoting(interaction);
      if (interaction.customId.startsWith("rec_award_approve:")) return handleRecAwardApprove(interaction);
      // EOS payout buttons appear in user DMs and in commissioner channel — no /menu session required
      if (interaction.customId.startsWith("eos_payout_approve:")) return handleEosPayoutApprove(interaction);
      if (interaction.customId.startsWith("eos_payout_reject:")) return handleEosPayoutReject(interaction);
    }
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("rec_award_vote:")) return handleRecAwardVote(interaction);
      if (interaction.customId.startsWith("eos_vote:")) return handleEosVote(interaction);
      if (interaction.customId.startsWith("poty_nominate:")) return handlePotyNominateSelect(interaction);
      if (interaction.customId.startsWith("poty_category_select:")) return handlePotyCategorySelect(interaction);
      if (interaction.customId.startsWith("goty_nominate:")) return handleGotyNominateSelect(interaction);
      if (interaction.customId.startsWith("eos_tiebreaker:cant_shut_up:")) return handleCantShutUpTiebreaker(interaction);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("goty_nominate_modal:")) {
      return handleGotyNominateModal(interaction);
    }

    if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && !menuSessions.touch(interaction.user.id)) {
      leagueSetupSessions.delete(interaction.user.id);
      importSessions.delete(interaction.user.id);
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

      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.simpleUserSelect) return handleSimpleTeamLinkUserSelect(interaction);

      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.roleSelect) return handleSimpleTeamLinkRoleSelect(interaction);

      if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.teamConflictSelect) return handleTeamConflictSelect(interaction);

      if (interaction.customId === SERVER_SETUP_CUSTOM_IDS.selectChannelType) {
        const channelType = interaction.values[0];
        serverSetupChannelSessions.set(interaction.user.id, channelType);
        const { buildChannelIdModal } = await import("./ui/server-setup-admin.js");
        return interaction.showModal(buildChannelIdModal(channelType));
      }

      if (interaction.customId === ADVANCE_WIZARD_GOTW_CUSTOM_ID) return handleWizardGotwSelect(interaction);
      if (interaction.customId.startsWith("eos_vote:")) return handleEosVote(interaction);
      if (interaction.customId === GOTW_CUSTOM_IDS.select) return handleGotwSelect(interaction);
      if (interaction.customId === RULES_CUSTOM_IDS.select) return handleRulesSelect(interaction);
      if (interaction.customId === LEAGUE_WEEK_CUSTOM_IDS.stageSelect) return interaction.showModal(buildLeagueWeekSetModal(interaction.values[0]));
      if (interaction.customId === MENU_CUSTOM_IDS.mainSelect) return handleMainMenuSelect(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.adminSelect) return handleAdminPanelSelect(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.commissionerToolsSelect) return handleCommissionerToolsSelect(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.manageLeagueSelect) return handleManageLeagueSelect(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.serverLeagueSetupSelect) return handleServerLeagueSetupSelect(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.eosFunctionsSelect) return handleEosFunctionsSelect(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.select) return handleRostersMenuSelect(interaction, buildMainMenuPayload);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotUserSelect) return handleSnapshotUserSelect(interaction);
      if (interaction.customId.startsWith(`${ROSTERS_CUSTOM_IDS.teamSelect}:`)) return handleRosterTeamSelect(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.byTeamNav) return handleByTeamNav(interaction, buildMainMenuPayload);
      if (interaction.customId === REC_BANK_CUSTOM_IDS.select) return handleRecBankSelect(interaction, buildMainMenuPayload);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.transferDirection) return handleWalletTransferDirection(interaction);
      if (interaction.customId === STREAM_CUSTOM_IDS.serviceSelect) return handleStreamServiceSelect(interaction);
      if (Object.values(LEAGUE_SETUP_CUSTOM_IDS).includes(interaction.customId as any) || interaction.customId.startsWith(LEAGUE_SETUP_CUSTOM_IDS.seasonWeek)) return handleLeagueSetupSelect(interaction);
      if (
        Object.values(IMPORT_CUSTOM_IDS).some(
          (id) => interaction.customId === id || interaction.customId.startsWith(`${id}:`)
        )
      ) return handleImportSelect(interaction);
      if (interaction.customId === ADVANCE_MENU_CUSTOM_IDS.select) return handleAdvanceMenuSelect(interaction);
      if (interaction.customId === ADVANCE_MENU_CUSTOM_IDS.troubleshootSelect) return handleTroubleshootMenuSelect(interaction);
      if (
        interaction.customId === ADVANCE_SCHEDULE_CUSTOM_IDS.daySelect ||
        interaction.customId === ADVANCE_SCHEDULE_CUSTOM_IDS.hourSelect ||
        interaction.customId === ADVANCE_SCHEDULE_CUSTOM_IDS.tzSelect
      ) return handleAdvanceScheduleSelect(interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("eos_payout_approve:")) return handleEosPayoutApprove(interaction);
      if (interaction.customId.startsWith("eos_payout_reject:")) return handleEosPayoutReject(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.adminServerSetup) return interaction.reply(buildServerSetupPanel());
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.clearAllLinks) return handleClearAllTeamLinks(interaction);
      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.customTeamNoLink) return handleCustomTeamNoLink(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.adminLeagueSetup) return interaction.showModal(buildSetupDangerModal("league_setup"));
      if (interaction.customId === MENU_CUSTOM_IDS.deleteLeagueCancel) return interaction.update({ embeds: [buildServerLeagueSetupEmbed()], components: buildServerLeagueSetupRows() });
      if (interaction.customId === MENU_CUSTOM_IDS.deleteLeagueConfirm) {
        if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can delete league data.", flags: MessageFlags.Ephemeral });
        const week = interaction.guildId ? await recApi.viewLeagueWeek(interaction.guildId).catch(() => null) : null;
        const leagueName = week?.league?.name;
        if (!leagueName) return interaction.reply({ content: "No league is set up for this server.", flags: MessageFlags.Ephemeral });
        return interaction.showModal(buildDeleteLeagueModal(leagueName));
      }
      if (interaction.customId === MENU_CUSTOM_IDS.adminImports || interaction.customId === MENU_CUSTOM_IDS.adminImportEnterData) return renderImportPanel(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.adminRules) return interaction.update(buildRulesPanel());
      if (interaction.customId === MENU_CUSTOM_IDS.adminActiveCheck) return handleStartActiveCheck(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.adminReselectGotw) return renderGotwSelection(interaction);
      if (interaction.customId === ACTIVE_CHECK_CUSTOM_IDS.start) return handleStartActiveCheck(interaction);
      if (interaction.customId === WEEKLY_CHALLENGE_CUSTOM_IDS.selectGotw) return renderGotwSelection(interaction);
      if (interaction.customId === LEAGUE_WEEK_CUSTOM_IDS.view) return handleLeagueWeekView(interaction);
      if (interaction.customId === LEAGUE_WEEK_CUSTOM_IDS.set) return interaction.reply({ content: "Choose the stage first.", components: [buildLeagueWeekStageRow()], ephemeral: true });
      if (interaction.customId.startsWith(IMPORT_CUSTOM_IDS.approveJob)) return handleImportButton(interaction);
      if (
        Object.values(IMPORT_CUSTOM_IDS).some(
          (id) => interaction.customId === id || interaction.customId.startsWith(`${id}:`)
        )
      ) return handleImportButton(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.save) return handleLeagueSetupSave(interaction);
      if (interaction.customId === ADVANCE_MENU_CUSTOM_IDS.troubleshootBack) return interaction.update(buildTroubleshootMenuPanel());
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
      if (interaction.customId === "rec:league_setup:skip_team_linking") {
        // League is already saved by this point; this button just closes the linking step.
        return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
      }
      if (Object.values(ADVANCE_WIZARD_CUSTOM_IDS).includes(interaction.customId as any)) return handleAdvanceWizardButton(interaction);
      if (interaction.customId === ADVANCE_WIZARD_BACK_CUSTOM_ID) {
        if (!interaction.guildId) return interaction.reply({ content: "The Advance Wizard can only be used inside a Discord server.", flags: MessageFlags.Ephemeral });
        return interaction.update(await buildAdvanceWizardStep2Payload(interaction.guildId, true, interaction.user.id));
      }
      if (interaction.customId === ADVANCE_SCHEDULE_CUSTOM_IDS.confirm) return handleAdvanceScheduleConfirm(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.mainMenu) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.adminPanel) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.back) return handleBackNavigation(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotPrev) return handleSnapshotPageNav(interaction, -1);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotNext) return handleSnapshotPageNav(interaction, +1);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotBack) return renderRostersMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.openTeams) return renderTeamsMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.schedule) return renderScheduleMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleSelectTeam) return renderSchedulePlaceholder(interaction, "Select Team", "Team schedule selection is coming soon. This will let you view any team's schedule.");
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleSos) return renderSchedulePlaceholder(interaction, "SOS", "Strength of schedule is coming soon.");
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleHistory) return renderSchedulePlaceholder(interaction, "History", "Schedule history is coming soon.");
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleBack) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.transferFunds) return handleTransferFunds(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.placeWager) return handlePlaceWager(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.manageWallet) return handleManageWallet(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.makePurchase) return replyMenuPlaceholder(interaction, "Purchase", "The purchase store is coming soon. It will only show purchase types enabled for this league.");
      if (interaction.customId === MENU_CUSTOM_IDS.viewUserProfiles) return renderUserSnapshotPicker(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.stream) return handleStreamMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.uploadBoxScore) return replyMenuPlaceholder(interaction, "Box Score & Scoring Summary", "Screenshot uploads are coming soon. This will log game results, scoring details, eligible payouts, and story generation.");
      if (interaction.customId === MENU_CUSTOM_IDS.uploadScoringSummary) return replyMenuPlaceholder(interaction, "Upload Scoring Summary", "Scoring summary screenshot uploads are coming soon. This will log game details, payouts, and story generation.");
      if (interaction.customId === MENU_CUSTOM_IDS.helpRules) return interaction.update(buildRulesPanel());
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmt) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId.startsWith(`${MENU_CUSTOM_IDS.teamsPage}:`)) return handleTeamsPage(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.requestTeam) return replyMenuPlaceholder(interaction, "Request Team", "Team requests are coming soon. This will let users request an available team from this league.");
      if (interaction.customId === MENU_CUSTOM_IDS.teamsBack) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.transfer) return handleWalletTransferOpen(interaction);
      if (interaction.customId.startsWith(`${MANAGE_WALLET_CUSTOM_IDS.transferAll}:`)) return handleWalletTransferAll(interaction, interaction.customId.endsWith(":from_savings") ? "from_savings" : "to_savings");
      if (interaction.customId.startsWith(`${MANAGE_WALLET_CUSTOM_IDS.transferCustom}:`)) return interaction.showModal(buildWalletTransferCustomModal(interaction.customId.endsWith(":from_savings") ? "from_savings" : "to_savings"));
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.transactions) return handleWalletTransactions(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.back) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.toSavings) return interaction.showModal(buildToSavingsModal());
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.fromSavings) return interaction.showModal(buildFromSavingsModal());
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.pendingPurchases) return handleWalletPendingPurchases(interaction);
      if (interaction.customId === MANAGE_WALLET_CUSTOM_IDS.makePurchase) return handleWalletMakePurchase(interaction);
    }

    if (interaction.isModalSubmit() && interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.outcomesFsFwModal) return handleAdvanceWizardFsFwModal(interaction);

    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${ADVANCE_WIZARD_CUSTOM_IDS.teamConflictResolveModal}:`)) return handleTeamConflictResolveModal(interaction);

    if (interaction.isModalSubmit()) {
      if (interaction.customId === SERVER_SETUP_CUSTOM_IDS.channelIdModal) return handleServerSetupChannelIdModal(interaction);
      if (
        Object.values(IMPORT_CUSTOM_IDS).some(
          (id) => interaction.customId === id || interaction.customId.startsWith(`${id}:`)
        )
      ) return handleImportModal(interaction);
      if (interaction.customId.startsWith(`${MENU_CUSTOM_IDS.setupModal}:`)) return handleSetupModal(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.deleteLeagueModal) return handleDeleteLeagueModal(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.activityRequirementsModal) return handleActivityRequirementsModal(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.coachAbilitiesRestrictionModal) return handleCoachAbilitiesRestrictionModal(interaction);
      if (interaction.customId === REC_BANK_CUSTOM_IDS.toSavingsModal) return handleSavingsTransferModal(interaction, "to_savings");
      if (interaction.customId === REC_BANK_CUSTOM_IDS.fromSavingsModal) return handleSavingsTransferModal(interaction, "from_savings");
      if (interaction.customId.startsWith(`${MANAGE_WALLET_CUSTOM_IDS.transferCustomModal}:`)) return handleWalletCustomTransferModal(interaction, interaction.customId.endsWith(":from_savings") ? "from_savings" : "to_savings");
      if (interaction.customId.startsWith(`${STREAM_CUSTOM_IDS.linkModal}:`)) return handleStreamLinkModal(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_WEEK_CUSTOM_IDS.setModal}:`)) return handleLeagueWeekSetModal(interaction);
      if (interaction.customId.startsWith(`${TEAM_LINK_CUSTOM_IDS.customTeamModal}:`)) return handleCustomTeamModal(interaction);
    }
  } catch (error) {
    await safeInteractionError(interaction, error);
  }
});

async function buildMainMenuPayload(userId: string, guildId: string | null, isAdmin: boolean) {
  let menuEmbed = buildLeagueMenuEmbed({ discordUsername: "Loading REC profile..." });
  let isLinkedToTeamForRows = false;
  const unregisteredNotice = "You are not currently registered in the REC League's database, so you have not participated in a REC League before. You must select an open team using Teams below and, once a Commissioner/League Manager approves your request, you'll be added to the database.";

  if (!guildId) {
    return {
      embeds: [buildLeagueMenuEmbed({ discordUsername: "Open /menu inside a REC Discord server" })],
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
      noticeText: isLinkedToTeam ? undefined : unregisteredNotice
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
      noticeText: isMissingRecUser ? unregisteredNotice : undefined
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
  importSessions.delete(interaction.user.id);
  await interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isDiscordAdminInteraction(interaction)));
}

async function renderAdminPanelFromComponent(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can open the Admin Panel.", flags: MessageFlags.Ephemeral });
  importSessions.delete(interaction.user.id);
  await interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
}

async function replyMenuPlaceholder(interaction: ButtonInteraction, title: string, description: string) {
  return interaction.reply({
    embeds: [new EmbedBuilder().setTitle(title).setDescription(description)],
    flags: MessageFlags.Ephemeral
  });
}


async function handleMainMenuSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];
  if (selected === "admin_panel") {
    if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can open the Admin Panel.", flags: MessageFlags.Ephemeral });
    return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
  }
  if (selected === "rosters") return interaction.update({ embeds: [buildRostersMenuEmbed()], components: buildRostersMenuRows() });
  // FUTURE: these four main-menu departments are connected shells (see docs/menu-map.md):
  //   manage_franchise   -> coach self-service: my lineup/links, my contract+cap snapshot, my badges, purchases
  //   standings_stats    -> league standings table + leaderboards (rec_season_user_records, weekly stats, power rankings)
  //   rec_sports_network -> streams, highlights, POTW/GOTY galleries, award results
  //   rules_faq          -> player-facing rule reader + command help (admin rules panel exists via buildRulesPanel)
  const shells: Record<string, { title: string; blurb: string }> = {
    manage_franchise: { title: "Manage My Franchise", blurb: "Your coach hub — your team and lineup, contracts and cap, badges, and the upgrade store will live here." },
    standings_stats: { title: "Standings & Stats", blurb: "League standings, stat leaderboards, and power rankings will live here." },
    rec_sports_network: { title: "REC Sports Network", blurb: "Streams, highlights, Player/Game of the Week galleries, and award results will live here." },
    rules_faq: { title: "Rules / FAQ", blurb: "The league rulebook and answers to common questions will live here." }
  };
  const shell = shells[selected] ?? { title: "REC League HQ", blurb: "This department is coming soon." };
  await interaction.update({ embeds: [new EmbedBuilder().setTitle(shell.title).setDescription(`${shell.blurb}\n\n**Coming soon** — use the menu below to head elsewhere.`).setFooter({ text: "REC Core" })], components: buildMainMenuRows(isDiscordAdminInteraction(interaction)) });
}

async function handleAdminPanelSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can use Admin Panel workflows.", flags: MessageFlags.Ephemeral });
  }

  const selected = interaction.values[0];

  if (selected === "main_menu") return renderMainMenuFromSelect(interaction);
  if (selected === "advance_wizard") {
    if (!interaction.inCachedGuild()) return interaction.reply({ content: "The Advance Wizard can only be used inside a Discord server.", flags: MessageFlags.Ephemeral });
    return interaction.update(await buildAdvanceWizardEntryPayload(interaction.guildId));
  }
  if (selected === "import_enter_data") return renderImportPanel(interaction);
  if (selected === "commissioner_tools") {
    return interaction.update({ embeds: [await buildCommissionerToolsEmbed(interaction.guildId ?? undefined)], components: buildCommissionerToolsRows() });
  }

  return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
}

// Commissioner Tools submenu router (Admin Panel -> Commissioner Tools).
async function handleCommissionerToolsSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can use Commissioner Tools.", flags: MessageFlags.Ephemeral });
  }
  const selected = interaction.values[0];
  if (selected === "admin_panel") return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
  if (selected === "main_menu") return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
  if (selected === "server_league_setup") return interaction.update({ embeds: [buildServerLeagueSetupEmbed()], components: buildServerLeagueSetupRows() });
  if (selected === "manage_league") {
    return interaction.update({ embeds: [buildManageLeagueEmbed()], components: buildManageLeagueRows() });
  }
  return interaction.update({ embeds: [await buildCommissionerToolsEmbed(interaction.guildId)], components: buildCommissionerToolsRows() });
}

// Manage League submenu router (Commissioner Tools -> Manage League).
async function handleManageLeagueSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can manage the league.", flags: MessageFlags.Ephemeral });
  }
  const selected = interaction.values[0];
  if (selected === "commissioner_tools") {
    return interaction.update({ embeds: [await buildCommissionerToolsEmbed(interaction.guildId)], components: buildCommissionerToolsRows() });
  }
  if (selected === "active_check") return handleStartActiveCheck(interaction);
  if (selected === "troubleshoot_advance") return interaction.update(buildTroubleshootMenuPanel());
  if (selected === "eos_functions") return interaction.update({ embeds: [buildEosFunctionsEmbed()], components: buildEosFunctionsRows() });
  if (selected === "user_team_linking") {
    const { buildSimpleTeamLinkPanel } = await import("./ui/team-options.js");
    return interaction.update(buildSimpleTeamLinkPanel());
  }
  if (selected === "edit_league_settings") {
    if (!interaction.inCachedGuild()) return interaction.reply({ content: "This action requires a guild context.", flags: MessageFlags.Ephemeral });
    await interaction.deferUpdate();
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading League Settings...").setDescription("Fetching current league configuration.")], components: [] });
    try {
      const result = await recApi.getLeagueConfig(interaction.guildId);
      const draft = { ...result.draft, step: "settings_picker" as const, editMode: true };
      leagueSetupSessions.set(interaction.user.id, draft as LeagueSetupDraft);
      return interaction.editReply({ ...buildSettingsPickerWindow(draft as LeagueSetupDraft), components: buildSettingsPickerWindow(draft as LeagueSetupDraft).components });
    } catch {
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Edit League Settings").setDescription("No league configuration found. Run League Setup first.")], components: buildManageLeagueRows() });
    }
  }
  return interaction.update({ embeds: [buildManageLeagueEmbed()], components: buildManageLeagueRows() });
}

async function handleServerLeagueSetupSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can use Server/League Setup.", flags: MessageFlags.Ephemeral });
  }
  const selected = interaction.values[0];
  if (selected === "commissioner_tools") {
    return interaction.update({ embeds: [await buildCommissionerToolsEmbed(interaction.guildId)], components: buildCommissionerToolsRows() });
  }
  if (selected === "server_setup") return interaction.update(buildServerSetupPanel());
  if (selected === "league_setup") return interaction.showModal(buildSetupDangerModal("league_setup"));
  if (selected === "delete_league") {
    const week = interaction.guildId ? await recApi.viewLeagueWeek(interaction.guildId).catch(() => null) : null;
    const leagueName = week?.league?.name;
    if (!leagueName) {
      return interaction.update({ embeds: [new EmbedBuilder().setTitle("Delete League Data").setDescription("No league is set up for this server, so there is nothing to delete.")], components: buildServerLeagueSetupRows() });
    }
    return interaction.update(buildDeleteLeagueWarningPayload(leagueName));
  }
  return interaction.update({ embeds: [buildServerLeagueSetupEmbed()], components: buildServerLeagueSetupRows() });
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
      components: buildServerLeagueSetupRows()
    });
  } catch (error) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Delete Failed").setColor(0xe74c3c).setDescription(error instanceof Error ? error.message : String(error))],
      components: buildServerLeagueSetupRows()
    });
  }
}

async function handleEosFunctionsSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: "EOS functions can only be used inside a Discord server.", flags: MessageFlags.Ephemeral });
  }
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can use EOS functions.", flags: MessageFlags.Ephemeral });
  }

  const selected = interaction.values[0];
  if (selected === "manage_league") return interaction.update({ embeds: [buildManageLeagueEmbed()], components: buildManageLeagueRows() });

  await interaction.deferUpdate();

  if (selected === "run_eos_polls_and_awards") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Running EOS Polls & Awards...").setDescription("Generating nominees and posting community polls + REC Awards voting embeds.")], components: [] });
    try {
      const result = await recApi.runEosPollsAndAwards(interaction.guildId);
      if (!result.allowed) {
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Not Available").setDescription(result.reason ?? "This action is only available during Wild Card through Super Bowl weeks.")], components: buildEosFunctionsRows() });
        return;
      }
      const warnings = [...(result.warnings ?? []), ...await postEosPollsAndAwards(interaction.guild, result.pollsData)];
      const pollCount = result.pollsData?.polls?.length ?? 0;
      const awardCount = result.pollsData?.recAwardsData?.awards?.filter((a: any) => a.status === "voting" && a.nomineeCount > 0).length ?? 0;
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Polls & Awards Posted").setDescription([
          `Community polls posted: **${pollCount}**`,
          `REC Award voting embeds posted: **${awardCount}**`,
          warnings.length ? `\nWarnings: ${warnings.join(", ")}` : ""
        ].filter(Boolean).join("\n"))],
        components: buildEosFunctionsRows()
      });
    } catch (error) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("EOS Polls Failed").setDescription(error instanceof Error ? error.message : String(error))], components: buildEosFunctionsRows() });
    }
    return;
  }

  if (selected === "issue_eos_payouts") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Issuing EOS Payouts...").setDescription("Computing stat thresholds and rank bonuses. Already approved payouts are preserved.")], components: [] });
    try {
      const result = await recApi.issueEosPayouts(interaction.guildId);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Payouts Issued").setDescription(`Created ${result.items?.length ?? 0} payout items. Skipped ${result.skippedAlreadyIssued?.length ?? 0} already-issued payouts.`)],
        components: buildEosFunctionsRows()
      });
    } catch (error) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("EOS Payouts Failed").setDescription(error instanceof Error ? error.message : String(error))], components: buildEosFunctionsRows() });
    }
    return;
  }
}

async function handleAdvanceWizardButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "The Advance Wizard can only be used inside a Discord server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can use the Advance Wizard.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.teamConflictContinue) return handleTeamConflictContinue(interaction);

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.back) {
    await interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.manualBack) {
    await interaction.update(await buildAdvanceWizardEntryPayload(interaction.guildId));
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.importBack) {
    await interaction.update(await buildAdvanceWizardEntryPayload(interaction.guildId));
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.outcomesBack || interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.step2Back) {
    clearCatchUpTarget(interaction.user.id);
    await interaction.update(await buildAdvanceWizardEntryPayload(interaction.guildId));
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.manualMarkFsFw) {
    await interaction.update(await buildAdvanceWizardOutcomeReviewPayload(interaction.guildId));
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.outcomesSkip) {
    // The catch-up plan was set on the import screen; keep it so the review screen can show it.
    await interaction.update(await buildAdvanceWizardStep2Payload(interaction.guildId, true, interaction.user.id));
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.outcomesMarkFsFw) {
    await interaction.update(await buildAdvanceWizardOutcomeReviewPayload(interaction.guildId));
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.outcomesOpenFsFwModal) {
    await interaction.showModal(await buildAdvanceWizardFsFwModal(interaction.guildId));
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.step2Next) {
    await interaction.update(startAdvanceScheduleSession(interaction.user.id, { timezone: DEFAULT_SCHEDULE_TIMEZONE, wizardMode: true }));
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.manual) {
    await interaction.update(await buildAdvanceWizardManualPayload(interaction.guildId));
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.import) {
    await interaction.update(buildAdvanceWizardImportPayload());
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.importData) {
    await startImportMode(interaction, "ea_import", { fromAdvanceWizard: true });
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.offseasonAdvance) {
    await interaction.deferUpdate();
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Advancing Offseason Stage...").setDescription("Moving the league to the next offseason stage.")],
      components: []
    });
    try {
      const result = await recApi.processAdvanceResults(interaction.guildId);
      const week = result.week;
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Offseason Advance Complete")
            .setDescription([
              week ? `Advanced from **${String(week.previousStage).replaceAll("_", " ")} Week ${week.previousWeek}** to **${String(week.seasonStage).replaceAll("_", " ")} Week ${week.weekNumber}**.` : "Advance completed.",
              "",
              result.warnings?.length ? `Warnings:\n${result.warnings.slice(0, 8).map((w: string) => `- ${w}`).join("\n")}` : "No warnings reported."
            ].join("\n").slice(0, 4000))
        ],
        components: buildAdminPanelRows()
      });
    } catch (error) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Offseason Advance Failed").setDescription(error instanceof Error ? error.message : String(error))],
        components: buildAdminPanelRows()
      });
    }
    return;
  }

  if (interaction.customId === ADVANCE_WIZARD_CUSTOM_IDS.mcaUrl) {
    await interaction.reply({
      content: "MCA URL placeholder: the API endpoint to receive and parse Madden Companion App exports is not configured yet.",
      flags: MessageFlags.Ephemeral
    });
  }
}


async function renderMainMenuFromSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  importSessions.delete(interaction.user.id);
  await interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isDiscordAdminInteraction(interaction)));
}

async function handleBackNavigation(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (draft) {
    const previous = getPreviousLeagueSetupStep(draft.step);
    if (previous === "admin_panel") {
      leagueSetupSessions.delete(interaction.user.id);
      return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
    }
    draft.step = previous;
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  if (importSessions.has(interaction.user.id)) {
    importSessions.delete(interaction.user.id);
    return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
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

async function handleEosPayoutApprove(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  // customId: eos_payout_approve:{role}:{itemId}
  const parts = interaction.customId.split(":");
  const role = parts[1] as "user" | "commissioner";
  const itemId = parts[2];

  if (role === "commissioner" && !isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized commissioners can approve EOS payouts.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await recApi.approveEosPayoutItem({ itemId, discordId: interaction.user.id, role });

    if (result.reason === "already_issued") {
      return interaction.editReply({ content: "This payout has already been issued." });
    }
    if (result.reason === "already_denied") {
      return interaction.editReply({ content: "This payout has already been rejected." });
    }
    if (result.reason === "already_voided") {
      return interaction.editReply({ content: "This payout has been voided by a newer EOS payout batch." });
    }
    if (result.reason === "already_user_approved") {
      return interaction.editReply({ content: "You already approved this payout. It is still waiting on commissioner approval." });
    }
    if (result.reason === "already_commissioner_approved") {
      return interaction.editReply({ content: "A commissioner has already approved this payout. It is still waiting on recipient approval." });
    }
    if (result.reason === "not_recipient") {
      return interaction.editReply({ content: "You are not the recipient of this payout." });
    }

    if (result.credited) {
      // Both approvals collected — payout issued
      const balanceStr = result.newBalance !== null ? ` Your new wallet balance: **$${result.newBalance?.wallet ?? 0}**.` : "";
      await interaction.editReply({ content: `✅ Payout approved! **$${result.amount}** — ${result.payoutLabel} has been credited to your wallet.${balanceStr}` });

      // Edit the original message to reflect completed state
      try {
        await interaction.message.edit({
          embeds: [new EmbedBuilder()
            .setTitle("✅ Payout Issued")
            .setDescription(`**$${result.amount}** — ${result.payoutLabel}\nBoth approvals received. Funds credited.`)
            .setColor(0x57f287)],
          components: []
        });
      } catch { /* non-fatal if message is in DM */ }
    } else if (result.reason === "awaiting_commissioner") {
      await interaction.editReply({ content: "✅ You approved your payout. Awaiting commissioner approval before funds are credited." });
      // Update the DM message to show pending state
      try {
        await interaction.message.edit({
          embeds: [new EmbedBuilder()
            .setTitle("⏳ Awaiting Commissioner Approval")
            .setDescription(interaction.message.embeds[0]?.description ?? "Payout pending.")
            .setColor(0xfee75c)],
          components: interaction.message.components
        });
      } catch { /* non-fatal */ }
      // Update the commissioner channel embed and ping roles
      if (result.commissionerChannelId && result.commissionerMessageId && result.guildId) {
        try {
          const guild = await client.guilds.fetch(result.guildId).catch(() => null);
          if (guild) {
            const commCh = await guild.channels.fetch(result.commissionerChannelId).catch(() => null) as TextChannel | null;
            if (commCh?.type === ChannelType.GuildText) {
              const commMsg = await commCh.messages.fetch(result.commissionerMessageId).catch(() => null);
              if (commMsg) {
                const originalDesc = commMsg.embeds[0]?.description ?? "";
                await commMsg.edit({
                  embeds: [new EmbedBuilder()
                    .setDescription(originalDesc)
                    .setTitle("✅ User Approved — Awaiting Commissioner")
                    .setColor(0xfee75c)],
                  components: commMsg.components
                }).catch(() => undefined);
                // Ping commissioner/co-commissioner roles
                const allRoles = await guild.roles.fetch();
                const pingParts = (["REC League Commissioner", "REC League Comp. Committee"] as const)
                  .map(name => allRoles.find(r => r.name === name))
                  .filter(Boolean)
                  .map(r => `<@&${r!.id}>`);
                if (pingParts.length > 0) {
                  await commCh.send({
                    content: `${pingParts.join(" ")} — <@${interaction.user.id}> approved their **${result.payoutLabel ?? "EOS"}** payout ($${result.amount}). Only your sign-off is needed to issue funds.`
                  }).catch(() => undefined);
                }
              }
            }
          }
        } catch { /* non-fatal */ }
      }
    } else if (result.reason === "awaiting_user") {
      await interaction.editReply({ content: "✅ Commissioner approval recorded. Waiting for the recipient to approve via DM." });
    }
  } catch (err) {
    await interaction.editReply({ content: `Failed to process approval: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function handleEosPayoutReject(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  // customId: eos_payout_reject:{itemId}
  const itemId = interaction.customId.split(":")[1];

  // Either the recipient OR a commissioner can reject
  const isAdmin = isDiscordAdminInteraction(interaction);
  // Non-admins can only reject in DMs (their own payout)
  if (!isAdmin && interaction.guild) {
    return interaction.reply({ content: "Only commissioners can reject payouts from this panel. Recipients may reject via their DM.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await recApi.rejectEosPayoutItem({ itemId, discordId: interaction.user.id });

    if (!result.rejected) {
      return interaction.editReply({ content: "This payout has already been resolved." });
    }

    await interaction.editReply({ content: `Payout rejected — **${result.payoutLabel}** ($${result.amount}) has been cancelled.` });

    // Edit the original message to close it (remove buttons)
    try {
      await interaction.message.edit({
        embeds: [new EmbedBuilder()
          .setTitle("❌ Payout Rejected")
          .setDescription(`**$${result.amount}** — ${result.payoutLabel}\nThis payout was rejected and will not be credited.`)
          .setColor(0xed4245)],
        components: []
      });
    } catch { /* non-fatal */ }
  } catch (err) {
    await interaction.editReply({ content: `Failed to process rejection: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function handleEosVote(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  // Custom ID format: eos_vote:{pollId}:{categoryKey}
  const parts = interaction.customId.split(":");
  const categoryKey = parts[2] ?? "";
  const nomineeDiscordId = interaction.values[0];
  const guildId = interaction.guild?.id;

  if (!guildId || !nomineeDiscordId || !categoryKey) {
    return interaction.reply({ content: "Could not process your vote. Missing data.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await recApi.castEosVote({
      guildId,
      voterDiscordId: interaction.user.id,
      categoryKey,
      nomineeDiscordId
    });

    if (result.recorded) {
      return interaction.editReply({ content: `Your vote for **${result.categoryLabel}** has been recorded! You may change your vote at any time before voting closes.` });
    } else {
      return interaction.editReply({ content: `Could not record your vote: ${result.reason}` });
    }
  } catch (err) {
    console.error("[EOS Vote] Error:", err);
    return interaction.editReply({ content: "An error occurred while recording your vote. Please try again." });
  }
}

// ─── Message handler: routes messages to stream/highlight tracking ───────────
client.on("messageCreate", async (message: Message) => {
  if (message.author?.bot || !message.guildId) return;
  // Run both handlers; each checks internally if the message is in its designated channel.
  await Promise.allSettled([
    recordGameChannelMessage(message),
    recordHighlightMessage(message)
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler functions for interactions that appear outside of /menu sessions.
// Called from the session-gate bypass block at the top of interactionCreate.
// ─────────────────────────────────────────────────────────────────────────────

async function handleHighlightPayout(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only admins can manage highlight payouts.", flags: MessageFlags.Ephemeral });
    return;
  }
  const [, action, postId] = interaction.customId.split(":");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (action === "approve") {
    try {
      await recApi.approveHighlightPayout({ postId: postId!, discordId: interaction.user.id });
      await interaction.message.edit({ components: [] }).catch(() => undefined);
      await interaction.editReply({ content: "Highlight payout approved." });
    } catch (err) {
      await interaction.editReply({ content: `Failed to approve: ${err instanceof Error ? err.message : String(err)}` });
    }
  } else {
    await recApi.denyHighlightPayout({ postId: postId!, discordId: interaction.user.id, deniedReason: "Denied by commissioner review." }).catch(() => undefined);
    await interaction.message.edit({ components: [] }).catch(() => undefined);
    await interaction.editReply({ content: "Highlight payout denied." });
  }
}

async function handleRecAwardVote(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const parts = interaction.customId.split(":");
  const guildId = parts[1] ?? interaction.guildId ?? "";
  const awardId = parts[2] ?? "";
  const nomineeUserId = interaction.values[0];
  if (!guildId || !awardId || !nomineeUserId) {
    return interaction.reply({ content: "Could not process vote.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await recApi.castAwardVote({ guildId, voterDiscordId: interaction.user.id, awardId, nomineeUserId });
    if (result.recorded) {
      await interaction.editReply({ content: `Your vote for **${result.awardName ?? "this award"}** has been recorded!` });
      if (result.award) {
        await interaction.message.edit({ embeds: [buildRecAwardVotingEmbed(result.award)] }).catch((err) => console.warn("Failed to refresh REC award voting embed", err));
      }
    } else {
      await interaction.editReply({ content: result.reason ?? "Could not record your vote." });
    }
  } catch (err) {
    await interaction.editReply({ content: `Failed to record vote: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function handlePotyNominateSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const guildId = interaction.customId.split(":")[1] ?? interaction.guildId ?? "";
  const nomineeDiscordId = interaction.values[0];
  if (!guildId || !nomineeDiscordId) return interaction.reply({ content: "Could not process nomination.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await recApi.submitPotyNomination({ guildId, nominatorDiscordId: interaction.user.id, nomineeDiscordId });
    const nominated = await interaction.client.users.fetch(nomineeDiscordId).catch(() => null);
    await interaction.editReply({ content: `Your POTY nomination for **${nominated?.displayName ?? nomineeDiscordId}** has been recorded!` });
  } catch (err) {
    await interaction.editReply({ content: `Failed to record nomination: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function handleGotyNominateSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const guildId = interaction.customId.split(":")[1] ?? interaction.guildId ?? "";
  const nominatedGameId = interaction.values[0];
  if (!guildId || !nominatedGameId) return interaction.reply({ content: "Could not process nomination.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await recApi.submitGotyNomination({ guildId, nominatorDiscordId: interaction.user.id, nominatedGameId });
    await interaction.editReply({ content: "Your GOTY nomination has been recorded!" });
  } catch (err) {
    await interaction.editReply({ content: `Failed to record nomination: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function handlePotyNominateOwn(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  const parts = interaction.customId.split(":");
  const guildId = parts[1] ?? interaction.guildId ?? "";
  const highlightId = parts[2] ?? "";
  if (!guildId) return interaction.reply({ content: "Could not process nomination.", flags: MessageFlags.Ephemeral });
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: "Select a category for your Play of the Year nomination:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`poty_category_select:${guildId}:${highlightId}`)
        .setPlaceholder("Choose a category")
        .addOptions([
          new StringSelectMenuOptionBuilder().setLabel("Best Touchdown").setValue("best_td"),
          new StringSelectMenuOptionBuilder().setLabel("Best Run Play").setValue("best_run"),
          new StringSelectMenuOptionBuilder().setLabel("Best Catch").setValue("best_catch"),
          new StringSelectMenuOptionBuilder().setLabel("Best Defensive Play").setValue("best_defensive_play"),
          new StringSelectMenuOptionBuilder().setLabel("Best Special Teams Play").setValue("best_special_teams"),
          new StringSelectMenuOptionBuilder().setLabel("Most Clutch Moment").setValue("most_clutch")
        ])
    )]
  });
}

async function handlePotyCategorySelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const parts = interaction.customId.split(":");
  const guildId = parts[1] ?? interaction.guildId ?? "";
  const highlightId = parts[2] ?? "";
  const potyCategory = interaction.values[0];
  if (!guildId || !potyCategory) return interaction.reply({ content: "Could not process nomination.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  try {
    await recApi.submitPotyNomination({
      guildId,
      nominatorDiscordId: interaction.user.id,
      nomineeDiscordId: interaction.user.id,
      potyCategory,
      highlightId: highlightId || undefined
    });
    await interaction.editReply({ content: `Your **Play of the Year** nomination has been recorded in the **${potyCategory.replace(/_/g, " ")}** category!`, components: [] });
  } catch (err) {
    await interaction.editReply({ content: `Failed to record nomination: ${err instanceof Error ? err.message : String(err)}`, components: [] });
  }
}

async function handleGotyNominateBtn(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  const parts = interaction.customId.split(":");
  const guildId = parts[1] ?? interaction.guildId ?? "";
  const gameId = parts[2] ?? "";
  if (!guildId || !gameId) return interaction.reply({ content: "Could not process nomination.", flags: MessageFlags.Ephemeral });
  const modal = new ModalBuilder()
    .setCustomId(`goty_nominate_modal:${guildId}:${gameId}`)
    .setTitle("Game of the Year Nomination");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("goty_notes")
        .setLabel("What made this game memorable?")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(true)
        .setPlaceholder("Describe the highlights, key moments, or why this game should win GOTY...")
    )
  );
  await interaction.showModal(modal);
}

async function handleGotyNominateModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  const parts = interaction.customId.split(":");
  const guildId = parts[1] ?? interaction.guildId ?? "";
  const gameId = parts[2] ?? "";
  const notes = interaction.fields.getTextInputValue("goty_notes").trim();
  if (!guildId || !gameId) return interaction.reply({ content: "Could not process nomination.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await recApi.submitGotyNomination({ guildId, nominatorDiscordId: interaction.user.id, nominatedGameId: gameId, nominationNotes: notes });
    await interaction.editReply({ content: "Your Game of the Year nomination has been recorded!" });
  } catch (err) {
    await interaction.editReply({ content: `Failed to record nomination: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function handleCantShutUpTiebreaker(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only commissioners can resolve this tiebreaker.", flags: MessageFlags.Ephemeral });
    return;
  }
  const pollId = interaction.customId.split(":")[2] ?? "";
  const winnerUserId = interaction.values[0];
  if (!pollId || !winnerUserId) return interaction.reply({ content: "Missing tiebreaker data.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await recApi.resolveEosTiebreaker({ pollId, winnerUserId });
    await interaction.message.edit({ components: [] }).catch(() => undefined);
    await interaction.editReply({ content: "Tiebreaker resolved! Winner has been set." });
  } catch (err) {
    await interaction.editReply({ content: `Failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function handleRecAwardCloseVoting(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can close award voting.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId ?? "";
  try {
    const result = await recApi.closeAwardVoting(guildId);
    if (!result.closed) {
      return interaction.editReply({ content: "No awards are currently open for closing." });
    }

    // Auto-approved awards (non-voting: best_h2h_record, challenge_king, badge_collector, best_roster, best_ol)
    // — no human vote so we announce winners immediately
    const autoAnnounceCh = result.announcementsChannelId
      ? await interaction.guild?.channels.fetch(result.announcementsChannelId).catch(() => null) as TextChannel | null
      : interaction.channel as TextChannel | null;
    if (result.autoApproved?.length && autoAnnounceCh && "send" in autoAnnounceCh) {
      for (const award of result.autoApproved) {
        const winner = award.winner;
        const mention = winner.discordId ? `<@${winner.discordId}>` : winner.displayLabel;
        await autoAnnounceCh.send({
          embeds: [new EmbedBuilder()
            .setTitle(`${award.awardName} — Winner`)
            .setDescription([
              `**Winner:** ${mention}${winner.teamName ? ` (${winner.teamName})` : ""}`,
              `**Score:** ${Number(winner.finalScore ?? 0).toFixed(1)}`,
              `**Bonus:** +$${award.payoutAmount ?? 100} REC Cash ${winner.payoutIssued ? "(issued)" : "(pending)"}`
            ].join("\n"))
            .setColor(0x2ecc71)
          ]
        }).catch(() => undefined);
      }
    }

    // Voted awards that still need commissioner approval
    const approvals = await recApi.getPendingAwardApprovals(guildId);
    if (approvals?.awards?.length) {
      const configuredCh = approvals.pendingPayoutsChannelId
        ? await interaction.guild?.channels.fetch(approvals.pendingPayoutsChannelId).catch(() => null) as TextChannel | null
        : null;
      const postCh = (configuredCh?.type === ChannelType.GuildText ? configuredCh : interaction.channel) as TextChannel;
      for (const award of approvals.awards) {
        const topNominee = award.nominees?.[0];
        if (!topNominee) continue;
        const lines = (award.nominees ?? []).slice(0, 5).map((n: any, i: number) =>
          `${i + 1}. ${n.display_label ?? "Unknown"} — Perf: ${Number(n.performance_score ?? 0).toFixed(1)} · Votes: ${n.vote_count ?? 0} · Final: ${Number(n.final_score ?? 0).toFixed(2)}`
        );
        await postCh.send({
          embeds: [new EmbedBuilder()
            .setTitle(`Award Review: ${award.award_name}`)
            .setDescription([`**Category:** ${award.award_category}`, `**Payout:** $${award.payout_amount ?? 100}`, "", "**Top Nominees:**", ...lines].join("\n"))
            .setColor(0xf1c40f)
          ],
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`rec_award_approve:${guildId}:${award.id}`).setLabel(`Approve Winner: ${(topNominee.display_label ?? "Unknown").slice(0, 40)}`).setStyle(ButtonStyle.Success)
          )]
        }).catch(() => undefined);
      }
    }

    const autoCount = result.autoApproved?.length ?? 0;
    const reviewCount = approvals?.awards?.length ?? 0;
    const parts: string[] = [`Closed **${result.closed}** award(s).`];
    if (autoCount) parts.push(`**${autoCount}** auto-awarded${result.announcementsChannelId ? ` and posted to <#${result.announcementsChannelId}>` : ""}.`);
    if (reviewCount) {
      const where = approvals?.pendingPayoutsChannelId ? `<#${approvals.pendingPayoutsChannelId}>` : "this channel";
      parts.push(`**${reviewCount}** voted award(s) need commissioner approval in ${where}.`);
    }
    await interaction.editReply({ content: parts.join(" ") });
  } catch (err) {
    await interaction.editReply({ content: `Failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function handleRecAwardApprove(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can approve award winners.", flags: MessageFlags.Ephemeral });
  }
  const parts = interaction.customId.split(":");
  const guildId = parts[1] ?? interaction.guildId ?? "";
  const awardId = parts[2] ?? "";
  if (!guildId || !awardId) return interaction.reply({ content: "Missing award data.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await recApi.approveAwardWinner({ guildId, awardId, approvedByDiscordId: interaction.user.id });
    const winner = result.winner;
    const mention = winner?.discordId ? `<@${winner.discordId}>` : winner?.teamName ?? "Unknown";
    await interaction.message.edit({ components: [] }).catch(() => undefined);
    const awardCh = interaction.channel;
    if (awardCh && "send" in awardCh) await awardCh.send({
      embeds: [new EmbedBuilder()
        .setTitle(`${result.awardName} — Winner Approved!`)
        .setDescription([
          `**Winner:** ${mention} (${winner?.teamName ?? "?"})`,
          `**Performance Score:** ${Number(winner?.performanceScore ?? 0).toFixed(1)}`,
          `**Vote Count:** ${winner?.voteCount ?? 0}`,
          `**Final Score:** ${Number(winner?.finalScore ?? 0).toFixed(2)}`,
          `**Bonus:** +$${winner?.payoutAmount ?? 100} REC Cash ${winner?.payoutIssued ? "(issued)" : "(pending)"}`
        ].join("\n"))
        .setColor(0x2ecc71)
      ]
    }).catch(() => undefined);
    await interaction.editReply({ content: `Winner approved and payout issued!` });
  } catch (err) {
    await interaction.editReply({ content: `Failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin handler implementations
// ─────────────────────────────────────────────────────────────────────────────

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
  if (action === "approve" && result.streamLog?.discord_channel_id && result.streamLog?.discord_message_id && interaction.inCachedGuild()) {
    const sourceChannel = await interaction.guild.channels.fetch(result.streamLog.discord_channel_id).catch(() => null);
    if (sourceChannel?.isTextBased()) {
      const sourceMessage = await sourceChannel.messages.fetch(result.streamLog.discord_message_id).catch(() => null);
      await sourceMessage?.react("✅").catch(() => undefined);
    }
  }
  if (interaction.message?.editable) {
    await appendReviewActionToMessage(interaction, action === "approve" ? "Applied" : "Denied");
  }
}

async function handleLeagueWeekSetModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can set league week.", flags: MessageFlags.Ephemeral });
    return;
  }
  const seasonStage = interaction.customId.split(":").at(-1) ?? "regular_season";
  const weekNumber = Number(interaction.fields.getTextInputValue(LEAGUE_WEEK_CUSTOM_IDS.weekInput));
  const seasonRaw = interaction.fields.getTextInputValue(LEAGUE_WEEK_CUSTOM_IDS.seasonInput).trim();
  const seasonNumber = seasonRaw ? Number(seasonRaw) : undefined;
  const result = await recApi.setLeagueWeek({ guildId: interaction.guildId, weekNumber, seasonStage, seasonNumber });
  await interaction.reply({
    content: [`League week set to ${seasonStage} week ${weekNumber}.`, result.warning ? `Warning: ${result.warning}` : undefined].filter(Boolean).join("\n"),
    flags: MessageFlags.Ephemeral
  });
}

async function handleLeagueWeekView(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await recApi.viewLeagueWeek(interaction.guildId);
  await interaction.editReply(`League: ${result.league?.name ?? "Unknown"}\nSeason: ${result.league?.season_number ?? "?"}\nWeek: ${result.league?.current_week ?? "?"}\nStage: ${result.league?.season_stage ?? result.league?.current_phase ?? "?"}`);
}

await registerApplicationCommands().catch((error) => {
  console.error("Failed to register Discord application commands before startup", error);
});

await client.login(env.DISCORD_TOKEN);
