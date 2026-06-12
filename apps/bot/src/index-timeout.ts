import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType, Client, EmbedBuilder, GatewayIntentBits, Interaction, Message, MessageFlags, ModalBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, TextChannel, TextInputBuilder, TextInputStyle } from "discord.js";
import { env } from "./config/env.js";
import { isDiscordAdminInteraction } from "./lib/admin.js";
import { recApi } from "./lib/rec-api.js";
import { ExpiringSessionStore } from "./lib/session-timeout.js";
import {
  buildAdminPanelEmbed,
  buildAdminPanelRows,
  buildMainMenuEmbed,
  buildMainMenuRows,
  buildRostersMenuEmbed,
  buildRostersMenuRows,
  buildSnapshotUserSelectRows,
  buildRecBankRows,
  buildToSavingsModal,
  buildFromSavingsModal,
  buildSetupDangerModal,
  MENU_CUSTOM_IDS,
  ROSTERS_CUSTOM_IDS,
  REC_BANK_CUSTOM_IDS,
  type SetupDangerAction
} from "./ui/menu.js";
import { SERVER_SETUP_CUSTOM_IDS, buildServerSetupPanel, buildChannelIdModal } from "./ui/server-setup-admin.js";
import { NAV_CUSTOM_IDS } from "./ui/navigation.js";
import {
  applyLeagueSetupDependencies,
  buildActivityRequirementsModal,
  buildLeagueSetupWindow,
  buildSettingsPickerWindow,
  createDefaultLeagueSetupDraft,
  getNextLeagueSetupStep,
  getPreviousLeagueSetupStep,
  LEAGUE_SETUP_CUSTOM_IDS,
  type LeagueSetupDraft
} from "./ui/league-setup.js";
import { handleImportButton, handleImportModal, handleImportSelect, importSessions, renderImportPanel } from "./flows/imports.js";
import { IMPORT_CUSTOM_IDS } from "./ui/imports.js";
import { buildAdvanceMenuPanel, buildTroubleshootMenuPanel, ADVANCE_MENU_CUSTOM_IDS } from "./ui/advance-menu.js";
import { ADVANCE_SCHEDULE_CUSTOM_IDS, ADVANCE_WIZARD_BACK_CUSTOM_ID, buildAdvanceSchedulePayload, wallClockToUtc, DEFAULT_SCHEDULE_TIMEZONE, type AdvanceScheduleState } from "./ui/advance-schedule.js";
import { advanceWizardSessions, ADVANCE_WIZARD_GOTW_CUSTOM_ID, handleWizardGotwSelect, runAdvanceWizardProcessing } from "./flows/advance-wizard.js";
import { recreateGameChannelsForGuild, sendAdvanceDmsForGuild, recordGameChannelMessage, recordHighlightMessage } from "./flows/game-channels.js";
import { handleGotwSelect, handleGotwVote, renderGotwSelection } from "./flows/gotw.js";
import { buildGotwSelectionPayload, GOTW_CUSTOM_IDS } from "./ui/gotw.js";
import { RULES_CUSTOM_IDS, buildRulesPanel } from "./ui/rules.js";
import { LEAGUE_WEEK_CUSTOM_IDS, buildLeagueWeekSetModal, buildLeagueWeekStageRow } from "./ui/league-week.js";
import { ECONOMY_ADMIN_CUSTOM_IDS, buildClearEosModal, buildEconomyAdminPanel } from "./ui/economy-admin.js";
import { ACTIVE_CHECK_CUSTOM_IDS, buildActiveCheckAnnouncement } from "./ui/active-check.js";
import { WEEKLY_CHALLENGE_CUSTOM_IDS } from "./ui/weekly-challenges.js";
import { handleSimpleTeamLinkSelect, handleSimpleTeamLinkUserSelect, handleSimpleTeamLinkRoleSelect, handleClearAllTeamLinks } from "./flows/team-linking.js";
import { TEAM_LINK_CUSTOM_IDS } from "./ui/team-options.js";
import { postEosPollsAndAwards } from "./flows/advance-wizard.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
client.setMaxListeners(50);
const menuSessions = new ExpiringSessionStore<true>();
const leagueSetupSessions = new ExpiringSessionStore<LeagueSetupDraft>();
const serverSetupChannelSessions = new Map<string, string>();
const advanceScheduleSessions = new Map<string, AdvanceScheduleState>();

// Tracks active User Snapshot viewer sessions. Page index and which Discord ID is being viewed.
// Key: viewer's Discord user ID (not the target subject's ID).
type SnapshotSession = { targetDiscordId: string; targetDisplayName: string; currentPage: number };
const snapshotSessions = new Map<string, SnapshotSession>();
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
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => undefined);
    else await interaction.update(payload).catch(async () => interaction.reply({ content: EXPIRED_WINDOW_MESSAGE, flags: MessageFlags.Ephemeral }).catch(() => undefined));
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
  console.log(`REC Bot logged in as ${client.user?.tag ?? "unknown"}`);
  try {
    const health = await recApi.health();
    console.log(`Connected to ${health.service}`);
  } catch (error) {
    console.error("REC Core API health check failed", error);
  }
  startActiveCheckCloseoutLoop(client);
});

client.on("error", (error) => {
  console.error("Discord client error", error);
});

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
    }
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("rec_award_vote:")) return handleRecAwardVote(interaction);
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

    if (interaction.isChannelSelectMenu()) {
      if (interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.setPendingChannel || interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.setGameCategory) {
        return handleEconomyChannelSelect(interaction);
      }
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
      if (interaction.customId === ROSTERS_CUSTOM_IDS.select) return handleRostersMenuSelect(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotUserSelect) return handleSnapshotUserSelect(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.conferenceSelect) return handleRosterConferenceSelect(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.teamSelect) return handleRosterTeamSelect(interaction);
      if (interaction.customId === REC_BANK_CUSTOM_IDS.select) return handleRecBankSelect(interaction);
      if (Object.values(LEAGUE_SETUP_CUSTOM_IDS).includes(interaction.customId as any) || interaction.customId.startsWith(LEAGUE_SETUP_CUSTOM_IDS.seasonWeek)) return handleLeagueSetupSelect(interaction);
      if (Object.values(IMPORT_CUSTOM_IDS).includes(interaction.customId as any)) return handleImportSelect(interaction);
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
      if (interaction.customId === MENU_CUSTOM_IDS.adminLeagueSetup) return interaction.showModal(buildSetupDangerModal("league_setup"));
      if (interaction.customId === MENU_CUSTOM_IDS.adminUserTeamLinking) return interaction.update({ embeds: [new EmbedBuilder().setTitle("User / Team Linking").setDescription("This panel is available. The full link workflow is the next build target.")], components: [] });
      if (interaction.customId === MENU_CUSTOM_IDS.adminImports || interaction.customId === MENU_CUSTOM_IDS.adminImportEnterData) return renderImportPanel(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.adminEconomyReviews) return interaction.update(buildEconomyAdminPanel());
      if (interaction.customId === MENU_CUSTOM_IDS.adminRules) return interaction.update(buildRulesPanel());
      if (interaction.customId === MENU_CUSTOM_IDS.adminActiveCheck) return handleStartActiveCheck(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.adminReselectGotw) return renderGotwSelection(interaction);
      if (interaction.customId === ACTIVE_CHECK_CUSTOM_IDS.start) return handleStartActiveCheck(interaction);
      if (interaction.customId === WEEKLY_CHALLENGE_CUSTOM_IDS.selectGotw) return renderGotwSelection(interaction);
      if (interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.clearEos) return interaction.showModal(buildClearEosModal());
      if (interaction.customId === LEAGUE_WEEK_CUSTOM_IDS.view) return handleLeagueWeekView(interaction);
      if (interaction.customId === LEAGUE_WEEK_CUSTOM_IDS.set) return interaction.reply({ content: "Choose the stage first.", components: [buildLeagueWeekStageRow()], ephemeral: true });
      if (interaction.customId.startsWith(IMPORT_CUSTOM_IDS.approveJob)) return handleImportButton(interaction);
      if (Object.values(IMPORT_CUSTOM_IDS).includes(interaction.customId as any)) return handleImportButton(interaction);
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
      if (interaction.customId === ADVANCE_WIZARD_BACK_CUSTOM_ID) return interaction.update(buildAdvanceMenuPanel());
      if (interaction.customId === ADVANCE_SCHEDULE_CUSTOM_IDS.confirm) return handleAdvanceScheduleConfirm(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.mainMenu) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.adminPanel) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.back) return handleBackNavigation(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotPrev) return handleSnapshotPageNav(interaction, -1);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotNext) return handleSnapshotPageNav(interaction, +1);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.snapshotBack) return renderRostersMenu(interaction);
      if (interaction.customId === ROSTERS_CUSTOM_IDS.rosterBackToConf) return handleRosterBackToConf(interaction);
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === SERVER_SETUP_CUSTOM_IDS.channelIdModal) return handleServerSetupChannelIdModal(interaction);
      if (Object.values(IMPORT_CUSTOM_IDS).includes(interaction.customId as any)) return handleImportModal(interaction);
      if (interaction.customId.startsWith(`${MENU_CUSTOM_IDS.setupModal}:`)) return handleSetupModal(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.activityRequirementsModal) return handleActivityRequirementsModal(interaction);
      if (interaction.customId === REC_BANK_CUSTOM_IDS.toSavingsModal) return handleSavingsTransferModal(interaction, "to_savings");
      if (interaction.customId === REC_BANK_CUSTOM_IDS.fromSavingsModal) return handleSavingsTransferModal(interaction, "from_savings");
      if (interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.clearEosModal) return handleClearEosModal(interaction);
      if (interaction.customId.startsWith(`${LEAGUE_WEEK_CUSTOM_IDS.setModal}:`)) return handleLeagueWeekSetModal(interaction);
    }
  } catch (error) {
    await safeInteractionError(interaction, error);
  }
});

