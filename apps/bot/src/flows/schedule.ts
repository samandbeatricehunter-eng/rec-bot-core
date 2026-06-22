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
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { buildAdminPanelEmbed, buildAdminPanelRows, buildScheduleEmbed, buildScheduleRows, MENU_CUSTOM_IDS } from "../ui/menu.js";

export const SCHEDULE_MGMT_CUSTOM_IDS = {
  manualWeekSelect: "rec:schedule_manual:week",
  manualAfcSelect: "rec:schedule_manual:afc",
  manualNfcSelect: "rec:schedule_manual:nfc",
  manualNextMatchup: "rec:schedule_manual:next_matchup",
  manualNextWeek: "rec:schedule_manual:next_week",
  manualContinueNextWeek: "rec:schedule_manual:continue_next_week",
  manualComplete: "rec:schedule_manual:complete",
  manualBack: "rec:schedule_manual:back",
  viewPrev: "rec:schedule_view:prev",
  viewNext: "rec:schedule_view:next",
  viewPostPublicly: "rec:schedule_view:post_public",
  viewBack: "rec:schedule_view:back",
} as const;

export const POST_SETUP_SCHEDULE_CUSTOM_IDS = {
  prev: "rec:post_setup_schedule:prev",
  next: "rec:post_setup_schedule:next",
  finish: "rec:post_setup_schedule:finish",
  continueFromTeams: "rec:league_setup:continue_schedule_review",
} as const;

const POST_SETUP_MAX_WEEK = 18;

type ManualTeam = {
  id: string;
  name: string;
  abbreviation?: string | null;
  display_abbr?: string | null;
  display_city?: string | null;
  display_nick?: string | null;
  conference?: string | null;
  division?: string | null;
};

type ManualScheduleSession = {
  guildId: string;
  userId: string;
  seasonNumber: number;
  currentWeek: number;
  weekNumber: number;
  teams: ManualTeam[];
  selectedTeamIds: string[];
  games: any[];
  warnedIncomplete: boolean;
  notice?: string | null;
};

const manualScheduleSessions = new Map<string, ManualScheduleSession>();
const sessionKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

type ScheduleViewSession = {
  guildId: string;
  userId: string;
  leagueName?: string | null;
  seasonNumber: number;
  pageIndex: number;
  weeks: Array<{ weekNumber: number; phase?: string | null; games: any[] }>;
  mode: "admin" | "post_setup";
};

const scheduleViewSessions = new Map<string, ScheduleViewSession>();
const postSetupSessions = new Map<string, { guildId: string }>();

export function markPostSetupActive(userId: string, guildId: string) {
  postSetupSessions.set(userId, { guildId });
}

export function clearPostSetupSession(userId: string) {
  postSetupSessions.delete(userId);
}

export function isPostSetupActive(userId: string) {
  return postSetupSessions.has(userId);
}

export async function renderScheduleMenu(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Schedule").setDescription("Open /menu inside a REC Discord server to view league schedules.")],
      components: buildScheduleRows()
    });
  }

  const schedule = await recApi.getUserSchedule(interaction.user.id, interaction.guildId);
  return interaction.editReply({
    embeds: [
      buildScheduleEmbed({
        leagueName: schedule?.league?.name ?? null,
        teamName: schedule?.team?.name ?? null,
        isLinked: Boolean(schedule?.isLinked),
        games: schedule?.games ?? []
      })
    ],
    components: buildScheduleRows()
  });
}

export async function renderSchedulePlaceholder(interaction: ButtonInteraction, title: string, description: string) {
  return interaction.reply({
    embeds: [new EmbedBuilder().setTitle(title).setDescription(description)],
    ephemeral: true
  });
}

export async function startManualScheduleEntry(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can set the league schedule.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });

  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Manual Schedule...").setDescription("Fetching league teams so you can choose weekly matchups.")], components: [] });
  try {
    const data = await recApi.listScheduleTeams(interaction.guildId);
    const teams: ManualTeam[] = data?.teams ?? [];
    if (teams.length < 2) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Manual Schedule").setDescription("No league teams are set up yet.")],
        components: [scheduleBackRow()],
      });
    }
    const session: ManualScheduleSession = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      seasonNumber: Number(data?.league?.seasonNumber ?? 1),
      currentWeek: Number(data?.league?.currentWeek ?? 1),
      weekNumber: 1,
      teams,
      selectedTeamIds: [],
      games: [],
      warnedIncomplete: false,
      notice: null,
    };
    manualScheduleSessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    return interaction.editReply(renderManualWeekPicker(session));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Manual Schedule").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [scheduleBackRow()],
    });
  }
}

