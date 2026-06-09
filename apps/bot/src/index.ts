import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Interaction,
  type ButtonInteraction,
  type StringSelectMenuInteraction
} from "discord.js";
import { env } from "./config/env.js";
import { recApi } from "./lib/rec-api.js";
import { isDiscordAdminInteraction } from "./lib/admin.js";
import {
  buildAdminPanelEmbed,
  buildAdminPanelRows,
  buildMainMenuEmbed,
  buildMainMenuRows,
  buildSetupDangerModal,
  MENU_CUSTOM_IDS,
  type SetupDangerAction
} from "./ui/menu.js";
import {
  applyLeagueSetupDependencies,
  buildLeagueSetupWindow,
  createDefaultLeagueSetupDraft,
  getNextLeagueSetupStep,
  getPreviousLeagueSetupStep,
  LEAGUE_SETUP_CUSTOM_IDS,
  type LeagueSetupDraft
} from "./ui/league-setup.js";
import { NAV_CUSTOM_IDS } from "./ui/navigation.js";
import {
  handleCreateDefaultTeams,
  handleTeamLinkSelect,
  handleTeamLinkUserPage,
  handleViewLinkedUsersTeams,
  handleViewOpenTeams,
  renderTeamLinkPanel,
  startTeamLinkFlow,
  teamLinkSessions
} from "./flows/team-linking.js";
import {
  handleImportButton,
  handleImportSelect,
  importSessions,
  renderImportPanel
} from "./flows/imports.js";
import { TEAM_LINK_CUSTOM_IDS } from "./ui/team-options.js";
import { IMPORT_CUSTOM_IDS } from "./ui/imports.js";
import { ECONOMY_ADMIN_CUSTOM_IDS, buildClearEosModal, buildEconomyAdminPanel } from "./ui/economy-admin.js";
import { SERVER_SETUP_ADMIN_CUSTOM_IDS, buildServerSetupAdminPanel } from "./ui/server-setup-admin.js";
import { WEEKLY_CHALLENGE_CUSTOM_IDS, buildWeeklyChallengesPanel } from "./ui/weekly-challenges.js";
import { ADVANCE_MENU_CUSTOM_IDS, buildAdvanceMenuPanel } from "./ui/advance-menu.js";
import { RULES_CUSTOM_IDS, buildRulesPanel } from "./ui/rules.js";
import { LEAGUE_WEEK_CUSTOM_IDS, buildLeagueWeekPanel, buildLeagueWeekSetModal, buildLeagueWeekStageRow } from "./ui/league-week.js";
import { recordGameChannelMessage, recreateGameChannelsForGuild, sendAdvanceDmsForGuild, startGameChannelReminderLoop } from "./flows/game-channels.js";
import { GOTW_CUSTOM_IDS } from "./ui/gotw.js";
import { handleGotwSelect, handleGotwVote, renderGotwSelection } from "./flows/gotw.js";
import { ACTIVE_CHECK_CUSTOM_IDS, buildActiveCheckAnnouncement } from "./ui/active-check.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const leagueSetupSessions = new Map<string, LeagueSetupDraft>();

client.once("clientReady", async () => {
  console.log(`REC Bot logged in as ${client.user?.tag ?? "unknown"}`);

  try {
    const health = await recApi.health();
    console.log(`Connected to ${health.service}`);
    startGameChannelReminderLoop(client);
  } catch (error) {
    console.error("REC Core API health check failed", error);
  }
});