async function buildMainMenuPayload(userId: string, guildId: string | null, isAdmin: boolean) {
  let menuEmbed = buildMainMenuEmbed({ discordUsername: "Loading REC profile...", isAdmin });

  if (!guildId) {
    return {
      embeds: [buildMainMenuEmbed({ discordUsername: "Open /menu inside a REC Discord server", isAdmin })],
      components: buildMainMenuRows(isAdmin)
    };
  }

  try {
    const profile = await recApi.getMenuProfile(userId, guildId);
    const display = profile?.display ?? {};
    const hasResolvedProfile = Boolean(profile?.user || profile?.discord || profile?.league || profile?.team || display.discordUsername);

    menuEmbed = buildMainMenuEmbed({
      ...display,
      discordUsername: display.discordUsername ?? profile?.discord?.global_name ?? profile?.discord?.username ?? "Linked REC User",
      teamName: display.teamName ?? profile?.team?.name ?? null,
      highestRole: display.highestRole ?? profile?.role ?? null,
      wallet: display.wallet ?? profile?.wallet?.wallet_balance ?? 0,
      savings: display.savings ?? profile?.wallet?.savings_balance ?? 0,
      leagueName: display.leagueName ?? profile?.league?.name ?? "Current League",
      seasonNumber: display.seasonNumber ?? profile?.league?.season_number ?? profile?.league?.display_season_number ?? null,
      currentWeek: display.currentWeek ?? profile?.league?.current_week ?? null,
      seasonStage: display.seasonStage ?? profile?.league?.season_stage ?? profile?.league?.current_phase ?? "regular_season",
      isAdmin
    });

    if (!hasResolvedProfile) {
      console.warn("REC menu profile returned no resolved data", { userId, guildId, profile });
    }
  } catch (error) {
    console.warn("Failed to load REC menu profile", { userId, guildId, error });
    menuEmbed = buildMainMenuEmbed({
      discordUsername: "REC profile failed to load",
      teamName: "Check API logs",
      leagueName: "Profile endpoint error",
      currentMatchupText: "Run /v1/users/:discordId/menu-profile with this guildId",
      isAdmin
    });
  }

  return {
    embeds: [menuEmbed],
    components: buildMainMenuRows(isAdmin)
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


function formatRecDateTime(value?: string | null) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }) + " CST";
}

function formatTransactionLine(transaction: any) {
  const amount = Number(transaction?.amount ?? 0);
  const sign = amount > 0 ? "+" : "";
  const type = String(transaction?.transaction_type ?? "transaction").replaceAll("_", " ");
  const reason = transaction?.description ?? transaction?.source ?? "No reason provided";
  return `**${sign}$${amount}** — ${type}\n${formatRecDateTime(transaction?.created_at)} • ${reason}`;
}

// Builds the REC Bank embed and returns the payload (used when opening or refreshing the bank view).
async function buildRecBankPayload(discordUserId: string, guildId: string | undefined, isAdmin: boolean) {
  const walletPayload = await recApi.getWallet(discordUserId, guildId);
  const wallet = walletPayload?.wallet ?? { wallet_balance: 0, savings_balance: 0 };
  const transactions = Array.isArray(walletPayload?.transactions) ? walletPayload.transactions : [];
  // API already limits to 10 when guildId is provided; show label accordingly
  const countLabel = guildId ? "Last 10 Transactions (This League)" : "Last 25 Transactions (All Leagues)";
  const transactionText = transactions.length
    ? transactions.map(formatTransactionLine).join("\n\n")
    : "No wallet transactions found.";

  const embed = new EmbedBuilder()
    .setTitle("REC Bank")
    .setDescription([
      `Wallet Balance: **$${wallet.wallet_balance ?? 0}**`,
      `Savings Balance: **$${wallet.savings_balance ?? 0}**`,
      "",
      `**${countLabel}**`,
      transactionText
    ].join("\n").slice(0, 4096));

  return { embeds: [embed], components: buildRecBankRows() };
}

async function renderRecBankFromSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading REC Bank...").setDescription("Fetching your wallet balance and recent transactions.")], components: [] });
  const guildId = interaction.guild?.id ?? undefined;
  await interaction.editReply(await buildRecBankPayload(interaction.user.id, guildId, isDiscordAdminInteraction(interaction)));
}

// Handles the REC Bank action dropdown (transfer, wager, back).
async function handleRecBankSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];

  if (selected === "bank_back") {
    return interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isDiscordAdminInteraction(interaction)));
  }
  if (selected === "to_savings") return interaction.showModal(buildToSavingsModal());
  if (selected === "from_savings") return interaction.showModal(buildFromSavingsModal());
  if (selected === "place_wager") {
    // Wager workflow placeholder — will be built in a future session.
    await interaction.deferUpdate();
    const guildId = interaction.guild?.id ?? undefined;
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Place a Wager").setDescription("The wager workflow is coming soon. You'll be able to wager coins on upcoming matchups from this menu.")],
      components: buildRecBankRows()
    });
  }
}

// Processes the savings transfer modal submission.
async function handleSavingsTransferModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>, direction: "to_savings" | "from_savings") {
  if (!interaction.isModalSubmit()) return;
  await interaction.deferUpdate();
  const inputId = direction === "to_savings" ? REC_BANK_CUSTOM_IDS.toSavingsAmountInput : REC_BANK_CUSTOM_IDS.fromSavingsAmountInput;
  const raw = interaction.fields.getTextInputValue(inputId);
  const amount = parseFloat(raw.replace(/[^0-9.]/g, ""));
  const guildId = interaction.guild?.id ?? undefined;

  if (!Number.isFinite(amount) || amount <= 0) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Invalid Amount").setDescription("Please enter a valid positive number (e.g. 50).")],
      components: buildRecBankRows()
    });
  }

  try {
    const result = await recApi.transferSavings(interaction.user.id, amount, direction);
    const dirLabel = direction === "to_savings" ? "moved to savings" : "withdrawn from savings";
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Transfer Complete").setDescription([
        `**$${amount}** ${dirLabel}.`,
        "",
        `Wallet Balance: **$${result.wallet_balance ?? 0}**`,
        `Savings Balance: **$${result.savings_balance ?? 0}**`
      ].join("\n"))],
      components: buildRecBankRows()
    });
  } catch (err: any) {
    const msg = err?.message ?? "Transfer failed. Please try again.";
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Transfer Failed").setDescription(msg)],
      components: buildRecBankRows()
    });
  }
}

