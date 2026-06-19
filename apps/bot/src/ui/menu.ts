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
  openTeams: "rec:menu:open_teams",
  schedule: "rec:menu:schedule",
  scheduleSelectTeam: "rec:schedule:select_team",
  scheduleSos: "rec:schedule:sos",
  scheduleHistory: "rec:schedule:history",
  scheduleBack: "rec:schedule:back",
  makePurchase: "rec:menu:make_purchase",
  viewUserProfiles: "rec:menu:view_user_profiles",
  stream: "rec:menu:stream",
  streamBack: "rec:stream:back",
  uploadBoxScore: "rec:menu:upload_box_score",
  uploadScoringSummary: "rec:menu:upload_scoring_summary",
  helpRules: "rec:menu:help_rules",
  leagueMgmt: "rec:menu:league_mgmt",
  requestTeam: "rec:teams:request",
  teamsBack: "rec:teams:back",
  teamsPage: "rec:teams:page",
  adminSelect: "rec:admin:select",
  adminServerSetup: "rec:admin:server_setup",
  adminLeagueSetup: "rec:admin:league_setup",
  adminImportEnterData: "rec:admin:import_enter_data",
  adminImports: "rec:admin:imports",
  adminAdvanceMenu: "rec:admin:advance_menu",
  adminWeeklyChallenges: "rec:admin:weekly_challenges",
  adminLeagueWeek: "rec:admin:league_week",
  adminActiveCheck: "rec:admin:active_check",
  adminRules: "rec:admin:rules",
  adminReselectGotw: "rec:admin:reselect_gotw",
  leagueMgmtTeams: "rec:league_mgmt:teams",
  leagueMgmtSchedule: "rec:league_mgmt:schedule",
  leagueMgmtAdvance: "rec:league_mgmt:advance",
  leagueMgmtSettings: "rec:league_mgmt:settings",
  leagueMgmtFirstTimeSetup: "rec:league_mgmt:first_time_setup",
  leagueMgmtDeleteLeague: "rec:league_mgmt:delete_league",
  leagueMgmtRoles: "rec:league_mgmt:roles",
  leagueMgmtBack: "rec:league_mgmt:back",
  commissionerToolsSelect: "rec:admin:commissioner_tools_select",
  manageLeagueSelect: "rec:admin:manage_league_select",
  serverLeagueSetupSelect: "rec:admin:server_league_setup_select",
  eosFunctionsSelect: "rec:admin:eos_functions_select",
  setupModal: "rec:admin:setup_modal",
  serverSetupAcknowledgeInput: "rec:admin:server_setup_ack",
  leagueNameInput: "rec:admin:league_name_input",
  deleteLeagueConfirm: "rec:admin:delete_league_confirm",
  deleteLeagueCancel: "rec:admin:delete_league_cancel",
  deleteLeagueModal: "rec:admin:delete_league_modal",
  deleteLeagueNameInput: "rec:admin:delete_league_name_input",
  // Main-menu Row 1 buttons
  transferFunds: "rec:menu:transfer_funds",
  placeWager: "rec:menu:place_wager",
  manageWallet: "rec:menu:manage_wallet"
} as const;

// Custom IDs for the Manage My Wallet ephemeral.
export const MANAGE_WALLET_CUSTOM_IDS = {
  toSavings: "rec:wallet:to_savings",
  fromSavings: "rec:wallet:from_savings",
  pendingPurchases: "rec:wallet:pending_purchases",
  makePurchase: "rec:wallet:make_purchase",
  transfer: "rec:wallet:transfer",
  transferDirection: "rec:wallet:transfer_direction",
  transferAll: "rec:wallet:transfer_all",
  transferCustom: "rec:wallet:transfer_custom",
  transferCustomModal: "rec:wallet:transfer_custom_modal",
  transferCustomAmountInput: "rec:wallet:transfer_custom_amount",
  transactions: "rec:wallet:transactions",
  back: "rec:wallet:back"
} as const;

export const STREAM_CUSTOM_IDS = {
  serviceSelect: "rec:stream:service",
  linkModal: "rec:stream:link_modal",
  linkInput: "rec:stream:link"
} as const;