client.on("interactionCreate", async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "menu") {
      await handleMenuCommand(interaction);
      return;
    }

    if (interaction.isChannelSelectMenu()) {
      if (interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.setPendingChannel || interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.setGameCategory) {
        await handleEconomyChannelSelect(interaction);
        return;
      }

      if (interaction.customId === SERVER_SETUP_ADMIN_CUSTOM_IDS.setCommissionerOffice || interaction.customId === SERVER_SETUP_ADMIN_CUSTOM_IDS.setStreamsChannel) {
        await handleServerSetupChannelSelect(interaction);
        return;
      }
    }

    if (interaction.isRoleSelectMenu()) {
      if (interaction.customId === SERVER_SETUP_ADMIN_CUSTOM_IDS.setCommissionerRole || interaction.customId === SERVER_SETUP_ADMIN_CUSTOM_IDS.setCompCommitteeRole) {
        await handleServerSetupRoleSelect(interaction);
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === MENU_CUSTOM_IDS.mainSelect) {
        await handleMainMenuSelect(interaction);
        return;
      }

      if (interaction.customId === MENU_CUSTOM_IDS.adminSelect) {
        await handleAdminPanelSelect(interaction);
        return;
      }

      if (interaction.customId === ADVANCE_MENU_CUSTOM_IDS.select) {
        await handleAdvanceMenuSelect(interaction);
        return;
      }

      if (interaction.customId === WEEKLY_CHALLENGE_CUSTOM_IDS.select) {
        await handleWeeklyChallengeSelect(interaction);
        return;
      }

      if (interaction.customId === RULES_CUSTOM_IDS.select) {
        await handleRulesSelect(interaction);
        return;
      }

      if (Object.values(LEAGUE_SETUP_CUSTOM_IDS).includes(interaction.customId as any)) {
        await handleLeagueSetupSelect(interaction);
        return;
      }

      if (Object.values(TEAM_LINK_CUSTOM_IDS).includes(interaction.customId as any)) {
        await handleTeamLinkSelect(interaction);
        return;
      }

      if (Object.values(IMPORT_CUSTOM_IDS).includes(interaction.customId as any)) {
        await handleImportSelect(interaction);
        return;
      }

      if (interaction.customId === GOTW_CUSTOM_IDS.select) {
        await handleGotwSelect(interaction);
        return;
      }

      if (interaction.customId === LEAGUE_WEEK_CUSTOM_IDS.stageSelect) {
        await interaction.showModal(buildLeagueWeekSetModal(interaction.values[0]));
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === MENU_CUSTOM_IDS.adminServerSetup) {
        await interaction.showModal(buildSetupDangerModal("server_setup"));
        return;
      }

      if (interaction.customId === MENU_CUSTOM_IDS.adminLeagueSetup) {
        await interaction.showModal(buildSetupDangerModal("league_setup"));
        return;
      }

      if (interaction.customId === MENU_CUSTOM_IDS.adminUserTeamLinking) {
        await renderTeamLinkPanel(interaction);
        return;
      }

      if (interaction.customId === MENU_CUSTOM_IDS.adminImports || interaction.customId === MENU_CUSTOM_IDS.adminImportEnterData) {
        await renderImportPanel(interaction);
        return;
      }

      if (interaction.customId === MENU_CUSTOM_IDS.adminEconomyReviews) {
        await interaction.update(buildEconomyAdminPanel());
        return;
      }

      if (interaction.customId === MENU_CUSTOM_IDS.adminAdvanceMenu) {
        await interaction.update(buildAdvanceMenuPanel());
        return;
      }

      if (interaction.customId === MENU_CUSTOM_IDS.adminActiveCheck) {
        await handleStartActiveCheck(interaction);
        return;
      }

      if (interaction.customId === MENU_CUSTOM_IDS.adminRules) {
        await interaction.update(buildRulesPanel());
        return;
      }

      if (interaction.customId === MENU_CUSTOM_IDS.adminReselectGotw) {
        await renderGotwSelection(interaction);
        return;
      }

      if (interaction.customId.startsWith(IMPORT_CUSTOM_IDS.approveJob)) {
        await handleImportButton(interaction);
        return;
      }

      if (Object.values(IMPORT_CUSTOM_IDS).includes(interaction.customId as any)) {
        await handleImportButton(interaction);
        return;
      }

      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.createDefaultTeams) {
        await handleCreateDefaultTeams(interaction);
        return;
      }

      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.viewLinked) {
        await handleViewLinkedUsersTeams(interaction);
        return;
      }

      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.viewOpen) {
        await handleViewOpenTeams(interaction);
        return;
      }

      if (interaction.customId === TEAM_LINK_CUSTOM_IDS.userTeamLinkPanel) {
        await startTeamLinkFlow(interaction);
        return;
      }

      if (
        interaction.customId === TEAM_LINK_CUSTOM_IDS.userPagePrev ||
        interaction.customId === TEAM_LINK_CUSTOM_IDS.userPageNext
      ) {
        await handleTeamLinkUserPage(interaction);
        return;
      }

      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.save) {
        await handleLeagueSetupSave(interaction);
        return;
      }

      if (interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.clearEos) {
        await interaction.showModal(buildClearEosModal());
        return;
      }

      if (interaction.customId.startsWith(GOTW_CUSTOM_IDS.voteAwayPrefix) || interaction.customId.startsWith(GOTW_CUSTOM_IDS.voteHomePrefix)) {
        await handleGotwVote(interaction);
        return;
      }

      if (interaction.customId.startsWith("rec:stream_review:approve:") || interaction.customId.startsWith("rec:stream_review:deny:")) {
        await handleStreamReviewButton(interaction);
        return;
      }

      if (interaction.customId.startsWith(ACTIVE_CHECK_CUSTOM_IDS.activePrefix)) {
        await handleActiveCheckResponse(interaction);
        return;
      }

      if (interaction.customId === ACTIVE_CHECK_CUSTOM_IDS.start) {
        await handleStartActiveCheck(interaction);
        return;
      }

      if (interaction.customId === WEEKLY_CHALLENGE_CUSTOM_IDS.selectGotw) {
        await renderGotwSelection(interaction);
        return;
      }

      if (interaction.customId === LEAGUE_WEEK_CUSTOM_IDS.view) {
        if (!interaction.inCachedGuild()) return;
        await interaction.deferReply({ ephemeral: true });
        const result = await recApi.viewLeagueWeek(interaction.guildId);
        await interaction.editReply(`League: ${result.league?.name ?? "Unknown"}\nSeason: ${result.league?.season_number ?? "?"}\nWeek: ${result.league?.current_week ?? "?"}\nStage: ${result.league?.season_stage ?? result.league?.current_phase ?? "?"}`);
        return;
      }

      if (interaction.customId === LEAGUE_WEEK_CUSTOM_IDS.set) {
        await interaction.reply({ content: "Choose the stage first.", components: [buildLeagueWeekStageRow()], ephemeral: true });
        return;
      }

      if (interaction.customId === NAV_CUSTOM_IDS.mainMenu) {
        await renderMainMenuFromComponent(interaction);
        return;
      }

      if (interaction.customId === NAV_CUSTOM_IDS.adminPanel) {
        await renderAdminPanelFromComponent(interaction);
        return;
      }

      if (interaction.customId === NAV_CUSTOM_IDS.back) {
        await handleBackNavigation(interaction);
        return;
      }
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith(`${MENU_CUSTOM_IDS.setupModal}:`)
    ) {
      await handleSetupModal(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.clearEosModal) {
      await handleClearEosModal(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${LEAGUE_WEEK_CUSTOM_IDS.setModal}:`)) {
      await handleLeagueWeekSetModal(interaction);
      return;
    }
  } catch (error) {
    console.error("Interaction handling failed", error);

    if (interaction.isRepliable()) {
      const payload = {
        content: "REC Bot hit an error while handling that action.",
        ephemeral: true
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => undefined);
      } else {
        await interaction.reply(payload).catch(() => undefined);
      }
    }
  }
});

client.on("messageCreate", recordGameChannelMessage);


async function handleAdminPanelSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can use the Admin Panel.", ephemeral: true });
    return;
  }

  const selected = interaction.values[0];
  if (selected === "main_menu") {
    await interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, true));
    return;
  }
  if (selected === "server_setup") {
    await interaction.update(buildServerSetupAdminPanel());
    return;
  }
  if (selected === "league_setup") {
    await interaction.showModal(buildSetupDangerModal("league_setup"));
    return;
  }
  if (selected === "user_team_linking") {
    await renderTeamLinkPanel(interaction as any);
    return;
  }
  if (selected === "import_enter_data") {
    await renderImportPanel(interaction as any);
    return;
  }
  if (selected === "advance_menu") {
    await interaction.update(buildAdvanceMenuPanel());
    return;
  }
  if (selected === "active_check") {
    await handleStartActiveCheck(interaction as any);
    return;
  }
  if (selected === "rules") {
    await interaction.update(buildRulesPanel());
    return;
  }
  if (selected === "economy_reviews") {
    await interaction.update(buildEconomyAdminPanel());
  }
}

async function handleAdvanceMenuSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];
  if (selected === "back_admin") {
    await interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
    return;
  }
  if (selected === "set_week") {
    await interaction.reply({ content: "Choose the stage first.", components: [buildLeagueWeekStageRow()], ephemeral: true });
    return;
  }
  if (selected === "recreate_game_channels") {
    if (!interaction.inCachedGuild()) return;
    await interaction.deferReply({ ephemeral: true });
    const result = await recreateGameChannelsForGuild(interaction.guild);
    await interaction.editReply(`Game channels recreated. Created: ${result.created?.length ?? 0}.`);
    return;
  }
  if (selected === "reselect_gotw") {
    await renderGotwSelection(interaction);
    return;
  }
  if (selected === "regenerate_challenges") {
    await handleRegenerateChallenges(interaction);
    return;
  }
  if (selected === "challenge_audit") {
    await handleChallengeAudit(interaction);
    return;
  }
  if (selected === "catch_up_advance") {
    await handleCatchUpAdvance(interaction);
    return;
  }
  if (selected === "advance_week") {
    if (!interaction.inCachedGuild()) return;
    await interaction.deferReply({ ephemeral: true });
    const result = await sendAdvanceDmsForGuild(interaction.guild);
    await interaction.editReply(`Advance automation completed. DMs sent: ${result.sent}. Failed: ${result.failed}.`);
  }
}

async function handleWeeklyChallengeSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];
  if (selected === "back_admin") {
    await interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
    return;
  }
  if (selected === "regenerate") await handleRegenerateChallenges(interaction);
  if (selected === "audit") await handleChallengeAudit(interaction);
}

async function handleRulesSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const selected = interaction.values[0];
  if (selected === "back_admin") {
    await interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
    return;
  }
  await interaction.update(buildRulesPanel(selected));
}

async function handleRegenerateChallenges(interaction: StringSelectMenuInteraction | ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ ephemeral: true });
  const result = await recApi.regenerateWeeklyChallenges(interaction.guildId);
  await interaction.editReply(`Weekly challenges regenerated. Rows affected: ${result.generated ?? 0}.`);
}

async function handleChallengeAudit(interaction: StringSelectMenuInteraction | ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ ephemeral: true });
  const result = await recApi.getChallengeAudit(interaction.guildId);
  const lines = (result.challenges ?? []).slice(0, 20).map((c: any) => `Week ${c.week_number} - ${c.challenge_side}: ${c.earned_tier ?? "Not earned"} $${c.earned_amount ?? 0}`);
  await interaction.editReply(lines.length ? lines.join("\n") : "No challenge audit rows found for the last 2 in-game weeks.");
}

async function handleCatchUpAdvance(interaction: StringSelectMenuInteraction | ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ ephemeral: true });
  const result = await recApi.postAdvanceAutomation(interaction.guildId, "catch_up");
  await interaction.editReply([
    "Catch-up advance processing completed.",
    "",
    "Records, eligible automatic payouts, POTW, and weekly challenges were processed from the current imported week data.",
    "Advance DMs, GOTW scheduling/polls, and game-channel recreation were skipped.",
    "",
    `Skipped: ${(result.skipped ?? []).join(", ") || "None"}`
  ].join("\n"));
}
async function buildMainMenuPayload(userId: string, guildId: string | null, isAdmin: boolean) {
  let menuEmbed = buildMainMenuEmbed({ discordUsername: "Unlinked User", isAdmin });

  if (guildId) {
    try {
      const profile = await recApi.getMenuProfile(userId, guildId);
      menuEmbed = buildMainMenuEmbed({ ...profile.display, isAdmin });
    } catch {
      // Unlinked users can still see the menu shell.
    }
  }

  return {
    embeds: [menuEmbed],
    components: buildMainMenuRows(isAdmin)
  };
}

async function handleMenuCommand(interaction: Extract<Interaction, { isChatInputCommand(): boolean }>) {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply({ ephemeral: true });

  const isAdmin = isDiscordAdminInteraction(interaction);
  await interaction.editReply(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isAdmin));
}

async function renderMainMenuFromComponent(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;

  const isAdmin = isDiscordAdminInteraction(interaction);
  leagueSetupSessions.delete(interaction.user.id);
  teamLinkSessions.delete(interaction.user.id);
  importSessions.delete(interaction.user.id);
  await interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isAdmin));
}

async function renderAdminPanelFromComponent(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;

  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({
      content: "Only authorized admins can open the Admin Panel.",
      ephemeral: true
    });
    return;
  }

  leagueSetupSessions.delete(interaction.user.id);
  teamLinkSessions.delete(interaction.user.id);
  importSessions.delete(interaction.user.id);
  await interaction.update({
    embeds: [buildAdminPanelEmbed()],
    components: buildAdminPanelRows()
  });
}

async function handleMainMenuSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;

  const selected = interaction.values[0];

  if (selected === "admin_panel") {
    if (!isDiscordAdminInteraction(interaction)) {
      await interaction.reply({
        content: "Only authorized admins can open the Admin Panel.",
        ephemeral: true
      });
      return;
    }

    await interaction.update({
      embeds: [buildAdminPanelEmbed()],
      components: buildAdminPanelRows()
    });
    return;
  }

  const labels: Record<string, string> = {
    rosters: "Rosters",
    manage_team: "Manage My Team",
    standings_stats: "Standings & Stats",
    rec_bank: "REC Bank",
    media_center: "Media Center",
    help_rules: "Help / Rules"
  };

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(labels[selected] ?? "REC League HQ")
        .setDescription("This department shell is connected. The detailed workflow will be built next.")
        .setFooter({ text: "REC Core connected" })
    ],
    components: buildMainMenuRows(isDiscordAdminInteraction(interaction))
  });
}

async function handleSetupModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit()) return;

  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({
      content: "Only authorized admins can use setup workflows.",
      ephemeral: true
    });
    return;
  }

  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: "Setup workflows must be run inside a Discord server.",
      ephemeral: true
    });
    return;
  }

  const action = interaction.customId.split(":").at(-1) as SetupDangerAction | undefined;

  if (action === "server_setup") {
    const result = await recApi.registerServer({
      guildId: interaction.guildId,
      name: interaction.guild.name,
      setupMode: "manual_first",
      requestedByDiscordId: interaction.user.id
    });

    await interaction.reply({
      content: [
        "**Server Setup confirmed.**",
        "",
        `Server: ${result.server.name}`,
        `Status: ${result.server.setup_status}`,
        `Created: ${result.created ? "Yes" : "No, existing server record updated"}`
      ].join("\n"),
      ephemeral: true
    });
    return;
  }

  if (action === "league_setup") {
    const leagueName = interaction.fields.getTextInputValue(MENU_CUSTOM_IDS.leagueNameInput).trim();
    const draft = createDefaultLeagueSetupDraft(leagueName);

    leagueSetupSessions.set(interaction.user.id, draft);

    await interaction.reply({
      ...buildLeagueSetupWindow(draft),
      ephemeral: true
    });
  }
}

async function handleLeagueSetupSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;

  const draft = leagueSetupSessions.get(interaction.user.id);

  if (!draft) {
    await interaction.reply({
      content: "League Setup session expired. Open Admin Panel → League Setup again.",
      ephemeral: true
    });
    return;
  }

  const value = interaction.values[0];

  switch (interaction.customId) {
    case LEAGUE_SETUP_CUSTOM_IDS.leagueType:
      draft.leagueType = value as LeagueSetupDraft["leagueType"];
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.importMode:
      draft.importMode = value as LeagueSetupDraft["importMode"];
      break;

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

    case LEAGUE_SETUP_CUSTOM_IDS.draftClassType:
      draft.draftClassType = value as LeagueSetupDraft["draftClassType"];
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.regularSeasonStreaming:
      draft.regularSeasonStreamingRequirement = value as LeagueSetupDraft["regularSeasonStreamingRequirement"];
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.postseasonStreaming:
      draft.postseasonStreamingRequirement = value as LeagueSetupDraft["postseasonStreamingRequirement"];
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.streamingSide:
      draft.streamingSide = value as LeagueSetupDraft["streamingSide"];
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.fourthDownRule:
      draft.fourthDownRuleType = value as LeagueSetupDraft["fourthDownRuleType"];
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.positionChangePolicy:
      draft.positionChangePolicy = value as LeagueSetupDraft["positionChangePolicy"];
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.tradeApprovalPolicy:
      draft.tradeApprovalPolicy = value as LeagueSetupDraft["tradeApprovalPolicy"];
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.cpuRules: {
      const values = new Set(interaction.values);
      draft.cpuTradingAllowed = values.has("cpu_trading");
      draft.cpuFreeAgencyPolicy = values.has("cpu_fa_open") ? "open" : "disabled";
      break;
    }

    case LEAGUE_SETUP_CUSTOM_IDS.difficulty:
      draft.difficulty = value as LeagueSetupDraft["difficulty"];
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.quarterLength:
      draft.quarterLengthMinutes = Number(value);
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.acceleratedClockEnabled:
      draft.acceleratedClockEnabled = value === "yes";
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.acceleratedClockSeconds:
      draft.acceleratedClockMinimumSeconds = Number(value);
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.salaryCap:
      draft.salaryCapEnabled = value === "yes";
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.tradeDeadline:
      draft.tradeDeadlineEnabled = value === "yes";
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.abilities:
      draft.abilitiesEnabled = value === "yes";
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.wearAndTear:
      draft.wearAndTearEnabled = value === "yes";
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.injuryPolicy:
      draft.injuryPolicy = value as LeagueSetupDraft["injuryPolicy"];
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.offensiveLimitsEnabled:
      draft.offensivePlayCallLimitsEnabled = value === "yes";
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.offensiveLimit:
      draft.offensivePlayCallLimit = Number(value);
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.offensiveCooldown:
      draft.offensivePlayCallCooldown = Number(value);
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.defensiveLimitsEnabled:
      draft.defensivePlayCallLimitsEnabled = value === "yes";
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.defensiveLimit:
      draft.defensivePlayCallLimit = Number(value);
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.defensiveCooldown:
      draft.defensivePlayCallCooldown = Number(value);
      break;
  }

  draft.step = getNextLeagueSetupStep(draft.step, draft);
  applyLeagueSetupDependencies(draft);
  leagueSetupSessions.set(interaction.user.id, draft);

  await interaction.update(buildLeagueSetupWindow(draft));
}

async function handleLeagueSetupSave(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;

  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({
      content: "Only authorized admins can save League Setup.",
      ephemeral: true
    });
    return;
  }

  const draft = leagueSetupSessions.get(interaction.user.id);

  if (!draft) {
    await interaction.reply({
      content: "League Setup session expired. Open Admin Panel → League Setup again.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferUpdate();

  const result = await recApi.createLeague({
    ...applyLeagueSetupDependencies(draft),
    guildId: interaction.guildId,
    requestedByDiscordId: interaction.user.id,
    seasonNumber: 1,
    seasonStage: "regular_season",
    currentPhase: "regular_season",
    currentWeek: 1
  } as any);

  leagueSetupSessions.delete(interaction.user.id);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("League Setup Saved")
        .setDescription([
          `League: **${result.league.name}**`,
          "",
          `Type: ${result.configuration.roster_type}`,
          `Import Mode: ${result.configuration.import_mode}`,
          `Economy: ${result.configuration.coin_economy_enabled ? "Enabled" : "Disabled"}`,
          `Media: ${result.configuration.media_features_enabled ? "Enabled" : "Disabled"}`,
          `Draft Classes: ${result.configuration.draft_class_features_enabled ? result.configuration.draft_class_type : "Disabled"}`,
          `Regular Season Streaming: ${result.configuration.regular_season_streaming_requirement}`,
          `Postseason Streaming: ${result.configuration.postseason_streaming_requirement}`,
          `Injuries: ${result.configuration.injury_policy}`,
          "",
          "League week defaults to Season 1, Week 1, Regular Season so imports can proceed week by week.",
          "Economy payouts will remain inactive until the league meets the configured linked-user minimum and imported game-user requirements."
        ].join("\n"))
    ],
    components: buildAdminPanelRows()
  });
}

function isTeamLinkMessage(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return false;

  const title = interaction.message.embeds.at(0)?.title ?? "";

  return [
    "User / Team Linking",
    "Link User to Team",
    "Linked Users / Teams",
    "Open Teams",
    "NFL Teams Refreshed",
    "User Linked to Team",
    "Team Not Available"
  ].some((teamLinkTitle) => title.includes(teamLinkTitle));
}

function isImportMessage(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return false;

  const title = interaction.message.embeds.at(0)?.title ?? "";

  return [
    "Import Data",
    "Import Franchise",
    "Discovered EA Franchises",
    "Franchise Selected",
    "Create Import Job",
    "Import Job Created",
    "Import Status",
    "Import History"
  ].some((importTitle) => title.includes(importTitle));
}

async function handleBackNavigation(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;

  const draft = leagueSetupSessions.get(interaction.user.id);

  if (draft) {
    const previous = getPreviousLeagueSetupStep(draft.step);

    if (previous === "admin_panel") {
      leagueSetupSessions.delete(interaction.user.id);
      await interaction.update({
        embeds: [buildAdminPanelEmbed()],
        components: buildAdminPanelRows()
      });
      return;
    }

    draft.step = previous;
    leagueSetupSessions.set(interaction.user.id, draft);
    await interaction.update(buildLeagueSetupWindow(draft));
    return;
  }

  if (teamLinkSessions.has(interaction.user.id) || isTeamLinkMessage(interaction)) {
    teamLinkSessions.delete(interaction.user.id);
    await renderTeamLinkPanel(interaction);
    return;
  }

  if (importSessions.has(interaction.user.id) || isImportMessage(interaction)) {
    importSessions.delete(interaction.user.id);
    await renderImportPanel(interaction);
    return;
  }

  await renderMainMenuFromComponent(interaction);
}

startActiveCheckCloseoutLoop(client);

await client.login(env.DISCORD_TOKEN);


async function handleServerSetupChannelSelect(interaction: any) {
  if (!interaction.isChannelSelectMenu() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can change server setup routing.", ephemeral: true });
    return;
  }
  const channelId = interaction.values[0];
  if (interaction.customId === SERVER_SETUP_ADMIN_CUSTOM_IDS.setCommissionerOffice) {
    await recApi.setEconomyConfig({ guildId: interaction.guildId, commissionerOfficeChannelId: channelId });
    await interaction.reply({ content: `Commissioner Office channel set to <#${channelId}>.`, ephemeral: true });
    return;
  }
  await recApi.setEconomyConfig({ guildId: interaction.guildId, streamsChannelId: channelId });
  await interaction.reply({ content: `Streams channel set to <#${channelId}>.`, ephemeral: true });
}

async function handleServerSetupRoleSelect(interaction: any) {
  if (!interaction.isRoleSelectMenu() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can change server setup routing.", ephemeral: true });
    return;
  }
  const roleId = interaction.values[0];
  if (interaction.customId === SERVER_SETUP_ADMIN_CUSTOM_IDS.setCommissionerRole) {
    await recApi.setEconomyConfig({ guildId: interaction.guildId, commissionerRoleId: roleId });
    await interaction.reply({ content: `Commissioner role set to <@&${roleId}>.`, ephemeral: true });
    return;
  }
  await recApi.setEconomyConfig({ guildId: interaction.guildId, compCommitteeRoleId: roleId });
  await interaction.reply({ content: `Comp Committee role set to <@&${roleId}>.`, ephemeral: true });
}

async function handleEconomyChannelSelect(interaction: any) {
  if (!interaction.isChannelSelectMenu() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can change economy routing.", ephemeral: true });
    return;
  }
  const channelId = interaction.values[0];
  if (interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.setPendingChannel) {
    await recApi.setEconomyConfig({ guildId: interaction.guildId, pendingEconomyChannelId: channelId });
    await interaction.reply({ content: `Pending Purchases / Payouts channel set to <#${channelId}>.`, ephemeral: true });
    return;
  }
  if (interaction.customId === ECONOMY_ADMIN_CUSTOM_IDS.setGameCategory) {
    await recApi.setEconomyConfig({ guildId: interaction.guildId, gameChannelsCategoryId: channelId });
    await interaction.reply({ content: `Game Channels category set to <#${channelId}>.`, ephemeral: true });
    return;
  }
  await interaction.reply({ content: "Unknown Economy Reviews channel selector.", ephemeral: true });
}


function formatCstAppliedLine(actionLabel: string, userMention: string) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date());
  return `${actionLabel} by ${userMention} on ${formatted} CST`;
}