async function handleMainMenuSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];
  if (selected === "admin_panel") {
    if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can open the Admin Panel.", flags: MessageFlags.Ephemeral });
    return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
  }
  if (selected === "rec_bank") return renderRecBankFromSelect(interaction);
  if (selected === "rosters") return interaction.update({ embeds: [buildRostersMenuEmbed()], components: buildRostersMenuRows() });
  const labels: Record<string, string> = { manage_team: "Manage My Team", standings_stats: "Standings & Stats", media_center: "Media Center", help_rules: "Help / Rules" };
  await interaction.update({ embeds: [new EmbedBuilder().setTitle(labels[selected] ?? "REC League HQ").setDescription("This department shell is connected. The detailed workflow will be built next.").setFooter({ text: "REC Core connected" })], components: buildMainMenuRows(isDiscordAdminInteraction(interaction)) });
}

// Render the Rosters submenu (used from both the main select and the snapshot Back button).
async function renderRostersMenu(interaction: Extract<Interaction, { isButton(): boolean } | { isStringSelectMenu(): boolean }>) {
  if (interaction.isButton()) return interaction.update({ embeds: [buildRostersMenuEmbed()], components: buildRostersMenuRows() });
  if (interaction.isStringSelectMenu()) return interaction.update({ embeds: [buildRostersMenuEmbed()], components: buildRostersMenuRows() });
}

// Handles the Rosters submenu dropdown selection.
async function handleRostersMenuSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];

  if (selected === "rosters_back") {
    return interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isDiscordAdminInteraction(interaction)));
  }

  if (selected === "rosters_by_team") {
    return renderRosterConferenceSelect(interaction);
  }

  if (selected === "players_by_position") {
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle("View Players by Position").setDescription("This view is coming soon. Check back after the next build update.")],
      components: buildRostersMenuRows()
    });
  }

  if (selected === "user_snapshots") {
    // Load the coach list so the user can pick whose snapshot to view.
    await interaction.deferUpdate();
    if (!interaction.guildId) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("User Snapshots").setDescription("This must be run inside a league server.")], components: buildRostersMenuRows() });
    const coachData = await recApi.getCoaches(interaction.guildId).catch(() => null);
    const coaches = coachData?.coaches ?? [];
    if (!coaches.length) {
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("User Snapshots").setDescription("No linked coaches found in this league. Team assignments must be configured first.")], components: buildRostersMenuRows() });
    }
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("User Snapshots").setDescription("Select a coach from the dropdown below to view their full profile snapshot.")],
      components: buildSnapshotUserSelectRows(coaches)
    });
  }
}

// ── View Rosters by Team flow ─────────────────────────────────────────────────

function buildRosterConferenceSelectRows(conferences: Array<{ conference: string; teams: any[] }>) {
  const options = conferences.slice(0, 25).map((c) =>
    new StringSelectMenuOptionBuilder().setLabel(c.conference).setValue(c.conference)
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(ROSTERS_CUSTOM_IDS.conferenceSelect)
    .setPlaceholder("Select a conference")
    .addOptions(options);
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.snapshotBack).setLabel("Back to Rosters").setStyle(ButtonStyle.Secondary)
  );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), backRow];
}

function buildRosterTeamSelectRows(conferenceName: string, teams: Array<{ id: string; name: string; abbreviation?: string }>) {
  const options = teams.slice(0, 25).map((t) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(t.name.slice(0, 100))
      .setValue(t.id)
      .setDescription((t.abbreviation ?? "").slice(0, 100))
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(ROSTERS_CUSTOM_IDS.teamSelect)
    .setPlaceholder("Select a team")
    .addOptions(options);
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.rosterBackToConf).setLabel("Back to Conferences").setStyle(ButtonStyle.Secondary)
  );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), backRow];
}

function buildRosterEmbed(rosterData: any): EmbedBuilder {
  const team = rosterData.team ?? {};
  const groups: Array<{ label: string; posOrder: boolean; members: Array<{ name: string; ovr: number; dev: string; years: number; posLabel?: string }> }> = rosterData.groups ?? [];
  const embed = new EmbedBuilder()
    .setTitle(`${team.name ?? "Team"} — Roster`)
    .setDescription(`${team.conference ?? ""}${team.division ? ` · ${team.division}` : ""}`);

  for (const group of groups) {
    if (!group.members.length) continue;
    const lines = group.members.map((m) => {
      const pos = group.posOrder && m.posLabel ? `${m.posLabel} ` : "";
      return `${pos}**${m.name}**  OVR ${m.ovr}  ${m.dev}  ${m.years}y`;
    });
    embed.addFields({ name: group.label, value: lines.join("\n").slice(0, 1024), inline: false });
  }

  return embed;
}

async function renderRosterConferenceSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  await interaction.deferUpdate();
  if (!interaction.guildId) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("View Rosters by Team").setDescription("Must be run inside a league server.")], components: buildRostersMenuRows() });
  }
  let confData: any;
  try {
    confData = await recApi.getLeagueConferences(interaction.guildId);
  } catch {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("View Rosters by Team").setDescription("Failed to load conferences. Please try again.")], components: buildRostersMenuRows() });
  }
  const conferences: Array<{ conference: string; teams: any[] }> = confData?.conferences ?? [];
  if (!conferences.length) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("View Rosters by Team").setDescription("No conferences found. Import data must be available first.")], components: buildRostersMenuRows() });
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("View Rosters by Team").setDescription("Select a conference to browse teams.")],
    components: buildRosterConferenceSelectRows(conferences)
  });
}

async function handleRosterConferenceSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  await interaction.deferUpdate();
  const conferenceName = interaction.values[0];
  if (!interaction.guildId) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Rosters").setDescription("Must be run inside a league server.")], components: [] });
  let confData: any;
  try {
    confData = await recApi.getLeagueConferences(interaction.guildId);
  } catch {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Rosters").setDescription("Failed to load conference data.")], components: buildRostersMenuRows() });
  }
  const conferences: Array<{ conference: string; teams: any[] }> = confData?.conferences ?? [];
  const conf = conferences.find((c) => c.conference === conferenceName);
  if (!conf || !conf.teams.length) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`${conferenceName}`).setDescription("No teams found in this conference.")], components: buildRosterConferenceSelectRows(conferences) });
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(`${conferenceName}`).setDescription("Select a team to view their roster.")],
    components: buildRosterTeamSelectRows(conferenceName, conf.teams)
  });
}

async function handleRosterTeamSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  await interaction.deferUpdate();
  const teamId = interaction.values[0];
  if (!interaction.guildId) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Rosters").setDescription("Must be run inside a league server.")], components: [] });
  let rosterData: any;
  try {
    rosterData = await recApi.getTeamRoster(interaction.guildId, teamId);
  } catch {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Roster").setDescription("Failed to load roster. Please try again.")], components: [] });
  }
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.rosterBackToConf).setLabel("Back to Conferences").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.mainMenu).setLabel("Main Menu").setStyle(ButtonStyle.Secondary)
  );
  return interaction.editReply({ embeds: [buildRosterEmbed(rosterData)], components: [backRow] });
}

async function handleRosterBackToConf(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  await interaction.deferUpdate();
  if (!interaction.guildId) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Rosters").setDescription("Must be run inside a league server.")], components: [] });
  let confData: any;
  try {
    confData = await recApi.getLeagueConferences(interaction.guildId);
  } catch {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("View Rosters by Team").setDescription("Failed to load conferences.")], components: buildRostersMenuRows() });
  }
  const conferences: Array<{ conference: string; teams: any[] }> = confData?.conferences ?? [];
  if (!conferences.length) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("View Rosters by Team").setDescription("No conferences found.")], components: buildRostersMenuRows() });
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("View Rosters by Team").setDescription("Select a conference to browse teams.")],
    components: buildRosterConferenceSelectRows(conferences)
  });
}

// ── User Snapshots paginated viewer ──────────────────────────────────────────

// PAGE STRUCTURE:
//   0 → Season/Global records + power ranking + GOTW records
//   1 → Badges (up to 15 per page; repeats for additional badge pages)
//   last-2 → GOTW competition history
//   last-1 → Awards won in this guild
//
// The viewer renders one embed per page and provides prev/next/back navigation buttons.

function buildSnapshotNavRows(currentPage: number, totalPages: number) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.snapshotBack).setLabel("Back to Rosters").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.snapshotPrev).setLabel("◀ Prev").setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.snapshotNext).setLabel("Next ▶").setStyle(ButtonStyle.Primary).setDisabled(currentPage >= totalPages - 1)
  );
  return [row];
}

