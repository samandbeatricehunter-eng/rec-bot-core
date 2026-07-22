import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { nextLeagueStage, stageLabel } from "../lib/league-stage.js";
import { formatCoins } from "@rec/shared";
import { recApi } from "../lib/rec-api.js";
import { getBoxScoresChannel, getRouteChannels, purgeChannelMessages } from "../lib/route-channels.js";
import { enterAdvanceTimeStep } from "./advance-time.js";
import { deleteWagerCleanupMessages, refreshConfirmableWagerEmbeds } from "./wagers.js";

export const ADVANCE_WIZARD_CUSTOM_IDS = {
  homeWinPrefix: "rec:advance_wizard:home",
  awayWinPrefix: "rec:advance_wizard:away",
  tiePrefix: "rec:advance_wizard:tie",
  divisionWinnerSelectPrefix: "rec:advance_wizard:division_winner",
  cancelPrefix: "rec:advance_wizard:cancel",
  scoreModalPrefix: "rec:advance_wizard:score_modal",
  scoreAwayInput: "rec:advance_wizard:score_away",
  scoreHomeInput: "rec:advance_wizard:score_home",
} as const;

type WizardGame = {
  gameId: string;
  homeTeamName: string;
  awayTeamName: string;
  isH2h: boolean;
  isCpuGame: boolean;
};

type AdvanceWizardSession = {
  guildId: string;
  userId: string;
  game: string | null;
  seasonNumber: number;
  currentWeek: number;
  currentStage: string;
  nextWeekNumber: number;
  nextSeasonStage: string;
  pendingGames: WizardGame[];
  gameIndex: number;
  results: Array<{ gameId: string; outcome: "home" | "away" | "tie"; homeScore?: number | null; awayScore?: number | null }>;
  pendingOutcome: "home" | "away" | "tie" | null;
  divisions: DivisionWinnerGroup[];
  divisionIndex: number;
  divisionWinners: Array<{ divisionKey: string; teamId: string }>;
};

type DivisionWinnerGroup = {
  key: string;
  label: string;
  conference: string;
  division: string;
  teams: Array<{ id: string; name: string; abbreviation?: string | null }>;
};

const sessions = new Map<string, AdvanceWizardSession>();
const sessionKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

function renderWizardStep(session: AdvanceWizardSession) {
  const game = session.pendingGames[session.gameIndex];
  if (!game) {
    return {
      embeds: [new EmbedBuilder().setTitle("Advance Week").setDescription("No games require commissioner input this week.")],
      components: [],
    };
  }

  const embed = new EmbedBuilder()
    .setTitle(`Advance Week — Game ${session.gameIndex + 1} of ${session.pendingGames.length}`)
    .setDescription([
      `Logging results for **${stageLabel(session.currentStage, session.currentWeek, session.game)}** before advancing to **${stageLabel(session.nextSeasonStage, session.nextWeekNumber, session.game)}**.`,
      "",
      `**Away:** ${game.awayTeamName}`,
      `**Home:** ${game.homeTeamName}`,
      game.isH2h ? "User H2H" : "Includes CPU",
      "",
      "Pick the winner (or Tie), then enter each team's final score. These results update **display records only** (power rankings / team embed W-L). Box scores still drive official stats and payouts.",
    ].join("\n"));

  const suffix = `:${session.guildId}:${session.userId}`;
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.awayWinPrefix}${suffix}`).setLabel(`${game.awayTeamName} Win`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.homeWinPrefix}${suffix}`).setLabel(`${game.homeTeamName} Win`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.tiePrefix}${suffix}`).setLabel("Tie").setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.cancelPrefix}${suffix}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function needsDivisionWinnerStep(session: Pick<AdvanceWizardSession, "currentStage" | "currentWeek" | "nextSeasonStage">) {
  return session.currentStage === "regular_season" && session.currentWeek >= 18 && session.nextSeasonStage === "wild_card";
}

function renderDivisionWinnerStep(session: AdvanceWizardSession) {
  const division = session.divisions[session.divisionIndex];
  if (!division) {
    return {
      embeds: [new EmbedBuilder().setTitle("Division Winners").setDescription("All division winners selected. Saving and advancing...")],
      components: [],
    };
  }

  const selectedLines = session.divisionWinners
    .map((winner) => {
      const group = session.divisions.find((d) => d.key === winner.divisionKey);
      const team = group?.teams.find((t) => t.id === winner.teamId);
      return `- ${group?.label ?? winner.divisionKey}: **${team?.name ?? "Selected"}**`;
    });

  const suffix = `:${session.guildId}:${session.userId}`;
  const selected = session.divisionWinners.find((winner) => winner.divisionKey === division.key)?.teamId;
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.divisionWinnerSelectPrefix}${suffix}`)
    .setPlaceholder(`Select ${division.label} winner`)
    .addOptions(
      division.teams.slice(0, 25).map((team) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(team.name.slice(0, 100))
          .setDescription((team.abbreviation ?? division.label).slice(0, 100))
          .setValue(team.id)
          .setDefault(team.id === selected),
      ),
    );

  return {
    embeds: [new EmbedBuilder()
      .setTitle(`Division Winners - ${session.divisionIndex + 1} of ${session.divisions.length}`)
      .setDescription([
        `Select the **${division.label}** winner before advancing to **${stageLabel(session.nextSeasonStage, session.nextWeekNumber, session.game)}**.`,
        "",
        selectedLines.length ? selectedLines.join("\n") : "No division winners selected yet.",
      ].join("\n"))],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.cancelPrefix}${suffix}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function enterDivisionWinnerStepOrComplete(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  session: AdvanceWizardSession,
  buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[],
) {
  if (needsDivisionWinnerStep(session)) {
    const payload = await recApi.getDivisionWinnerOptions(session.guildId);
    session.divisions = (payload.divisions ?? []).filter((division: DivisionWinnerGroup) => (division.teams ?? []).length > 1);
    session.divisionIndex = 0;
    session.divisionWinners = [];
    if (session.divisions.length) {
      sessions.set(sessionKey(session.guildId, session.userId), session);
      return interaction.editReply(renderDivisionWinnerStep(session));
    }
  }
  return completeAdvanceFromSession(interaction, session, buildAdvanceRows);
}

