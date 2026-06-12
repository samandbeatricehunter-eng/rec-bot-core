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
  adminSelect: "rec:admin:select",
  adminServerSetup: "rec:admin:server_setup",
  adminLeagueSetup: "rec:admin:league_setup",
  adminUserTeamLinking: "rec:admin:user_team_linking",
  adminImportEnterData: "rec:admin:import_enter_data",
  adminImports: "rec:admin:imports",
  adminAdvanceMenu: "rec:admin:advance_menu",
  adminWeeklyChallenges: "rec:admin:weekly_challenges",
  adminLeagueWeek: "rec:admin:league_week",
  adminActiveCheck: "rec:admin:active_check",
  adminRules: "rec:admin:rules",
  adminReselectGotw: "rec:admin:reselect_gotw",
  commissionerToolsSelect: "rec:admin:commissioner_tools_select",
  manageLeagueSelect: "rec:admin:manage_league_select",
  setupModal: "rec:admin:setup_modal",
  serverSetupAcknowledgeInput: "rec:admin:server_setup_ack",
  leagueNameInput: "rec:admin:league_name_input"
} as const;

// Custom IDs for the Rosters submenu
export const ROSTERS_CUSTOM_IDS = {
  select: "rec:rosters:select",
  // User Snapshots paginated viewer — page nav buttons
  snapshotPrev: "rec:rosters:snapshot_prev",
  snapshotNext: "rec:rosters:snapshot_next",
  snapshotBack: "rec:rosters:snapshot_back",
  // User selector dropdown
  snapshotUserSelect: "rec:rosters:snapshot_user_select",
  // View Rosters by Team flow
  conferenceSelect: "rec:rosters:conference_select",
  teamSelect: "rec:rosters:team_select",
  rosterBackToConf: "rec:rosters:back_to_conferences"
} as const;

// Custom IDs for the REC Bank dropdown
export const REC_BANK_CUSTOM_IDS = {
  select: "rec:bank:select",
  // Modals for savings transfers
  toSavingsModal: "rec:bank:to_savings_modal",
  fromSavingsModal: "rec:bank:from_savings_modal",
  toSavingsAmountInput: "rec:bank:to_savings_amount",
  fromSavingsAmountInput: "rec:bank:from_savings_amount"
} as const;

export type SetupDangerAction = "server_setup" | "league_setup";

function formatRoleLabel(role?: string | null) {
  if (role === "commissioner") return "Commissioner";
  if (role === "co_commissioner" || role === "comp_committee") return "Comp Committee";
  if (role === "member" || role === "approved_member") return "Approved Member";
  return "None";
}


function formatChallenge(challenge?: { s_tier_goal?: string; a_tier_goal?: string; b_tier_goal?: string } | null) {
  if (!challenge) return "Not generated yet";
  return [`S: ${challenge.s_tier_goal ?? "Not set"} ($50)`, `A: ${challenge.a_tier_goal ?? "Not set"} ($25)`, `B: ${challenge.b_tier_goal ?? "Win the game"} ($10)`].join("\n");
}

// Shows the 3 most recently earned badges; the full list lives in Rosters > User Snapshots.
function formatBadgePreview(badges?: Array<{ name?: string; badge_name?: string; label?: string; tier?: string }>) {
  if (!badges?.length) return "None yet — view all via Rosters > User Snapshots";
  const preview = badges.slice(0, 3).map((badge) => {
    const name = badge.name ?? badge.badge_name ?? badge.label ?? "Badge";
    return badge.tier ? `${name} (${badge.tier})` : name;
  });
  const suffix = badges.length > 3 ? `\n+${badges.length - 3} more — view all via Rosters > User Snapshots` : "";
  return preview.join("\n") + suffix;
}