// Custom IDs for the User Profiles viewer.
export const ROSTERS_CUSTOM_IDS = {
  snapshotPrev: "rec:rosters:snapshot_prev",
  snapshotNext: "rec:rosters:snapshot_next",
  snapshotBack: "rec:rosters:snapshot_back",
  snapshotConferenceSelect: "rec:profiles:conference_select",
  snapshotTeamSelect: "rec:profiles:team_select"
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

// Shows the 3 most recently earned badges; the full list lives in User Profiles.
function formatBadgePreview(badges?: Array<{ name?: string; badge_name?: string; label?: string; tier?: string }>) {
  if (!badges?.length) return "None yet — view all via User Profiles";
  const preview = badges.slice(0, 3).map((badge) => {
    const name = badge.name ?? badge.badge_name ?? badge.label ?? "Badge";
    return badge.tier ? `${name} (${badge.tier})` : name;
  });
  const suffix = badges.length > 3 ? `\n+${badges.length - 3} more — view all via User Profiles` : "";
  return preview.join("\n") + suffix;
}

// Lists up to the 10 most recently earned badges. NOTE: Discord embeds have no hover tooltips, so
// each badge shows name + tier inline; richer descriptions would need a badge catalog lookup.
function formatTop10Badges(badges?: Array<{ name?: string; badge_name?: string; label?: string; tier?: string }>) {
  if (!badges?.length) return "No badges earned yet.";
  return badges
    .slice(0, 10)
    .map((badge, i) => {
      const name = badge.label ?? badge.name ?? badge.badge_name ?? "Badge";
      return `${i + 1}. ${name}${badge.tier ? ` (${badge.tier})` : ""}`;
    })
    .join("\n");
}

const MENU_GUIDE_LINES = [
  "**User Profiles** — View user profiles for league members.",
  "**Manage My Franchise** — View & manage your roster, purchase upgrades and utilize management tools.",
  "**Standings & Stats** — View League Standings, current and career stats and other league details.",
  "**REC Sports Network** — View GOTW, GOTY & POTY (Play of the Year) nominations & records.",
  "**Rules/FAQ** — View league rules & find answers to any frequently asked questions."
];

const ZERO_WIDTH = "​";

export function buildMainMenuEmbed(input: {
  discordUsername?: string;
  teamName?: string | null;
  highestRole?: string | null;
  wallet?: number;
  savings?: number;
  projectedInterest?: number;
  leagueName?: string;
  seasonNumber?: number | string | null;
  currentWeek?: number | string | null;
  seasonStage?: string | null;
  leagueSeasonRecordText?: string;
  leagueSeasonPointDifferential?: number;
  currentMatchupText?: string;
  youAreText?: string;
  matchupType?: string;
  opponentName?: string | null;
  opponentRecordText?: string;
  opponentPointDifferential?: number;
  opponentStreakText?: string;
  userStreakText?: string;
  gotwStatus?: string;
  gotwH2hRecordText?: string;
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
  const userInfo = [
    `User: ${input.discordUsername ?? "Unlinked User"}`,
    `Wallet: $${input.wallet ?? 0}`,
    `Savings: $${input.savings ?? 0}`,
    `Proj. Interest: $${input.projectedInterest ?? 0}`,
    `Role: ${formatRoleLabel(input.highestRole)}`
  ].join("\n");

  const globalInfo = [
    `Global Record: ${input.globalRecordText ?? "0-0-0"}`,
    `Global Playoffs: ${input.globalPlayoffText ?? "0-0"}`,
    `Global Super Bowls: ${input.globalSuperbowlText ?? "0-0"}`,
    `Global Point Differential: ${input.globalPointDifferential ?? 0}`
  ].join("\n");

  const leagueInfo = [
    `Team: ${input.teamName ?? "None"}`,
    `Season ${input.seasonNumber ?? "?"}, Week ${input.currentWeek ?? "?"}`,
    `Game of the Week: ${input.gotwStatus ?? "No"}`,
    `GOTW H2H Record: ${input.gotwH2hRecordText ?? "No GOTW games yet"}`,
    `GOTW Voting Record: ${input.gotwVotingRecordText ?? "No votes yet"}`,
    `Season Record: ${input.leagueSeasonRecordText ?? "0-0-0"}`,
    `Point Differential: ${input.leagueSeasonPointDifferential ?? 0}`,
    `Streak: ${input.userStreakText ?? "—"}`
  ].join("\n");

  const matchupInfo = [
    `You're: ${input.youAreText ?? "BYE WEEK"}`,
    `Type: ${input.matchupType ?? "NONE"}`,
    `Opponent: ${input.opponentName ?? "None"}`,
    `Opponent Record: ${input.opponentRecordText ?? "—"}`,
    `Point Differential: ${input.opponentPointDifferential ?? 0}`,
    `Streak: ${input.opponentStreakText ?? "—"}`
  ].join("\n");

  const spacer = { name: ZERO_WIDTH, value: ZERO_WIDTH, inline: true };

  return new EmbedBuilder()
    .setTitle(input.leagueName ? `${input.leagueName} — HQ` : "REC League HQ")
    .addFields(
      { name: "👤 User Info", value: userInfo.slice(0, 1024), inline: true },
      { name: "🌎 Global Info", value: globalInfo.slice(0, 1024), inline: true },
      spacer,
      { name: "🏟️ League Info", value: leagueInfo.slice(0, 1024), inline: true },
      { name: "📅 Matchup Info", value: matchupInfo.slice(0, 1024), inline: true },
      spacer,
      { name: "🏈 Matchup Challenge · Offense", value: formatChallenge(input.offensiveChallenge).slice(0, 1024), inline: true },
      { name: "🛡️ Matchup Challenge · Defense", value: formatChallenge(input.defensiveChallenge).slice(0, 1024), inline: true },
      spacer,
      { name: "🏅 Top 10 Badges", value: formatTop10Badges(input.badges).slice(0, 1024), inline: false },
      { name: "📖 Menu Guide", value: MENU_GUIDE_LINES.join("\n").slice(0, 1024), inline: false }
    )
    .setFooter({ text: "Use the buttons below to move funds, place a wager, or manage your transactions." });
}

export function buildMainMenuRows(isAdmin: boolean) {
  // Row 1: wallet/wager action buttons (replace the former REC Bank top-level entry).
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.transferFunds).setLabel("Transfer Funds").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.placeWager).setLabel("Place a Wager").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.manageWallet).setLabel("Manage My Wallet").setStyle(ButtonStyle.Secondary)
  );

  // Row 2: department selector.
  const select = new StringSelectMenuBuilder()
    .setCustomId(MENU_CUSTOM_IDS.mainSelect)
    .setPlaceholder("Select a REC department")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("User Profiles").setValue("rosters").setDescription("View league member profiles."),
      new StringSelectMenuOptionBuilder().setLabel("Manage My Franchise").setValue("manage_franchise").setDescription("Your team, lineup, contracts, badges, and store (coming soon)."),
      new StringSelectMenuOptionBuilder().setLabel("Standings & Stats").setValue("standings_stats").setDescription("League standings, leaderboards, and power rankings (coming soon)."),
      new StringSelectMenuOptionBuilder().setLabel("REC Sports Network").setValue("rec_sports_network").setDescription("Streams, highlights, and award showcases (coming soon)."),
      new StringSelectMenuOptionBuilder().setLabel("Rules / FAQ").setValue("rules_faq").setDescription("League rules and frequently asked questions (coming soon).")
    );

  if (isAdmin) {
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Admin Panel")
        .setValue("admin_panel")
        .setDescription("Commissioner setup, imports, links, and audit tools.")
    );
  }

  return [buttonRow, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function formatLeagueStage(value?: string | null) {
  const stage = String(value ?? "regular_season");
  if (stage === "regular_season") return "Regular Season";
  if (stage === "preseason_training_camp") return "Training Camp";
  return stage
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatMenuSeasonWeek(input: { seasonNumber?: number | string | null; currentWeek?: number | string | null; seasonStage?: string | null }) {
  const season = input.seasonNumber ?? "?";
  const stage = String(input.seasonStage ?? "regular_season");
  if (stage === "regular_season") return `Season ${season}, Week ${input.currentWeek ?? "?"}`;
  return `Season ${season}, ${formatLeagueStage(stage)}`;
}

export function buildLeagueMenuEmbed(input: {
  discordUsername?: string;
  teamName?: string | null;
  wallet?: number | string;
  savings?: number | string;
  projectedInterest?: number | string;
  leagueName?: string;
  seasonNumber?: number | string | null;
  currentWeek?: number | string | null;
  seasonStage?: string | null;
  leagueSeasonRecordText?: string;
  leagueSeasonPointDifferential?: number;
  userStreakText?: string;
  purchaseCapsActive?: boolean;
  purchaseCaps?: Array<{ label: string; purchased?: number | null; allowed?: number | null }>;
  hideLeagueInfo?: boolean;
  noticeText?: string;
}) {
  const userInfo = [
    `**User:** ${input.discordUsername ?? "Unlinked User"}`,
    `**Wallet:** ${typeof input.wallet === "string" ? input.wallet : `$${input.wallet ?? 0}`}`,
    `**Savings:** ${typeof input.savings === "string" ? input.savings : `$${input.savings ?? 0}`}`,
    `**Proj. Interest:** ${typeof input.projectedInterest === "string" ? input.projectedInterest : `$${input.projectedInterest ?? 0}`}`
  ].join("\n");

  const leagueInfo = [
    `**Team:** ${input.teamName ?? "None"}`,
    `**Szn/Wk:** ${formatMenuSeasonWeek(input)}`,
    `**Record:** ${input.leagueSeasonRecordText ?? "0-0-0"}`,
    `**Streak:** ${input.userStreakText ?? "-"}`,
    `**PointDiff:** ${input.leagueSeasonPointDifferential ?? 0}`
  ].join("\n");

  const purchaseCaps = input.purchaseCapsActive && input.purchaseCaps?.length
    ? input.purchaseCaps.map((cap) => `**${cap.label}:** ${cap.purchased ?? 0}/${cap.allowed ?? 0}`).join("\n")
    : null;

  const menuText = [
    "Please use the buttons below to navigate to your destination.",
    "**Teams** - Displays open teams and allows a user to request a team.",
    "**Schedule** - Displays the season schedule, by league week, for each team.",
    "**Help/Rules** - Find a list of all league rules and various FAQ here.",
    "**My Wallet** - Move funds to/from savings, send funds to/from users.",
    "**Purchase** - Make a variety of purchases, depending on league settings.",
    "**Wager** - Put your money where your mouth is against users or the house.",
    "**Stream** - Post a stream link or select Discord streaming options.",
    "**Box Score & Scoring Summary** - Upload game screenshots to log results, details, payouts, and story generation.",
    "**View User Profiles** - View user profiles for actively linked users in this league.",
    "**League Mgmt** - Admin Only. Use this menu to manage this league."
  ].join("\n");

  return new EmbedBuilder()
    .setTitle(input.leagueName ? `${input.leagueName} Menu` : "REC League Menu")
    .addFields(
      { name: "USER INFO", value: userInfo.slice(0, 1024), inline: false },
      ...(input.hideLeagueInfo ? [] : [{ name: "LEAGUE INFO", value: leagueInfo.slice(0, 1024), inline: false }]),
      ...(input.noticeText ? [{ name: "NOTICE", value: input.noticeText.slice(0, 1024), inline: false }] : []),
      ...(!input.hideLeagueInfo && purchaseCaps ? [{ name: "PURCHASE CAPS", value: purchaseCaps.slice(0, 1024), inline: false }] : []),
      { name: "MENU", value: menuText.slice(0, 1024), inline: false }
    )
    .setFooter({ text: "Powered by the REC Scout bot © 2026" });
}

export function buildLeagueMenuRows(_isAdmin: boolean, isLinkedToTeam = true) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.openTeams).setLabel("Teams").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.schedule).setLabel("Schedule").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.helpRules).setLabel("Help/Rules").setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.manageWallet).setLabel("My Wallet").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.makePurchase).setLabel("Purchase").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.placeWager).setLabel("Wager").setStyle(ButtonStyle.Success)
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.stream).setLabel("Stream").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.uploadBoxScore).setLabel("Box Score & Scoring Summary").setStyle(ButtonStyle.Primary)
  );
  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.viewUserProfiles).setLabel("User Profiles").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmt).setLabel("League Mgmt").setStyle(ButtonStyle.Danger)
  );
  return isLinkedToTeam ? [row1, row2, row3, row4] : [row1, row4];
}