export async function handleManualScheduleWeekSelect(interaction: StringSelectMenuInteraction) {
  const session = getManualSession(interaction);
  if (!session) return interaction.reply({ content: "Manual schedule session expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  session.weekNumber = Number(interaction.values[0] ?? 1);
  session.selectedTeamIds = [];
  session.warnedIncomplete = false;
  session.notice = null;
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Week...").setDescription("Fetching the saved matchups for the selected week.")], components: [] });
  await refreshWeek(session);
  return interaction.editReply(renderManualEntry(session));
}

export async function handleManualScheduleTeamSelect(interaction: StringSelectMenuInteraction) {
  const session = getManualSession(interaction);
  if (!session) return interaction.reply({ content: "Manual schedule session expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  const next = [...session.selectedTeamIds];
  for (const teamId of interaction.values) {
    if (next.length >= 2) break;
    if (!next.includes(teamId)) next.push(teamId);
  }
  session.selectedTeamIds = next.slice(0, 2);
  session.notice = session.selectedTeamIds.length === 2
    ? "Selection ready. The first team is Away and the second team is Home."
    : "Select one more team. The first selected team is Away; the second selected team is Home.";
  return interaction.update(renderManualEntry(session));
}

export async function handleManualScheduleNextMatchup(interaction: ButtonInteraction) {
  const session = getManualSession(interaction);
  if (!session) return interaction.reply({ content: "Manual schedule session expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Saving Matchup...").setDescription("Saving the selected Away/Home matchup to the weekly schedule.")], components: [] });
  const saved = await saveSelectedMatchup(session, interaction.user.id).catch((err) => {
    session.notice = err instanceof Error ? err.message : String(err);
    return false;
  });
  if (saved) {
    session.selectedTeamIds = [];
    session.warnedIncomplete = false;
    session.notice = "Matchup saved. Select the next Away/Home pair.";
  }
  return interaction.editReply(renderManualEntry(session));
}

export async function handleManualScheduleNextWeek(interaction: ButtonInteraction, force = false) {
  const session = getManualSession(interaction);
  if (!session) return interaction.reply({ content: "Manual schedule session expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Next Week...").setDescription("Checking whether this week is complete, then loading the next schedule page.")], components: [] });

  const expected = expectedGamesForWeek(session);
  if (!force && session.games.length < expected) {
    session.warnedIncomplete = true;
    session.notice = `Week ${session.weekNumber} has ${session.games.length}/${expected} expected games. Continuing without the full schedule can cause schedule issues and game channel creation issues.`;
    return interaction.editReply(renderManualEntry(session));
  }

  session.weekNumber = Math.min(22, session.weekNumber + 1);
  session.selectedTeamIds = [];
  session.warnedIncomplete = false;
  session.notice = null;
  await refreshWeek(session);
  return interaction.editReply(renderManualEntry(session));
}

export async function handleManualScheduleComplete(interaction: ButtonInteraction) {
  const session = getManualSession(interaction);
  if (!session) return interaction.reply({ content: "Manual schedule session expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Completing Schedule Entry...").setDescription("Saving any selected matchup and returning to League Mgmt.")], components: [] });
  if (session.selectedTeamIds.length === 2) {
    const saved = await saveSelectedMatchup(session, interaction.user.id).catch((err) => {
      session.notice = err instanceof Error ? err.message : String(err);
      return false;
    });
    if (!saved) return interaction.editReply(renderManualEntry(session));
  }
  manualScheduleSessions.delete(sessionKey(session.guildId, session.userId));
  return interaction.editReply({
    embeds: [buildAdminPanelEmbed().setDescription("Manual schedule entry completed. Your saved matchups are logged in the league schedule.")],
    components: buildAdminPanelRows(),
  });
}

export async function handleManualScheduleBack(interaction: ButtonInteraction) {
  if (interaction.inCachedGuild()) manualScheduleSessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Schedule")
      .setDescription("Choose how you want to upload, enter, or view league schedule data.")],
    components: scheduleManagementRows(),
  });
}

export async function startScheduleViewer(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only authorized admins can view the full league schedule.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Schedule...").setDescription("Fetching all regular-season, postseason, and Super Bowl week pages.")], components: [] });
  try {
    const result = await recApi.listScheduleSeason({ guildId: interaction.guildId });
    const session: ScheduleViewSession = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      leagueName: result?.league?.name ?? null,
      seasonNumber: Number(result?.league?.seasonNumber ?? 1),
      pageIndex: 0,
      weeks: result?.weeks ?? [],
      mode: "admin",
    };
    scheduleViewSessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    return interaction.editReply(renderScheduleView(session));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("View Schedule").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [scheduleBackRow()],
    });
  }
}