export function buildMainMenuEmbed(input: {
  discordUsername?: string;
  teamName?: string | null;
  highestRole?: string | null;
  wallet?: number;
  savings?: number;
  leagueName?: string;
  seasonNumber?: number | string | null;
  currentWeek?: number | string | null;
  seasonStage?: string | null;
  leagueSeasonRecordText?: string;
  leagueSeasonPointDifferential?: number;
  currentMatchupText?: string;
  gotwStatus?: string;
  gotwVotingRecordText?: string;
  offensiveChallenge?: { s_tier_goal?: string; a_tier_goal?: string; b_tier_goal?: string } | null;
  defensiveChallenge?: { s_tier_goal?: string; a_tier_goal?: string; b_tier_goal?: string } | null;
  globalRecordText?: string;
  globalPlayoffText?: string;
  globalSuperbowlText?: string;
  globalPointDifferential?: number;
  badges?: Array<{ name?: string; badge_name?: string; label?: string; tier?: string }>;
  isAdmin: boolean;
}) {
  const userText = input.discordUsername ?? "Unlinked User";
  const teamText = input.teamName ?? "None";
  const roleText = formatRoleLabel(input.highestRole);
  const seasonText = input.seasonNumber ?? "?";
  const weekText = input.currentWeek ?? "?";
  const stageText = input.seasonStage ? String(input.seasonStage).replaceAll("_", " ") : "regular season";

  const description = [
    `User: ${userText}`,
    `Team: ${teamText}`,
    `Role: ${roleText}`,
    `Wallet: $${input.wallet ?? 0}`,
    `Savings: $${input.savings ?? 0}`,
    "",
    "**League Data**",
    `League: ${input.leagueName ?? "Current League"}`,
    `Season ${seasonText}, Week ${weekText}`,
    `Stage: ${stageText}`,
    `Season Record: ${input.leagueSeasonRecordText ?? "0-0-0"}`,
    `Season Point Differential: ${input.leagueSeasonPointDifferential ?? 0}`,
    `Current Matchup: ${input.currentMatchupText ?? "None"}`,
    `Game of the Week: ${input.gotwStatus ?? "No"}`,
    `GOTW Voting Record: ${input.gotwVotingRecordText ?? "No votes yet"}`,
    "",
    "**Current Weekly Challenges**",
    "Offense:",
    formatChallenge(input.offensiveChallenge),
    "",
    "Defense:",
    formatChallenge(input.defensiveChallenge),
    "",
    "**Global Data**",
    `Global Record: ${input.globalRecordText ?? "0-0-0"}`,
    `Global Playoffs: ${input.globalPlayoffText ?? "0-0"}`,
    `Global Super Bowls: ${input.globalSuperbowlText ?? "0-0"}`,
    `Global Point Differential: ${input.globalPointDifferential ?? 0}`,
    "",
    "**Recent Badges**",
    formatBadgePreview(input.badges),
    "",
    "**Menu Guide**",
    "Use Rosters below to view players, rosters, and your full badge history (User Snapshots).",
    "Use Manage My Team to manage purchases, players and other facets of your team.",
    "Use Standings & Stats to view league standings, player/team stats and other details of this league.",
    "Use REC Bank to move funds between your savings and wallet.",
    "Use Media Center to vote on Play of the Year nominations, Game of the Year nominations and review historical data from this league.",
    "Use Help / Rules to view league rules and FAQs for more info.",
    "If you're an admin/commissioner/co-commissioner, use Admin Menu to view the Admin controls."
  ].join("\n");

  return new EmbedBuilder()
    .setTitle("REC League HQ")
    .setDescription(description.slice(0, 4096));
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
      "Choose an administrative workflow from the dropdown below.",
      "",
      "Server Setup and League Setup will open a warning modal first because rerunning setup can affect existing league data."
    ].join("\n"));
}

// Top-level Admin Panel: only two workflows. Everything else is nested under
// Commissioner Tools to keep the top level shallow.
export function buildAdminPanelRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(MENU_CUSTOM_IDS.adminSelect)
    .setPlaceholder("Select an admin workflow")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Import / Enter Data").setValue("import_enter_data").setDescription("Imports, companion exports, manual data, and import history."),
      new StringSelectMenuOptionBuilder().setLabel("Commissioner Tools").setValue("commissioner_tools").setDescription("Advance, league management, server setup, and the league setup wizard."),
      new StringSelectMenuOptionBuilder().setLabel("Back to Main Menu").setValue("main_menu")
    );

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

// Commissioner Tools submenu (Admin Panel -> Commissioner Tools).
export function buildCommissionerToolsRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(MENU_CUSTOM_IDS.commissionerToolsSelect)
    .setPlaceholder("Select a commissioner tool")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Advance Menu").setValue("advance_menu").setDescription("Advance, catch-up, week/stage, channels, challenges, and audit tools."),
      new StringSelectMenuOptionBuilder().setLabel("Manage League").setValue("manage_league").setDescription("Active checks, rules, user/team linking, and league settings."),
      new StringSelectMenuOptionBuilder().setLabel("Server Setup").setValue("server_setup").setDescription("Register/update this Discord server."),
      new StringSelectMenuOptionBuilder().setLabel("League Setup Wizard").setValue("league_setup").setDescription("Create/update league settings (full wizard)."),
      new StringSelectMenuOptionBuilder().setLabel("Back to Main Menu").setValue("main_menu")
    );

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

// Manage League submenu (Commissioner Tools -> Manage League).
export function buildManageLeagueRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(MENU_CUSTOM_IDS.manageLeagueSelect)
    .setPlaceholder("Select a league management tool")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Active Check").setValue("active_check").setDescription("Post a 24-hour activity confirmation check."),
      new StringSelectMenuOptionBuilder().setLabel("View / Edit Rules").setValue("rules").setDescription("Review the REC rule base and editable league rule settings."),
      new StringSelectMenuOptionBuilder().setLabel("User / Team Linking").setValue("user_team_linking").setDescription("Link Discord users to Madden teams."),
      new StringSelectMenuOptionBuilder().setLabel("Edit League Settings").setValue("edit_league_settings").setDescription("Adjust individual settings without re-running the full wizard."),
      new StringSelectMenuOptionBuilder().setLabel("Back to Commissioner Tools").setValue("commissioner_tools")
    );

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

