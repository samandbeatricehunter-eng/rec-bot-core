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
import { canonicalConferenceName, CONFERENCE_ORDER, isCfb, isRegularSeasonWeek, stageForWeek, stageLabel, formatCoins } from "@rec/shared";
import { COLORS } from "../lib/colors.js";

/**
 * Central custom IDs for the REC menu system.
 *
 * The bot should keep a single slash command: /menu. Every workflow branches
 * from these custom IDs through buttons, select menus, and modals.
 */
export const MENU_CUSTOM_IDS = {
  openTeams: "rec:menu:open_teams",
  schedule: "rec:menu:schedule",
  scheduleSelectTeam: "rec:schedule:select_team",
  scheduleTeamSelect: "rec:schedule:team_select",
  scheduleLeague: "rec:schedule:league",
  schedulePowerRankings: "rec:schedule:power_rankings",
  scheduleSos: "rec:schedule:sos",
  scheduleStats: "rec:schedule:stats",
  scheduleStatsTeamSelect: "rec:schedule:stats_team_select",
  scheduleHistory: "rec:schedule:history",
  scheduleBack: "rec:schedule:back",
  viewUserProfiles: "rec:menu:view_user_profiles",
  stream: "rec:menu:stream",
  streamBack: "rec:stream:back",
  helpRules: "rec:menu:help_rules",
  leagueMgmt: "rec:menu:league_mgmt",
  leagueMgmtOpenDashboard: "rec:league_mgmt:open_dashboard",
  requestTeam: "rec:teams:request",
  teamsPostOpen: "rec:teams:post_open",
  teamsBack: "rec:teams:back",
  teamsPage: "rec:teams:page",
  teamsConferenceSelect: "rec:teams:conference",
  leagueMgmtTeams: "rec:league_mgmt:teams",
  leagueMgmtServerSetup: "rec:league_mgmt:server_setup",
  leagueMgmtSchedule: "rec:league_mgmt:schedule",
  leagueMgmtScheduleWizard: "rec:league_mgmt:schedule:wizard",
  leagueMgmtScheduleOneWeek: "rec:league_mgmt:schedule:one_week",
  leagueMgmtScheduleManual: "rec:league_mgmt:schedule:manual",
  leagueMgmtScheduleView: "rec:league_mgmt:schedule:view",
  leagueMgmtScheduleBack: "rec:league_mgmt:schedule:back",
  leagueMgmtAdvance: "rec:league_mgmt:advance",
  leagueMgmtUploadScores: "rec:league_mgmt:advance:upload_scores",
  leagueMgmtAdvanceWeek: "rec:league_mgmt:advance:week",
  leagueMgmtActiveCheck: "rec:league_mgmt:advance:active_check",
  leagueMgmtGotwPolls: "rec:league_mgmt:advance:gotw_polls",
  leagueMgmtSetGotw: "rec:league_mgmt:advance:set_gotw",
  leagueMgmtRerunGotw: "rec:league_mgmt:advance:rerun_gotw",
  leagueMgmtGameChannels: "rec:league_mgmt:advance:game_channels",
  leagueMgmtSetWeek: "rec:league_mgmt:advance:set_week",
  leagueMgmtSetSeason: "rec:league_mgmt:advance:set_season",
  leagueMgmtEosActions: "rec:league_mgmt:advance:eos_actions",
  leagueMgmtTroubleshoot: "rec:league_mgmt:advance:troubleshoot",
  leagueMgmtTroubleshootSchedule: "rec:league_mgmt:advance:troubleshoot:schedule",
  leagueMgmtTroubleshootEos: "rec:league_mgmt:advance:troubleshoot:eos",
  leagueMgmtTroubleshootReverseTxn: "rec:league_mgmt:advance:troubleshoot:reverse_txn",
  leagueMgmtEosPayouts: "rec:league_mgmt:advance:eos_payouts",
  leagueMgmtEosAwards: "rec:league_mgmt:advance:eos_awards",
  leagueMgmtPotyTallies: "rec:league_mgmt:advance:poty_tallies",
  leagueMgmtAdvanceBack: "rec:league_mgmt:advance:back",
  leagueMgmtSettings: "rec:league_mgmt:settings",
  leagueMgmtFirstTimeSetup: "rec:league_mgmt:first_time_setup",
  leagueMgmtDeleteLeague: "rec:league_mgmt:delete_league",
  leagueMgmtRoles: "rec:league_mgmt:roles",
  leagueMgmtBack: "rec:league_mgmt:back",
  setupModal: "rec:admin:setup_modal",
  serverSetupAcknowledgeInput: "rec:admin:server_setup_ack",
  leagueNameInput: "rec:admin:league_name_input",
  leaguePasswordInput: "rec:admin:league_password_input",
  deleteLeagueConfirm: "rec:admin:delete_league_confirm",
  deleteLeagueCancel: "rec:admin:delete_league_cancel",
  deleteLeagueModal: "rec:admin:delete_league_modal",
  deleteLeagueNameInput: "rec:admin:delete_league_name_input",
  placeWager: "rec:menu:place_wager",
  manageWallet: "rec:menu:manage_wallet"
} as const;

