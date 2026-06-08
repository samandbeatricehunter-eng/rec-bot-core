import { Client, EmbedBuilder, GatewayIntentBits, Interaction, MessageFlags } from "discord.js";
import { env } from "./config/env.js";
import { isDiscordAdminInteraction } from "./lib/admin.js";
import { recApi } from "./lib/rec-api.js";
import { ExpiringSessionStore } from "./lib/session-timeout.js";
import {
  buildAdminPanelEmbed,
  buildAdminPanelRows,
  buildMainMenuEmbed,
  buildMainMenuRows,
  buildSetupDangerModal,
  MENU_CUSTOM_IDS,
  type SetupDangerAction
} from "./ui/menu.js";
import { NAV_CUSTOM_IDS } from "./ui/navigation.js";
import {
  applyLeagueSetupDependencies,
  buildLeagueSetupWindow,
  createDefaultLeagueSetupDraft,
  getNextLeagueSetupStep,
  getPreviousLeagueSetupStep,
  LEAGUE_SETUP_CUSTOM_IDS,
  type LeagueSetupDraft
} from "./ui/league-setup.js";
import { handleImportButton, handleImportModal, handleImportSelect, importSessions, renderImportPanel } from "./flows/imports.js";
import { IMPORT_CUSTOM_IDS } from "./ui/imports.js";
import { buildAdvanceMenuPanel, ADVANCE_MENU_CUSTOM_IDS } from "./ui/advance-menu.js";
import { recreateGameChannelsForGuild } from "./flows/game-channels.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const menuSessions = new ExpiringSessionStore<true>();
const leagueSetupSessions = new ExpiringSessionStore<LeagueSetupDraft>();
setInterval(() => {
  menuSessions.cleanup();
  leagueSetupSessions.cleanup();
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

    if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && !menuSessions.touch(interaction.user.id)) {
      leagueSetupSessions.delete(interaction.user.id);
      importSessions.delete(interaction.user.id);
      await expireWindow(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === MENU_CUSTOM_IDS.mainSelect) return handleMainMenuSelect(interaction);
      if (interaction.customId === MENU_CUSTOM_IDS.adminSelect) return handleAdminPanelSelect(interaction);
      if (Object.values(LEAGUE_SETUP_CUSTOM_IDS).includes(interaction.customId as any)) return handleLeagueSetupSelect(interaction);
      if (Object.values(IMPORT_CUSTOM_IDS).includes(interaction.customId as any)) return handleImportSelect(interaction);
      if (interaction.customId === ADVANCE_MENU_CUSTOM_IDS.select) return handleAdvanceMenuSelect(interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId === MENU_CUSTOM_IDS.adminServerSetup) return interaction.showModal(buildSetupDangerModal("server_setup"));
      if (interaction.customId === MENU_CUSTOM_IDS.adminLeagueSetup) return interaction.showModal(buildSetupDangerModal("league_setup"));
      if (interaction.customId === MENU_CUSTOM_IDS.adminUserTeamLinking) return interaction.update({ embeds: [new EmbedBuilder().setTitle("User / Team Linking").setDescription("This panel is available. The full link workflow is the next build target.")], components: [] });
      if (interaction.customId === MENU_CUSTOM_IDS.adminImports) return renderImportPanel(interaction);
      if (Object.values(IMPORT_CUSTOM_IDS).includes(interaction.customId as any)) return handleImportButton(interaction);
      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.save) return handleLeagueSetupSave(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.mainMenu) return renderMainMenuFromComponent(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.adminPanel) return renderAdminPanelFromComponent(interaction);
      if (interaction.customId === NAV_CUSTOM_IDS.back) return handleBackNavigation(interaction);
    }

    if (interaction.isModalSubmit()) {
      if (Object.values(IMPORT_CUSTOM_IDS).includes(interaction.customId as any)) return handleImportModal(interaction);
      if (interaction.customId.startsWith(`${MENU_CUSTOM_IDS.setupModal}:`)) return handleSetupModal(interaction);
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

async function renderRecBankFromSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const walletPayload = await recApi.getWallet(interaction.user.id);
  const wallet = walletPayload?.wallet ?? { wallet_balance: 0, savings_balance: 0 };
  const transactions = Array.isArray(walletPayload?.transactions) ? walletPayload.transactions : [];
  const transactionText = transactions.length
    ? transactions.slice(0, 25).map(formatTransactionLine).join("\n\n")
    : "No wallet transactions found.";

  const embed = new EmbedBuilder()
    .setTitle("REC Bank")
    .setDescription([
      `Wallet Balance: **$${wallet.wallet_balance ?? 0}**`,
      `Savings Balance: **$${wallet.savings_balance ?? 0}**`,
      "",
      "**Last 25 Transactions**",
      transactionText
    ].join("\n").slice(0, 4096));

  return interaction.update({ embeds: [embed], components: buildMainMenuRows(isDiscordAdminInteraction(interaction)) });
}

