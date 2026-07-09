import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type Message,
  type StringSelectMenuInteraction,
} from "discord.js";
import { canonicalConferenceName, CONFERENCE_ORDER, stageForWeek, stageLabel } from "@rec/shared";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { COLORS } from "../lib/colors.js";
import { recApi } from "../lib/rec-api.js";

// ─── CFB Team Schedule import wizard ───────────────────────────────────────────
// Commissioner picks a conference, then a team, then uploads that team's in-game
// "Team Schedule" screenshot(s) (1-2 images cover a full season). The parser reads
// each week's opponent + home/away; weeks that already have a confirmed matchup
// (from this or an earlier team's upload — a game row involves both teams at
// once) come back locked. The commissioner can edit any unconfirmed week before
// approving, at which point every remaining decision is saved — which also
// populates the OPPONENT team's schedule for that week, since one rec_games row
// covers both sides of the matchup.

export const CFB_TEAM_SCHEDULE_CUSTOM_IDS = {
  conferenceSelect: "rec:cfb_sched:conference",
  teamSelect: "rec:cfb_sched:team",
  editWeekSelect: "rec:cfb_sched:edit_week",
  editTeamSelect: "rec:cfb_sched:edit_team",
  editHome: "rec:cfb_sched:edit_home",
  editAway: "rec:cfb_sched:edit_away",
  editBack: "rec:cfb_sched:edit_back",
  approve: "rec:cfb_sched:approve",
  cancel: "rec:cfb_sched:cancel",
} as const;

type TeamOption = { id: string; name: string; abbreviation: string | null; conference: string | null };

type WeekState = {
  weekNumber: number | null;
  weekLabel: string;
  isBye: boolean;
  opponentRaw: string | null;
  matchedOpponentTeamId: string | null;
  matchedOpponentName: string | null;
  matchConfidence: number | null;
  homeAway: "home" | "away" | null;
  alreadyConfirmed: boolean;
  confirmedOpponentName: string | null;
  confirmedHomeAway: "home" | "away" | null;
  // Commissioner override from the edit screen, if any — wins over the parsed match.
  overrideOpponentTeamId: string | null;
  overrideOpponentName: string | null;
  overrideHomeAway: "home" | "away" | null;
};

type Session = {
  guildId: string;
  userId: string;
  channelId: string;
  step: "pick_conference" | "pick_team" | "awaiting_upload" | "review" | "edit_week";
  conference?: string;
  teamId?: string;
  teamName?: string;
  weeks: WeekState[];
  editingWeek?: number;
  warnings: string[];
  at: number;
  // The interaction that put us into "awaiting_upload" (the team-select interaction) — held so
  // the screenshot-upload listener (a message event, not an interaction) can editReply() the
  // same ephemeral message for the review, instead of posting a new public channel message.
  interaction?: StringSelectMenuInteraction;
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

// ─── Entry point ────────────────────────────────────────────────────────────────

export async function startCfbTeamScheduleImport(interaction: ButtonInteraction, buildScheduleMgmtRows: () => any[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners or server admins can import a team schedule.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  const { teams, game } = await loadTeams(interaction.guildId).catch(() => ({ teams: [] as TeamOption[], game: null }));
  if (game !== "cfb_27") {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Import Team Schedule").setColor(COLORS.error).setDescription("This tool is only available for CFB leagues.")],
      components: buildScheduleMgmtRows(),
    });
  }
  sessions.set(key(interaction.guildId, interaction.user.id), {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    step: "pick_conference",
    weeks: [],
    warnings: [],
    at: Date.now(),
  });

  const conferences = [...new Set(teams.map((t) => canonicalConferenceName(t.conference)).filter(Boolean))]
    .sort((a, b) => (CONFERENCE_ORDER.indexOf(a) + 1 || 99) - (CONFERENCE_ORDER.indexOf(b) + 1 || 99));
  const select = new StringSelectMenuBuilder()
    .setCustomId(CFB_TEAM_SCHEDULE_CUSTOM_IDS.conferenceSelect)
    .setPlaceholder("Select a conference")
    .addOptions(conferences.slice(0, 25).map((c) => new StringSelectMenuOptionBuilder().setLabel(c).setValue(c)));

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Import Team Schedule")
      .setDescription("Step 1 of 3: select the conference of the team whose schedule you're uploading.")],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), cancelRow()],
  });
}

function cancelRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CFB_TEAM_SCHEDULE_CUSTOM_IDS.cancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
}

export async function handleCfbTeamScheduleConferenceSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();

  const conference = interaction.values[0];
  const { teams } = await loadTeams(interaction.guildId);
  const inConference = teams.filter((t) => canonicalConferenceName(t.conference) === conference).sort((a, b) => a.name.localeCompare(b.name));

  session.step = "pick_team";
  session.conference = conference;
  touch(session);

  const select = new StringSelectMenuBuilder()
    .setCustomId(CFB_TEAM_SCHEDULE_CUSTOM_IDS.teamSelect)
    .setPlaceholder("Select a team")
    .addOptions(inConference.slice(0, 25).map((t) => new StringSelectMenuOptionBuilder().setLabel(t.name.slice(0, 100)).setValue(t.id)));

  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Import Team Schedule").setDescription(`Step 2 of 3: select the ${conference} team whose schedule you're uploading.`)],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

export async function handleCfbTeamScheduleTeamSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();

  const { teams } = await loadTeams(interaction.guildId);
  const team = teams.find((t) => t.id === interaction.values[0]);
  if (!team) return interaction.editReply({ content: "That team could not be found.", embeds: [], components: [] });

  session.step = "awaiting_upload";
  session.teamId = team.id;
  session.teamName = team.name;
  session.interaction = interaction;
  touch(session);

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle(`Import Team Schedule — ${team.name}`)
      .setColor(COLORS.info)
      .setDescription([
        `Step 3 of 3: post **${team.name}**'s **Team Schedule** screenshot(s) in this channel — attach **1 or 2 images** (top + bottom of the list) to a single message.`,
        "",
        "I'll read each week's opponent and home/away, match them to your league's teams, and show a review before saving.",
      ].join("\n"))],
    components: [],
  });
}

// ─── Screenshot listener ───────────────────────────────────────────────────────

export async function handleCfbTeamScheduleUploadMessage(message: Message): Promise<boolean> {
  if (!message.inGuild() || message.author.bot) return false;
  const session = getSession(message.guildId, message.author.id);
  if (!session || session.step !== "awaiting_upload" || session.channelId !== message.channelId) return false;
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return false;
  if (!session.interaction) return false;

  const images = [...message.attachments.values()]
    .filter((a) => (a.contentType?.startsWith("image/") ?? false) || /\.(png|jpe?g|webp)$/i.test(a.name ?? ""))
    .map((a) => a.url)
    .slice(0, 2);
  if (images.length === 0) return false;

  // Everything stays on this one ephemeral message (the team-select interaction's reply) rather
  // than posting a new public channel message — a message event has no interaction of its own
  // to reply to, so this reuses the stored one from the last step instead of channel.send().
  await session.interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Reading schedule…").setDescription(`Parsing ${session.teamName}'s schedule. This can take ~30–60 seconds.`)],
    components: [],
  }).catch(() => undefined);

  try {
    const preview = await recApi.previewCfbTeamScheduleImport({ guildId: session.guildId, teamId: session.teamId!, imageUrls: images });
    await message.delete().catch(() => undefined);

    session.weeks = (preview.weeks ?? []).map((w: any) => ({
      weekNumber: w.weekNumber,
      weekLabel: w.weekLabel,
      isBye: w.isBye,
      opponentRaw: w.opponentRaw,
      matchedOpponentTeamId: w.matchedOpponentTeamId,
      matchedOpponentName: w.matchedOpponentName,
      matchConfidence: w.matchConfidence,
      homeAway: w.homeAway,
      alreadyConfirmed: w.alreadyConfirmed,
      confirmedOpponentName: w.confirmedOpponentName,
      confirmedHomeAway: w.confirmedHomeAway,
      overrideOpponentTeamId: null,
      overrideOpponentName: null,
      overrideHomeAway: null,
    }));
    session.warnings = preview.warnings ?? [];
    session.step = "review";
    touch(session);

    await session.interaction.editReply({ embeds: [buildReviewEmbed(session)], components: await buildReviewRows(session) }).catch(() => undefined);
  } catch (err) {
    await message.delete().catch(() => undefined);
    await session.interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Couldn't read schedule").setColor(COLORS.error).setDescription(userFacingError(err))], components: [] }).catch(() => undefined);
    sessions.delete(key(session.guildId, session.userId));
  }
  return true;
}