// Custom IDs for the Manage My Wallet ephemeral.
export const MANAGE_WALLET_CUSTOM_IDS = {
  toSavings: "rec:wallet:to_savings",
  fromSavings: "rec:wallet:from_savings",
  pendingPurchases: "rec:wallet:pending_purchases",
  transfer: "rec:wallet:transfer",
  transferDirection: "rec:wallet:transfer_direction",
  transferAll: "rec:wallet:transfer_all",
  transferCustom: "rec:wallet:transfer_custom",
  transferCustomModal: "rec:wallet:transfer_custom_modal",
  transferCustomAmountInput: "rec:wallet:transfer_custom_amount",
  transactions: "rec:wallet:transactions",
  mainMenu: "rec:wallet:main_menu",
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
  identities: "rec:profiles:identities",
  identitiesPrev: "rec:profiles:identities_prev",
  identitiesNext: "rec:profiles:identities_next",
  identitiesBack: "rec:profiles:identities_back",
  snapshotConferenceSelect: "rec:profiles:conference_select",
  snapshotTeamSelect: "rec:profiles:team_select"
} as const;

export type SetupDangerAction = "server_setup" | "league_setup";

function formatLeagueStage(value?: string | null) {
  const stage = String(value ?? "regular_season");
  if (stage === "regular_season") return "Regular Season";
  if (stage === "preseason_training_camp") return "Training Camp";
  if (stage === "preseason") return "Preseason";
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
  leagueTeamRecordText?: string;
  leagueUserRecordText?: string;
  leagueSeasonRecordText?: string;
  leagueSeasonPointDifferential?: number;
  userStreakText?: string;
  globalRecordText?: string;
  globalChampionships?: number;
  globalPointDifferential?: number;
  gameGlobalLabel?: string | null;
  gameGlobalRecordText?: string | null;
  gameGlobalPlayoffText?: string | null;
  gameGlobalSuperbowlText?: string | null;
  gameGlobalPointDifferential?: number;
  purchaseCapsActive?: boolean;
  purchaseCaps?: Array<{ label: string; purchased?: number | null; allowed?: number | null }>;
  hideLeagueInfo?: boolean;
  noticeText?: string;
  canManageLeague?: boolean;
  game?: string | null;
}) {
  const userInfo = [
    `**User:** ${input.discordUsername ?? "Unlinked User"}`,
    `**Wallet:** ${typeof input.wallet === "string" ? input.wallet : formatCoins(input.wallet)}`,
    `**Savings:** ${typeof input.savings === "string" ? input.savings : formatCoins(input.savings)}`,
    `**Proj. Interest:** ${typeof input.projectedInterest === "string" ? input.projectedInterest : formatCoins(input.projectedInterest)}`
  ].join("\n");

  const leagueInfo = [
    `**Team:** ${input.teamName ?? "None"}`,
    `**Szn/Wk:** ${formatMenuSeasonWeek(input)}`,
    `**Team Record:** ${input.leagueTeamRecordText ?? input.leagueSeasonRecordText ?? "0-0-0"}`,
    `**User Record:** ${input.leagueUserRecordText ?? input.leagueSeasonRecordText ?? "0-0-0"}`,
    `**Streak:** ${input.userStreakText ?? "-"}`,
    `**PointDiff:** ${input.leagueSeasonPointDifferential ?? 0}`
  ].join("\n");

  const championshipLabel = isCfb(input.game) ? "National Championships" : "Super Bowls";
  const globalCareerInfo = input.gameGlobalLabel
    ? [
      `**Global (${input.gameGlobalLabel}):** ${input.gameGlobalRecordText ?? "0-0-0"} | PD: ${input.gameGlobalPointDifferential ?? 0}`,
      `Playoffs: ${input.gameGlobalPlayoffText ?? "0-0"} | ${championshipLabel}: ${input.gameGlobalSuperbowlText ?? "0-0"}`,
      `**All Games:** ${input.globalRecordText ?? "0-0-0"} | Championships: ${input.globalChampionships ?? 0}`,
    ].join("\n")
    : "";

  const purchaseCaps = input.purchaseCapsActive && input.purchaseCaps?.length
    ? input.purchaseCaps.map((cap) => `**${cap.label}:** ${cap.purchased ?? 0}/${cap.allowed ?? 0}`).join("\n")
    : null;

  const menuText = [
    "Use the buttons below to open a REC workflow. Most actions happen in this private menu unless the button says it will post to a league channel.",
    "**Teams** - View open and linked teams.",
    "**Schedule** - View your logged league schedule.",
    "**Help/Rules** - Read current league rules and FAQ sections.",
    "**My Wallet** - Review balances, transfer to/from savings, and view transactions.",
    "**Purchase** - Purchase tools will unlock after league purchase settings are built.",
    "**Wager** - Wager tools will be built last.",
    "**Profiles** - View linked users and team snapshots.",
    ...(input.canManageLeague ? ["**League Mgmt** - Commissioner-only league operations."] : [])
  ].join("\n");

  return new EmbedBuilder()
    .setTitle(input.leagueName ? `${input.leagueName} Menu` : "REC League Menu")
    .addFields(
      { name: "USER INFO", value: userInfo.slice(0, 1024), inline: false },
      ...(input.hideLeagueInfo ? [] : [{ name: "LEAGUE INFO", value: leagueInfo.slice(0, 1024), inline: false }]),
      ...(input.gameGlobalLabel
        ? [{ name: "GLOBAL CAREER", value: globalCareerInfo.slice(0, 1024), inline: false }]
        : []),
      ...(input.noticeText ? [{ name: "NOTICE", value: input.noticeText.slice(0, 1024), inline: false }] : []),
      ...(!input.hideLeagueInfo && purchaseCaps ? [{ name: "PURCHASE CAPS", value: purchaseCaps.slice(0, 1024), inline: false }] : []),
      { name: "MENU", value: menuText.slice(0, 1024), inline: false }
    )
    .setFooter({ text: "Powered by the REC Scout bot (c) 2026" });
}

