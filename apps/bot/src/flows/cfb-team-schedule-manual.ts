import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { canonicalConferenceName, CONFERENCE_ORDER, isCfb, regularSeasonWeeks, stageForWeek, stageLabel } from "@rec/shared";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { COLORS } from "../lib/colors.js";
import { recApi } from "../lib/rec-api.js";

// ─── CFB manual schedule entry: one user-controlled team, every week, inline ────
// Commissioner picks a team a Discord user actually controls, then walks that
// team's entire regular season one week at a time — BYE or a conference, then an
// opponent within it, then home/away — saving each pick immediately via the same
// saveManualScheduleGame() the older week-first/all-teams flow uses. Weeks that
// already have a confirmed matchup (from this or an earlier team's entry — one
// rec_games row covers both sides) are shown read-only and skipped forward
// automatically, matching the "locked" convention the CFB screenshot-import
// review flow already uses, rather than risking overwriting a game that may
// already have recorded results. A week with no pick yet can be left blank via
// "Skip This Week" and revisited later by re-running the flow for that team.

export const CFB_SCHEDULE_MANUAL_CUSTOM_IDS = {
  teamSelect: "rec:cfb_sched_manual:team",
  teamPagePrev: "rec:cfb_sched_manual:team_prev",
  teamPageNext: "rec:cfb_sched_manual:team_next",
  conferenceSelect: "rec:cfb_sched_manual:conf",
  opponentSelect: "rec:cfb_sched_manual:opp",
  home: "rec:cfb_sched_manual:home",
  away: "rec:cfb_sched_manual:away",
  skip: "rec:cfb_sched_manual:skip",
  continue: "rec:cfb_sched_manual:continue",
  cancel: "rec:cfb_sched_manual:cancel",
} as const;

const BYE_VALUE = "__BYE__";
const TEAM_PAGE_SIZE = 25; // Discord's hard cap on options per select menu.

type TeamOption = { id: string; name: string; abbreviation: string | null; conference: string | null };

type WeekEntry = {
  weekNumber: number;
  isBye: boolean;
  opponentTeamId: string | null;
  opponentName: string | null;
  homeAway: "home" | "away" | null;
  alreadyConfirmed: boolean;
};

type Session = {
  guildId: string;
  userId: string;
  step: "pick_team" | "pick_conference" | "pick_opponent" | "pick_home_away" | "done";
  teamListPage: number;
  teamId?: string;
  teamName?: string;
  teams: TeamOption[];
  game: string | null;
  weeks: WeekEntry[];
  weekIndex: number;
  pendingConference?: string;
  pendingOpponentTeamId?: string;
  pendingOpponentName?: string;
  at: number;
};

const sessions = new Map<string, Session>();
const key = (guildId: string, userId: string) => `${guildId}:${userId}`;
const SESSION_TTL = 20 * 60 * 1000;

function getSession(guildId: string, userId: string): Session | null {
  const s = sessions.get(key(guildId, userId));
  if (!s) return null;
  if (Date.now() - s.at > SESSION_TTL) {
    sessions.delete(key(guildId, userId));
    return null;
  }
  return s;
}

function touch(session: Session) {
  session.at = Date.now();
  sessions.set(key(session.guildId, session.userId), session);
}

function weekLabel(weekNumber: number, game: string | null) {
  return stageLabel(stageForWeek(weekNumber, game), weekNumber, game);
}

async function loadTeams(guildId: string): Promise<{ teams: TeamOption[]; game: string | null }> {
  const result = await recApi.listScheduleTeams(guildId);
  const teams: TeamOption[] = (result?.teams ?? []).map((t: any) => ({
    id: t.id,
    name: t.is_relocated && t.display_city ? `${t.display_city} ${t.display_nick ?? ""}`.trim() : t.name,
    abbreviation: t.is_relocated && t.display_abbr ? t.display_abbr : t.abbreviation,
    conference: t.conference ?? null,
  }));
  return { teams, game: result?.league?.game ?? null };
}

function cancelRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.cancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
}

// ─── Entry point ────────────────────────────────────────────────────────────────