export function buildAdminPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("League Mgmt")
    .setDescription([
      "From this menu, you can manage your league in a variety of ways.",
      "",
      "**Teams** - Add/Remove users and teams (custom/relocated) from the league.",
      "**Schedule** - Submit schedule screenshots, box scores, award races, summaries, etc. for the league.",
      "**Advance** - Advance the current league week/stage to the next using the Advance Wizard.",
      "**Settings** - Change league settings, repair issues within the league such as automated features not triggering, etc.",
      "**First-Time Setup** - Wizard for setting up your league for the first time. **WARNING** This will clear ALL league data if ran more than once.",
      "**Delete League** - This will delete all league data for this server. Use this when your league is done and/or you're starting a new league in the same server.",
      "**Roles** - Change users assigned roles to one of the three designated server roles."
    ].join("\n"));
}

export function buildAdminPanelRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtTeams).setLabel("Teams").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSchedule).setLabel("Schedule").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvance).setLabel("Advance").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSettings).setLabel("Settings").setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtFirstTimeSetup).setLabel("First-Time Setup").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtDeleteLeague).setLabel("Delete League").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtRoles).setLabel("Roles").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtBack).setLabel("Back to Menu").setStyle(ButtonStyle.Secondary)
    )
  ];
}

// Commissioner Tools submenu (Admin Panel -> Commissioner Tools).
export function buildCommissionerToolsRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(MENU_CUSTOM_IDS.commissionerToolsSelect)
    .setPlaceholder("Select a commissioner tool")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Manage League").setValue("manage_league").setDescription("Active checks, rules, user/team linking, and league settings."),
      new StringSelectMenuOptionBuilder().setLabel("Server / League Setup").setValue("server_league_setup").setDescription("Channel links, first-time setup, and setup tools."),
      new StringSelectMenuOptionBuilder().setLabel("Back to Admin Panel").setValue("admin_panel")
    );

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