async function handleMainMenuSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];
  if (selected === "admin_panel") {
    if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can open the Admin Panel.", flags: MessageFlags.Ephemeral });
    return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
  }
  if (selected === "rec_bank") return renderRecBankFromSelect(interaction);
  const labels: Record<string, string> = { rosters: "Rosters", manage_team: "Manage My Team", standings_stats: "Standings & Stats", media_center: "Media Center", help_rules: "Help / Rules" };
  await interaction.update({ embeds: [new EmbedBuilder().setTitle(labels[selected] ?? "REC League HQ").setDescription("This department shell is connected. The detailed workflow will be built next.").setFooter({ text: "REC Core connected" })], components: buildMainMenuRows(isDiscordAdminInteraction(interaction)) });
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
  if (selected === "server_setup") return interaction.showModal(buildSetupDangerModal("server_setup"));
  if (selected === "league_setup") return interaction.showModal(buildSetupDangerModal("league_setup"));
  if (selected === "user_team_linking") {
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle("User / Team Linking").setDescription("This panel is available. The full link workflow is the next build target.")],
      components: buildAdminPanelRows()
    });
  }

  const labels: Record<string, string> = {
    advance_menu: "Advance Menu",
    active_check: "Active Check",
    rules: "View / Edit Rules",
    economy_reviews: "Economy Reviews"
  };

  return interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(labels[selected] ?? "REC Admin Panel")
        .setDescription("This admin workflow shell is connected. The detailed workflow will continue in the next build pass.")
    ],
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

  if (selected === "regenerate_challenges") {
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
      components: buildAdvanceMenuPanel().components
    });
    return;
  }

  if (selected === "challenge_audit") {
    const result = await recApi.getChallengeAudit(interaction.guildId);
    const challenges = Array.isArray(result?.challenges) ? result.challenges.slice(0, 15) : [];
    const lines = challenges.length
      ? challenges.map((challenge: any) => {
          const tier = challenge.earned_tier ? `${String(challenge.earned_tier).toUpperCase()} Tier` : "No tier";
          const amount = Number(challenge.earned_amount ?? 0);
          return `• W${challenge.week_number ?? "?"} ${challenge.challenge_side ?? "challenge"}: ${tier}${amount ? ` (+$${amount})` : ""}`;
        })
      : ["No recent challenge audit rows found."];

    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Challenge Audit").setDescription(lines.join("\n"))],
      components: buildAdvanceMenuPanel().components
    });
    return;
  }

  if (selected === "catch_up_advance") {
    const result = await recApi.postAdvanceAutomation(interaction.guildId, "catch_up");
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Catch-Up Advance Processed")
          .setDescription([
            "Processed the imported week without user DMs, GOTW scheduling, or game-channel recreation.",
            "",
            `Mode: **${result?.mode ?? "catch_up"}**`
          ].join("\n"))
      ],
      components: buildAdvanceMenuPanel().components
    });
    return;
  }

  if (selected === "advance_week") {
    const result = await recApi.postAdvanceAutomation(interaction.guildId, "normal");
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Post-Advance Automation Processed")
          .setDescription([
            "Ran the normal post-advance automation queue.",
            "",
            `Mode: **${result?.mode ?? "normal"}**`
          ].join("\n"))
      ],
      components: buildAdvanceMenuPanel().components
    });
    return;
  }

  if (selected === "recreate_game_channels") {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.update({ content: "Game channels can only be recreated inside a Discord server.", embeds: [], components: [] });
      return;
    }

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
      components: buildAdvanceMenuPanel().components
    });
    return;
  }

  const labels: Record<string, string> = {
    set_week: "Set Current Week / Stage",
    reselect_gotw: "Re-Select GOTW"
  };

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(labels[selected] ?? "Advance Menu").setDescription("This advance action is connected and will be expanded in the next build pass.")],
    components: buildAdvanceMenuPanel().components
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
  if (action === "server_setup") {
    const result = await recApi.registerServer({ guildId: interaction.guildId, name: interaction.guild.name, setupMode: "manual_first", requestedByDiscordId: interaction.user.id });
    return interaction.reply({ content: ["**Server Setup confirmed.**", "", `Server: ${result.server.name}`, `Status: ${result.server.setup_status}`, `Created: ${result.created ? "Yes" : "No, existing server record updated"}`].join("\n"), flags: MessageFlags.Ephemeral });
  }
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
    case LEAGUE_SETUP_CUSTOM_IDS.fourthDownRule: draft.fourthDownRuleType = value as LeagueSetupDraft["fourthDownRuleType"]; break;
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
    case LEAGUE_SETUP_CUSTOM_IDS.offensiveCooldown: draft.offensivePlayCallCooldown = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.defensiveLimitsEnabled: draft.defensivePlayCallLimitsEnabled = value === "yes"; break;
    case LEAGUE_SETUP_CUSTOM_IDS.defensiveLimit: draft.defensivePlayCallLimit = Number(value); break;
    case LEAGUE_SETUP_CUSTOM_IDS.defensiveCooldown: draft.defensivePlayCallCooldown = Number(value); break;
  }
  draft.step = getNextLeagueSetupStep(draft.step, draft);
  applyLeagueSetupDependencies(draft);
  leagueSetupSessions.set(interaction.user.id, draft);
  await interaction.update(buildLeagueSetupWindow(draft));
}

async function handleLeagueSetupSave(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only authorized admins can save League Setup.", flags: MessageFlags.Ephemeral });
  const draft = leagueSetupSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "League Setup session expired. Open Admin Panel → League Setup again.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  const result = await recApi.createLeague({ ...applyLeagueSetupDependencies(draft), guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
  leagueSetupSessions.delete(interaction.user.id);
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("League Setup Saved").setDescription([`League: **${result.league.name}**`, "", `Type: ${result.configuration.roster_type}`, `Import Mode: ${result.configuration.import_mode}`, `Economy: ${result.configuration.coin_economy_enabled ? "Enabled" : "Disabled"}`, `Media: ${result.configuration.media_features_enabled ? "Enabled" : "Disabled"}`, `Draft Classes: ${result.configuration.draft_class_features_enabled ? result.configuration.draft_class_type : "Disabled"}`, `Regular Season Streaming: ${result.configuration.regular_season_streaming_requirement}`, `Postseason Streaming: ${result.configuration.postseason_streaming_requirement}`, `Injuries: ${result.configuration.injury_policy}`, "", "Economy payouts will remain inactive until at least 8 users are verified through Discord team links and imported game users."].join("\n"))], components: buildAdminPanelRows() });
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

await client.login(env.DISCORD_TOKEN);