async function completeAdvanceFromSession(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  session: AdvanceWizardSession,
  _buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[],
) {
  if (needsDivisionWinnerStep(session) && session.divisionWinners.length) {
    await recApi.saveDivisionWinners({
      guildId: session.guildId,
      seasonNumber: session.seasonNumber,
      selectedByDiscordId: interaction.user.id,
      winners: session.divisionWinners,
    });
  }

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Advancing Week...").setDescription("Saving display results and advancing the league week.")],
    components: [],
  });

  const result = await recApi.completeAdvanceWeek({
    guildId: session.guildId,
    nextWeekNumber: session.nextWeekNumber,
    nextSeasonStage: session.nextSeasonStage,
    advancedByDiscordId: interaction.user.id,
    results: session.results,
  });

  const interest = result?.savingsInterest;
  const interestLine = interest?.applied && interest.usersCredited > 0
    ? `\n\nSavings interest credited: **${formatCoins(interest.totalInterest)}** across **${interest.usersCredited}** user${interest.usersCredited === 1 ? "" : "s"} (3.5%, floored).`
    : "";

  // Clean up wagers whose results were never logged (refunded server-side on advance).
  const wagerCleanup = result?.wagerCleanup ?? { refundedCount: 0, refundedMessages: [] };
  if (interaction.guild) {
    void deleteWagerCleanupMessages(interaction.client, wagerCleanup);
    void refreshConfirmableWagerEmbeds(interaction.client, session.guildId);
  }
  const wagerLine = wagerCleanup.refundedCount > 0
    ? `\n\nRefunded **${wagerCleanup.refundedCount}** open wager${wagerCleanup.refundedCount === 1 ? "" : "s"} whose results weren't logged before advancing.`
    : "";

  // Settle the GOTW poll for the week that just completed.
  if (interaction.guild) await settleGotwForWeek(interaction.guild, session.guildId, session.currentWeek).catch((err) => {
    console.error("[ERROR] GOTW settlement failed (non-fatal):", err);
  });

  // Reset the box scores channel for the new week — last week's submissions (and any
  // stray chatter) are cleared out so it starts clean.
  if (interaction.guild) {
    void getRouteChannels(session.guildId)
      .then((routes) => getBoxScoresChannel(interaction.guild!, routes))
      .then((channel) => channel && purgeChannelMessages(channel))
      .catch((err) => console.error("[ERROR] Box scores channel reset failed (non-fatal):", err));
  }

  const headline = `League advanced from **${stageLabel(session.currentStage, session.currentWeek, session.game)}** to **${stageLabel(session.nextSeasonStage, session.nextWeekNumber, session.game)}**.${interestLine}${wagerLine}`;
  sessions.delete(sessionKey(session.guildId, session.userId));
  return enterAdvanceTimeStep(interaction, headline, { seasonNumber: session.seasonNumber, weekNumber: session.currentWeek, game: session.game });
}

