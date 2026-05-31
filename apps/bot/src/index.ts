import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Interaction
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
  getPreviousLeagueSetupStep,
  LEAGUE_SETUP_CUSTOM_IDS,
  type LeagueSetupDraft
} from "./ui/league-setup.js";
import { NAV_CUSTOM_IDS } from "./ui/navigation.js";

/**
 * The bot stays intentionally menu-driven.
 *
 * Important navigation rule:
 * Every window should either render Back/Main Menu controls directly or include
 * the shared navigation row from ui/navigation.ts.
 */
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const leagueSetupSessions = new Map<string, LeagueSetupDraft>();

client.once("clientReady", async () => {
  console.log(`REC Bot logged in as ${client.user?.tag ?? "unknown"}`);

  try {
    const health = await recApi.health();
    console.log(`Connected to ${health.service}`);
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

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === MENU_CUSTOM_IDS.mainSelect) {
        await handleMainMenuSelect(interaction);
        return;
      }

      if (Object.values(LEAGUE_SETUP_CUSTOM_IDS).includes(interaction.customId as any)) {
        await handleLeagueSetupSelect(interaction);
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
        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("User / Team Linking")
              .setDescription("This panel is available. The full link workflow is the next build target.")
          ],
          components: []
        });
        return;
      }

      if (interaction.customId === LEAGUE_SETUP_CUSTOM_IDS.save) {
        await handleLeagueSetupSave(interaction);
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

async function buildMainMenuPayload(userId: string, isAdmin: boolean) {
  let menuEmbed = buildMainMenuEmbed({ isAdmin });

  try {
    const baseline = await recApi.getBaseline(userId);
    const record = baseline.globalRecord;
    const wallet = baseline.wallet;

    menuEmbed = buildMainMenuEmbed({
      displayName: baseline.user.display_name,
      recordText: `${record?.wins ?? 0}-${record?.losses ?? 0}-${record?.ties ?? 0}`,
      playoffText: `${record?.playoff_wins ?? 0}-${record?.playoff_losses ?? 0}`,
      superbowlText: `${record?.superbowl_wins ?? 0}-${record?.superbowl_losses ?? 0}`,
      pointDifferential: record?.point_differential ?? 0,
      wallet: wallet?.wallet_balance ?? 0,
      savings: wallet?.savings_balance ?? 0,
      isAdmin
    });
  } catch {
    // Unlinked users can still see the menu shell.
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
  await interaction.editReply(await buildMainMenuPayload(interaction.user.id, isAdmin));
}

async function renderMainMenuFromComponent(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;

  const isAdmin = isDiscordAdminInteraction(interaction);
  await interaction.update(await buildMainMenuPayload(interaction.user.id, isAdmin));
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

  switch (interaction.customId) {
    case LEAGUE_SETUP_CUSTOM_IDS.leagueType:
      draft.leagueType = interaction.values[0] as LeagueSetupDraft["leagueType"];
      draft.step = "import_mode";
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.importMode:
      draft.importMode = interaction.values[0] as LeagueSetupDraft["importMode"];
      draft.step = "features";
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
      draft.step = "draft_class_type";
      break;
    }

    case LEAGUE_SETUP_CUSTOM_IDS.draftClassType:
      draft.draftClassType = interaction.values[0] as LeagueSetupDraft["draftClassType"];
      draft.step = "streaming";
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.streamingRequirement:
      draft.streamingRequirement = interaction.values[0] as LeagueSetupDraft["streamingRequirement"];
      draft.step = "fourth_down";
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.fourthDownRule:
      draft.fourthDownRuleType = interaction.values[0] as LeagueSetupDraft["fourthDownRuleType"];
      draft.step = "gameplay";
      break;

    case LEAGUE_SETUP_CUSTOM_IDS.gameplayCore:
      applyGameplayPreset(draft, interaction.values[0]);
      draft.step = "review";
      break;
  }

  applyLeagueSetupDependencies(draft);
  leagueSetupSessions.set(interaction.user.id, draft);

  await interaction.update(buildLeagueSetupWindow(draft));
}

function applyGameplayPreset(draft: LeagueSetupDraft, preset: string) {
  if (preset === "salary_cap_on") {
    draft.difficulty = "all_madden";
    draft.quarterLengthMinutes = 8;
    draft.acceleratedClockEnabled = true;
    draft.acceleratedClockMinimumSeconds = 20;
    draft.salaryCapEnabled = true;
    draft.tradeDeadlineEnabled = false;
    draft.abilitiesEnabled = true;
    draft.wearAndTearEnabled = true;
    draft.capManagementAssistantEnabled = draft.coinEconomyEnabled;
    return;
  }

  if (preset === "casual") {
    draft.difficulty = "all_pro";
    draft.quarterLengthMinutes = 7;
    draft.acceleratedClockEnabled = true;
    draft.acceleratedClockMinimumSeconds = 20;
    draft.salaryCapEnabled = false;
    draft.tradeDeadlineEnabled = false;
    draft.abilitiesEnabled = true;
    draft.wearAndTearEnabled = false;
    return;
  }

  draft.difficulty = "all_madden";
  draft.quarterLengthMinutes = 8;
  draft.acceleratedClockEnabled = true;
  draft.acceleratedClockMinimumSeconds = 20;
  draft.salaryCapEnabled = false;
  draft.tradeDeadlineEnabled = false;
  draft.abilitiesEnabled = true;
  draft.wearAndTearEnabled = true;
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
    requestedByDiscordId: interaction.user.id
  });

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
          "",
          "Economy payouts will remain inactive until at least 8 users are verified through Discord team links and imported game users."
        ].join("\n"))
    ],
    components: buildAdminPanelRows()
  });
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

  await renderMainMenuFromComponent(interaction);
}

await client.login(env.DISCORD_TOKEN);
