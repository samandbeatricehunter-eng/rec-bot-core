import { ButtonInteraction, Client, EmbedBuilder, GatewayIntentBits, Interaction, MessageFlags, ModalSubmitInteraction } from "discord.js";
import { env } from "./config/env.js";
import { registerApplicationCommands, registerGuildCommands } from "./commands.js";
import { isDiscordAdminInteraction } from "./lib/admin.js";
import { recApi } from "./lib/rec-api.js";
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
import { renderScheduleMenu, renderSchedulePlaceholder } from "./flows/schedule.js";
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
import { handleStreamLinkModal, handleStreamMenu, handleStreamServiceSelect } from "./handlers/stream.js";
import {
  BOX_SCORE_CUSTOM_IDS,
  handleBoxScoreApprove,
  handleBoxScoreButton,
  handleBoxScoreCancel,
  handleBoxScoreChannelMessage,
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
  console.log(`REC Bot logged in as ${client.user?.tag ?? "unknown"} — build ${deployedCommit.slice(0, 12)}`);
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
      if (interaction.customId === "rec:league_setup:skip_team_linking") {
        // League is already saved by this point; this button just closes the linking step.
        return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
      }
      if (interaction.customId === NAV_CUSTOM_IDS.mainMenu) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.adminPanel) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.back) return handleBackNavigation(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtTeams) return handleLeagueMgmtTeams(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtServerSetup) return handleLeagueMgmtServerSetup(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtSchedule) return handleLeagueMgmtSchedule(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.leagueMgmtAdvance) return handleLeagueMgmtAdvance(interaction);
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
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleSelectTeam) return renderSchedulePlaceholder(interaction, "Select Team", "Team schedule selection is coming soon. This will let you view any team's schedule.");
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleSos) return renderSchedulePlaceholder(interaction, "SOS", "Strength of schedule is coming soon.");
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleHistory) return renderSchedulePlaceholder(interaction, "History", "Schedule history is coming soon.");
      if (interaction.customId === MENU_CUSTOM_IDS.scheduleBack) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.placeWager) return handlePlaceWager(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.manageWallet) return handleManageWallet(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.makePurchase) return replyMenuPlaceholder(interaction, "Purchase", "The purchase store is coming soon. It will only show purchase types enabled for this league.");
      if (interaction.customId === MENU_CUSTOM_IDS.viewUserProfiles) return renderUserSnapshotPicker(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.stream) return handleStreamMenu(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.streamBack) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.uploadBoxScore) return handleBoxScoreButton(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.uploadScoringSummary) return replyMenuPlaceholder(interaction, "Scoring Summary", "Scoring summary uploads are coming soon.");
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.cancel) return handleBoxScoreCancel(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.inboxOpen) return handleBoxScoreInbox(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.inboxBack) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === BOX_SCORE_CUSTOM_IDS.submitConfirm) return handleBoxScoreSubmitConfirm(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.approvePrefix)) return handleBoxScoreApprove(interaction);
      if (interaction.customId.startsWith(BOX_SCORE_CUSTOM_IDS.denyModalPrefix)) return handleBoxScoreDenyModal(interaction);
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
    }
  } catch (error) {
    await safeInteractionError(interaction, error);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  await handleBoxScoreChannelMessage(message).catch(() => undefined);
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
      .setDescription("Schedule management is temporarily unavailable while the import tooling is being rebuilt.")],
    components: buildAdminPanelRows()
  });
}

async function handleLeagueMgmtAdvance(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can advance the league.", flags: MessageFlags.Ephemeral });
  }
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Advance")
      .setDescription("The Advance Wizard is temporarily unavailable while it is being rebuilt.")],
    components: buildAdminPanelRows()
  });
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
  return replyMenuPlaceholder(interaction, "Roles", "Role management is coming soon. This will let admins change users between the designated REC league roles.");
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

await registerApplicationCommands().catch((error) => {
  console.error("Failed to register Discord application commands before startup", error);
});

await client.login(env.DISCORD_TOKEN);