function buildSnapshotPages(snapshot: any, currentPage: number): { embed: EmbedBuilder; totalPages: number } {
  const pages: EmbedBuilder[] = [];

  // Page 0: Records + Power Ranking + GOTW
  {
    const sr = snapshot.seasonRecord ?? {};
    const gr = snapshot.globalRecord ?? {};
    const pr = snapshot.powerRank;
    const gg = snapshot.gotwGuessing;
    const gc = snapshot.gotwCompetition;
    const embed = new EmbedBuilder()
      .setTitle(`${snapshot.discord?.global_name ?? snapshot.user?.display_name ?? "Coach"} — Snapshot`)
      .setDescription([
        `Team: **${snapshot.teamName ?? "Unassigned"}**`,
        `League: ${snapshot.leagueName ?? "Unknown"} • Season ${snapshot.seasonNumber ?? "?"}, Week ${snapshot.currentWeek ?? "?"}`,
        "",
        "**Season Record (This Guild)**",
        `W-L-T: **${sr.text ?? "0-0-0"}** | PD: **${sr.pointDifferential ?? 0}**`,
        `Points For: ${sr.pointsFor ?? 0} | Points Against: ${sr.pointsAgainst ?? 0}`,
        "",
        "**Global Record (All Leagues)**",
        `W-L-T: **${gr.text ?? "0-0-0"}** | PD: **${gr.pointDifferential ?? 0}**`,
        `Playoffs: ${gr.playoffText ?? "0-0"} | Super Bowls: ${gr.superbowlText ?? "0-0"}`,
        "",
        "**Power Ranking**",
        pr ? `Rank: **#${pr.rank}** | Score: ${(pr.score ?? 0).toFixed(2)} | SOS: ${(pr.sosScore ?? 0).toFixed(2)}` : "Not yet ranked this season",
        "",
        "**GOTW Voting Record (Global)**",
        gg ? `${gg.correct}/${gg.total} correct (${gg.accuracy}%)` : "No votes recorded yet",
        "",
        "**GOTW Competitor Record (This Guild)**",
        gc ? `${gc.wins}W-${gc.losses}L as a GOTW participant` : "No GOTW games played yet"
      ].join("\n").slice(0, 4096));
    pages.push(embed);
  }

  // Badge pages (up to 15 badges per page)
  const badges: any[] = snapshot.badges ?? [];
  if (badges.length === 0) {
    pages.push(new EmbedBuilder().setTitle("Badges").setDescription("No badges earned yet."));
  } else {
    const BADGES_PER_PAGE = 15;
    for (let i = 0; i < badges.length; i += BADGES_PER_PAGE) {
      const slice = badges.slice(i, i + BADGES_PER_PAGE);
      const lines = slice.map((b: any) => {
        const name = b.badge_label ?? b.badge_name ?? "Badge";
        const tier = b.tier ? ` (${b.tier})` : "";
        const earned = b.earned_at ? ` — ${new Date(b.earned_at).toLocaleDateString("en-US")}` : "";
        return `• ${name}${tier}${earned}`;
      });
      pages.push(new EmbedBuilder().setTitle(`Badges (${i + 1}–${Math.min(i + BADGES_PER_PAGE, badges.length)} of ${badges.length})`).setDescription(lines.join("\n")));
    }
  }

  // Awards page
  const awards: any[] = snapshot.awardsWon ?? [];
  if (awards.length === 0) {
    pages.push(new EmbedBuilder().setTitle("Awards Won (This Guild)").setDescription("No awards won in this league yet."));
  } else {
    const lines = awards.map((a: any) => `• **${a.award_name}** — Season ${a.season_number}`);
    pages.push(new EmbedBuilder().setTitle(`Awards Won (This Guild) — ${awards.length} total`).setDescription(lines.join("\n")));
  }

  const safeIndex = Math.max(0, Math.min(currentPage, pages.length - 1));
  const embed = pages[safeIndex];
  // Attach page indicator to footer
  embed.setFooter({ text: `Page ${safeIndex + 1} of ${pages.length}` });
  return { embed, totalPages: pages.length };
}

// Called when the user selects a coach from the snapshot user-selector dropdown.
async function handleSnapshotUserSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  await interaction.deferUpdate();
  if (!interaction.guildId) return;
  const targetDiscordId = interaction.values[0];

  // Fetch snapshot data for the selected user
  const snapshot = await recApi.getUserSnapshot(targetDiscordId, interaction.guildId).catch(() => null);
  if (!snapshot) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Snapshot Unavailable").setDescription("Could not load this coach's snapshot. They may not be fully linked.")], components: buildRostersMenuRows() });
  }

  const displayName = snapshot.discord?.global_name ?? snapshot.user?.display_name ?? "Coach";
  snapshotSessions.set(interaction.user.id, { targetDiscordId, targetDisplayName: displayName, currentPage: 0 });

  const { embed, totalPages } = buildSnapshotPages(snapshot, 0);
  return interaction.editReply({ embeds: [embed], components: buildSnapshotNavRows(0, totalPages) });
}

// Called when the user clicks the prev/next page nav buttons in a snapshot viewer.
async function handleSnapshotPageNav(interaction: Extract<Interaction, { isButton(): boolean }>, delta: -1 | 1) {
  if (!interaction.isButton()) return;
  await interaction.deferUpdate();
  if (!interaction.guildId) return;

  const session = snapshotSessions.get(interaction.user.id);
  if (!session) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Session Expired").setDescription("Your snapshot session expired. Please reopen Rosters > User Snapshots.")], components: buildRostersMenuRows() });
  }

  const snapshot = await recApi.getUserSnapshot(session.targetDiscordId, interaction.guildId).catch(() => null);
  if (!snapshot) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Snapshot Unavailable").setDescription("Could not reload this snapshot.")], components: buildRostersMenuRows() });
  }

  const newPage = session.currentPage + delta;
  const { embed, totalPages } = buildSnapshotPages(snapshot, newPage);
  const safePage = Math.max(0, Math.min(newPage, totalPages - 1));
  snapshotSessions.set(interaction.user.id, { ...session, currentPage: safePage });

  return interaction.editReply({ embeds: [embed], components: buildSnapshotNavRows(safePage, totalPages) });
}

async function handleAdminPanelSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can use Admin Panel workflows.", flags: MessageFlags.Ephemeral });
  }

  const selected = interaction.values[0];

  if (selected === "main_menu") return renderMainMenuFromSelect(interaction);
  if (selected === "import_enter_data") return renderImportPanel(interaction);
  if (selected === "advance_menu") return interaction.update(buildAdvanceMenuPanel());
  if (selected === "server_setup") return interaction.update(buildServerSetupPanel());
  if (selected === "league_setup") return interaction.showModal(buildSetupDangerModal("league_setup"));
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
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Edit League Settings").setDescription("No league configuration found. Run League Setup first.")], components: buildAdminPanelRows() });
    }
  }
  if (selected === "user_team_linking") {
    const { buildSimpleTeamLinkPanel } = await import("./ui/team-options.js");
    return interaction.update(buildSimpleTeamLinkPanel());
  }
  if (selected === "active_check") return handleStartActiveCheck(interaction);
  if (selected === "rules") return interaction.update(buildRulesPanel());
  if (selected === "economy_reviews") return interaction.update(buildEconomyAdminPanel());

  return interaction.update({
    embeds: [new EmbedBuilder().setTitle("REC Admin Panel").setDescription("This admin workflow shell is connected. The detailed workflow will continue in the next build pass.")],
    components: buildAdminPanelRows()
  });
}