export async function handleScheduleViewPage(interaction: ButtonInteraction, delta: number) {
  const session = getScheduleViewSession(interaction);
  if (!session) return interaction.reply({ content: "Schedule view expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  session.pageIndex = Math.max(0, Math.min(session.weeks.length - 1, session.pageIndex + delta));
  return interaction.update(renderScheduleView(session));
}

export async function handleScheduleViewPostPublicly(interaction: ButtonInteraction) {
  const session = getScheduleViewSession(interaction);
  if (!session) return interaction.reply({ content: "Schedule view expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  if (!interaction.channel?.isTextBased() || !("send" in interaction.channel)) return interaction.reply({ content: "I can't post in this channel.", flags: MessageFlags.Ephemeral });
  await interaction.channel.send({ embeds: [buildScheduleWeekEmbed(session)] });
  return interaction.reply({ content: "Posted this schedule page publicly.", flags: MessageFlags.Ephemeral });
}

export async function handleScheduleViewBack(interaction: ButtonInteraction) {
  const session = getScheduleViewSession(interaction);
  if (session?.mode === "post_setup") return handlePostSetupScheduleFinish(interaction);
  if (interaction.inCachedGuild()) scheduleViewSessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Schedule")
      .setDescription("Choose how you want to upload, enter, or view league schedule data.")],
    components: scheduleManagementRows(),
  });
}

function filterPostSetupWeeks(weeks: ScheduleViewSession["weeks"]) {
  const filtered = weeks.filter((week) => week.weekNumber >= 1 && week.weekNumber <= POST_SETUP_MAX_WEEK);
  if (filtered.length > 0) return filtered;
  return Array.from({ length: POST_SETUP_MAX_WEEK }, (_, idx) => ({
    weekNumber: idx + 1,
    phase: "regular_season",
    games: [],
  }));
}

export async function startPostSetupScheduleReview(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Loading Schedule...").setDescription(`Fetching Weeks 1–${POST_SETUP_MAX_WEEK} for review.`)],
    components: [],
  });
  try {
    const result = await recApi.listScheduleSeason({ guildId: interaction.guildId });
    const session: ScheduleViewSession = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      leagueName: result?.league?.name ?? null,
      seasonNumber: Number(result?.league?.seasonNumber ?? 1),
      pageIndex: 0,
      weeks: filterPostSetupWeeks(result?.weeks ?? []),
      mode: "post_setup",
    };
    scheduleViewSessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    return interaction.editReply(renderPostSetupScheduleView(session));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Schedule Review").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.finish).setLabel("Finish Setup").setStyle(ButtonStyle.Success)
        ),
      ],
    });
  }
}

export async function handlePostSetupScheduleViewPage(interaction: ButtonInteraction, delta: number) {
  const session = getScheduleViewSession(interaction);
  if (!session || session.mode !== "post_setup") {
    return interaction.reply({ content: "Schedule review expired. Open Admin Panel → League Setup again.", flags: MessageFlags.Ephemeral });
  }
  session.pageIndex = Math.max(0, Math.min(session.weeks.length - 1, session.pageIndex + delta));
  return interaction.update(renderPostSetupScheduleView(session));
}

export async function handlePostSetupScheduleFinish(interaction: ButtonInteraction) {
  if (interaction.inCachedGuild()) scheduleViewSessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  clearPostSetupSession(interaction.user.id);
  return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
}

function getScheduleViewSession(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return null;
  return scheduleViewSessions.get(sessionKey(interaction.guildId, interaction.user.id)) ?? null;
}

function getManualSession(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return null;
  return manualScheduleSessions.get(sessionKey(interaction.guildId, interaction.user.id)) ?? null;
}

async function refreshWeek(session: ManualScheduleSession) {
  const week = await recApi.listScheduleWeek({ guildId: session.guildId, seasonNumber: session.seasonNumber, weekNumber: session.weekNumber });
  session.games = week?.games ?? [];
}