async function settleGotwForWeek(guild: Guild, guildId: string, weekNumber: number) {
  // Settle every open poll for the week — the postseason posts one per playoff
  // game, so there can be multiple. (Regular season is just a single poll.)
  const polls = await recApi.getActiveGotwPolls({ guildId, weekNumber }).then((r) => r?.polls ?? []).catch(() => []);
  for (const poll of polls as any[]) {
    await settleSingleGotwPoll(guild, guildId, weekNumber, poll).catch((err) => {
      console.error("[ERROR] GOTW poll settlement failed (non-fatal):", err);
    });
  }
}

async function settleSingleGotwPoll(guild: Guild, guildId: string, weekNumber: number, poll: any) {
  if (!poll?.id || !poll.discord_channel_id || !poll.discord_message_id) return;

  // Fetch the Discord message that holds the native poll.
  const channel = await guild.channels.fetch(poll.discord_channel_id).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel)) return;
  const message = await (channel as any).messages.fetch(poll.discord_message_id).catch(() => null);
  if (!message?.poll) return;

  // End the Discord poll so vote counts are frozen and fetchVoters works.
  // Poll#end() resolves to the updated Message, not a Poll — unwrap .poll from it.
  const ended = await message.poll.end().catch(() => null);
  const endedPoll = ended?.poll ?? message.poll;

  // Collect who voted for which team.
  // answer_id 1 = away team, answer_id 2 = home team (the order we inserted them).
  const voters: { discordId: string; selectedTeamId: string }[] = [];
  for (const [answerId, teamId] of [[1, poll.away_team_id], [2, poll.home_team_id]] as [number, string][]) {
    const answer = endedPoll.answers?.get(answerId);
    if (!answer) continue;
    try {
      const voterCollection = await answer.fetchVoters();
      for (const [, user] of voterCollection) {
        if (!user.bot) voters.push({ discordId: user.id, selectedTeamId: teamId });
      }
    } catch {
      // no votes on this answer — non-fatal
    }
  }

  // Look up the ACTUAL game result to determine who was right.
  // Poll vote counts are irrelevant — what matters is which team won the real game.
  const gameResult = await recApi.getGotwGameResult({
    guildId,
    awayTeamId: poll.away_team_id,
    homeTeamId: poll.home_team_id,
    weekNumber,
  }).catch(() => null);

  // winning_team_id from actual game result; null on tie or game not yet logged.
  const winningTeamId = gameResult?.is_tie ? null : (gameResult?.winning_team_id ?? null);

  await recApi.settleGotwPoll({ guildId, pollId: poll.id, winningTeamId, voters });
}

export async function startAdvanceWeekWizard(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", ephemeral: true });
  if (!isFullLeagueAdminInteraction(interaction)) return interaction.reply({ content: "Only commissioners or server admins can advance the league.", ephemeral: true });

  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Preparing Advance Week...").setDescription("Loading this week's schedule and checking for missing box scores.")],
    components: [],
  });

  const payload = await recApi.getAdvanceWeekGames(interaction.guildId);
  const currentWeek = Number(payload.currentWeek ?? 1);
  const currentStage = String(payload.currentStage ?? "regular_season");
  const game = payload.league?.game ?? null;
  const next = nextLeagueStage(currentWeek, currentStage, game);
  const pendingGames: WizardGame[] = (payload.gamesNeedingInput ?? []).map((game: any) => ({
    gameId: game.gameId,
    homeTeamName: game.homeTeamName,
    awayTeamName: game.awayTeamName,
    isH2h: Boolean(game.isH2h),
    isCpuGame: Boolean(game.isCpuGame),
  }));

  const session: AdvanceWizardSession = {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    game,
    seasonNumber: Number(payload.seasonNumber ?? 1),
    currentWeek,
    currentStage,
    nextWeekNumber: next.weekNumber,
    nextSeasonStage: next.seasonStage,
    pendingGames,
    gameIndex: 0,
    results: [],
    pendingOutcome: null,
    divisions: [],
    divisionIndex: 0,
    divisionWinners: [],
  };

  sessions.set(sessionKey(interaction.guildId, interaction.user.id), session);

  if (!pendingGames.length) {
    sessions.delete(sessionKey(interaction.guildId, interaction.user.id));
    return enterDivisionWinnerStepOrComplete(interaction, session, buildAdvanceRows);
  }

  return interaction.editReply(renderWizardStep(session));
}