// Manage League submenu (Commissioner Tools -> Manage League).
export function buildManageLeagueRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(MENU_CUSTOM_IDS.manageLeagueSelect)
    .setPlaceholder("Select a league management tool")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("User / Team Linking").setValue("user_team_linking").setDescription("Link Discord users to Madden teams."),
      new StringSelectMenuOptionBuilder().setLabel("Troubleshoot Advance").setValue("troubleshoot_advance").setDescription("Repair failed advance steps, GOTW, channels, DMs, and records."),
      new StringSelectMenuOptionBuilder().setLabel("EOS Functions").setValue("eos_functions").setDescription("Run EOS polls, awards, and payout actions."),
      new StringSelectMenuOptionBuilder().setLabel("Active Check").setValue("active_check").setDescription("Post a 24-hour activity confirmation check."),
      new StringSelectMenuOptionBuilder().setLabel("Edit League Settings").setValue("edit_league_settings").setDescription("Edit league settings and rules."),
      new StringSelectMenuOptionBuilder().setLabel("Back to Commissioner Tools").setValue("commissioner_tools")
    );

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

export function buildServerLeagueSetupRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(MENU_CUSTOM_IDS.serverLeagueSetupSelect)
    .setPlaceholder("Select a setup workflow")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Server Setup").setValue("server_setup").setDescription("Assign channels/categories used by bot features."),
      new StringSelectMenuOptionBuilder().setLabel("League Setup Wizard").setValue("league_setup").setDescription("Create/update league setup through the full wizard."),
      new StringSelectMenuOptionBuilder().setLabel("Delete League Data").setValue("delete_league").setDescription("Permanently erase this league's data and user links."),
      new StringSelectMenuOptionBuilder().setLabel("Back to Commissioner Tools").setValue("commissioner_tools")
    );

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