// League Mgmt used to have a button here for commissioners/co-commissioners; it's now
// reached via the standalone /league-mgmt command instead (same isDiscordAdminInteraction
// gate), which goes straight to the web dashboard now that it has full League Mgmt parity.
// The Store purchase flow moved to the web Hub the same way (2026-07-16) — the REC Store
// section there covers every purchase type with live pricing/cap previews, so there's no
// "Purchase" button here any more; run /hub for it.
export function buildLeagueMenuRows(isLinkedToTeam = true) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.openTeams).setLabel("Teams").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.schedule).setLabel("Schedule").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.helpRules).setLabel("Help/Rules").setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.manageWallet).setLabel("My Wallet").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.placeWager).setLabel("Wager").setStyle(ButtonStyle.Success)
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.viewUserProfiles).setLabel("Profiles").setStyle(ButtonStyle.Danger)
  );
  return isLinkedToTeam ? [row1, row2, row3] : [row1, row3];
}

export function buildAdminPanelEmbed(input: { coCommissionerLimited?: boolean } = {}) {
  const menuText = input.coCommissionerLimited
    ? [
      "**Teams** - Link users to teams, unlink users, reset default teams, and edit relocated/custom team names.",
      "**Box Scores** - Commissioner-assisted upload flow for prior or missed box scores.",
    ]
    : [
      "**New here?** Run your game in-game first (advance Madden/CFB), then come back to upload scores and advance REC — that order keeps the new week, scores, playoff bracket, and schedule screenshots ready to import.",
      "",
      "**Teams / Roles** — Link coaches to teams, edit relocated/custom teams, reset defaults, and manage REC Discord roles.",
      "**Schedule** — Upload a schedule screenshot, enter it manually, or review the current schedule. Playoff schedules usually need an in-game advance first.",
      "**Advance** — Upload score catch-up tools and active checks live here; advancing the league week, GOTW, game channels, and EOS payouts moved to the web dashboard.",
      "**Settings** — Update league & server configuration (channels, economy, rules, activity requirements).",
      "**First-Time Setup / Delete League** — Re-run initial setup (can rebuild league data) or permanently delete this server's league.",
    ];

  return new EmbedBuilder()
    .setTitle("League Mgmt")
    .setDescription([
      input.coCommissionerLimited
        ? "Co-Commissioners can manage team links and box score reviews from this menu."
        : "From this menu, you can manage your league in a variety of ways.",
      "",
      ...menuText,
    ].join("\n"));
}