// ─── Review embed / rows ──────────────────────────────────────────────────────

function effectiveWeek(week: WeekState): { opponentName: string | null; homeAway: "home" | "away" | null; opponentTeamId: string | null; locked: boolean } {
  if (week.alreadyConfirmed) return { opponentName: week.confirmedOpponentName, homeAway: week.confirmedHomeAway, opponentTeamId: null, locked: true };
  if (week.overrideOpponentTeamId) return { opponentName: week.overrideOpponentName, homeAway: week.overrideHomeAway, opponentTeamId: week.overrideOpponentTeamId, locked: false };
  return { opponentName: week.matchedOpponentName, homeAway: week.homeAway, opponentTeamId: week.matchedOpponentTeamId, locked: false };
}

function weekLine(week: WeekState): string {
  const label = week.weekNumber != null ? stageLabel(stageForWeek(week.weekNumber, "cfb_27"), week.weekNumber, "cfb_27") : week.weekLabel;
  if (week.isBye) return `**${label}**: Bye`;
  const eff = effectiveWeek(week);
  const sideText = eff.homeAway === "home" ? "vs" : eff.homeAway === "away" ? "at" : "vs/at ?";
  const name = eff.opponentName ?? (week.opponentRaw ? `"${week.opponentRaw}" (unmatched)` : "Unknown");
  const status = eff.locked ? "✅ confirmed" : eff.opponentTeamId ? "✓ matched" : "⚠ needs review";
  return `**${label}**: ${sideText} ${name} — ${status}`;
}

function buildReviewEmbed(session: Session): EmbedBuilder {
  const lines = session.weeks.filter((w) => w.weekNumber != null).map(weekLine);
  const needsReview = session.weeks.filter((w) => !w.isBye && !effectiveWeek(w).locked && !effectiveWeek(w).opponentTeamId).length;
  return new EmbedBuilder()
    .setTitle(`Team Schedule Review — ${session.teamName}`)
    .setColor(needsReview ? 0xf1c40f : 0x3498db)
    .setDescription(lines.length ? lines.join("\n").slice(0, 4096) : "No week rows could be read from the screenshot.")
    .addFields({
      name: "STATUS",
      value: needsReview
        ? `**${needsReview}** week${needsReview === 1 ? "" : "s"} need${needsReview === 1 ? "s" : ""} a manual opponent pick before saving. Use **Edit a Week** below.`
        : "Every week is matched or already confirmed. Review, then **Approve & Save**.",
      inline: false,
    });
}