// Step 1 of league deletion: a warning embed naming the league and what is erased, with a red
// confirm button that opens the typed-confirmation modal.
export function buildDeleteLeagueWarningPayload(leagueName: string) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚠️ Delete League Data — Permanent")
        .setColor(0xe74c3c)
        .setDescription([
          `This will **permanently erase** the league **${leagueName}** from REC. This cannot be undone.`,
          "",
          "**Deleted:** all teams, rosters, records, standings, payouts/economy ledger for this league, badges, awards, GOTW polls, game channels data, imports, settings/rules, and every user-to-team link in this league.",
          "**Kept:** each member's Discord account, global career record, wallet balance, and legacy history — and the Discord server itself.",
          "",
          "Use this to wipe a league that needs to start over before it goes inactive. After deletion you can run the League Setup Wizard to set up a new league.",
          "",
          "Press **Delete League Data** to confirm by typing the league name, or **Cancel**."
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.deleteLeagueCancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.deleteLeagueConfirm).setLabel("Delete League Data").setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

// Step 2: typed-confirmation modal. The commissioner must type the league name exactly.
export function buildDeleteLeagueModal(leagueName: string) {
  return new ModalBuilder()
    .setCustomId(MENU_CUSTOM_IDS.deleteLeagueModal)
    .setTitle("Delete League Data")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(MENU_CUSTOM_IDS.deleteLeagueNameInput)
          .setLabel("Type the league name to confirm")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder(leagueName.slice(0, 100))
      )
    );
}