async function handleAdvanceMenuSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "The Advance Menu can only be used inside a Discord server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can use the Advance Menu.", flags: MessageFlags.Ephemeral });
    return;
  }

  const selected = interaction.values[0];
  if (selected === "back_admin") return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });

  await interaction.deferUpdate();

  if (selected === "advance_week") {
    const scheduleState: AdvanceScheduleState = { timezone: DEFAULT_SCHEDULE_TIMEZONE, wizardMode: true };
    advanceScheduleSessions.set(interaction.user.id, scheduleState);
    await interaction.editReply(buildAdvanceSchedulePayload(scheduleState));
    return;
  }

  if (selected === "troubleshoot_advance") {
    await interaction.editReply(buildTroubleshootMenuPanel());
    return;
  }

  if (selected === "run_eos_polls_and_awards") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Running EOS Polls & Awards...").setDescription("Generating nominees and posting community polls + REC Awards voting embeds.")], components: [] });
    try {
      const result = await recApi.runEosPollsAndAwards(interaction.guildId);
      if (!result.allowed) {
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Not Available").setDescription(result.reason ?? "This action is only available during Wild Card through Super Bowl weeks.")], components: buildAdvanceMenuPanel().components });
        return;
      }
      const guild = interaction.guild!;
      const warnings = await postEosPollsAndAwards(guild, result.pollsData);
      const pollCount = result.pollsData?.polls?.length ?? 0;
      const awardCount = result.pollsData?.recAwardsData?.awards?.filter((a: any) => a.status === "voting" && a.nomineeCount > 0).length ?? 0;
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Polls & Awards Posted").setDescription([
          `Community polls posted: **${pollCount}**`,
          `REC Award voting embeds posted: **${awardCount}**`,
          warnings.length ? `\nWarnings: ${warnings.join(", ")}` : ""
        ].filter(Boolean).join("\n"))],
        components: buildAdvanceMenuPanel().components
      });
    } catch (error) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("EOS Polls Failed").setDescription(error instanceof Error ? error.message : String(error))], components: buildAdvanceMenuPanel().components });
    }
    return;
  }

  if (selected === "issue_eos_payouts") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Issuing EOS Payouts...").setDescription("Computing stat thresholds and rank bonuses. Already approved payouts are preserved.")], components: [] });
    try {
      const result = await recApi.issueEosPayouts(interaction.guildId);
      const guild = interaction.guild;

      if (!guild) {
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("EOS Payouts Issued").setDescription(`Created ${result.items?.length ?? 0} payout items. Guild context unavailable for DMs.`)], components: buildAdvanceMenuPanel().components });
        return;
      }

      // Batch-fetch all payout recipients at once
      const payoutDiscordIds = (result.items ?? []).map((i: any) => i.discordId).filter(Boolean) as string[];
      const payoutMembers = payoutDiscordIds.length > 0
        ? await guild.members.fetch({ user: payoutDiscordIds }).catch(() => new Map()) as Map<string, any>
        : new Map<string, any>();

      let dmsSent = 0;

      for (const item of result.items ?? []) {
        if (!item.discordId) continue;
        try {
          const member = payoutMembers.get(item.discordId) ?? null;
          if (!member) continue;

          // Build breakdown lines for DM
          const breakdownLines: string[] = [];
          if (item.rankAmount > 0) {
            breakdownLines.push(`**${item.rankLabel ?? `Rank ${item.rank}`}:** $${item.rankAmount}`);
          }
          const statCategories: any[] = item.statCategories ?? [];
          if (statCategories.length > 0) {
            breakdownLines.push("", "**Stat Bonuses:**");
            for (const cat of statCategories) {
              const entityLabel = cat.entityName ? ` (${cat.entityName}${cat.entityPosition ? ` · ${cat.entityPosition}` : ""})` : "";
              const tierLabel = cat.isFlat ? "Flat" : cat.qualifiedTier;
              breakdownLines.push(`• ${cat.label}${entityLabel}: **$${cat.amount}** [${tierLabel}]`);
            }
          }
          breakdownLines.push("", `**Total Payout: $${item.amount}**`);

          const rankLine = item.rank
            ? `You finished **Rank ${item.rank}** (${item.wins ?? 0}-${item.losses ?? 0}) in the regular season for **${result.serverName}**.`
            : `You earned stat bonuses this season in **${result.serverName}**.`;

          const dmEmbed = new EmbedBuilder()
            .setTitle("End of Season Payout")
            .setDescription([
              rankLine,
              "",
              ...breakdownLines,
              "",
              "Please approve or reject your payout below.",
              "_Rejecting will permanently cancel this payout._"
            ].join("\n"))
            .setColor(0xffd700);

          const dmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`eos_payout_approve:user:${item.id}`).setLabel("Approve Payout").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`eos_payout_reject:${item.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
          );

          await member.send({ embeds: [dmEmbed], components: [dmRow] }).then(() => dmsSent++).catch(() => undefined);
        } catch { /* DM failed — non-fatal */ }
      }

      // Post the public summary embed to the announcements channel (no action buttons there).
      if (result.announcementsChannelId) {
        try {
          const ch = await guild.channels.fetch(result.announcementsChannelId).catch(() => null) as TextChannel | null;
          if (ch?.type === ChannelType.GuildText) {
            const summaryLines = (result.items ?? []).map((item: any) => {
              const mention = item.discordId ? `<@${item.discordId}>` : item.displayName ?? item.teamName ?? "Unknown";
              const rankPart = item.rank ? `Rank ${item.rank} · ` : "";
              return `• ${mention} — ${rankPart}**$${item.amount}**`;
            });
            const headerEmbed = new EmbedBuilder()
              .setTitle("EOS Payouts Issued")
              .setDescription([
                `**Season ${result.seasonNumber}** payouts have been issued. Each recipient must approve via DM, and a commissioner must approve in the pending payouts channel.`,
                "",
                ...summaryLines
              ].join("\n"))
              .setColor(0x5865f2);
            await ch.send({ embeds: [headerEmbed] }).catch(() => undefined);
          }
        } catch { /* non-fatal */ }
      }

      // Post the per-coach commissioner approve/reject panels to the PENDING PAYOUTS channel
      // (falls back to announcements only if no pending payouts channel is configured).
      const approvalChannelId = result.pendingPayoutsChannelId ?? result.announcementsChannelId;
      if (approvalChannelId) {
        try {
          const ch = await guild.channels.fetch(approvalChannelId).catch(() => null) as TextChannel | null;
          if (ch?.type === ChannelType.GuildText) {
            await ch.send({ embeds: [new EmbedBuilder()
              .setTitle("EOS Payout Approvals — Commissioner Action Required")
              .setDescription(`**Season ${result.seasonNumber}** payouts. Approve or reject each below. Funds credit only after both the recipient (via DM) and a commissioner approve.`)
              .setColor(0x5865f2)] }).catch(() => undefined);

            // One approval message per coach
            for (const item of result.items ?? []) {
              const mention = item.discordId ? `<@${item.discordId}>` : item.displayName ?? item.teamName ?? "Unknown";
              const statCategories: any[] = item.statCategories ?? [];
              const breakdownLines: string[] = [];
              if (item.rankAmount > 0) breakdownLines.push(`**${item.rankLabel ?? `Rank ${item.rank}`}:** $${item.rankAmount}`);
              if (statCategories.length > 0) {
                breakdownLines.push("Stat Bonuses:");
                for (const cat of statCategories.slice(0, 15)) {
                  const entity = cat.entityName ? ` (${cat.entityName})` : "";
                  breakdownLines.push(`  ${cat.label}${entity}: $${cat.amount}`);
                }
                if (statCategories.length > 15) breakdownLines.push(`  ...and ${statCategories.length - 15} more`);
              }

              const itemEmbed = new EmbedBuilder()
                .setDescription([
                  `${mention} — **Total: $${item.amount}**`,
                  ...breakdownLines
                ].join("\n"))
                .setColor(0x57f287);

              const itemRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`eos_payout_approve:commissioner:${item.id}`).setLabel(`Approve $${item.amount}`).setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`eos_payout_reject:${item.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
              );

              await ch.send({ embeds: [itemEmbed], components: [itemRow] }).catch(() => undefined);
            }
          }
        } catch { /* non-fatal */ }
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Payouts Issued").setDescription([
          `Payout items created: **${result.items?.length ?? 0}**`,
          `DMs sent: **${dmsSent}**`,
          "",
          "Each payout requires both recipient and commissioner approval before funds are credited."
        ].join("\n"))],
        components: buildAdvanceMenuPanel().components
      });
    } catch (error) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Payout Failed").setDescription(error instanceof Error ? error.message : String(error))],
        components: buildAdvanceMenuPanel().components
      });
    }
    return;
  }

  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Advance Menu").setDescription("Unrecognized action.")], components: buildAdvanceMenuPanel().components });
}