/**
 * Discord modals only support Submit/Cancel actions. This modal uses the
 * Discord-provided Submit button as "Continue" and the Cancel/X controls as
 * "Cancel". No typed confirmation is required.
 */
/**
 * Build setup modal for server or league configuration
 * Server setup: Simple acknowledgement, no warning (just configures channels/roles)
 * League setup: Requires league name input (creates new league record)
 */
export function buildSetupDangerModal(action: SetupDangerAction) {
  const modal = new ModalBuilder()
    .setCustomId(`${MENU_CUSTOM_IDS.setupModal}:${action}`);

  if (action === "league_setup") {
    // League setup modal with warning (creates new league, may be destructive)
    modal.setTitle("League Setup");

    const leagueNameInput = new TextInputBuilder()
      .setCustomId(MENU_CUSTOM_IDS.leagueNameInput)
      .setLabel("League Name (Required)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("Use exact in-game Madden league name if known.");

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(leagueNameInput));
    return modal;
  }

  // Server setup modal (no warning - just configures channels/roles, not destructive)
  modal.setTitle("Server Setup");

  const acknowledgementInput = new TextInputBuilder()
    .setCustomId(MENU_CUSTOM_IDS.serverSetupAcknowledgeInput)
    .setLabel("Ready to configure channels?")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Press Submit to proceed to channel configuration.");

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(acknowledgementInput));
  return modal;
}

// ── Rosters submenu ───────────────────────────────────────────────────────────

export function buildRostersMenuEmbed() {
  return new EmbedBuilder()
    .setTitle("Rosters")
    .setDescription([
      "Browse rosters, players, and coach profiles for this league.",
      "",
      "**View Rosters by Team** — Full depth chart by team, sorted by position group",
      "**View Players by Position** — Filter all players by position group (coming soon)",
      "**View User Snapshots** — Season & global records, badges, power ranking, awards, and GOTW history for any linked coach"
    ].join("\n"));
}

export function buildRostersMenuRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(ROSTERS_CUSTOM_IDS.select)
    .setPlaceholder("Choose a roster view")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("View Rosters by Team").setValue("rosters_by_team").setDescription("Browse full team depth charts by position group"),
      new StringSelectMenuOptionBuilder().setLabel("View Players by Position").setValue("players_by_position").setDescription("Filter players by position group (coming soon)"),
      new StringSelectMenuOptionBuilder().setLabel("View User Snapshots").setValue("user_snapshots").setDescription("Season & global stats, badges, awards, GOTW history for any coach"),
      new StringSelectMenuOptionBuilder().setLabel("Back to Main Menu").setValue("rosters_back")
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

// Builds the user selector dropdown for the User Snapshots viewer.
// coaches: array of { userId, discordId, displayName, teamName } from /v1/guilds/:guildId/coaches
export function buildSnapshotUserSelectRows(coaches: Array<{ userId: string; discordId?: string | null; displayName: string; teamName?: string | null }>) {
  const options = coaches.slice(0, 25).map((coach) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${coach.teamName ?? coach.displayName}`.slice(0, 100))
      .setValue(coach.discordId ?? coach.userId)
      .setDescription((`${coach.displayName}` + (coach.teamName ? ` — ${coach.teamName}` : "")).slice(0, 100))
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(ROSTERS_CUSTOM_IDS.snapshotUserSelect)
    .setPlaceholder("Select a coach to view their snapshot")
    .addOptions(options);
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

// ── REC Bank rows ─────────────────────────────────────────────────────────────

// The bank embed already shows balances and transactions; these rows power the action menu.
export function buildRecBankRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(REC_BANK_CUSTOM_IDS.select)
    .setPlaceholder("Choose a bank action")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Transfer to Savings").setValue("to_savings").setDescription("Move funds from your wallet into savings"),
      new StringSelectMenuOptionBuilder().setLabel("Transfer from Savings").setValue("from_savings").setDescription("Move funds from savings back to your wallet"),
      new StringSelectMenuOptionBuilder().setLabel("Place a Wager").setValue("place_wager").setDescription("Wager coins on an upcoming game (coming soon)"),
      new StringSelectMenuOptionBuilder().setLabel("Back to Main Menu").setValue("bank_back")
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

// ── Savings transfer modals ───────────────────────────────────────────────────

export function buildToSavingsModal() {
  const modal = new ModalBuilder().setCustomId(REC_BANK_CUSTOM_IDS.toSavingsModal).setTitle("Transfer to Savings");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(REC_BANK_CUSTOM_IDS.toSavingsAmountInput).setLabel("Amount to move to savings").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("e.g. 50")
    )
  );
  return modal;
}

export function buildFromSavingsModal() {
  const modal = new ModalBuilder().setCustomId(REC_BANK_CUSTOM_IDS.fromSavingsModal).setTitle("Transfer from Savings");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(REC_BANK_CUSTOM_IDS.fromSavingsAmountInput).setLabel("Amount to withdraw from savings").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("e.g. 50")
    )
  );
  return modal;
}