export async function startCfbTeamScheduleManualEntry(interaction: ButtonInteraction, buildScheduleMgmtRows: () => any[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners or server admins can enter a team schedule.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();

  const linkedResult = await recApi.getLinkedUsersTeams(interaction.guildId).catch(() => null);
  const game: string | null = linkedResult?.league?.game ?? null;
  if (!isCfb(game)) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Enter Team Schedule").setColor(COLORS.error).setDescription("This tool is only available for CFB leagues.")],
      components: buildScheduleMgmtRows(),
    });
  }

  const seen = new Set<string>();
  const linkedTeams = ((linkedResult?.linked ?? []) as any[])
    .map((row) => row.team)
    .filter((t) => t?.id && !seen.has(t.id) && seen.add(t.id))
    .sort((a: any, b: any) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

  if (!linkedTeams.length) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Enter Team Schedule").setDescription("No teams are currently linked to a Discord user in this league — link a team first under **Teams → Add/Remove User**.")],
      components: buildScheduleMgmtRows(),
    });
  }

  sessions.set(key(interaction.guildId, interaction.user.id), {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    step: "pick_team",
    teamListPage: 0,
    teams: [],
    game,
    weeks: [],
    weekIndex: 0,
    at: Date.now(),
  });

  return interaction.editReply(renderTeamPicker(linkedTeams, 0));
}

function renderTeamPicker(teams: Array<{ id: string; name: string }>, page: number) {
  const totalPages = Math.max(1, Math.ceil(teams.length / TEAM_PAGE_SIZE));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageTeams = teams.slice(clampedPage * TEAM_PAGE_SIZE, clampedPage * TEAM_PAGE_SIZE + TEAM_PAGE_SIZE);

  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.teamSelect)
        .setPlaceholder(`Select a team (page ${clampedPage + 1}/${totalPages})`)
        .addOptions(pageTeams.map((t) => new StringSelectMenuOptionBuilder().setLabel(t.name.slice(0, 100)).setValue(t.id))),
    ),
  ];
  if (totalPages > 1) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.teamPagePrev).setLabel("Previous Teams").setStyle(ButtonStyle.Secondary).setDisabled(clampedPage <= 0),
        new ButtonBuilder().setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.teamPageNext).setLabel("Next Teams").setStyle(ButtonStyle.Secondary).setDisabled(clampedPage >= totalPages - 1),
      ),
    );
  }
  rows.push(cancelRow());

  return {
    embeds: [new EmbedBuilder()
      .setTitle("Enter Team Schedule")
      .setDescription("Select the user-controlled team whose schedule you're entering. You'll go week by week — pick BYE or a conference, then the opponent, then home/away.")],
    components: rows,
  };
}

async function reRenderTeamPicker(interaction: ButtonInteraction, page: number) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session || session.step !== "pick_team") return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();

  const linkedResult = await recApi.getLinkedUsersTeams(interaction.guildId).catch(() => null);
  const seen = new Set<string>();
  const linkedTeams = ((linkedResult?.linked ?? []) as any[])
    .map((row) => row.team)
    .filter((t) => t?.id && !seen.has(t.id) && seen.add(t.id))
    .sort((a: any, b: any) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

  session.teamListPage = page;
  touch(session);
  return interaction.editReply(renderTeamPicker(linkedTeams, page));
}

export async function handleCfbScheduleManualTeamPagePrev(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  return reRenderTeamPicker(interaction, (session?.teamListPage ?? 0) - 1);
}

export async function handleCfbScheduleManualTeamPageNext(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  return reRenderTeamPicker(interaction, (session?.teamListPage ?? 0) + 1);
}

export async function handleCfbScheduleManualTeamSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session || session.step !== "pick_team") return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();

  const { teams, game } = await loadTeams(interaction.guildId);
  const team = teams.find((t) => t.id === interaction.values[0]);
  if (!team) return interaction.editReply({ content: "That team could not be found.", embeds: [], components: [] });

  session.teamId = team.id;
  session.teamName = team.name;
  session.teams = teams;
  session.game = game;
  touch(session);

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(`Enter Schedule — ${team.name}`).setDescription("Loading the current season schedule…")],
    components: [],
  });

  try {
    session.weeks = await buildWeekEntries(interaction.guildId, team.id, game);
    session.weekIndex = 0;
    session.step = "pick_conference";
    touch(session);
    return interaction.editReply(renderCurrentWeek(session));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Enter Team Schedule").setColor(COLORS.error).setDescription(userFacingError(err))],
      components: [cancelRow()],
    });
  }
}