export function buildEosFunctionsRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(MENU_CUSTOM_IDS.eosFunctionsSelect)
    .setPlaceholder("Select an EOS function")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Run EOS Polls & Awards").setValue("run_eos_polls_and_awards").setDescription("Post community polls and REC Awards voting."),
      new StringSelectMenuOptionBuilder().setLabel("Issue EOS Payouts").setValue("issue_eos_payouts").setDescription("Issue end-of-season payouts."),
      new StringSelectMenuOptionBuilder().setLabel("Back to Manage League").setValue("manage_league")
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

// ── Teams and user profiles ───────────────────────────────────────────────────

export type RosterTeam = {
  id: string;
  name: string;
  abbreviation?: string | null;
  division?: string | null;
  linkedDiscordId?: string | null;
  linkedName?: string | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  pointDifferential?: number | null;
  recordText?: string | null;
};
export type RosterConference = {
  conference: string;
  divisions: Array<{ division: string; label: string; teams: RosterTeam[] }>;
};

// A linked team shows its coach as a Discord mention (renders as @nickname); unlinked teams show the team name.
function teamNickname(name?: string | null) {
  const text = String(name ?? "").trim();
  if (!text) return "Team";
  const parts = text.split(/\s+/);
  return parts[parts.length - 1] || text;
}

function maddenTeamLine(team: RosterTeam) {
  const record = team.recordText ?? `${team.wins ?? 0}-${team.losses ?? 0}-${team.ties ?? 0}`;
  const label = teamNickname(team.name);
  const teamText = team.linkedDiscordId ? `~~${label}~~` : label;
  const coach = team.linkedDiscordId ? ` (<@${team.linkedDiscordId}>)` : "";
  return `${teamText} (${record})${coach}`;
}

// Relocated/custom teams sometimes come back with a blank conference and a division like "NFC East".
// Re-bucket every team into NFC/AFC (inferring from the division text when the conference is blank)
// so the grid always renders exactly the two real conferences — no empty/duplicate groups.
function normalizeRosterConferences(conferences: RosterConference[]): RosterConference[] {
  const inferConf = (confName: string, divisionText: string) => {
    const c = String(confName ?? "").toUpperCase().trim();
    if (c === "NFC" || c === "AFC") return c;
    const text = String(divisionText ?? "").toUpperCase();
    if (text.includes("AFC")) return "AFC";
    if (text.includes("NFC")) return "NFC";
    return "Other";
  };
  const confMap = new Map<string, Map<string, RosterTeam[]>>();
  for (const conf of conferences ?? []) {
    for (const division of conf.divisions ?? []) {
      for (const team of division.teams ?? []) {
        const label = String(division.label || team.division || "Other");
        const c = inferConf(conf.conference, `${label} ${team.division ?? ""}`);
        if (!confMap.has(c)) confMap.set(c, new Map());
        const divMap = confMap.get(c)!;
        if (!divMap.has(label)) divMap.set(label, []);
        divMap.get(label)!.push(team);
      }
    }
  }
  const order = ["NFC", "AFC", "Other"];
  return [...confMap.keys()]
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map((c) => ({
      conference: c === "Other" ? "Other" : c,
      divisions: [...confMap.get(c)!.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, teams]) => ({ division: label, label, teams: [...teams].sort((x, y) => x.name.localeCompare(y.name)) }))
    }));
}

export type MaddenTeamsPage = "NFC" | "AFC";

export function buildMaddenTeamsEmbed(rawConferences: RosterConference[], page: MaddenTeamsPage = "NFC") {
  const conferences = normalizeRosterConferences(rawConferences);
  const conf = conferences.find((c) => c.conference === page) ?? conferences.find((c) => c.conference === "NFC" || c.conference === "AFC");
  const embed = new EmbedBuilder()
    .setTitle(`${conf?.conference ?? page} Teams`)
    .setDescription("Open teams are shown plainly. Linked teams are struck through with the assigned Discord username in parentheses.");

  for (const division of conf?.divisions ?? []) {
    embed.addFields({
      name: division.label,
      value: (division.teams.map(maddenTeamLine).join("\n") || "No teams found").slice(0, 1024),
      inline: false
    });
  }

  return embed;
}