async function buildReviewRows(session: Session) {
  const editable = session.weeks.filter((w) => w.weekNumber != null && !w.isBye && !effectiveWeek(w).locked);
  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>> = [];
  if (editable.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(CFB_TEAM_SCHEDULE_CUSTOM_IDS.editWeekSelect)
      .setPlaceholder("Edit a week's opponent/home-away")
      .addOptions(editable.slice(0, 25).map((w) => new StringSelectMenuOptionBuilder()
        .setLabel(`${stageLabel(stageForWeek(w.weekNumber!, "cfb_27"), w.weekNumber!, "cfb_27")}`.slice(0, 100))
        .setDescription((effectiveWeek(w).opponentName ?? w.opponentRaw ?? "No match").slice(0, 100))
        .setValue(String(w.weekNumber))));
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CFB_TEAM_SCHEDULE_CUSTOM_IDS.approve).setLabel("Approve & Save").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CFB_TEAM_SCHEDULE_CUSTOM_IDS.cancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

// ─── Edit a week ────────────────────────────────────────────────────────────────

export async function handleCfbTeamScheduleEditWeekSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session || session.step !== "review") return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();

  const weekNumber = Number(interaction.values[0]);
  const week = session.weeks.find((w) => w.weekNumber === weekNumber);
  if (!week) return interaction.editReply({ content: "That week could not be found.", embeds: [], components: [] });

  session.step = "edit_week";
  session.editingWeek = weekNumber;
  touch(session);

  const { teams } = await loadTeams(interaction.guildId);
  const others = teams.filter((t) => t.id !== session.teamId);
  // Best-effort ranking: exact/substring match on the OCR'd opponent text first, then
  // alphabetical — the server already computed a confident match when possible, but this
  // list is the fallback for when it didn't (or was wrong).
  const raw = (week.opponentRaw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const ranked = [...others].sort((a, b) => {
    const an = a.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const bn = b.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const aHit = raw && (an.includes(raw) || raw.includes(an)) ? 0 : 1;
    const bHit = raw && (bn.includes(raw) || raw.includes(bn)) ? 0 : 1;
    return aHit - bHit || a.name.localeCompare(b.name);
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(CFB_TEAM_SCHEDULE_CUSTOM_IDS.editTeamSelect)
    .setPlaceholder("Select the opponent")
    .addOptions(ranked.slice(0, 25).map((t) => new StringSelectMenuOptionBuilder().setLabel(t.name.slice(0, 100)).setValue(t.id)));

  const label = stageLabel(stageForWeek(weekNumber, "cfb_27"), weekNumber, "cfb_27");
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle(`Edit ${label}`)
      .setDescription([
        week.opponentRaw ? `Screenshot read: **"${week.opponentRaw}"**` : "No opponent could be read from the screenshot for this week.",
        "",
        "Select the correct opponent team.",
      ].join("\n"))],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(CFB_TEAM_SCHEDULE_CUSTOM_IDS.editBack).setLabel("Back to Review").setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

export async function handleCfbTeamScheduleEditTeamSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session || session.step !== "edit_week" || session.editingWeek == null) {
    return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();

  const { teams } = await loadTeams(interaction.guildId);
  const team = teams.find((t) => t.id === interaction.values[0]);
  if (!team) return interaction.editReply({ content: "That team could not be found.", embeds: [], components: [] });

  const week = session.weeks.find((w) => w.weekNumber === session.editingWeek);
  if (week) {
    week.overrideOpponentTeamId = team.id;
    week.overrideOpponentName = team.name;
  }
  touch(session);

  const label = stageLabel(stageForWeek(session.editingWeek, "cfb_27"), session.editingWeek, "cfb_27");
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(`Edit ${label}`).setDescription(`Opponent set to **${team.name}**. Is **${session.teamName}** home or away this week?`)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(CFB_TEAM_SCHEDULE_CUSTOM_IDS.editHome).setLabel(`${session.teamName} is Home`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(CFB_TEAM_SCHEDULE_CUSTOM_IDS.editAway).setLabel(`${session.teamName} is Away`).setStyle(ButtonStyle.Primary),
      ),
    ],
  });
}