export const LEAGUE_MGMT_BOX_SCORE_INBOX_ID = "rec:league_mgmt:box_score_inbox";

export function buildAdminPanelRows(input: { coCommissionerLimited?: boolean } = {}) {
  const sharedRows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtTeams).setLabel("Teams").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtRoles).setLabel("Roles").setStyle(ButtonStyle.Primary),
      // Additive, alongside the rest of this embed-based workflow — not a replacement.
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtOpenDashboard).setLabel("Open Web Dashboard (Beta)").setStyle(ButtonStyle.Secondary)
    ),
  ];

  if (input.coCommissionerLimited) {
    return [
      ...sharedRows,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtBack).setLabel("Back to Menu").setStyle(ButtonStyle.Secondary)
      ),
    ];
  }

  return [
    ...sharedRows,
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSchedule).setLabel("Schedule").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvance).setLabel("Advance").setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtFirstTimeSetup).setLabel("First-Time Setup").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtDeleteLeague).setLabel("Delete League").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtSettings).setLabel("Settings").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtBack).setLabel("Back to Menu").setStyle(ButtonStyle.Secondary)
    )
  ];
}

// Step 1 of league deletion: a warning embed naming the league and what is erased, with a red
// confirm button that opens the typed-confirmation modal.
export function buildDeleteLeagueWarningPayload(leagueName: string) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("WARNING: Delete League Data - Permanent")
        .setColor(COLORS.error)
        .setDescription([
          `This will **permanently erase** the league **${leagueName}** from REC. This cannot be undone.`,
          "",
          "**Deleted:** all teams, rosters, records, standings, payouts/economy ledger for this league, badges, awards, GOTW polls, game channels data, imports, settings/rules, and every user-to-team link in this league.",
          "**Kept:** each member's Discord account, global career record, wallet balance, legacy history, and the Discord server itself.",
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

    const leaguePasswordInput = new TextInputBuilder()
      .setCustomId(MENU_CUSTOM_IDS.leaguePasswordInput)
      .setLabel("League Password (optional for public leagues)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("Leave blank if the league is not private or has no password.");

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(leagueNameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(leaguePasswordInput)
    );
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
  display_nick?: string | null;
  is_relocated?: boolean | null;
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
  const label = String(team.name ?? "Team").trim() || "Team";
  const teamText = team.linkedDiscordId ? `~~${label}~~` : label;
  const coach = team.linkedDiscordId ? ` (<@${team.linkedDiscordId}>)` : "";
  return `${teamText} (${record})${coach}`;
}

// Re-bucket every team into its real conference so the grid always renders exactly the
// conferences actually present — no empty/duplicate groups.
export function normalizeRosterConferences(conferences: RosterConference[]): RosterConference[] {
  const conferenceOrder = CONFERENCE_ORDER;
  const inferConf = canonicalConferenceName;
  const divisionOrder = ["East", "North", "South", "West"];
  const normalizeDivisionLabel = (value: string, conference: string) => {
    const cleaned = String(value || "Other")
      .replace(new RegExp(`^${conference}\\s+`, "i"), "")
      .replace(/^(AFC|NFC)\s+/i, "")
      .trim();
    return cleaned || "Other";
  };
  const confMap = new Map<string, Map<string, RosterTeam[]>>();
  for (const conf of conferences ?? []) {
    for (const division of conf.divisions ?? []) {
      for (const team of division.teams ?? []) {
        const rawLabel = String(division.label || team.division || "Other");
        const c = inferConf(conf.conference, `${rawLabel} ${team.division ?? ""}`);
        const label = normalizeDivisionLabel(rawLabel, c);
        if (!confMap.has(c)) confMap.set(c, new Map());
        const divMap = confMap.get(c)!;
        if (!divMap.has(label)) divMap.set(label, []);
        divMap.get(label)!.push(team);
      }
    }
  }
  return [...confMap.keys()]
    .sort((a, b) => (conferenceOrder.indexOf(a) + 1 || 99) - (conferenceOrder.indexOf(b) + 1 || 99))
    .map((c) => ({
      conference: c,
      divisions: [...confMap.get(c)!.entries()]
        .sort((a, b) => {
          const ai = divisionOrder.indexOf(a[0]);
          const bi = divisionOrder.indexOf(b[0]);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a[0].localeCompare(b[0]);
        })
        .map(([label, teams]) => ({ division: label, label, teams: [...teams].sort((x, y) => x.name.localeCompare(y.name)) }))
    }));
}

export type TeamsMenuPage = string;

function defaultTeamsPage(rawConferences: RosterConference[]) {
  const conferences = normalizeRosterConferences(rawConferences);
  return conferences.find((c) => c.conference === "NFC")?.conference ?? conferences[0]?.conference ?? "Teams";
}

export function buildTeamsMenuEmbed(rawConferences: RosterConference[], page: TeamsMenuPage = defaultTeamsPage(rawConferences)) {
  const conferences = normalizeRosterConferences(rawConferences);
  const conf = conferences.find((c) => c.conference === page) ?? conferences.find((c) => c.conference === "NFC" || c.conference === "AFC") ?? conferences[0];
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

export function buildTeamsMenuRows(page: TeamsMenuPage = "NFC", rawConferences?: RosterConference[]) {
  const conferences = rawConferences ? normalizeRosterConferences(rawConferences) : [];
  const conferenceNames = conferences.map((conference) => conference.conference);
  const isNflLayout = conferenceNames.length <= 2 && conferenceNames.every((conference) => conference === "NFC" || conference === "AFC");
  if (!rawConferences || isNflLayout) {
    const nextPage: TeamsMenuPage = page === "NFC" ? "AFC" : "NFC";
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${MENU_CUSTOM_IDS.teamsPage}:${nextPage}`).setLabel(nextPage).setStyle(nextPage === "AFC" ? ButtonStyle.Danger : ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.requestTeam).setLabel("Request Team").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.teamsPostOpen).setLabel("Post Open Teams").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.teamsBack).setLabel("Back to Menu").setStyle(ButtonStyle.Danger)
      )
    ];
  }

  const selectedPage = conferenceNames.includes(page) ? page : conferenceNames[0] ?? page;
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(MENU_CUSTOM_IDS.teamsConferenceSelect)
        .setPlaceholder("Select conference")
        .addOptions(
          ...conferences.slice(0, 25).map((conference) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(conference.conference.slice(0, 100))
              .setValue(conference.conference)
              .setDefault(conference.conference === selectedPage)
          )
        )
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.requestTeam).setLabel("Request Team").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.teamsPostOpen).setLabel("Post Open Teams").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.teamsBack).setLabel("Back to Menu").setStyle(ButtonStyle.Danger)
    )
  ];
}

export function buildOpenTeamsEmbeds(conferences: RosterConference[]) {
  const normalized = normalizeRosterConferences(conferences);
  const embeds: EmbedBuilder[] = [];

  for (const conf of normalized) {
    const fields: Array<{ name: string; value: string; inline: false }> = [];
    for (const division of conf.divisions) {
      const openTeams = division.teams.filter((team) => !team.linkedDiscordId);
      if (!openTeams.length) continue;
      fields.push({
        name: division.label,
        value: openTeams.map((team) => team.name).join("\n").slice(0, 1024),
        inline: false,
      });
    }

    if (fields.length) {
      embeds.push(new EmbedBuilder().setTitle(`${conf.conference} Open Teams`).addFields(fields));
    }
  }

  if (!embeds.length) {
    return [new EmbedBuilder().setTitle("Open Teams").setDescription("All teams are currently assigned.")];
  }

  return embeds;
}

export type TeamScheduleGame = {
  weekNumber?: number | null;
  phase?: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  homeLabel?: string | null;
  awayLabel?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  isCompleted?: boolean;
  isH2h?: boolean;
  isBye?: boolean;
  isHome?: boolean;
  opponentLabel?: string | null;
  line?: string | null;
};

function formatScheduleStage(weekNumber: number | null | undefined, game: string | null) {
  if (weekNumber == null) return "Week ?";
  if (isRegularSeasonWeek(weekNumber, game)) return `Week ${weekNumber}`;
  return stageLabel(stageForWeek(weekNumber, game), weekNumber, game);
}

function formatScheduleTeam(name?: string | null, lost?: boolean) {
  const label = name?.trim() || "Team";
  return lost ? `~~${label}~~` : label;
}

function formatScheduleLineForWeek(game: TeamScheduleGame, currentWeek: number | null | undefined, leagueGame: string | null) {
  if (game.line) return game.line;
  if (game.isBye) return `Week ${game.weekNumber ?? "?"}: BYE`;
  const completed = Boolean(game.isCompleted && game.homeScore != null && game.awayScore != null);
  const isPastWeek = currentWeek == null || Number(game.weekNumber ?? 0) < Number(currentWeek);
  if (completed && isPastWeek) {
    const prefix = game.isHome ? "VS" : "@";
    const opponent = String(game.opponentLabel ?? (game.isHome ? game.awayTeamName : game.homeTeamName) ?? "Team").trim();
    const mine = Number(game.isHome ? game.homeScore : game.awayScore);
    const theirs = Number(game.isHome ? game.awayScore : game.homeScore);
    const result = mine > theirs ? "W" : mine < theirs ? "L" : "T";
    return `${formatScheduleStage(game.weekNumber, leagueGame)}: ~~${prefix} ${opponent}~~ ${game.awayScore}-${game.homeScore} **${result}**`;
  }
  const homeLost = completed && Number(game.homeScore) < Number(game.awayScore);
  const awayLost = completed && Number(game.awayScore) < Number(game.homeScore);
  // User teams render as their @nickname; CPU teams by name. No H2H/CPU suffix.
  const away = formatScheduleTeam(game.awayLabel ?? game.awayTeamName, awayLost);
  const home = formatScheduleTeam(game.homeLabel ?? game.homeTeamName, homeLost);
  const scorePart = completed ? ` (${game.awayScore}-${game.homeScore})` : "";
  return `${formatScheduleStage(game.weekNumber, leagueGame)}: ${away} VS ${home}${scorePart}`;
}

export function buildScheduleEmbed(input: {
  leagueName?: string | null;
  teamName?: string | null;
  isLinked?: boolean;
  hasLoggedSchedule?: boolean;
  currentWeek?: number | null;
  games?: TeamScheduleGame[];
  game?: string | null;
}) {
  const embed = new EmbedBuilder().setTitle(input.teamName ? `${input.teamName} Schedule` : "Schedule");

  if (!input.isLinked) {
    return embed.setDescription([
      "You are not currently linked to a team in this league.",
      "",
      "Open **Teams** and use **Request Team** to ask a commissioner for an open team.",
    ].join("\n"));
  }

  if (!input.hasLoggedSchedule) {
    return embed.setDescription([
      input.leagueName ? `League: **${input.leagueName}**` : null,
      `You are linked to **${input.teamName ?? "your team"}**, but no schedule has been logged for this season yet.`,
      "",
      "Ask a commissioner to enter the league schedule from **League Mgmt → Schedule**.",
    ].filter(Boolean).join("\n"));
  }

  const games = input.games ?? [];
  const scheduleText = games.length
    ? games.map((game) => formatScheduleLineForWeek(game, input.currentWeek, input.game ?? null)).join("\n")
    : "No schedule entries found for your team.";

  return embed.setDescription([
    input.leagueName ? `League: **${input.leagueName}**` : null,
    scheduleText,
  ].filter(Boolean).join("\n\n").slice(0, 4096));
}

export function buildScheduleRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.scheduleSelectTeam).setLabel("View Other Teams").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.scheduleLeague).setLabel("League Schedule").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.schedulePowerRankings).setLabel("Power Rankings").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.scheduleSos).setLabel("SOS").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.scheduleStats).setLabel("Stats").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.scheduleHistory).setLabel("History").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.scheduleBack).setLabel("Back to Menu").setStyle(ButtonStyle.Secondary),
    ),
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
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.identities).setLabel("Player Identities").setStyle(ButtonStyle.Primary)
    ),
  ];
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
      new ButtonBuilder().setCustomId(MANAGE_WALLET_CUSTOM_IDS.mainMenu).setLabel("Main Menu").setStyle(ButtonStyle.Danger)
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
      new ButtonBuilder().setCustomId(MANAGE_WALLET_CUSTOM_IDS.back).setLabel("Back").setStyle(ButtonStyle.Danger)
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
      new ButtonBuilder().setCustomId(MANAGE_WALLET_CUSTOM_IDS.back).setLabel("Back").setStyle(ButtonStyle.Danger)
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