export function buildMaddenTeamsRows(page: MaddenTeamsPage = "NFC") {
  const nextPage: MaddenTeamsPage = page === "NFC" ? "AFC" : "NFC";
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${MENU_CUSTOM_IDS.teamsPage}:${nextPage}`).setLabel(nextPage).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.requestTeam).setLabel("Request Team").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.teamsBack).setLabel("Back to Menu").setStyle(ButtonStyle.Secondary)
    )
  ];
}

export type TeamScheduleGame = {
  weekNumber?: number | null;
  phase?: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  isCompleted?: boolean;
  isH2h?: boolean;
};

function formatScheduleStage(phase?: string | null, weekNumber?: number | null) {
  const normalized = String(phase ?? "regular_season");
  if (normalized === "regular_season") return `Week ${weekNumber ?? "?"}`;
  if (normalized === "wild_card") return "Wild Card";
  if (normalized === "divisional") return "Divisional";
  if (normalized === "conference_championship") return "Conference Championship";
  if (normalized === "super_bowl") return "Super Bowl";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || `Week ${weekNumber ?? "?"}`;
}

function formatScheduleTeam(name?: string | null, lost?: boolean) {
  const label = name?.trim() || "Team";
  return lost ? `~~${label}~~` : label;
}

function formatScheduleLine(game: TeamScheduleGame) {
  const completed = Boolean(game.isCompleted && game.homeScore != null && game.awayScore != null);
  const homeLost = completed && Number(game.homeScore) < Number(game.awayScore);
  const awayLost = completed && Number(game.awayScore) < Number(game.homeScore);
  const away = formatScheduleTeam(game.awayTeamName, awayLost);
  const home = formatScheduleTeam(game.homeTeamName, homeLost);
  const suffix = completed ? `${game.awayScore}-${game.homeScore}` : (game.isH2h ? "H2H" : "CPU");
  return `${formatScheduleStage(game.phase, game.weekNumber)}: ${away} VS ${home} (${suffix})`;
}

export function buildScheduleEmbed(input: {
  leagueName?: string | null;
  teamName?: string | null;
  isLinked?: boolean;
  games?: TeamScheduleGame[];
}) {
  const embed = new EmbedBuilder().setTitle(input.teamName ? `${input.teamName} Schedule` : "Schedule");

  if (!input.isLinked) {
    return embed.setDescription("You are not currently linked to a team. Please use the Select Team button below to view a teams schedule.");
  }

  const games = input.games ?? [];
  const scheduleText = games.length
    ? games.map(formatScheduleLine).join("\n")
    : "No schedule has been logged for your team yet.";

  return embed.setDescription([
    scheduleText,
    "",
    "To view another teams schedule, please use the Select Team button below."
  ].join("\n").slice(0, 4096));
}

export function buildScheduleRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.scheduleSelectTeam).setLabel("Select Team").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.scheduleSos).setLabel("SOS").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.scheduleHistory).setLabel("History").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.scheduleBack).setLabel("Back to Menu").setStyle(ButtonStyle.Danger)
    )
  ];
}

export function buildSnapshotConferenceSelectRows(rawConferences: RosterConference[]) {
  const conferences = normalizeRosterConferences(rawConferences)
    .filter((conference) => conference.divisions.some((division) => division.teams.some((team) => team.linkedDiscordId)));
  const options = conferences.slice(0, 24).map((conference) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(conference.conference.slice(0, 100))
      .setValue(conference.conference)
      .setDescription("View linked teams in this conference.")
  );
  options.push(new StringSelectMenuOptionBuilder().setLabel("Back to Menu").setValue("profiles_back_menu"));
  const select = new StringSelectMenuBuilder()
    .setCustomId(ROSTERS_CUSTOM_IDS.snapshotConferenceSelect)
    .setPlaceholder("Select a conference")
    .addOptions(options);
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

export function buildSnapshotTeamSelectRows(rawConferences: RosterConference[], conferenceName: string) {
  const conference = normalizeRosterConferences(rawConferences).find((conf) => conf.conference === conferenceName);
  const teams = (conference?.divisions ?? [])
    .flatMap((division) => division.teams.map((team) => ({ ...team, divisionLabel: division.label })))
    .filter((team) => team.linkedDiscordId);
  const options = teams.slice(0, 24).map((team) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(team.name.slice(0, 100))
      .setValue(team.linkedDiscordId!)
      .setDescription(`${team.linkedName ?? "Linked User"} - ${team.divisionLabel}`.slice(0, 100))
  );
  options.push(new StringSelectMenuOptionBuilder().setLabel("Back to Profiles").setValue("profiles_back"));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${ROSTERS_CUSTOM_IDS.snapshotTeamSelect}:${conferenceName}`)
    .setPlaceholder(`Select a ${conferenceName} team`)
    .addOptions(options);
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