async function handleTroubleshootMenuSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "This can only be used inside a Discord server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can use these tools.", flags: MessageFlags.Ephemeral });
    return;
  }

  const selected = interaction.values[0];
  if (selected === "back_advance_menu") return interaction.update(buildAdvanceMenuPanel());

  await interaction.deferUpdate();

  if (selected === "set_next_advance") {
    const scheduleState: AdvanceScheduleState = { timezone: DEFAULT_SCHEDULE_TIMEZONE };
    advanceScheduleSessions.set(interaction.user.id, scheduleState);
    await interaction.editReply(buildAdvanceSchedulePayload(scheduleState));
    return;
  }

  if (selected === "reselect_gotw") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading GOTW Candidates...").setDescription("Fetching matchup data to re-select the Game of the Week.")], components: [] });
    const result = await recApi.getGotwCandidates(interaction.guildId);
    const stage = result?.stage ?? "regular_season";
    if (stage !== "regular_season") {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Re-Select GOTW").setDescription("GOTW selection is only required during the regular season. Playoff and Super Bowl games are automatically treated as GOTW.")],
        components: buildTroubleshootMenuPanel().components
      });
      return;
    }
    if (!result?.candidates?.length) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Re-Select GOTW").setDescription("No User H2H matchups were found for the current week, so there is no GOTW to select.")],
        components: buildTroubleshootMenuPanel().components
      });
      return;
    }
    await interaction.editReply(buildGotwSelectionPayload(result.candidates));
    return;
  }

  if (selected === "regenerate_challenges") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Regenerating Challenges...").setDescription("Voiding current challenges and generating new ones. Please wait.")], components: [] });
    const result = await recApi.regenerateWeeklyChallenges(interaction.guildId);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Weekly Challenges Re-Generated")
          .setDescription([
            `Challenges generated: **${result?.count ?? result?.challenges?.length ?? 0}**`,
            "",
            "Current active challenges were voided before new ones were created."
          ].join("\n"))
      ],
      components: buildTroubleshootMenuPanel().components
    });
    return;
  }

  if (selected === "regenerate_potw") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Re-Generate POTW").setDescription("This feature is coming soon.")], components: buildTroubleshootMenuPanel().components });
    return;
  }

  if (selected === "recreate_game_channels") {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ content: "Game channels can only be recreated inside a Discord server.", embeds: [], components: [] });
      return;
    }
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Recreating Game Channels...").setDescription("Deleting old channels and rebuilding all active H2H game channels.")], components: [] });
    const result = await recreateGameChannelsForGuild(guild);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Game Channels Re-Created")
          .setDescription([
            "Deleted old active game channels and recreated current H2H matchup channels.",
            "",
            `Created: **${result.created?.length ?? 0}**`
          ].join("\n"))
      ],
      components: buildTroubleshootMenuPanel().components
    });
    return;
  }

  if (selected === "send_advance_dms") {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Re-Send Advance DMs").setDescription("This action requires a guild context.")], components: buildTroubleshootMenuPanel().components });
      return;
    }
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Sending Advance DMs...").setDescription("Sending DMs to all active players and creating game channels. This may take a moment.")], components: [] });
    let dmSummary: string[];
    try {
      const dmResult = await sendAdvanceDmsForGuild(guild);
      dmSummary = [
        `DMs sent: ${dmResult.sent} (failed: ${dmResult.failed})`,
        `Game channels created: ${dmResult.gameChannels.created.length} of ${dmResult.gameChannels.totalPlans}`,
        ...(dmResult.gameChannels.skipped.length ? [`Game channels skipped: ${dmResult.gameChannels.skipped[0].reason}`] : [])
      ];
    } catch (error) {
      console.error("Re-Send Advance DMs failed", error);
      dmSummary = ["DMs/game channels failed — check logs or use Recreate Game Channels to retry."];
    }
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Advance DMs Sent").setDescription(dmSummary.join("\n"))],
      components: buildTroubleshootMenuPanel().components
    });
    return;
  }

  if (selected === "audit_repair_records") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Auditing & Repairing Records...").setDescription("Rebuilding W/L/T records from all logged game results. This may take a moment.")], components: [] });
    try {
      const result = await recApi.auditRepairRecords(interaction.guildId);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Records Audit & Repair Complete")
            .setDescription([
              "Records have been recalculated from all logged game results.",
              "",
              `Season records repaired: **${result.seasonRecordsRepaired}**`,
              `League-wide records repaired: **${result.leagueRecordsRepaired}**`,
              `H2H pairs repaired: **${result.h2hPairsRepaired}**`,
              `Games marked applied: **${result.gamesMarkedApplied}**`,
              "",
              "_Safe to run multiple times — totals are rebuilt from scratch each run._"
            ].join("\n"))
        ],
        components: buildTroubleshootMenuPanel().components
      });
    } catch (error) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Records Repair Failed").setDescription(error instanceof Error ? error.message : String(error))],
        components: buildTroubleshootMenuPanel().components
      });
    }
    return;
  }

  if (selected === "recalculate_eos_payouts") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Calculating EOS Payouts...").setDescription("Fetching season standings and projecting end-of-season payouts.")], components: [] });
    try {
      const preview = await recApi.previewEosPayouts(interaction.guildId);
      const lines = [
        `**EOS Payout Preview — Season ${preview.seasonNumber}** (Week ${preview.weekNumber})`,
        `Total projected: **$${preview.totalPayout}**`,
        "",
        ...(preview.items ?? []).slice(0, 16).map((item: any) => {
          const mention = item.discordId ? `<@${item.discordId}>` : `User ${String(item.userId).slice(0, 8)}`;
          const record = `${item.wins}-${item.losses}-${item.ties}`;
          return `**${item.rank}.** ${mention} (${record}) — ${item.payoutLabel}: **$${item.projectedPayout}**`;
        })
      ];
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Payout Preview").setDescription(lines.join("\n").slice(0, 4000))],
        components: buildTroubleshootMenuPanel().components
      });
    } catch (error) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Preview Failed").setDescription(error instanceof Error ? error.message : String(error))],
        components: buildTroubleshootMenuPanel().components
      });
    }
    return;
  }

  // set_week falls through to the label handler below
  const labels: Record<string, string> = {
    set_week: "Set Current Week / Stage"
  };
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(labels[selected] ?? "Troubleshoot Advance").setDescription("This repair action is connected and will be expanded in the next build pass.")],
    components: buildTroubleshootMenuPanel().components
  });
}

async function renderMainMenuFromSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  importSessions.delete(interaction.user.id);
  await interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isDiscordAdminInteraction(interaction)));
}

async function handleSetupModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can use setup workflows.", flags: MessageFlags.Ephemeral });
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Setup workflows must be run inside a Discord server.", flags: MessageFlags.Ephemeral });
  const action = interaction.customId.split(":").at(-1) as SetupDangerAction | undefined;
  if (action === "league_setup") {
    const draft = createDefaultLeagueSetupDraft(interaction.fields.getTextInputValue(MENU_CUSTOM_IDS.leagueNameInput).trim());
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.reply({ ...buildLeagueSetupWindow(draft), flags: MessageFlags.Ephemeral });
  }
}