async function saveSelectedMatchup(session: ManualScheduleSession, requestedByDiscordId: string) {
  if (session.selectedTeamIds.length !== 2) {
    session.notice = "Select exactly two teams before saving a matchup. The first selected team is Away; the second selected team is Home.";
    return false;
  }
  const [awayTeamId, homeTeamId] = session.selectedTeamIds;
  const result = await recApi.saveManualScheduleGame({
    guildId: session.guildId,
    seasonNumber: session.seasonNumber,
    weekNumber: session.weekNumber,
    slotNumber: session.games.length + 1,
    awayTeamId,
    homeTeamId,
    requestedByDiscordId,
  });
  session.games = result?.week?.games ?? [];
  return true;
}

function expectedGamesForWeek(session: ManualScheduleSession) {
  return Math.floor(session.teams.length / 2);
}

function displayTeam(team: ManualTeam | any) {
  const abbr = team?.display_abbr ?? team?.abbreviation;
  if (team?.display_city || team?.display_nick) return `${team.display_city ?? ""} ${team.display_nick ?? team.name}`.trim();
  return abbr ? `${abbr} - ${team?.name ?? "Team"}` : team?.name ?? "Team";
}

function conferenceOf(team: ManualTeam) {
  const conf = String(team.conference ?? "").toUpperCase();
  if (conf === "AFC" || conf === "NFC") return conf;
  const division = String(team.division ?? "").toUpperCase();
  if (division.includes("AFC")) return "AFC";
  if (division.includes("NFC")) return "NFC";
  return "Other";
}

function renderManualWeekPicker(session: ManualScheduleSession) {
  const options = Array.from({ length: 22 }, (_, idx) => {
    const week = idx + 1;
    const label = week <= 18 ? `Week ${week}` : ["Wild Card", "Divisional", "Conference Championship", "Super Bowl"][week - 19] ?? `Week ${week}`;
    return new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(week));
  });
  return {
    embeds: [new EmbedBuilder()
      .setTitle("Manual Schedule")
      .setDescription("Select the week you want to enter manually. After selecting a week, choose two teams per matchup. The first team selected is logged as Away; the second team selected is logged as Home.")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualWeekSelect).setPlaceholder("Select week").addOptions(options)
      ),
      scheduleBackRow(),
    ],
  };
}

function renderManualEntry(session: ManualScheduleSession) {
  const selected = session.selectedTeamIds.map((id, idx) => `${idx === 0 ? "Away" : "Home"}: **${displayTeam(session.teams.find((team) => team.id === id))}**`);
  const games = session.games.map((game: any, idx: number) => {
    const away = displayTeam(game.away_team ?? session.teams.find((team) => team.id === game.away_team_id));
    const home = displayTeam(game.home_team ?? session.teams.find((team) => team.id === game.home_team_id));
    return `${idx + 1}. ${away} at ${home}`;
  });
  const expected = expectedGamesForWeek(session);
  const description = [
    `Week ${session.weekNumber} manual entry`,
    "",
    "**Selection order matters:** first selected team is Away, second selected team is Home.",
    selected.length ? selected.join("\n") : "No teams selected for the next matchup.",
    "",
    `Saved matchups: ${session.games.length}/${expected}`,
    games.length ? games.join("\n") : "No matchups saved for this week yet.",
    session.notice ? `\n**Notice:** ${session.notice}` : "",
  ].filter(Boolean).join("\n");

  return {
    embeds: [new EmbedBuilder().setTitle("Manual Schedule").setDescription(description.slice(0, 4096)).setColor(session.warnedIncomplete ? 0xf1c40f : 0x3498db)],
    components: [...teamSelectRows(session), actionRows(session)],
  };
}

function teamSelectRows(session: ManualScheduleSession) {
  const used = new Set(session.games.flatMap((game: any) => [game.away_team_id, game.home_team_id]).filter(Boolean));
  const availableTeams = session.teams.filter((team) => !used.has(team.id) && !session.selectedTeamIds.includes(team.id));
  const buildSelect = (conference: "AFC" | "NFC", customId: string) => {
    const teams = availableTeams.filter((team) => conferenceOf(team) === conference).slice(0, 25);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(`${conference} teams`)
      .setMinValues(1)
      .setMaxValues(Math.min(2, Math.max(1, teams.length)))
      .setDisabled(session.selectedTeamIds.length >= 2 || teams.length === 0);
    if (teams.length) {
      menu.addOptions(teams.map((team) => new StringSelectMenuOptionBuilder()
        .setLabel(displayTeam(team).slice(0, 100))
        .setValue(team.id)
        .setDescription((team.division ?? conference).slice(0, 100))));
    } else {
      menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(`No ${conference} teams available`).setValue(`none-${conference}`));
    }
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  };
  return [
    buildSelect("AFC", SCHEDULE_MGMT_CUSTOM_IDS.manualAfcSelect),
    buildSelect("NFC", SCHEDULE_MGMT_CUSTOM_IDS.manualNfcSelect),
  ];
}