export function buildRecBankRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(REC_BANK_CUSTOM_IDS.select)
    .setPlaceholder("Choose a bank action")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Transfer to Savings").setValue("to_savings").setDescription("Move funds from your wallet into savings"),
      new StringSelectMenuOptionBuilder().setLabel("Transfer from Savings").setValue("from_savings").setDescription("Move funds from savings back to your wallet"),
      new StringSelectMenuOptionBuilder().setLabel("Back to Main Menu").setValue("bank_back")
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

// ── Manage My Wallet rows ──────────────────────────────────────────────────────

// Two button rows: savings transfers, then pending purchases + make a purchase.
export function buildManageWalletRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MANAGE_WALLET_CUSTOM_IDS.transfer).setLabel("Transfer").setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MANAGE_WALLET_CUSTOM_IDS.transactions).setLabel("Transactions").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MANAGE_WALLET_CUSTOM_IDS.back).setLabel("Back to Menu").setStyle(ButtonStyle.Danger)
    )
  ];
}

export function buildWalletTransferDirectionRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(MANAGE_WALLET_CUSTOM_IDS.transferDirection)
    .setPlaceholder("Select transfer direction")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Transfer To Savings").setValue("to_savings").setDescription("Move funds from wallet into savings."),
      new StringSelectMenuOptionBuilder().setLabel("Transfer From Savings").setValue("from_savings").setDescription("Move funds from savings into wallet.")
    );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MANAGE_WALLET_CUSTOM_IDS.back).setLabel("Back to Menu").setStyle(ButtonStyle.Danger)
    )
  ];
}

export function buildWalletTransferAmountRows(direction: "to_savings" | "from_savings") {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${MANAGE_WALLET_CUSTOM_IDS.transferAll}:${direction}`).setLabel("Transfer All").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${MANAGE_WALLET_CUSTOM_IDS.transferCustom}:${direction}`).setLabel("Custom Amount").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MANAGE_WALLET_CUSTOM_IDS.back).setLabel("Back to Menu").setStyle(ButtonStyle.Danger)
    )
  ];
}

export function buildWalletTransferCustomModal(direction: "to_savings" | "from_savings") {
  return new ModalBuilder()
    .setCustomId(`${MANAGE_WALLET_CUSTOM_IDS.transferCustomModal}:${direction}`)
    .setTitle(direction === "to_savings" ? "Transfer To Savings" : "Transfer From Savings")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(MANAGE_WALLET_CUSTOM_IDS.transferCustomAmountInput)
          .setLabel("Amount")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g. 50")
      )
    );
}

export function buildStreamRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(STREAM_CUSTOM_IDS.serviceSelect)
    .setPlaceholder("Select streaming service")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Discord Live Stream").setValue("discord").setDescription("Submit a Discord Live stream payout request."),
      new StringSelectMenuOptionBuilder().setLabel("Twitch").setValue("twitch").setDescription("Submit a Twitch stream link."),
      new StringSelectMenuOptionBuilder().setLabel("YouTube").setValue("youtube").setDescription("Submit a YouTube stream link."),
      new StringSelectMenuOptionBuilder().setLabel("Kick").setValue("kick").setDescription("Submit a Kick stream link."),
      new StringSelectMenuOptionBuilder().setLabel("Other").setValue("other").setDescription("Submit another streaming link.")
    );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.streamBack).setLabel("Back to Menu").setStyle(ButtonStyle.Danger)
    )
  ];
}

export function buildStreamLinkModal(service: string) {
  const label = service.charAt(0).toUpperCase() + service.slice(1);
  return new ModalBuilder()
    .setCustomId(`${STREAM_CUSTOM_IDS.linkModal}:${service}`)
    .setTitle(`${label} Stream Link`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(STREAM_CUSTOM_IDS.linkInput)
          .setLabel("Stream Link")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("https://...")
      )
    );
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