async function handleLeagueSetupSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "League Setup session expired. Open Admin Panel → League Setup again.", flags: MessageFlags.Ephemeral });
  const value = interaction.values[0];

  // Season week (and its offseason ":postseason" variant) both set the same field.
  if (interaction.customId.startsWith(LEAGUE_SETUP_CUSTOM_IDS.seasonWeek)) {
    draft.seasonWeek = value;
    draft.step = getNextLeagueSetupStep(draft.step, draft);
    applyLeagueSetupDependencies(draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  // Optional team-linking step: record the choice and advance to review.
  // Linking can only happen once the league exists, so it opens after Save (see handleLeagueSetupSave).
  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.teamLinkingOptional) {
    draft.linkTeamsAfterSetup = value === "yes";
    draft.step = "review";
    applyLeagueSetupDependencies(draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  // Settings picker: navigate directly to the chosen step without saving
  if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.settingsPicker) {
    if (value === "back_admin") {
      leagueSetupSessions.delete(interaction.user.id);
      return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
    }
    draft.step = value as LeagueSetupDraft["step"];
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildLeagueSetupWindow(draft));
  }

  switch (interaction.customId) {
    case LEAGUE_SETUP_CUSTOM_IDS.leagueType: draft.leagueType = value as LeagueSetupDraft["leagueType"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.importMode: draft.importMode = value as LeagueSetupDraft["importMode"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.featureToggles: {
      const values = new Set(interaction.values);
      draft.coinEconomyEnabled = values.has("coin_economy");
      draft.customPlayersEnabled = values.has("custom_players");
      draft.legendsEnabled = values.has("legends");
      draft.devUpgradesEnabled = values.has("dev_upgrades");
      draft.ageResetsEnabled = values.has("age_resets");
      draft.trainingPackagesEnabled = values.has("training_packages");
      draft.contractAdjustmentPurchasesEnabled = values.has("contract_purchases");
      draft.capManagementAssistantEnabled = values.has("cap_assistant");
      draft.draftClassFeaturesEnabled = values.has("draft_class_features");
      draft.scoutingPurchasesEnabled = values.has("draft_class_features");
      draft.mediaFeaturesEnabled = values.has("media_features");
      break;
    }
    case LEAGUE_SETUP_CUSTOM_IDS.draftClassType: draft.draftClassType = value as LeagueSetupDraft["draftClassType"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.regularSeasonStreaming: draft.regularSeasonStreamingRequirement = value as LeagueSetupDraft["regularSeasonStreamingRequirement"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.postseasonStreaming: draft.postseasonStreamingRequirement = value as LeagueSetupDraft["postseasonStreamingRequirement"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.streamingSide: draft.streamingSide = value as LeagueSetupDraft["streamingSide"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.fourthDownRuleRegular: draft.fourthDownRuleTypeRegular = value as LeagueSetupDraft["fourthDownRuleTypeRegular"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.fourthDownRulePlayoff: draft.fourthDownRuleTypePlayoff = value as LeagueSetupDraft["fourthDownRuleTypePlayoff"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.positionChangePolicy: draft.positionChangePolicy = value as LeagueSetupDraft["positionChangePolicy"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.tradeApprovalPolicy: draft.tradeApprovalPolicy = value as LeagueSetupDraft["tradeApprovalPolicy"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.cpuRules: { const values = new Set(interaction.values); draft.cpuTradingAllowed = values.has("cpu_trading"); draft.cpuFreeAgencyPolicy = values.has("cpu_fa_open") ? "open" : "disabled"; break; }
    case LEAGUE_SETUP_CUSTOM_IDS.difficulty: draft.difficulty = value as LeagueSetupDraft["difficulty"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.quarterLength: draft.quarterLengthMinutes = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.acceleratedClockEnabled: draft.acceleratedClockEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.acceleratedClockSeconds: draft.acceleratedClockMinimumSeconds = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.salaryCap: draft.salaryCapEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.tradeDeadline: draft.tradeDeadlineEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.abilities: draft.abilitiesEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.wearAndTear: draft.wearAndTearEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.injuryPolicy: draft.injuryPolicy = value as LeagueSetupDraft["injuryPolicy"]; break;
    case LEAGUE_SETUP_CUSTOM_IDS.offensiveLimitsEnabled: draft.offensivePlayCallLimitsEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.offensiveLimit: draft.offensivePlayCallLimit = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.offensiveCooldownEnabled: draft.offensivePlayCallCooldownEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.offensiveCooldown: draft.offensivePlayCallCooldown = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.defensiveLimitsEnabled: draft.defensivePlayCallLimitsEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.defensiveLimit: draft.defensivePlayCallLimit = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.defensiveCooldownEnabled: draft.defensivePlayCallCooldownEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.defensiveCooldown: draft.defensivePlayCallCooldown = Number(value); break;
  }

  // In edit mode: save the change to DB immediately, then return to the settings picker
  if (draft.editMode && interaction.guildId) {
    applyLeagueSetupDependencies(draft);
    leagueSetupSessions.set(interaction.user.id, draft);
    try {
      await recApi.updateLeagueConfig({ ...applyLeagueSetupDependencies(draft), guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
    } catch (err) {
      console.error("[ERROR] Failed to save league setting edit:", err);
    }
    draft.step = "settings_picker";
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.update(buildSettingsPickerWindow(draft));
  }

  draft.step = getNextLeagueSetupStep(draft.step, draft);
  applyLeagueSetupDependencies(draft);
  leagueSetupSessions.set(interaction.user.id, draft);
  await interaction.update(buildLeagueSetupWindow(draft));
}

async function handleActivityRequirementsModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "Session expired. Reopen /menu.", flags: MessageFlags.Ephemeral });

  draft.fairSimRequirements = interaction.fields.getTextInputValue(LEAGUE_SETUP_CUSTOM_IDS.fairSimInput).trim();
  draft.forceWinRequirements = interaction.fields.getTextInputValue(LEAGUE_SETUP_CUSTOM_IDS.forceWinInput).trim();
  leagueSetupSessions.set(interaction.user.id, draft);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (draft.editMode && interaction.guildId) {
    try {
      await recApi.updateLeagueConfig({ ...applyLeagueSetupDependencies(draft), guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
    } catch (err) {
      console.error("[ERROR] Failed to save activity requirements:", err);
    }
    draft.step = "settings_picker";
    leagueSetupSessions.set(interaction.user.id, draft);
    return interaction.editReply(buildSettingsPickerWindow(draft));
  }

  draft.step = getNextLeagueSetupStep(draft.step, draft);
  leagueSetupSessions.set(interaction.user.id, draft);
  return interaction.editReply(buildLeagueSetupWindow(draft));
}

// Maps the setup season-week selection to the league's current_week + season_stage.
function mapSeasonWeekToLeagueWeek(seasonWeek: string): { weekNumber: number; seasonStage: string } {
  if (seasonWeek.startsWith("week_")) {
    const n = Number(seasonWeek.slice("week_".length));
    return { weekNumber: Number.isFinite(n) && n > 0 ? n : 1, seasonStage: "regular_season" };
  }
  switch (seasonWeek) {
    case "wildcard": return { weekNumber: 19, seasonStage: "wild_card" };
    case "divisional": return { weekNumber: 20, seasonStage: "divisional" };
    case "conference": return { weekNumber: 21, seasonStage: "conference_championship" };
    case "super_bowl": return { weekNumber: 22, seasonStage: "super_bowl" };
    case "coach_hiring":    return { weekNumber: 1, seasonStage: "coach_hiring" };
    case "final_resigning": return { weekNumber: 1, seasonStage: "final_resigning" };
    case "free_agency":     return { weekNumber: 1, seasonStage: "free_agency" };
    case "draft":           return { weekNumber: 1, seasonStage: "draft" };
    case "training_camp":   return { weekNumber: 1, seasonStage: "preseason_training_camp" };
    default: return { weekNumber: 1, seasonStage: "regular_season" };
  }
}

async function handleLeagueSetupSave(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can save League Setup.", flags: MessageFlags.Ephemeral });
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "League Setup session expired. Open Admin Panel → League Setup again.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Saving League Setup...").setDescription("Creating your league and applying configuration. This may take a moment.")], components: [] });
  const result = await recApi.createLeague({ ...applyLeagueSetupDependencies(draft), guildId: interaction.guildId, requestedByDiscordId: interaction.user.id, serverName: interaction.guild?.name });

  // Persist the starting week/stage chosen during setup (defaults to regular-season week 1).
  const { weekNumber, seasonStage } = mapSeasonWeekToLeagueWeek(draft.seasonWeek);
  try {
    await recApi.setLeagueWeek({ guildId: interaction.guildId, weekNumber, seasonStage });
  } catch (error) {
    console.error("[ERROR] Failed to set league starting week:", error);
  }

  const wantsLinking = draft.linkTeamsAfterSetup;
  leagueSetupSessions.delete(interaction.user.id);

  const savedDescription = [`League: **${result.league.name}**`, "", `Type: ${result.configuration.roster_type}`, `Import Mode: ${result.configuration.import_mode}`, `Economy: ${result.configuration.coin_economy_enabled ? "Enabled" : "Disabled"}`, `Media: ${result.configuration.media_features_enabled ? "Enabled" : "Disabled"}`, `Draft Classes: ${result.configuration.draft_class_features_enabled ? result.configuration.draft_class_type : "Disabled"}`, `Regular Season Streaming: ${result.configuration.regular_season_streaming_requirement}`, `Postseason Streaming: ${result.configuration.postseason_streaming_requirement}`, `Injuries: ${result.configuration.injury_policy}`, "", "Economy payouts will remain inactive until at least 8 users are verified through Discord team links and imported game users."].join("\n");

  if (!wantsLinking) {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("League Setup Saved").setDescription(savedDescription)], components: buildAdminPanelRows() });
    return;
  }

  // League now exists — ensure default teams are present, then open the linking selector.
  try {
    const openTeams = await recApi.getOpenTeams(interaction.guildId);
    if (!openTeams?.openTeams || openTeams.openTeams.length === 0) {
      await recApi.createDefaultTeams(interaction.guildId);
    }
  } catch (error) {
    console.error("[ERROR] Failed to ensure default teams before linking:", error);
  }

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("League Setup Saved — Link Teams").setDescription([savedDescription, "", "Select a conference to begin linking users to teams, or click Done."].join("\n"))],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.simpleConferenceSelect)
          .setPlaceholder("Select conference")
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("AFC Teams").setValue("AFC"),
            new StringSelectMenuOptionBuilder().setLabel("NFC Teams").setValue("NFC")
          )
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("rec:league_setup:skip_team_linking").setLabel("Done").setStyle(ButtonStyle.Secondary)
      )
    ]
  });
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
    return renderImportPanel(interaction);
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