function actionRows(session: ManualScheduleSession) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualNextMatchup).setLabel("Next Matchup").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(session.warnedIncomplete ? SCHEDULE_MGMT_CUSTOM_IDS.manualContinueNextWeek : SCHEDULE_MGMT_CUSTOM_IDS.manualNextWeek)
      .setLabel(session.warnedIncomplete ? "Continue Next Week" : "Next Week")
      .setStyle(session.warnedIncomplete ? ButtonStyle.Danger : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualComplete).setLabel("Complete Schedule").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualBack).setLabel("Back").setStyle(ButtonStyle.Secondary)
  );
}

function scheduleBackRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualBack).setLabel("Back").setStyle(ButtonStyle.Secondary)
  );
}

function scheduleManagementRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleWizard).setLabel("Schedule Wizard").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleOneWeek).setLabel("Upload One Week").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleManual).setLabel("Set Manually").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleView).setLabel("View Schedule").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleBack).setLabel("Back").setStyle(ButtonStyle.Secondary)
    )
  ];
}

function formatViewWeekLabel(weekNumber: number) {
  if (weekNumber <= 18) return `Week ${weekNumber}`;
  if (weekNumber === 19) return "Wild Card Week";
  if (weekNumber === 20) return "Divisional Week";
  if (weekNumber === 21) return "Conference Championship Week";
  if (weekNumber === 22) return "Super Bowl Week";
  return `Week ${weekNumber}`;
}

function formatScheduleParticipant(team: any, discordId?: string | null) {
  if (discordId) return `<@${discordId}>`;
  if (team?.display_city || team?.display_nick) return `${team.display_city ?? ""} ${team.display_nick ?? team.name}`.trim();
  return team?.display_abbr ?? team?.abbreviation ?? team?.name ?? "TBD";
}

function buildScheduleWeekEmbed(session: ScheduleViewSession) {
  const page = session.weeks[session.pageIndex] ?? { weekNumber: session.pageIndex + 1, games: [] };
  const lines = page.games.length
    ? page.games.map((game: any, idx: number) => {
      const away = formatScheduleParticipant(game.away_team, game.away_discord_id);
      const home = formatScheduleParticipant(game.home_team, game.home_discord_id);
      return `${idx + 1}. ${away} at ${home}`;
    }).join("\n")
    : "No games have been set for this week yet.";
  return new EmbedBuilder()
    .setTitle(`${session.leagueName ?? "League"} Schedule - ${formatViewWeekLabel(page.weekNumber)}`)
    .setDescription(lines.slice(0, 4096))
    .setFooter({ text: `Season ${session.seasonNumber} - Page ${session.pageIndex + 1}/${session.weeks.length || 22}` });
}

function renderScheduleView(session: ScheduleViewSession) {
  const last = Math.max(0, session.weeks.length - 1);
  return {
    embeds: [buildScheduleWeekEmbed(session)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.viewPrev).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(session.pageIndex <= 0),
        new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.viewNext).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(session.pageIndex >= last),
        new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.viewPostPublicly).setLabel("Post Publicly").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.viewBack).setLabel("Back").setStyle(ButtonStyle.Secondary)
      )
    ],
  };
}

function renderPostSetupScheduleView(session: ScheduleViewSession) {
  const last = Math.max(0, session.weeks.length - 1);
  const onLastPage = session.pageIndex >= last;
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("League Setup: Review Schedule")
        .setDescription([
          "Review each regular-season week before finishing setup. Use **Previous** / **Next** to walk Weeks 1–18.",
          "",
          buildScheduleWeekEmbed(session).data.description ?? "No games have been set for this week yet.",
        ].join("\n").slice(0, 4096))
        .setFooter({ text: `Season ${session.seasonNumber} — Week ${session.weeks[session.pageIndex]?.weekNumber ?? session.pageIndex + 1} of ${POST_SETUP_MAX_WEEK}` }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.prev).setLabel("Previous Week").setStyle(ButtonStyle.Secondary).setDisabled(session.pageIndex <= 0),
        new ButtonBuilder().setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.next).setLabel("Next Week").setStyle(ButtonStyle.Primary).setDisabled(onLastPage),
        new ButtonBuilder()
          .setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.finish)
          .setLabel(onLastPage ? "Finish Setup" : "Skip to Finish")
          .setStyle(ButtonStyle.Success),
      ),
    ],
  };
}