async function finishWeekEdit(interaction: ButtonInteraction, homeAway: "home" | "away") {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session || session.step !== "edit_week" || session.editingWeek == null) {
    return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  const week = session.weeks.find((w) => w.weekNumber === session.editingWeek);
  if (week) week.overrideHomeAway = homeAway;
  session.step = "review";
  session.editingWeek = undefined;
  touch(session);
  return interaction.editReply({ embeds: [buildReviewEmbed(session)], components: await buildReviewRows(session) });
}

export async function handleCfbTeamScheduleEditHome(interaction: ButtonInteraction) {
  return finishWeekEdit(interaction, "home");
}

export async function handleCfbTeamScheduleEditAway(interaction: ButtonInteraction) {
  return finishWeekEdit(interaction, "away");
}

export async function handleCfbTeamScheduleEditBack(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  if (!session) return interaction.reply({ content: "Session expired. Reopen League Mgmt → Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  session.step = "review";
  session.editingWeek = undefined;
  touch(session);
  return interaction.editReply({ embeds: [buildReviewEmbed(session)], components: await buildReviewRows(session) });
}

// ─── Approve / cancel ───────────────────────────────────────────────────────────

export async function handleCfbTeamScheduleApprove(interaction: ButtonInteraction, buildScheduleMgmtRows: () => any[]) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can save the schedule.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  await interaction.deferUpdate();
  if (!session || session.step !== "review") {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Team Schedule Import").setDescription("This import expired. Reopen League Mgmt → Schedule.")], components: buildScheduleMgmtRows() });
  }

  const decisions = session.weeks
    .filter((w) => w.weekNumber != null && !w.isBye && !effectiveWeek(w).locked)
    .map((w) => {
      const eff = effectiveWeek(w);
      if (!eff.opponentTeamId || !eff.homeAway) return null;
      return { weekNumber: w.weekNumber!, opponentTeamId: eff.opponentTeamId, homeAway: eff.homeAway };
    })
    .filter((d): d is { weekNumber: number; opponentTeamId: string; homeAway: "home" | "away" } => Boolean(d));

  if (!decisions.length) {
    return interaction.editReply({ embeds: [buildReviewEmbed(session)], components: await buildReviewRows(session) }).then(() =>
      interaction.followUp({ content: "No new matchups to save — everything is either already confirmed or still needs a manual opponent pick.", flags: MessageFlags.Ephemeral }),
    );
  }

  try {
    const result = await recApi.commitCfbTeamScheduleImport({
      guildId: session.guildId,
      teamId: session.teamId!,
      decisions,
      requestedByDiscordId: interaction.user.id,
    });
    const savedCount = (result.saved ?? []).filter((s: any) => !s.skipped).length;
    const skippedCount = (result.saved ?? []).filter((s: any) => s.skipped).length;
    sessions.delete(key(session.guildId, session.userId));
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle("Team Schedule Saved")
        .setColor(COLORS.success)
        .setDescription([
          `Saved **${savedCount}** new matchup${savedCount === 1 ? "" : "s"} for **${session.teamName}** (and the matching week for each opponent).`,
          skippedCount ? `${skippedCount} week${skippedCount === 1 ? " was" : "s were"} already confirmed and left as-is.` : null,
          "",
          "Review with **View Schedule**.",
        ].filter(Boolean).join("\n"))],
      components: buildScheduleMgmtRows(),
    });
  } catch (err) {
    return interaction.editReply({ embeds: [buildReviewEmbed(session)], components: await buildReviewRows(session) }).then(() =>
      interaction.followUp({ content: userFacingError(err), flags: MessageFlags.Ephemeral }),
    );
  }
}

export async function handleCfbTeamScheduleCancel(interaction: ButtonInteraction, buildScheduleMgmtRows: () => any[]) {
  if (interaction.inCachedGuild()) sessions.delete(key(interaction.guildId, interaction.user.id));
  await interaction.deferUpdate();
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Team Schedule Import").setColor(COLORS.neutral).setDescription("Import cancelled.")],
    components: buildScheduleMgmtRows(),
  }).catch(() => undefined);
}