export async function handleAdvanceWizardCancel(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  sessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  await interaction.deferUpdate();
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Advance Week").setDescription("Advance cancelled. No changes were saved.")],
    components: buildAdvanceRows(),
  });
}

// Step 1 of logging a game: pick the winner/tie, then collect the final scores in a
// modal. The scores are authoritative — the recorded outcome is re-derived from them
// so the result can't end up inconsistent with the entered final.
export async function handleAdvanceWizardOutcome(interaction: ButtonInteraction, outcome: "home" | "away" | "tie", _buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  if (!session) {
    return interaction.reply({ content: "Advance session expired. Reopen League Mgmt > Advance.", ephemeral: true });
  }

  const game = session.pendingGames[session.gameIndex];
  if (!game) return;

  session.pendingOutcome = outcome;
  sessions.set(sessionKey(interaction.guildId, interaction.user.id), session);

  const suffix = `:${session.guildId}:${session.userId}`;
  const modal = new ModalBuilder()
    .setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.scoreModalPrefix}${suffix}`)
    .setTitle(`Final Score — Game ${session.gameIndex + 1}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.scoreAwayInput).setLabel(`${game.awayTeamName} final score`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("numbers only"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.scoreHomeInput).setLabel(`${game.homeTeamName} final score`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("numbers only"),
      ),
    );
  return interaction.showModal(modal);
}

function parseWizardScore(raw: string): number | null {
  const v = (raw ?? "").replace(/[^0-9]/g, "");
  if (!v) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// Step 2: record the game with its final scores, then move to the next game.
export async function handleAdvanceWizardScoreModal(interaction: ModalSubmitInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  if (!session) {
    return interaction.reply({ content: "Advance session expired. Reopen League Mgmt > Advance.", ephemeral: true });
  }
  const game = session.pendingGames[session.gameIndex];
  if (!game || !session.pendingOutcome) return interaction.deferUpdate().catch(() => undefined);

  await interaction.deferUpdate();
  const awayScore = parseWizardScore(interaction.fields.getTextInputValue(ADVANCE_WIZARD_CUSTOM_IDS.scoreAwayInput));
  const homeScore = parseWizardScore(interaction.fields.getTextInputValue(ADVANCE_WIZARD_CUSTOM_IDS.scoreHomeInput));

  // When both scores are entered they decide the outcome; otherwise keep the picked one.
  let outcome = session.pendingOutcome;
  if (awayScore != null && homeScore != null) {
    outcome = homeScore > awayScore ? "home" : awayScore > homeScore ? "away" : "tie";
  }

  session.results.push({ gameId: game.gameId, outcome, homeScore, awayScore });
  session.pendingOutcome = null;
  session.gameIndex += 1;

  if (session.gameIndex < session.pendingGames.length) {
    sessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    return interaction.editReply(renderWizardStep(session));
  }

  return enterDivisionWinnerStepOrComplete(interaction, session, buildAdvanceRows);
}

export async function handleAdvanceWizardDivisionWinnerSelect(
  interaction: StringSelectMenuInteraction,
  buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[],
) {
  if (!interaction.inCachedGuild()) return;
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  if (!session) {
    return interaction.reply({ content: "Advance session expired. Reopen League Mgmt > Advance.", ephemeral: true });
  }

  const division = session.divisions[session.divisionIndex];
  const teamId = interaction.values[0];
  if (!division || !teamId) return interaction.reply({ content: "Division winner selection was invalid.", ephemeral: true });

  await interaction.deferUpdate();
  session.divisionWinners = [
    ...session.divisionWinners.filter((winner) => winner.divisionKey !== division.key),
    { divisionKey: division.key, teamId },
  ];
  session.divisionIndex += 1;

  if (session.divisionIndex < session.divisions.length) {
    sessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    return interaction.editReply(renderDivisionWinnerStep(session));
  }

  return completeAdvanceFromSession(interaction, session, buildAdvanceRows);
}