async function appendReviewActionToMessage(interaction: ButtonInteraction, actionLabel: string) {
  const line = formatCstAppliedLine(actionLabel, `<@${interaction.user.id}>`);
  const embeds = interaction.message.embeds.map((embed: any) => {
    const builder = EmbedBuilder.from(embed);
    const current = embed.description ?? "";
    if (current.includes(`${actionLabel} by <@${interaction.user.id}>`)) return builder;
    builder.setDescription([current, "", `**${line}**`].filter(Boolean).join("\n"));
    return builder;
  });

  await interaction.message.edit({ embeds, components: [] }).catch(() => undefined);
}

async function handleStreamReviewButton(interaction: ButtonInteraction) {
  if (!interaction.isButton()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can review stream payouts.", ephemeral: true });
    return;
  }
  const parts = interaction.customId.split(":");
  const action = parts[2] === "approve" ? "approve" : "deny";
  const reviewId = parts[3];
  await interaction.deferReply({ ephemeral: true });
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
    await interaction.reply({ content: "Only authorized admins can clear EOS batches.", ephemeral: true });
    return;
  }
  const clearReason = interaction.fields.getTextInputValue(ECONOMY_ADMIN_CUSTOM_IDS.clearReasonInput);
  const result = await recApi.clearPendingEosBatch({ guildId: interaction.guildId, clearReason });
  await interaction.reply({ content: result.cleared ? "Pending EOS batch cleared. Reissue after correcting payout logic." : result.reason ?? "No pending EOS batch found.", ephemeral: true });
}

async function handleLeagueWeekSetModal(interaction: Extract<Interaction, { isModalSubmit(): boolean }>) {
  if (!interaction.isModalSubmit() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can set league week.", ephemeral: true });
    return;
  }
  const seasonStage = interaction.customId.split(":").at(-1) ?? "regular_season";
  const weekNumber = Number(interaction.fields.getTextInputValue(LEAGUE_WEEK_CUSTOM_IDS.weekInput));
  const seasonRaw = interaction.fields.getTextInputValue(LEAGUE_WEEK_CUSTOM_IDS.seasonInput).trim();
  const seasonNumber = seasonRaw ? Number(seasonRaw) : undefined;
  const result = await recApi.setLeagueWeek({ guildId: interaction.guildId, weekNumber, seasonStage, seasonNumber });
  await interaction.reply({
    content: [
      `League week set to ${seasonStage} week ${weekNumber}.`,
      result.warning ? "" : undefined,
      result.warning ? `Warning: ${result.warning}` : undefined
    ].filter(Boolean).join("\n"),
    ephemeral: true
  });
}


async function handleStartActiveCheck(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can start an Active Check.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
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
  await interaction.deferReply({ ephemeral: true });
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
  }, 10 * 60 * 1000).unref();
}