// Regular season only (0–14 for CFB) — matches the scope of the existing screenshot-import
// wizard; conference championship/playoff pairings aren't single-conference matchups, so they
// don't fit the conference-first opponent picker and stay in the existing edit tools.
async function buildWeekEntries(guildId: string, teamId: string, game: string | null): Promise<WeekEntry[]> {
  const lastWeek = regularSeasonWeeks(game);
  const confirmedByWeek = new Map<number, { opponentTeamId: string; opponentName: string; homeAway: "home" | "away" }>();

  const addWeek = (weekNumber: number, games: any[]) => {
    for (const g of games) {
      const isAway = g.away_team_id === teamId;
      const isHome = g.home_team_id === teamId;
      if (!isAway && !isHome) continue;
      const opponent = isAway ? g.home_team : g.away_team;
      confirmedByWeek.set(weekNumber, {
        opponentTeamId: isAway ? g.home_team_id : g.away_team_id,
        opponentName: opponent?.name ?? opponent?.abbreviation ?? "Team",
        homeAway: isAway ? "away" : "home",
      });
    }
  };

  // CFB's Week 0 is outside listScheduleSeason's 1-indexed week range, so it's fetched
  // separately to still catch an already-confirmed Week 0 matchup.
  if (isCfb(game)) {
    const week0 = await recApi.listScheduleWeek({ guildId, weekNumber: 0 }).catch(() => null);
    if (week0?.games?.length) addWeek(0, week0.games);
  }
  const season = await recApi.listScheduleSeason({ guildId }).catch(() => null);
  for (const week of season?.weeks ?? []) {
    if (week.weekNumber >= 1 && week.weekNumber <= lastWeek) addWeek(week.weekNumber, week.games ?? []);
  }

  const firstWeek = isCfb(game) ? 0 : 1;
  const entries: WeekEntry[] = [];
  for (let weekNumber = firstWeek; weekNumber <= lastWeek; weekNumber++) {
    const confirmed = confirmedByWeek.get(weekNumber);
    entries.push({
      weekNumber,
      isBye: false,
      opponentTeamId: confirmed?.opponentTeamId ?? null,
      opponentName: confirmed?.opponentName ?? null,
      homeAway: confirmed?.homeAway ?? null,
      alreadyConfirmed: Boolean(confirmed),
    });
  }
  return entries;
}

// ─── Per-week rendering ─────────────────────────────────────────────────────────

function renderCurrentWeek(session: Session) {
  if (session.weekIndex >= session.weeks.length) return renderComplete(session);
  const week = session.weeks[session.weekIndex];
  const label = weekLabel(week.weekNumber, session.game);

  if (week.alreadyConfirmed) {
    return {
      embeds: [new EmbedBuilder()
        .setTitle(`${session.teamName} — ${label}`)
        .setColor(COLORS.info)
        .setDescription([
          `Already set: **${week.homeAway === "home" ? "vs" : "at"} ${week.opponentName}**.`,
          "",
          "This week already has a confirmed matchup, so it's shown for reference only — change it from the existing schedule tools if it's wrong.",
        ].join("\n"))],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.continue).setLabel("Continue").setStyle(ButtonStyle.Primary),
        ),
        cancelRow(),
      ],
    };
  }

  const conferences = [...new Set(session.teams.map((t) => canonicalConferenceName(t.conference)).filter(Boolean))]
    .sort((a, b) => (CONFERENCE_ORDER.indexOf(a) + 1 || 99) - (CONFERENCE_ORDER.indexOf(b) + 1 || 99));
  const select = new StringSelectMenuBuilder()
    .setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.conferenceSelect)
    .setPlaceholder("Select BYE WEEK or a conference")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("BYE WEEK").setValue(BYE_VALUE).setDescription(`${session.teamName} has no game this week`),
      ...conferences.slice(0, 24).map((c) => new StringSelectMenuOptionBuilder().setLabel(`${c} Teams`).setValue(c)),
    );

  return {
    embeds: [new EmbedBuilder()
      .setTitle(`${session.teamName} — ${label}`)
      .setDescription("Pick **BYE WEEK**, or a conference to choose this week's opponent.")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.skip).setLabel("Skip This Week").setStyle(ButtonStyle.Secondary),
      ),
      cancelRow(),
    ],
  };
}

function renderComplete(session: Session) {
  return {
    embeds: [new EmbedBuilder()
      .setTitle(`${session.teamName} — Schedule Entry Complete`)
      .setColor(COLORS.success)
      .setDescription("Every week has been set, already confirmed, or skipped. Run this again to enter another team's schedule, or check **View Schedule** to review.")],
    components: [],
  };
}

async function advance(interaction: ButtonInteraction | StringSelectMenuInteraction, session: Session) {
  session.weekIndex += 1;
  session.step = "pick_conference";
  session.pendingConference = undefined;
  session.pendingOpponentTeamId = undefined;
  session.pendingOpponentName = undefined;
  touch(session);
  return interaction.editReply(renderCurrentWeek(session));
}

export async function handleCfbScheduleManualContinue(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  return advance(interaction, session);
}

export async function handleCfbScheduleManualSkip(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  return advance(interaction, session);
}

export async function handleCfbScheduleManualConferenceSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session || session.weekIndex >= session.weeks.length) return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();

  const value = interaction.values[0];
  const week = session.weeks[session.weekIndex];
  const label = weekLabel(week.weekNumber, session.game);

  if (value === BYE_VALUE) {
    week.isBye = true;
    week.opponentTeamId = null;
    week.opponentName = null;
    week.homeAway = null;
    return advance(interaction, session);
  }

  session.pendingConference = value;
  session.step = "pick_opponent";
  touch(session);

  const { teams } = await loadTeams(interaction.guildId);
  const inConference = teams
    .filter((t) => t.id !== session.teamId && canonicalConferenceName(t.conference) === value)
    .sort((a, b) => a.name.localeCompare(b.name));

  const select = new StringSelectMenuBuilder()
    .setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.opponentSelect)
    .setPlaceholder("Select the opponent")
    .addOptions(
      inConference.length
        ? inConference.slice(0, 25).map((t) => new StringSelectMenuOptionBuilder().setLabel(t.name.slice(0, 100)).setValue(t.id))
        : [new StringSelectMenuOptionBuilder().setLabel("No teams found in this conference").setValue("NONE")],
    );

  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(`${session.teamName} — ${label}`).setDescription(`Select the ${value} opponent.`)],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.skip).setLabel("Skip This Week").setStyle(ButtonStyle.Secondary),
      ),
      cancelRow(),
    ],
  });
}

export async function handleCfbScheduleManualOpponentSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session || session.step !== "pick_opponent" || session.weekIndex >= session.weeks.length) {
    return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  if (interaction.values[0] === "NONE") return interaction.editReply(renderCurrentWeek(session));

  const { teams } = await loadTeams(interaction.guildId);
  const team = teams.find((t) => t.id === interaction.values[0]);
  if (!team) return interaction.editReply({ content: "That team could not be found.", embeds: [], components: [] });

  session.pendingOpponentTeamId = team.id;
  session.pendingOpponentName = team.name;
  session.step = "pick_home_away";
  touch(session);

  const label = weekLabel(session.weeks[session.weekIndex].weekNumber, session.game);
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle(`${session.teamName} — ${label}`)
      .setDescription(`Opponent set to **${team.name}**. Is **${session.teamName}** home or away this week?`)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.home).setLabel(`${session.teamName} is Home`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.away).setLabel(`${session.teamName} is Away`).setStyle(ButtonStyle.Primary),
      ),
      cancelRow(),
    ],
  });
}

async function saveHomeAway(interaction: ButtonInteraction, homeAway: "home" | "away") {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session || session.step !== "pick_home_away" || session.weekIndex >= session.weeks.length || !session.pendingOpponentTeamId) {
    return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();

  const week = session.weeks[session.weekIndex];
  const awayTeamId = homeAway === "away" ? session.teamId! : session.pendingOpponentTeamId;
  const homeTeamId = homeAway === "away" ? session.pendingOpponentTeamId : session.teamId!;

  try {
    const currentWeek = await recApi.listScheduleWeek({ guildId: session.guildId, weekNumber: week.weekNumber });
    const slotNumber = (currentWeek?.games ?? []).length + 1;
    await recApi.saveManualScheduleGame({
      guildId: session.guildId,
      weekNumber: week.weekNumber,
      slotNumber,
      awayTeamId,
      homeTeamId,
      requestedByDiscordId: interaction.user.id,
    });
  } catch (err) {
    const label = weekLabel(week.weekNumber, session.game);
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle(`${session.teamName} — ${label}`).setColor(COLORS.error).setDescription(userFacingError(err))],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(CFB_SCHEDULE_MANUAL_CUSTOM_IDS.skip).setLabel("Skip This Week").setStyle(ButtonStyle.Secondary),
        ),
        cancelRow(),
      ],
    });
  }

  week.isBye = false;
  week.opponentTeamId = session.pendingOpponentTeamId;
  week.opponentName = session.pendingOpponentName ?? null;
  week.homeAway = homeAway;
  week.alreadyConfirmed = true;
  return advance(interaction, session);
}

export async function handleCfbScheduleManualHome(interaction: ButtonInteraction) {
  return saveHomeAway(interaction, "home");
}

export async function handleCfbScheduleManualAway(interaction: ButtonInteraction) {
  return saveHomeAway(interaction, "away");
}

export async function handleCfbScheduleManualCancel(interaction: ButtonInteraction, buildScheduleMgmtRows: () => any[]) {
  if (!interaction.inCachedGuild()) return;
  sessions.delete(key(interaction.guildId, interaction.user.id));
  await interaction.deferUpdate();
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Schedule").setDescription("Choose how you want to upload, enter, or view league schedule data.")],
    components: buildScheduleMgmtRows(),
  });
}