async function handleAdvanceScheduleSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const state = advanceScheduleSessions.get(interaction.user.id) ?? { timezone: DEFAULT_SCHEDULE_TIMEZONE };
  const value = interaction.values[0];
  if (interaction.customId === ADVANCE_SCHEDULE_CUSTOM_IDS.daySelect) {
    state.date = value;
  } else if (interaction.customId === ADVANCE_SCHEDULE_CUSTOM_IDS.hourSelect) {
    state.hour = value === "none" ? undefined : Number(value);
  } else if (interaction.customId === ADVANCE_SCHEDULE_CUSTOM_IDS.tzSelect) {
    state.timezone = value;
    // Changing the timezone can invalidate the chosen hour (past-hour filtering shifts), so drop it.
    state.hour = undefined;
  }
  advanceScheduleSessions.set(interaction.user.id, state);
  await interaction.update(buildAdvanceSchedulePayload(state));
}

async function handleAdvanceScheduleConfirm(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.guildId) return;
  const state = advanceScheduleSessions.get(interaction.user.id);
  if (!state?.date || state.hour == null || !state.timezone) {
    return interaction.reply({ content: "Select a day, time, and timezone first.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();

  // Wizard mode: start the full advance pipeline
  if (state.wizardMode && interaction.inCachedGuild()) {
    advanceScheduleSessions.delete(interaction.user.id);
    await runAdvanceWizardProcessing(interaction, state.date, state.hour, state.timezone, interaction.guild);
    return;
  }

  try {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Setting Next Advance...").setDescription("Saving the advance deadline.")], components: [] });
    const [y, mo, d] = state.date.split("-").map(Number);
    const when = wallClockToUtc(y, mo, d, state.hour, state.timezone);
    const result = await recApi.setNextAdvance({ guildId: interaction.guildId, nextAdvanceAt: when.toISOString(), timezone: state.timezone });
    advanceScheduleSessions.delete(interaction.user.id);
    const times: any[] = result?.nextAdvanceTimes ?? [];
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Next Advance Set")
          .setDescription([
            "The next advance deadline has been set.",
            "",
            ...(times.length ? times.map((t: any) => `${t.label}: ${t.value}`) : ["(No formatted times returned.)"])
          ].join("\n"))
      ],
      components: []
    });
  } catch (error) {
    console.error("[ERROR] Set next advance failed:", error);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Set Next Advance Failed").setDescription(error instanceof Error ? error.message : String(error))],
      components: []
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
      try {
        await interaction.message.edit({
          embeds: [new EmbedBuilder()
            .setTitle("⏳ Awaiting Commissioner Approval")
            .setDescription(interaction.message.embeds[0]?.description ?? "Payout pending.")
            .setColor(0xfee75c)],
          components: interaction.message.components
        });
      } catch { /* non-fatal */ }
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
    const where = approvals?.pendingPayoutsChannelId ? `<#${approvals.pendingPayoutsChannelId}>` : "this channel";
    await interaction.editReply({ content: `Voting closed for **${result.closed}** award(s). Review and approve winners in ${where}.` });
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
// Admin handler implementations (previously only in the dead index.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function handleRulesSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];
  if (selected === "back_admin") {
    return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
  }
  return interaction.update(buildRulesPanel(selected));
}

async function handleEconomyChannelSelect(interaction: any) {
  if (!interaction.isChannelSelectMenu() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can change economy routing.", flags: MessageFlags.Ephemeral });
    return;
  }
  const channelId = interaction.values[0];
  if (interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.setPendingChannel) {
    await recApi.setEconomyConfig({ guildId: interaction.guildId, pendingEconomyChannelId: channelId });
    await interaction.reply({ content: `Pending Purchases / Payouts channel set to <#${channelId}>.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.setGameCategory) {
    await recApi.setEconomyConfig({ guildId: interaction.guildId, gameChannelsCategoryId: channelId });
    await interaction.reply({ content: `Game Channels category set to <#${channelId}>.`, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content: "Unknown Economy Reviews channel selector.", flags: MessageFlags.Ephemeral });
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

async function handleClearEosModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can clear EOS batches.", flags: MessageFlags.Ephemeral });
    return;
  }
  const clearReason = interaction.fields.getTextInputValue(ECONOMY_ADMIN_CUSTOM_IDS.clearReasonInput);
  const result = await recApi.clearPendingEosBatch({ guildId: interaction.guildId, clearReason });
  await interaction.reply({ content: result.cleared ? "Pending EOS batch cleared. Reissue after correcting payout logic." : result.reason ?? "No pending EOS batch found.", flags: MessageFlags.Ephemeral });
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

async function handleStartActiveCheck(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can start an Active Check.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await recApi.createActiveCheck({ guildId: interaction.guildId, createdByDiscordId: interaction.user.id });
  if (!result.channelId) {
    await interaction.editReply("No league announcements channel is configured. Set announcements during server/league setup before starting an Active Check.");
    return;
  }
  const channel = await interaction.guild.channels.fetch(result.channelId).catch(() => null);
  if (!channel || !("send" in channel)) {
    await interaction.editReply("The configured announcements channel could not be accessed.");
    return;
  }
  const sent = await (channel as any).send(buildActiveCheckAnnouncement(result.event, result.deadlineDisplay ?? {}));
  await recApi.recordActiveCheckMessage({ eventId: result.event.id, discordChannelId: result.channelId, discordMessageId: sent.id });
  await interaction.editReply(`Active Check posted in <#${result.channelId}>. It closes in 24 hours.`);
}

async function handleActiveCheckResponse(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  const eventId = interaction.customId.slice(ACTIVE_CHECK_CUSTOM_IDS.activePrefix.length);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await recApi.recordActiveCheckResponse({ eventId, discordId: interaction.user.id });
  await interaction.editReply(result.recorded ? "Active Check recorded. You are marked active for this league." : result.reason ?? "Your Active Check could not be recorded.");
}

function startActiveCheckCloseoutLoop(activeClient: Client) {
  setInterval(async () => {
    for (const guild of activeClient.guilds.cache.values()) {
      const result = await recApi.getOpenActiveChecks(guild.id).catch(() => null);
      for (const event of result?.events ?? []) {
        if (!event.closes_at || new Date(event.closes_at).getTime() > Date.now()) continue;
        const closed = await recApi.closeActiveCheck(event.id).catch(() => null);
        if (!closed?.closed) continue;
        if (closed.event?.discord_channel_id && closed.event?.discord_message_id) {
          const channel = await guild.channels.fetch(closed.event.discord_channel_id).catch(() => null) as any;
          const message = channel?.messages ? await channel.messages.fetch(closed.event.discord_message_id).catch(() => null) : null;
          await message?.edit({ components: [] }).catch(() => undefined);
        }
        if (closed.commissionerOfficeChannelId) {
          const office = await guild.channels.fetch(closed.commissionerOfficeChannelId).catch(() => null) as any;
          const missing = closed.missing ?? [];
          const lines = missing.length
            ? missing.map((user: any) => user.discord_id ? `<@${user.discord_id}>` : user.rec_users?.display_name ?? user.user_id)
            : ["All linked team users responded as active."];
          await office?.send?.(["Active Check Closed", "", "Users who did not respond:", ...lines].join("\n")).catch(() => undefined);
        }
      }
    }
  }, 60_000).unref();
}

await client.login(env.DISCORD_TOKEN);
