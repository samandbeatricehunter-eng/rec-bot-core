import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

/**
 * Central custom IDs for the REC menu system.
 *
 * The bot should keep a single slash command: /menu. Every workflow branches
 * from these custom IDs through buttons, select menus, and modals.
 */
export const MENU_CUSTOM_IDS = {
  mainSelect: "rec:menu:main_select",
  adminServerSetup: "rec:admin:server_setup",
  adminLeagueSetup: "rec:admin:league_setup",
  adminUserTeamLinking: "rec:admin:user_team_linking",
  adminImports: "rec:admin:imports",
  adminEconomyReviews: "rec:admin:economy_reviews",
  adminWeeklyChallenges: "rec:admin:weekly_challenges",
  adminLeagueWeek: "rec:admin:league_week",
  setupModal: "rec:admin:setup_modal",
  serverSetupAcknowledgeInput: "rec:admin:server_setup_ack",
  leagueNameInput: "rec:admin:league_name_input"
} as const;

export type SetupDangerAction = "server_setup" | "league_setup";

export function buildMainMenuEmbed(input: {
  displayName?: string;
  recordText?: string;
  playoffText?: string;
  superbowlText?: string;
  pointDifferential?: number;
  wallet?: number;
  savings?: number;
  isAdmin: boolean;
}) {
  const description = input.displayName
    ? [
        `Coach: ${input.displayName}`,
        "",
        `Record: ${input.recordText ?? "0-0-0"}`,
        `Playoffs: ${input.playoffText ?? "0-0"}`,
        `Super Bowls: ${input.superbowlText ?? "0-0"}`,
        `Point Differential: ${input.pointDifferential ?? 0}`,
        "",
        `Wallet: $${input.wallet ?? 0}`,
        `Savings: $${input.savings ?? 0}`,
        "",
        input.isAdmin ? "Admin Panel available below." : "Select a department below."
      ].join("\n")
    : [
        "Your Discord account is not linked to a migrated REC Core profile yet.",
        "",
        "Select a department below."
      ].join("\n");

  return new EmbedBuilder()
    .setTitle("REC League HQ")
    .setDescription(description)
    .setFooter({ text: "REC Core connected" });
}

export function buildMainMenuRows(isAdmin: boolean) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(MENU_CUSTOM_IDS.mainSelect)
    .setPlaceholder("Select a REC department")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Rosters").setValue("rosters"),
      new StringSelectMenuOptionBuilder().setLabel("Manage My Team").setValue("manage_team"),
      new StringSelectMenuOptionBuilder().setLabel("Standings & Stats").setValue("standings_stats"),
      new StringSelectMenuOptionBuilder().setLabel("REC Bank").setValue("rec_bank"),
      new StringSelectMenuOptionBuilder().setLabel("Media Center").setValue("media_center"),
      new StringSelectMenuOptionBuilder().setLabel("Help / Rules").setValue("help_rules")
    );

  if (isAdmin) {
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Admin Panel")
        .setValue("admin_panel")
        .setDescription("Commissioner setup, imports, links, and audit tools.")
    );
  }

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

export function buildAdminPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("REC Admin Panel")
    .setDescription([
      "Choose an administrative workflow.",
      "",
      "Server Setup and League Setup will open a warning modal first because rerunning setup can affect existing league data."
    ].join("\n"));
}

export function buildAdminPanelRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(MENU_CUSTOM_IDS.adminServerSetup)
        .setLabel("Server Setup")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(MENU_CUSTOM_IDS.adminLeagueSetup)
        .setLabel("League Setup")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(MENU_CUSTOM_IDS.adminUserTeamLinking)
        .setLabel("User / Team Linking")
        .setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(MENU_CUSTOM_IDS.adminImports)
        .setLabel("Imports")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(MENU_CUSTOM_IDS.adminEconomyReviews)
        .setLabel("Economy Reviews")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(MENU_CUSTOM_IDS.adminWeeklyChallenges)
        .setLabel("Weekly Challenges")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(MENU_CUSTOM_IDS.adminLeagueWeek)
        .setLabel("League Week")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

/**
 * Discord modals only support Submit/Cancel actions. This modal uses the
 * Discord-provided Submit button as "Continue" and the Cancel/X controls as
 * "Cancel". No typed confirmation is required.
 */
export function buildSetupDangerModal(action: SetupDangerAction) {
  const actionLabel = action === "server_setup" ? "Server Setup" : "League Setup";

  const modal = new ModalBuilder()
    .setCustomId(`${MENU_CUSTOM_IDS.setupModal}:${action}`)
    .setTitle(`${actionLabel} Warning`);

  if (action === "league_setup") {
    const leagueNameInput = new TextInputBuilder()
      .setCustomId(MENU_CUSTOM_IDS.leagueNameInput)
      .setLabel("League Name")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("Use exact in-game Madden league name if known.");

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(leagueNameInput));
    return modal;
  }

  const acknowledgementInput = new TextInputBuilder()
    .setCustomId(MENU_CUSTOM_IDS.serverSetupAcknowledgeInput)
    .setLabel("Submit continues setup. Cancel stops here.")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Rerunning setup may overwrite server routing/configuration.");

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(acknowledgementInput));
  return modal;
}
