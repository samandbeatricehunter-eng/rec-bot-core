import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Guild, Message, ModalBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextChannel, TextInputBuilder, TextInputStyle, type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import { buildAdminPanelEmbed, buildAdminPanelRows, buildMainMenuEmbed, buildMainMenuRows } from "../ui/menu.js";
import { buildGotwAnnouncementContent, buildGotwVoteEmbed, buildGotwVoteRows } from "../ui/gotw.js";
import { buildPowerRankingsEmbeds } from "../ui/power-rankings.js";
import { readStat, formatStatValue, getStatShortLabel } from "@rec/shared";
import { recApi } from "../lib/rec-api.js";
import { ExpiringSessionStore } from "../lib/session-timeout.js";
import { wallClockToUtc } from "../ui/advance-schedule.js";
import { recreateGameChannelsForGuild, sendAdvanceDmsOnly, sendAdvanceDmPayloads } from "./game-channels.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";

export const ADVANCE_WIZARD_GOTW_CUSTOM_ID = "rec:advance_wizard:gotw";
export const ADVANCE_WIZARD_CUSTOM_IDS = {
  manual: "rec:advance_wizard:manual",
  import: "rec:advance_wizard:import",
  back: "rec:advance_wizard:back_admin",
  importBack: "rec:advance_wizard:import_back",
  importData: "rec:advance_wizard:import_data",
  mcaUrl: "rec:advance_wizard:mca_url",
  offseasonAdvance: "rec:advance_wizard:offseason_advance",
  manualBack: "rec:advance_wizard:manual_back",
  manualInputFinals: "rec:advance_wizard:manual_input_finals",
  manualMarkFsFw: "rec:advance_wizard:manual_mark_fs_fw",
  manualNextStep: "rec:advance_wizard:manual_next_step",
  outcomesBack: "rec:advance_wizard:outcomes_back",
  outcomesMarkFsFw: "rec:advance_wizard:outcomes_mark_fs_fw",
  outcomesOpenFsFwModal: "rec:advance_wizard:outcomes_open_fs_fw_modal",
  outcomesFsFwModal: "rec:advance_wizard:outcomes_fs_fw_modal",
  outcomesFsFwInput: "rec:advance_wizard:outcomes_fs_fw_input",
  outcomesSkip: "rec:advance_wizard:outcomes_skip",
  step2Back: "rec:advance_wizard:step2_back",
  step2Next: "rec:advance_wizard:step2_next",
  catchUpSelect: "rec:advance_wizard:catch_up_select",
  teamConflictSelect: "rec:advance_wizard:team_conflict_select",
  teamConflictContinue: "rec:advance_wizard:team_conflict_continue",
  teamConflictResolveModal: "rec:advance_wizard:team_conflict_modal",
  teamConflictReplaceInput: "rec:advance_wizard:team_conflict_replace",
  teamConflictCityInput: "rec:advance_wizard:team_conflict_city",
  teamConflictNickInput: "rec:advance_wizard:team_conflict_nick",
  teamConflictAbbrInput: "rec:advance_wizard:team_conflict_abbr"
} as const;

interface BadgeAnnouncement {
  userId: string;
  discordId: string | null;
  badgeName: string;
  badgeLabel: string;
  qualifier?: string;
  reason?: string;
  type: "earned" | "lost";
}

interface EosPollNominee {
  userId: string;
  discordId: string | null;
  displayName: string;
}

interface EosPoll {
  id: string;
  categoryKey: string;
  categoryLabel: string;
  categoryDescription: string | null;
  closesAt: string | null;
}

interface EosPollsData {
  polls: EosPoll[];
  nominees: EosPollNominee[];
  closesAt: string | null;
  announcementsChannelId: string | null;
  recAwardsData?: {
    awards: Array<{
      awardId: string;
      key: string;
      name: string;
      description?: string;
      nomineeCount: number;
      status: string;
      nomineeOptions?: Array<{ nomineeId?: string; userId: string; nomineeKey?: string; discordId: string | null; displayLabel: string; performanceScore?: number; statLine?: string; voteCount?: number; liveScore?: number }>;
      payoutAmount?: number;
      prizeText?: string;
      nominees?: Array<{ userId: string; displayLabel: string; performanceScore?: number; statLine?: string; voteCount?: number; liveScore?: number }>;
      totalVotes?: number;
      closesAt?: string | null;
    }>;
    leagueId: string;
    seasonNumber: number;
    announcementsChannelId: string | null;
    error?: string | null;
  } | null;
}

interface AdvanceWizardState {
  weekNumber: number;
  seasonStage: string;
  warnings: string[];
  badgeAnnouncements?: BadgeAnnouncement[];
  announcementsChannelId?: string | null;
  eosPollsData?: EosPollsData | null;
  eosLockData?: any;
  nominationData?: any;
}

export const advanceWizardSessions = new ExpiringSessionStore<AdvanceWizardState>();

function prettyStage(stage?: string | null) {
  return String(stage ?? "regular_season").replaceAll("_", " ");
}

function isOffseasonStage(stage: string) {
  return ["coach_hiring", "final_resigning", "free_agency", "draft"].includes(stage);
}

function nextWeekStage(currentWeek: number, currentStage: string) {
  const weekNumber = currentStage === "preseason_training_camp" ? 1 : currentWeek + 1;
  const seasonStage =
    currentStage === "regular_season" && weekNumber >= 19 ? "wild_card"
    : currentStage === "wild_card" ? "divisional"
    : currentStage === "divisional" ? "conference_championship"
    : currentStage === "conference_championship" ? "super_bowl"
    : currentStage === "super_bowl" ? "coach_hiring"
    : currentStage === "coach_hiring" ? "final_resigning"
    : currentStage === "final_resigning" ? "free_agency"
    : currentStage === "free_agency" ? "draft"
    : currentStage === "draft" ? "preseason_training_camp"
    : currentStage === "preseason_training_camp" ? "regular_season"
    : currentStage;
  return { weekNumber, seasonStage };
}

// Human-readable label for a (week, stage) pair, used in catch-up target options and summaries.
function catchUpWeekLabel(weekNumber: number, seasonStage: string) {
  switch (seasonStage) {
    case "wild_card": return "Wild Card";
    case "divisional": return "Divisional Round";
    case "conference_championship": return "Conference Championship";
    case "super_bowl": return "Super Bowl";
    case "coach_hiring": return "Coach Hiring";
    case "final_resigning": return "Final Re-signing";
    case "free_agency": return "Free Agency";
    case "draft": return "Draft";
    case "preseason_training_camp": return "Preseason (Training Camp)";
    case "regular_season": return `Week ${weekNumber}`;
    default: return `Week ${weekNumber}`;
  }
}

// Forward sequence of (week, stage) states reachable from the current state, one entry per advance.
// Used to offer "what week is your server on now?" catch-up targets.
function buildForwardStates(currentWeek: number, currentStage: string, count: number) {
  const states: Array<{ weekNumber: number; seasonStage: string; advances: number }> = [];
  let week = currentWeek;
  let stage = currentStage;
  for (let i = 1; i <= count; i++) {
    const next = nextWeekStage(week, stage);
    states.push({ weekNumber: next.weekNumber, seasonStage: next.seasonStage, advances: i });
    week = next.weekNumber;
    stage = next.seasonStage;
    // Stop once we reach the first offseason stage — catch-up only spans competitive weeks.
    if (next.seasonStage === "coach_hiring") break;
  }
  return states;
}

// Catch-up target the user selected on the review screen ("what week is your server on now?").
// Keyed by Discord user id; read at the start of runAdvanceWizardProcessing and then cleared.
const catchUpTargets = new Map<string, { targetWeek: number; targetStage: string; advances: number }>();

export function clearCatchUpTarget(userId: string) {
  catchUpTargets.delete(userId);
}

export async function buildAdvanceWizardEntryPayload(guildId: string) {
  const week = await recApi.viewLeagueWeek(guildId).catch(() => null);
  const league = week?.league;
  const stage = prettyStage(league?.season_stage ?? league?.current_phase);
  const rawStage = String(league?.season_stage ?? league?.current_phase ?? "regular_season");
  const current = league
    ? `Season ${league.season_number ?? league.display_season_number ?? "?"}, Week ${league.current_week ?? "?"} (${stage})`
    : "Current league week could not be loaded.";

  if (isOffseasonStage(rawStage)) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle("Advance Wizard")
          .setDescription([
            current,
            "",
            "This is an offseason stage, so no import or manual game outcomes are required.",
            "Click Advance Week to move to the next offseason stage."
          ].join("\n"))
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.back).setLabel("Back").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.offseasonAdvance).setLabel("Advance Week").setStyle(ButtonStyle.Success)
        )
      ]
    };
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Advance Wizard")
        .setDescription([
          current,
          "",
          "Are you manually entering data or importing it?"
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.manual).setLabel("Manual").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.importBack).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.import).setLabel("Import").setStyle(ButtonStyle.Primary)
      )
    ]
  };
}

export function buildAdvanceWizardPostImportPayload(summaryLines: string[] = []) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Import Complete")
        .setDescription([
          ...summaryLines,
          "",
          "If there were any Fair Sim or Force Win outcomes for your games, please use the button below to mark them."
        ].filter(Boolean).join("\n").slice(0, 4000))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.outcomesBack).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.outcomesMarkFsFw).setLabel("Mark FS/FW").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.outcomesSkip).setLabel("Skip").setStyle(ButtonStyle.Success)
      )
    ]
  };
}

// ── Custom team data conflicts (custom/relocated team data vs what the import contains) ──────────

export function buildTeamConflictPayload(conflicts: any[]) {
  const lines = conflicts.slice(0, 8).map((c) => {
    const league = `${c.league?.city ?? "?"} ${c.league?.nick ?? ""}`.trim();
    const mine = `${c.custom?.city ?? "?"} ${c.custom?.nick ?? ""}`.trim();
    return [
      `**${c.originalAbbreviation} slot** — mismatched: ${(c.mismatched ?? []).join(", ")}`,
      `• League (import): **${league}** (${c.league?.abbr ?? "?"})`,
      `• Yours: ${mine} (${c.custom?.abbr ?? "?"})`
    ].join("\n");
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.teamConflictSelect)
    .setPlaceholder("Select a team to update")
    .addOptions(
      conflicts.slice(0, 25).map((c) =>
        new StringSelectMenuOptionBuilder()
          .setLabel((`${c.league?.city ?? ""} ${c.league?.nick ?? ""}`.trim() || c.originalAbbreviation).slice(0, 100))
          .setValue(c.originalAbbreviation)
          .setDescription(`League ${c.league?.abbr ?? "?"} · fix ${(c.mismatched ?? []).join(", ")}`.slice(0, 100))
      )
    );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Custom Team Data Conflicts")
        .setDescription([
          "These relocated/custom teams don't match what the latest import contains. Select each team to update its data to match the league, then continue.",
          "",
          ...lines
        ].join("\n").slice(0, 4000))
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.teamConflictContinue).setLabel("Continue to FS/FW").setStyle(ButtonStyle.Success)
      )
    ]
  };
}

export function buildTeamConflictResolveModal(conflict: any) {
  const modal = new ModalBuilder()
    .setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.teamConflictResolveModal}:${conflict.originalAbbreviation}`)
    .setTitle(`Fix ${conflict.originalAbbreviation} Team Data`);
  const replaceInput = new TextInputBuilder()
    .setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.teamConflictReplaceInput)
    .setLabel("Original team abbreviation")
    .setStyle(TextInputStyle.Short).setRequired(true)
    .setValue(conflict.originalAbbreviation ?? "");
  const cityInput = new TextInputBuilder()
    .setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.teamConflictCityInput)
    .setLabel("Team city (per league)")
    .setStyle(TextInputStyle.Short).setRequired(true)
    .setValue(conflict.league?.city ?? "");
  const nickInput = new TextInputBuilder()
    .setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.teamConflictNickInput)
    .setLabel("Team name (per league)")
    .setStyle(TextInputStyle.Short).setRequired(true)
    .setValue(conflict.league?.nick ?? "");
  const abbrInput = new TextInputBuilder()
    .setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.teamConflictAbbrInput)
    .setLabel("Team abbreviation (per league)")
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8)
    .setValue(conflict.league?.abbr ?? "");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(replaceInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(cityInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(nickInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(abbrInput)
  );
  return modal;
}

// After an import commits, show the team-conflict screen if any relocated team data diverges from
// the import; otherwise fall through to the normal post-import (FS/FW) step.
export async function buildPostImportPayloadWithConflictCheck(guildId: string, summaryLines: string[] = []) {
  const data = await recApi.getTeamDataConflicts(guildId).catch(() => ({ conflicts: [] }));
  if (data?.conflicts?.length) return buildTeamConflictPayload(data.conflicts);
  return buildAdvanceWizardPostImportPayload(summaryLines);
}

export async function handleTeamConflictSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can resolve team data conflicts.", ephemeral: true });
    return;
  }
  const originalAbbr = interaction.values[0];
  const data = await recApi.getTeamDataConflicts(interaction.guildId).catch(() => ({ conflicts: [] }));
  const conflict = (data?.conflicts ?? []).find((c: any) => c.originalAbbreviation === originalAbbr);
  if (!conflict) {
    await interaction.reply({ content: "That conflict was already resolved.", ephemeral: true });
    return;
  }
  await interaction.showModal(buildTeamConflictResolveModal(conflict));
}

export async function handleTeamConflictResolveModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can resolve team data conflicts.", ephemeral: true });
    return;
  }
  const replacedAbbr = interaction.fields.getTextInputValue(ADVANCE_WIZARD_CUSTOM_IDS.teamConflictReplaceInput).trim().toUpperCase();
  const newCity = interaction.fields.getTextInputValue(ADVANCE_WIZARD_CUSTOM_IDS.teamConflictCityInput).trim();
  const newNick = interaction.fields.getTextInputValue(ADVANCE_WIZARD_CUSTOM_IDS.teamConflictNickInput).trim();
  const newAbbr = interaction.fields.getTextInputValue(ADVANCE_WIZARD_CUSTOM_IDS.teamConflictAbbrInput).trim().toUpperCase();
  await interaction.deferUpdate();
  try {
    await recApi.createCustomTeamReplacement({
      guildId: interaction.guildId,
      replacementTeamAbbreviation: replacedAbbr,
      customTeamName: newNick,
      customDisplayCity: newCity,
      customDisplayNick: newNick,
      customDisplayAbbr: newAbbr,
      requestedByDiscordId: interaction.user.id
    });
    await interaction.editReply(await buildPostImportPayloadWithConflictCheck(interaction.guildId, [`Updated ${newCity} ${newNick} (${newAbbr}) to match the league.`]));
  } catch (error) {
    await interaction.editReply({ content: `Failed to update team: ${error instanceof Error ? error.message : String(error)}`, components: [] });
  }
}

export async function handleTeamConflictContinue(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.update(buildAdvanceWizardPostImportPayload(["Continued past team data conflicts."]));
}

function outcomeLabel(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  if (text === "fs") return "FS";
  if (text === "fw") return "FW";
  return "None";
}

function scoreLabel(game: any) {
  return game.awayScore != null && game.homeScore != null
    ? `${game.awayScore}-${game.homeScore}`
    : "No final";
}

function formatOutcomeGameLine(game: any) {
  return `**${game.number}.** ${game.awayTeam} @ ${game.homeTeam} - ${scoreLabel(game)} - **${outcomeLabel(game.outcomeOverride)}**`;
}

export async function buildAdvanceWizardOutcomeReviewPayload(guildId: string) {
  const data = await recApi.getAdvanceWizardOutcomes(guildId);
  const games = data.games ?? [];
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Advance Wizard - FS/FW Outcomes")
        .setDescription([
          `Season ${data.seasonNumber ?? "?"}, Week ${data.weekNumber ?? "?"} (${prettyStage(data.seasonStage)})`,
          "",
          games.length ? "**Current Matchups / Designations**" : "No matchups were found for this week.",
          ...games.map(formatOutcomeGameLine),
          "",
          "Click **Mark FS/FW** to enter one line per matchup, such as `1 fs` or `2 fw`."
        ].join("\n").slice(0, 4000))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.outcomesBack).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.outcomesOpenFsFwModal).setLabel("Mark FS/FW").setStyle(ButtonStyle.Secondary).setDisabled(!games.length),
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.outcomesSkip).setLabel("Next").setStyle(ButtonStyle.Success)
      )
    ]
  };
}

export async function buildAdvanceWizardFsFwModal(guildId: string) {
  const data = await recApi.getAdvanceWizardOutcomes(guildId);
  const games = data.games ?? [];
  return new ModalBuilder()
    .setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.outcomesFsFwModal)
    .setTitle("Mark FS/FW Outcomes")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.outcomesFsFwInput)
          .setLabel("Enter matchup number + FS or FW")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("1 fs\n2 fw")
      )
    );
}

export async function handleAdvanceWizardFsFwModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can mark FS/FW outcomes.", ephemeral: true });
    return;
  }

  const text = interaction.fields.getTextInputValue(ADVANCE_WIZARD_CUSTOM_IDS.outcomesFsFwInput);
  const data = await recApi.getAdvanceWizardOutcomes(interaction.guildId);
  const gameByNumber = new Map<number, any>((data.games ?? []).map((game: any) => [Number(game.number), game]));
  const markings: Array<{ gameId: string; outcome: "fs" | "fw" }> = [];
  const invalid: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)[.)]?\s+([a-z]{2})\b/i);
    if (!match) {
      invalid.push(line);
      continue;
    }
    const number = Number(match[1]);
    const outcome = match[2].toLowerCase();
    const game = gameByNumber.get(number);
    if (!game || !["fs", "fw"].includes(outcome)) {
      invalid.push(line);
      continue;
    }
    markings.push({ gameId: game.gameId, outcome: outcome as "fs" | "fw" });
  }

  if (invalid.length) {
    await interaction.reply({
      content: `Use one line per matchup in the format \`1 fs\` or \`2 fw\`. Invalid line(s): ${invalid.slice(0, 5).join("; ")}`,
      ephemeral: true
    });
    return;
  }

  if (!markings.length) {
    await interaction.reply({ content: "No FS/FW markings were entered.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
  await recApi.markAdvanceWizardOutcomes({ guildId: interaction.guildId, markings, markedByDiscordId: interaction.user.id });
  await interaction.editReply(await buildAdvanceWizardOutcomeReviewPayload(interaction.guildId));
}

export async function buildAdvanceWizardStep2Payload(guildId: string, dataEntered = true, userId?: string) {
  const week = await recApi.viewLeagueWeek(guildId).catch(() => null);
  const league = week?.league;
  const currentWeek = Number(league?.current_week ?? 1);
  const currentStage = String(league?.season_stage ?? league?.current_phase ?? "regular_season");
  const next = nextWeekStage(currentWeek, currentStage);

  // Catch-up: offer the weeks reachable ahead so a commissioner whose imported data is several weeks
  // ahead can land the server on the right week in one pass. The first option is a normal single
  // advance. Only meaningful for competitive stages (offseason advances one stage at a time).
  const isCompetitive = currentStage === "regular_season" || ["wild_card", "divisional", "conference_championship", "super_bowl"].includes(currentStage);
  const forwardStates = isCompetitive ? buildForwardStates(currentWeek, currentStage, 24) : [];
  const target = userId ? catchUpTargets.get(userId) : undefined;
  const landing = target ? { weekNumber: target.targetWeek, seasonStage: target.targetStage } : next;
  const isCatchUp = Boolean(target && target.advances > 1);

  const components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
  if (forwardStates.length > 1) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.catchUpSelect)
      .setPlaceholder("What week is your server on now? (catch-up)")
      .addOptions(
        forwardStates.map((state) => {
          const label = state.advances === 1
            ? `Advance 1 week → ${catchUpWeekLabel(state.weekNumber, state.seasonStage)}`
            : `Catch up ${state.advances} weeks → ${catchUpWeekLabel(state.weekNumber, state.seasonStage)}`;
          return new StringSelectMenuOptionBuilder()
            .setLabel(label.slice(0, 100))
            .setValue(`${state.advances}:${state.weekNumber}:${state.seasonStage}`)
            .setDescription(state.advances === 1 ? "Normal single-week advance." : `Process every week up to ${catchUpWeekLabel(state.weekNumber, state.seasonStage)}.`)
            .setDefault(target ? state.advances === target.advances : state.advances === 1);
        })
      );
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.step2Back).setLabel("Back").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.step2Next).setLabel("Next Step").setStyle(ButtonStyle.Primary)
    )
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Advance Wizard - Review")
        .setDescription([
          `Season ${league?.season_number ?? league?.display_season_number ?? "?"}, Week ${league?.current_week ?? "?"} (${prettyStage(currentStage)})`,
          "",
          `Data Imported or Entered: **${dataEntered ? "Yes" : "No"}**`,
          "Upcoming Week Schedule Stored: **Pending check**",
          `Week/Stage Advancing To: **${catchUpWeekLabel(landing.weekNumber, landing.seasonStage)}**`,
          isCatchUp ? `Catch-up: processing **${target!.advances} weeks** in one pass (only the final week posts game channels and a GOTW poll).` : "",
          forwardStates.length > 1 ? "" : undefined,
          forwardStates.length > 1 ? "If your imported data is several weeks ahead, pick the week your server should land on. Otherwise leave it on the single-week advance." : undefined,
          "",
          "Please click Next Step to proceed with the advance process, or Back to make changes."
        ].filter((line) => line !== undefined && line !== "").join("\n"))
    ],
    components
  };
}

// Stores the catch-up target chosen on the review screen, then re-renders the review screen.
export async function handleAdvanceWizardCatchUpSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can run the Advance Wizard.", ephemeral: true });
    return;
  }
  const [advancesRaw, weekRaw, stage] = String(interaction.values[0] ?? "").split(":");
  const advances = Number(advancesRaw);
  const targetWeek = Number(weekRaw);
  if (!Number.isFinite(advances) || advances <= 1 || !Number.isFinite(targetWeek) || !stage) {
    catchUpTargets.delete(interaction.user.id);
  } else {
    catchUpTargets.set(interaction.user.id, { targetWeek, targetStage: stage, advances });
  }
  await interaction.update(await buildAdvanceWizardStep2Payload(interaction.guildId, true, interaction.user.id));
}

export function buildAdvanceWizardImportPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Import Data")
        .setDescription([
          "If you are importing using our wizard, open the EA login flow, complete OAuth, and paste the success-code redirect when prompted.",
          "",
          "If you are exporting using the Madden Companion App, click MCA URL to receive the export URL. The Companion App receiver is not configured yet, so this is a placeholder for now."
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.importData).setLabel("Import Data").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.back).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.mcaUrl).setLabel("MCA URL").setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

export async function buildAdvanceWizardManualPayload(guildId: string) {
  const week = await recApi.viewLeagueWeek(guildId).catch(() => null);
  const league = week?.league;
  const stage = prettyStage(league?.season_stage ?? league?.current_phase);
  const heading = league
    ? `Season ${league.season_number ?? league.display_season_number ?? "?"}, Week ${league.current_week ?? "?"} (${stage})`
    : "Current week unavailable";

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Manual Outcome Entry")
        .setDescription([
          heading,
          "",
          "Manual finals entry will list this week's scheduled matchups here as Away @ Home once the matchup-entry API is wired into the wizard.",
          "",
          "Advance cannot continue from regular season or playoff weeks until all game outcomes are logged."
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.manualBack).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.manualInputFinals).setLabel("Input Finals").setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.manualMarkFsFw).setLabel("Mark FS/FW").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(ADVANCE_WIZARD_CUSTOM_IDS.manualNextStep).setLabel("Next Step").setStyle(ButtonStyle.Success).setDisabled(true)
      )
    ]
  };
}

function asAwardScore(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function buildRecAwardVotingEmbed(award: any): EmbedBuilder {
  const sourceNominees = Array.isArray(award.nominees) && award.nominees.length ? award.nominees : (award.nomineeOptions ?? []);
  const nominees = [...sourceNominees]
    .map((n: any) => ({
      displayLabel: String(n.displayLabel ?? n.teamName ?? n.userId ?? "Unknown"),
      performanceScore: asAwardScore(n.performanceScore),
      statLine: n.statLine ? String(n.statLine) : "",
      voteCount: asAwardScore(n.voteCount),
      liveScore: asAwardScore(n.liveScore ?? n.finalScore ?? n.performanceScore)
    }))
    .sort((a, b) => b.liveScore - a.liveScore || b.performanceScore - a.performanceScore || b.voteCount - a.voteCount);

  const topLines = nominees.slice(0, 10).map((n, index) => {
    const voteText = n.voteCount > 0 ? ` · Votes: **${n.voteCount}**` : "";
    const statLine = n.statLine ? `\n   ${n.statLine}` : "";
    return `**${index + 1}. ${n.displayLabel}** — Score: **${n.performanceScore.toFixed(2)}**${voteText}${statLine}`;
  });

  return new EmbedBuilder()
    .setTitle(award.name ?? "REC Award Vote")
    .setDescription([
      award.description ?? "Vote for the best candidate this season.",
      award.prizeText || award.payoutAmount ? `**Prize:** ${award.prizeText ?? `$${award.payoutAmount}`}` : "",
      "",
      nominees.length ? "**Current Top Nominees**" : "No nominees available.",
      ...topLines,
      "",
      "_Rankings update as votes are recorded._"
    ].filter(Boolean).join("\n").slice(0, 4000))
    .setColor(0x9b59b6)
    .setFooter({ text: `${nominees.length} nominees · ${award.totalVotes ?? 0} votes logged${award.closesAt ? ` · Closes ${new Date(award.closesAt).toLocaleString()}` : " · Voting closes in 24 hours"}` });
}


async function cleanAwardVotingChannel(channel: TextChannel, warnings: string[]): Promise<void> {
  try {
    let deletedCount = 0;
    let cursor: string | undefined;

    for (let page = 0; page < 100; page += 1) {
      const fetched = await channel.messages.fetch({ limit: 100, before: cursor });
      if (fetched.size === 0) break;
      cursor = fetched.last()?.id;

      const bulkDeletable = fetched.filter((message: Message) => message.bulkDeletable);
      if (bulkDeletable.size > 0) {
        const deleted = await channel.bulkDelete(bulkDeletable, true).catch((err) => {
          warnings.push(`award_channel_bulk_delete_page_${page + 1}: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        });
        deletedCount += deleted?.size ?? 0;
      }

      const remaining = fetched.filter((message: Message) => !message.bulkDeletable && message.deletable);
      for (const message of remaining.values()) {
        await message.delete()
          .then(() => { deletedCount += 1; })
          .catch((err) => warnings.push(`award_channel_delete_${message.id}: ${err instanceof Error ? err.message : String(err)}`));
      }

      if (fetched.size < 100) break;
    }

    if (deletedCount === 0) {
      warnings.push("award_channel_cleanup: no messages were deleted; check bot Manage Messages permission or whether messages are too old/deletable");
    }
  } catch (err) {
    warnings.push(`award_channel_cleanup: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Shared EOS poll + REC Awards posting — called from advance-wizard finalize AND
// the manual "Run EOS Polls & Awards" advance menu action.
export async function postEosPollsAndAwards(guild: Guild, pollsData: EosPollsData): Promise<string[]> {
  const warnings: string[] = [];
  const votingChannelId = pollsData.announcementsChannelId ?? pollsData.recAwardsData?.announcementsChannelId ?? null;

  if (votingChannelId) {
    try {
      const channel = await guild.channels.fetch(votingChannelId).catch(() => null) as TextChannel | null;
      if (channel?.type === ChannelType.GuildText) {
        await cleanAwardVotingChannel(channel, warnings);
        await channel.send({
          content: "@everyone",
          embeds: [new EmbedBuilder()
            .setTitle("Post-Season Voting Has Begun")
            .setDescription([
              "Post-season voting is now open.",
              "",
              "You have **24 hours** to cast your votes in the polls below.",
              "Winners receive various cash rewards, and select special categories receive added bonus rewards for winning.",
              "",
              "Only linked coaches may vote. No self-voting. You may change your vote before voting closes."
            ].join("\n"))
            .setColor(0xf1c40f)
          ],
          allowedMentions: { parse: ["everyone"] }
        }).catch((err) => warnings.push(`voting_announcement: ${err instanceof Error ? err.message : String(err)}`));
      }
    } catch (err) {
      warnings.push(`voting_announcement: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (pollsData.polls?.length && pollsData.announcementsChannelId) {
    try {
      const pollCh = await guild.channels.fetch(pollsData.announcementsChannelId).catch(() => null) as TextChannel | null;
      if (pollCh?.type === ChannelType.GuildText) {
        const { polls, nominees, closesAt } = pollsData;
        const nomineeOptions = (nominees as EosPollNominee[])
          .filter((n) => n.discordId)
          .slice(0, 25)
          .map((n) => new StringSelectMenuOptionBuilder().setLabel(n.displayName.slice(0, 100)).setValue(n.discordId!));

        if (nomineeOptions.length > 0) {
          const closeTimeStr = closesAt
            ? `Voting closes <t:${Math.floor(new Date(closesAt).getTime() / 1000)}:R>`
            : "Voting closes when playoffs end.";

          for (const poll of polls) {
            await pollCh.send({
              embeds: [new EmbedBuilder()
                .setTitle(`🏆 ${poll.categoryLabel}`)
                .setDescription([poll.categoryDescription ?? "", "", closeTimeStr, "", "_Only linked coaches may vote. You may change your vote before voting closes._"].join("\n"))
                .setColor(0x9b59b6)
              ],
              components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId(`eos_vote:${poll.id}:${poll.categoryKey}`)
                  .setPlaceholder(`Vote for ${poll.categoryLabel}`)
                  .addOptions(nomineeOptions)
              )]
            }).catch((e) => {
              console.error("[EOS] Failed to post community poll:", e);
              warnings.push(`eos_poll_${poll.categoryKey}: ${e instanceof Error ? e.message : String(e)}`);
            });
          }
        } else {
          warnings.push("eos_polls: no linked nominees available for select menu options");
        }
      }
    } catch (err) {
      console.error("[EOS] Community poll posting failed:", err);
      warnings.push(`eos_polls: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const recAwardsData = pollsData.recAwardsData;
  if (recAwardsData?.error && (recAwardsData.announcementsChannelId ?? pollsData.announcementsChannelId)) {
    const channelId = recAwardsData.announcementsChannelId ?? pollsData.announcementsChannelId;
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) as TextChannel | null : null;
    if (channel?.type === ChannelType.GuildText) {
      await channel.send({ embeds: [new EmbedBuilder().setTitle("REC Award Generation Failed").setDescription(`REC award voting embeds were not created.\n\n\`${recAwardsData.error.slice(0, 1800)}\``).setColor(0xe74c3c)] }).catch(() => undefined);
    }
    warnings.push(`rec_awards_generation: ${recAwardsData.error}`);
  }

  if (recAwardsData?.awards?.length && recAwardsData.announcementsChannelId) {
    try {
      const awardCh = await guild.channels.fetch(recAwardsData.announcementsChannelId).catch(() => null) as TextChannel | null;
      if (awardCh?.type === ChannelType.GuildText) {
        const votingAwards = recAwardsData.awards.filter((a) => a.status === "voting" && a.nomineeCount > 0);
        if (votingAwards.length === 0 && recAwardsData.awards.length > 0) {
          warnings.push(`rec_awards: generated ${recAwardsData.awards.length} awards but none are voting awards with nominees`);
        }
        for (const award of votingAwards) {
          const options = (award.nomineeOptions ?? []).slice(0, 25).map((n) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(n.displayLabel.slice(0, 100))
              .setValue(String(n.nomineeKey ?? n.nomineeId ?? n.userId).slice(0, 100))
          );
          if (options.length === 0) {
            warnings.push(`rec_award_${award.key}: no selectable nominee options`);
            continue;
          }
          await awardCh.send({
            embeds: [buildRecAwardVotingEmbed(award)],
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(`rec_award_vote:${guild.id}:${award.awardId}`)
                .setPlaceholder(`Vote for ${award.name}`)
                .addOptions(options)
            )]
          }).catch((err) => warnings.push(`rec_award_${award.key}: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
    } catch (err) {
      console.error("[EOS] REC Awards posting failed:", err);
      warnings.push(`rec_awards: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return warnings;
}

function asNumber(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function processingEmbed(title: string, description: string) {
  return new EmbedBuilder().setTitle(title).setDescription(description);
}

function buildPotwAnnouncementEmbed(awards: any[], completedWeek: number) {
  const lines: string[] = [`**Week ${completedWeek} — Player of the Week**`, ""];

  const byConference = new Map<string, { offense?: any; defense?: any }>();
  for (const award of awards) {
    const conf = award.conference ?? "Unknown";
    if (!byConference.has(conf)) byConference.set(conf, {});
    const entry = byConference.get(conf)!;
    if (award.award_side === "offense") entry.offense = award;
    else entry.defense = award;
  }

  for (const [conference, { offense, defense }] of byConference) {
    lines.push(`__**${conference}**__`);
    for (const [label, award] of [["Offensive", offense], ["Defensive", defense]] as const) {
      if (!award) continue;
      const mention = award.discordId ? `<@${award.discordId}>` : award.player_name ?? "Unknown";
      const statsLine = formatPotwStats(award.weeklyStats ?? award.raw_payload?.weeklyStats ?? {}, award.award_side as "offense" | "defense");
      lines.push(`**${label} POTW:** ${award.player_name ?? "Unknown"} (${award.position ?? "?"}) · ${mention}`);
      if (statsLine) lines.push(`${statsLine}`);
      lines.push(`Bonus: **+$${award.payout_amount ?? 10}**`);
      lines.push("");
    }
  }

  if (lines.length <= 2) lines.push("No qualified POTW candidates found this week.");

  return new EmbedBuilder()
    .setTitle(`⭐ Week ${completedWeek} Player of the Week`)
    .setDescription(lines.join("\n").slice(0, 4000));
}

function formatPotwStats(stats: Record<string, any>, side: "offense" | "defense"): string {
  // Render one "value ShortLabel" segment from a canonical stat key (e.g. "3 Pass TD").
  const stat = (key: string): string => `${formatStatValue(key, readStat(stats, key))} ${getStatShortLabel(key)}`;
  const parts: string[] = [];
  if (side === "offense") {
    const passYds = readStat(stats, "pass_yards");
    const rushYds = readStat(stats, "rush_yards");
    const recYds = readStat(stats, "receiving_yards");
    if (passYds > 0) parts.push(`${stat("pass_yards")}, ${stat("pass_tds")}, ${stat("interceptions_thrown")}`);
    if (rushYds > 0) parts.push(`${stat("rush_yards")}${readStat(stats, "rush_tds") > 0 ? `, ${stat("rush_tds")}` : ""}`);
    if (recYds > 0) parts.push(`${stat("receiving_yards")}${readStat(stats, "receiving_tds") > 0 ? `, ${stat("receiving_tds")}` : ""}`);
  } else {
    if (readStat(stats, "sacks") > 0) parts.push(stat("sacks"));
    if (readStat(stats, "interceptions") > 0) parts.push(stat("interceptions"));
    if (readStat(stats, "forced_fumbles") > 0) parts.push(stat("forced_fumbles"));
    if (readStat(stats, "tackles") > 0) parts.push(stat("tackles"));
    if (readStat(stats, "tackles_for_loss") > 0) parts.push(stat("tackles_for_loss"));
  }
  return parts.join(" · ");
}

function buildWizardGotwSelectionPayload(candidates: any[], weekNumber: number) {
  const topCandidates = candidates.slice(0, 25);
  const options = topCandidates.map((c: any) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(c.matchup_title?.length > 100 ? c.matchup_title.slice(0, 97) + "..." : c.matchup_title ?? "Unknown Matchup")
      .setValue(c.id)
      .setDescription(`Rating: ${Number(c.strength_rating ?? 0).toFixed(0)}`)
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`Step 5 of 6 — Select Week ${weekNumber} Game of the Week`)
        .setDescription("Select the matchup to feature as the Game of the Week. The vote poll will be posted to the announcements channel.\n\nMatchups are sorted by strength rating (power rankings, competitiveness, division rivalry).")
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ADVANCE_WIZARD_GOTW_CUSTOM_ID)
          .setPlaceholder("Select the GOTW matchup")
          .addOptions(options)
      )
    ]
  };
}

function buildWizardCompletePage(weekNumber: number, seasonStage: string, warnings: string[]) {
  const stageLabel = String(seasonStage ?? "regular_season").replaceAll("_", " ");
  const lines = [
    `The advance process has completed. It is now **Week ${weekNumber}** (${stageLabel}).`,
    "",
    warnings.length ? `**${warnings.length} warning(s) during advance:**` : "All advance steps completed successfully.",
    ...warnings.slice(0, 8).map((w) => `• ${w}`)
  ].filter(Boolean);

  return {
    embeds: [new EmbedBuilder().setTitle("Advance Complete").setDescription(lines.join("\n").slice(0, 4000))],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("rec:nav:admin_panel").setLabel("Admin Panel").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("rec:nav:main_menu").setLabel("Main Menu").setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

// One embed recapping every week processed during a catch-up fast-forward (POTW + badges per week).
function buildCatchUpSummaryEmbed(result: any) {
  const weeks: any[] = result?.weeks ?? [];
  const lines: string[] = [];
  for (const w of weeks) {
    const potw = (w.potwAwards ?? [])
      .map((a: any) => `${a.conference ?? ""} ${a.award_side === "defense" ? "DEF" : "OFF"}: ${a.player_name ?? "—"}${a.position ? ` (${a.position})` : ""}`.trim())
      .filter(Boolean);
    const badgeCount = (w.badgesEarned ?? []).length;
    const parts: string[] = [];
    if (potw.length) parts.push(`POTW — ${potw.join(" · ")}`);
    if (badgeCount) parts.push(`${badgeCount} badge${badgeCount === 1 ? "" : "s"} earned`);
    if (!parts.length) parts.push("Processed (no POTW/badges)");
    lines.push(`**${w.completedWeekLabel ?? `Week ${w.weekNumber}`}** — ${parts.join("; ")}`);
  }
  return new EmbedBuilder()
    .setTitle("Catch-Up Advance Summary")
    .setColor(0x3498db)
    .setDescription([
      `Fast-forwarded **${weeks.length}** week${weeks.length === 1 ? "" : "s"} of imported results. Records, payouts, POTW, and badges were applied for each. Game channels and the Game of the Week poll are only created for the final landed week.`,
      "",
      ...lines
    ].join("\n").slice(0, 4000));
}

export async function runAdvanceWizardProcessing(
  interaction: ButtonInteraction,
  date: string,
  hour: number,
  timezone: string,
  guild: Guild
) {
  const guildId = guild.id;
  const allWarnings: string[] = [];

  // Save the next advance time
  try {
    const [y, mo, d] = date.split("-").map(Number);
    const when = wallClockToUtc(y, mo, d, hour, timezone);
    await recApi.setNextAdvance({ guildId, nextAdvanceAt: when.toISOString(), timezone });
  } catch (err) {
    console.error("[WIZARD] Failed to save advance time:", err);
  }

  // Catch-up: if the commissioner picked a target several weeks ahead on the review screen,
  // fast-forward the intermediate imported weeks first (records/payouts/POTW/badges per week, no
  // game-channel or GOTW spam), then fall through to the normal advance for the final landed week.
  const catchUpTarget = catchUpTargets.get(interaction.user.id);
  catchUpTargets.delete(interaction.user.id);
  if (catchUpTarget && catchUpTarget.advances > 1) {
    const intermediate = catchUpTarget.advances - 1;
    await interaction.editReply({
      embeds: [processingEmbed("Catching Up", `Processing ${intermediate} prior week${intermediate === 1 ? "" : "s"} of imported results before the final advance...`)],
      components: []
    });
    try {
      const catchUp = await recApi.catchUpAdvance({ guildId, targetWeek: catchUpTarget.targetWeek, targetStage: catchUpTarget.targetStage });
      allWarnings.push(...(catchUp?.warnings ?? []));
      const weeks: any[] = catchUp?.weeks ?? [];
      const announceId = weeks.find((w: any) => w.announcementsChannelId)?.announcementsChannelId ?? null;
      if (announceId) {
        const ch = await guild.channels.fetch(announceId).catch(() => null) as TextChannel | null;
        if (ch?.type === ChannelType.GuildText) await ch.send({ embeds: [buildCatchUpSummaryEmbed(catchUp)] }).catch((e) => console.error("[WIZARD] catch-up summary post failed:", e));
      }
      for (const w of weeks) {
        if (w.dmPayloads?.length) await sendAdvanceDmPayloads(guild, w.dmPayloads).catch((e: unknown) => console.error("[WIZARD] catch-up DM send failed:", e));
      }
    } catch (err) {
      console.error("[WIZARD] catchUpAdvance failed:", err);
      allWarnings.push(`catch_up: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 2: Process results
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 2 of 6 — Processing Results",
      "Game results are being logged, records updated and payouts issued...\n\nThis may take a moment. Please wait."
    )],
    components: []
  });

  let resultsData: any;
  try {
    resultsData = await recApi.processAdvanceResults(guildId);
  } catch (err) {
    console.error("[WIZARD] processAdvanceResults failed:", err);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Advance Failed").setDescription(`The advance process could not be completed.\n\n${err instanceof Error ? err.message : String(err)}`)],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("rec:nav:admin_panel").setLabel("Admin Panel").setStyle(ButtonStyle.Secondary)
      )]
    });
    return;
  }

  if (!resultsData?.week) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Advance Week Failed").setDescription(
        ["The week could not be advanced. Check the API logs for details.", "", ...(resultsData?.warnings ?? []).map((w: string) => `• ${w}`)].join("\n")
      )],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("rec:nav:admin_panel").setLabel("Admin Panel").setStyle(ButtonStyle.Secondary)
      )]
    });
    return;
  }

  allWarnings.push(...(resultsData.warnings ?? []));
  const completedWeek = resultsData.week.previousWeek as number;
  const newWeek = resultsData.week.weekNumber as number;
  const newStage = resultsData.week.seasonStage as string;

  // Collect transition badges (season-end / playoff) from the advance step
  const allBadgeAnnouncements: BadgeAnnouncement[] = [];
  const transitionBadges = resultsData.transitionBadgeAnnouncements;
  let badgeAnnouncementsChannelId: string | null = transitionBadges?.announcementsChannelId ?? null;
  if (transitionBadges?.earned?.length) {
    for (const b of transitionBadges.earned) allBadgeAnnouncements.push({ ...b, type: "earned" });
  }
  if (transitionBadges?.lost?.length) {
    for (const b of transitionBadges.lost) allBadgeAnnouncements.push({ ...b, type: "lost" });
  }

  // Collect EOS polls data (created on regular_season → wild_card transition)
  const eosPollsData: EosPollsData | null = resultsData.eosPollsData ?? null;
  // EOS lock data (wild_card → divisional): may include commissioner tiebreakers
  const eosLockData: any = resultsData.eosLockData ?? null;
  // Nomination data (POTY/GOTY DMs) — only present for intra-regular-season advances
  const nominationData: any = resultsData.nominationData ?? null;

  // Step 3: POTW
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 3 of 6 — POTW Awards",
      `Reviewing Week ${completedWeek} performances and awarding Player of the Week bonuses...`
    )],
    components: []
  });

  let potwData: any;
  try {
    potwData = await recApi.processPotwAward(guildId);
    allWarnings.push(...(potwData.warnings ?? []));

    if (potwData.awards?.length && potwData.announcementsChannelId) {
      const ch = await guild.channels.fetch(potwData.announcementsChannelId).catch(() => null) as TextChannel | null;
      if (ch?.type === ChannelType.GuildText) {
        await ch.send({ embeds: [buildPotwAnnouncementEmbed(potwData.awards, completedWeek)] }).catch((e) =>
          console.error("[WIZARD] Failed to post POTW announcement:", e)
        );
      }
    }

    // Collect weekly badges (Comeback Artist, Record Breaker) from POTW step
    const weeklyBadges = potwData.weeklyBadgeAnnouncements;
    if (!badgeAnnouncementsChannelId && potwData.announcementsChannelId) {
      badgeAnnouncementsChannelId = potwData.announcementsChannelId;
    }
    if (weeklyBadges?.earned?.length) {
      for (const b of weeklyBadges.earned) allBadgeAnnouncements.push({ ...b, type: "earned" });
    }
    if (weeklyBadges?.lost?.length) {
      for (const b of weeklyBadges.lost) allBadgeAnnouncements.push({ ...b, type: "lost" });
    }
  } catch (err) {
    console.error("[WIZARD] processPotwAward failed:", err);
    allWarnings.push(`potw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 4: Power Rankings
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 4 of 6 — Power Rankings",
      `Calculating Week ${completedWeek} power rankings and posting to announcements...`
    )],
    components: []
  });

  try {
    const rankingsData = await recApi.calculatePowerRankings(guildId);
    allWarnings.push(...(rankingsData.warnings ?? []));

    // Post to announcements channel — @everyone tag, split across multiple embeds if >16 teams
    const rankingsChannelId = rankingsData?.announcementsChannelId ?? potwData?.announcementsChannelId;

    if (rankingsData?.rankings?.length && rankingsChannelId) {
      const ch = await guild.channels.fetch(rankingsChannelId).catch(() => null) as TextChannel | null;
      if (ch?.type === ChannelType.GuildText) {
        const embeds = buildPowerRankingsEmbeds(rankingsData);
        // Discord allows max 10 embeds per message; send in groups
        const EMBEDS_PER_MSG = 10;
        for (let i = 0; i < embeds.length; i += EMBEDS_PER_MSG) {
          const batch = embeds.slice(i, i + EMBEDS_PER_MSG);
          const isFirst = i === 0;
          await ch.send({
            content: isFirst ? "@everyone" : undefined,
            embeds: batch,
            allowedMentions: isFirst ? { parse: ["everyone"] } : { parse: [] }
          }).catch((e) => console.error("[WIZARD] Failed to post power rankings:", e));
        }
      }
    }
  } catch (err) {
    console.error("[WIZARD] calculatePowerRankings failed:", err);
    allWarnings.push(`power_rankings: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 5: GOTW
  const isRegularSeason = newStage === "regular_season";
  const isPlayoffStage = ["wild_card", "divisional", "conference_championship", "super_bowl"].includes(newStage);

  if (isPlayoffStage) {
    // In playoffs every H2H game is a GOTW — auto-create polls and post all vote embeds
    await interaction.editReply({
      embeds: [processingEmbed(
        "Step 5 of 6 — Playoff Game of the Week",
        `All ${String(newStage).replaceAll("_", " ")} matchups are Game of the Week. Creating vote polls...`
      )],
      components: []
    });

    try {
      const playoffGotw = await recApi.processPlayoffGotw(guildId);
      const channelId = playoffGotw.channelId;
      if (channelId && playoffGotw.polls?.length) {
        const ch = await guild.channels.fetch(channelId).catch(() => null) as TextChannel | null;
        if (ch?.type === ChannelType.GuildText) {
          for (const poll of playoffGotw.polls) {
            const awayDiscordId: string | null = poll.awayDiscordId ?? null;
            const homeDiscordId: string | null = poll.homeDiscordId ?? null;
            const discordUserIds = [awayDiscordId, homeDiscordId].filter((id): id is string => Boolean(id));
            const sent = await ch.send({
              content: buildGotwAnnouncementContent(poll, awayDiscordId, homeDiscordId),
              embeds: [buildGotwVoteEmbed(poll, [])],
              components: buildGotwVoteRows(poll),
              allowedMentions: { parse: ["everyone"], users: discordUserIds }
            }).catch((e) => { console.error("[WIZARD] Failed to post playoff GOTW embed:", e); return null; });
            if (sent) {
              await recApi.recordGotwPollMessage({ pollId: poll.id, discordChannelId: ch.id, discordMessageId: sent.id }).catch(() => undefined);
            }
          }
        }
      }
      allWarnings.push(...(playoffGotw.warnings ?? []));
    } catch (err) {
      console.error("[WIZARD] processPlayoffGotw failed:", err);
      allWarnings.push(`playoff_gotw: ${err instanceof Error ? err.message : String(err)}`);
    }

    advanceWizardSessions.set(interaction.user.id, { weekNumber: newWeek, seasonStage: newStage, warnings: allWarnings, badgeAnnouncements: allBadgeAnnouncements, announcementsChannelId: badgeAnnouncementsChannelId, eosPollsData, eosLockData, nominationData });
    await runAdvanceWizardFinalize(interaction, guild, newWeek, newStage, allWarnings, allBadgeAnnouncements, badgeAnnouncementsChannelId, eosPollsData, nominationData, eosLockData);
    return;
  }

  if (isRegularSeason) {
    await interaction.editReply({
      embeds: [processingEmbed(
        "Step 5 of 6 — Game of the Week",
        "Determining GOTW matchup ratings and pulling the upcoming schedule..."
      )],
      components: []
    });

    let candidates: any[] = [];
    try {
      const gotwData = await recApi.getGotwCandidates(guildId);
      candidates = gotwData.candidates ?? [];
    } catch (err) {
      console.error("[WIZARD] getGotwCandidates failed:", err);
      allWarnings.push(`gotw_candidates: ${err instanceof Error ? err.message : String(err)}`);
    }

    advanceWizardSessions.set(interaction.user.id, { weekNumber: newWeek, seasonStage: newStage, warnings: allWarnings, badgeAnnouncements: allBadgeAnnouncements, announcementsChannelId: badgeAnnouncementsChannelId, eosPollsData, eosLockData, nominationData });

    if (candidates.length) {
      await interaction.editReply(buildWizardGotwSelectionPayload(candidates, newWeek));
    } else {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle("Step 5 of 6 — No GOTW Matchups")
          .setDescription("No H2H matchups found for this week. Skipping GOTW selection and proceeding to finalize.")],
        components: []
      });
      await runAdvanceWizardFinalize(interaction, guild, newWeek, newStage, allWarnings, allBadgeAnnouncements, badgeAnnouncementsChannelId, eosPollsData, nominationData, eosLockData);
    }
    return;
  }

  // Offseason or unrecognized stage: skip GOTW
  advanceWizardSessions.set(interaction.user.id, { weekNumber: newWeek, seasonStage: newStage, warnings: allWarnings, badgeAnnouncements: allBadgeAnnouncements, announcementsChannelId: badgeAnnouncementsChannelId, eosPollsData, eosLockData, nominationData });
  await runAdvanceWizardFinalize(interaction, guild, newWeek, newStage, allWarnings, allBadgeAnnouncements, badgeAnnouncementsChannelId, eosPollsData, nominationData, eosLockData);
}

export async function handleWizardGotwSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only admins can perform this action.", ephemeral: true });
    return;
  }
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Selecting GOTW...").setDescription("Saving your game of the week selection and posting the vote poll.")], components: [] });

  const wizardState = advanceWizardSessions.get(interaction.user.id);
  const candidateId = interaction.values[0];
  const guild = interaction.guild;

  // Select the GOTW and post the poll
  let newWeek = wizardState?.weekNumber ?? 0;
  let newStage = wizardState?.seasonStage ?? "regular_season";
  const allWarnings = wizardState?.warnings ?? [];
  const badgeAnnouncements = wizardState?.badgeAnnouncements ?? [];
  const announcementsChannelId = wizardState?.announcementsChannelId ?? null;
  const eosPollsData = wizardState?.eosPollsData ?? null;
  const eosLockData = wizardState?.eosLockData ?? null;
  const nominationData = wizardState?.nominationData ?? null;

  try {
    const result = await recApi.selectGotwCandidate({ guildId: guild.id, candidateId, selectedByDiscordId: interaction.user.id });
    const channelId = result.channelId;
    if (channelId) {
      const ch = await guild.channels.fetch(channelId).catch(() => null) as TextChannel | null;
      if (ch?.type === ChannelType.GuildText) {
        const poll = result.poll;
        const awayDiscordId: string | null = result.awayDiscordId ?? null;
        const homeDiscordId: string | null = result.homeDiscordId ?? null;
        const discordUserIds = [awayDiscordId, homeDiscordId].filter((id): id is string => Boolean(id));
        const sent = await ch.send({
          content: buildGotwAnnouncementContent(poll, awayDiscordId, homeDiscordId),
          embeds: [buildGotwVoteEmbed(poll, [])],
          components: buildGotwVoteRows(poll),
          allowedMentions: { parse: ["everyone"], users: discordUserIds }
        });
        await recApi.recordGotwPollMessage({ pollId: poll.id, discordChannelId: ch.id, discordMessageId: sent.id });
      }
    }
  } catch (err) {
    console.error("[WIZARD] GOTW select/post failed:", err);
    allWarnings.push(`gotw_select: ${err instanceof Error ? err.message : String(err)}`);
  }

  await runAdvanceWizardFinalize(interaction, guild, newWeek, newStage, allWarnings, badgeAnnouncements, announcementsChannelId, eosPollsData, nominationData, eosLockData);
}

async function runAdvanceWizardFinalize(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  guild: Guild,
  weekNumber: number,
  seasonStage: string,
  warnings: string[],
  badgeAnnouncements: BadgeAnnouncement[] = [],
  announcementsChannelId: string | null = null,
  eosPollsData: EosPollsData | null = null,
  nominationData: any = null,
  eosLockData: any = null
) {
  // 5a: generate challenges
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 6 of 6 — Generating Challenges",
      "Generating weekly challenges..."
    )],
    components: []
  });

  try {
    const finalizeData = await recApi.finalizeAdvanceStep(guild.id);
    warnings.push(...(finalizeData.warnings ?? []));
  } catch (err) {
    console.error("[WIZARD] finalizeAdvanceStep failed:", err);
    warnings.push(`generate_challenges: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5b: create game channels before DMs so each DM can link the matchup channel.
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 6 of 6 - Creating Game Channels",
      "Creating H2H game channels for the new week..."
    )],
    components: []
  });

  try {
    await recreateGameChannelsForGuild(guild);
  } catch (err) {
    console.error("[WIZARD] recreateGameChannelsForGuild failed:", err);
    warnings.push(`game_channels: ${err instanceof Error ? err.message : String(err)}`);
  }

  // DM each user about badge changes (no channel embed)
  if (badgeAnnouncements.length > 0) {
    const badgeIds = [...new Set(badgeAnnouncements.map((b) => b.discordId).filter(Boolean))] as string[];
    const badgeMembers = badgeIds.length > 0
      ? await guild.members.fetch({ user: badgeIds }).catch(() => new Map()) as Map<string, any>
      : new Map<string, any>();

    for (const b of badgeAnnouncements) {
      if (!b.discordId) continue;
      const member = badgeMembers.get(b.discordId);
      if (!member) continue;
      const dmText = b.type === "earned"
        ? `You earned the **${b.badgeLabel}** badge${b.qualifier ? ` for ${b.qualifier}` : ""}!`
        : `Your **${b.badgeLabel}** badge has been removed${b.reason ? ` — ${b.reason}` : ""}.`;
      await member.send({
        embeds: [new EmbedBuilder()
          .setTitle(b.type === "earned" ? "Badge Earned" : "Badge Removed")
          .setDescription(dmText)
          .setColor(b.type === "earned" ? 0xffd700 : 0x95a5a6)
        ]
      }).catch(() => undefined);
    }
  }

  // Post Can't Shut Up commissioner tiebreaker embed (wild_card → divisional only)
  if (eosLockData?.commissionerTiebreakers?.length) {
    const payoutsCh = eosLockData.pendingPayoutsChannelId
      ? await guild.channels.fetch(eosLockData.pendingPayoutsChannelId).catch(() => null) as TextChannel | null
      : null;
    if (payoutsCh?.type === ChannelType.GuildText) {
      for (const tb of eosLockData.commissionerTiebreakers as Array<{ pollId: string; categoryKey: string; categoryLabel: string; tiedUserIds: string[]; tiedDiscordIds: (string | null)[] }>) {
        try {
          const options = tb.tiedUserIds.map((uid, i) => {
            const mention = tb.tiedDiscordIds[i] ? `<@${tb.tiedDiscordIds[i]}>` : uid;
            return new StringSelectMenuOptionBuilder()
              .setLabel(mention.replace(/<@!?(\d+)>/, "User $1").slice(0, 100))
              .setDescription(`UserID: ${uid}`)
              .setValue(uid);
          }).slice(0, 25);
          const embed = new EmbedBuilder()
            .setTitle(`Commissioner Tiebreaker — ${tb.categoryLabel}`)
            .setDescription([
              `**"Can't Shut Up"** ended in a tie!`,
              "",
              `Tied candidates: ${tb.tiedDiscordIds.map((id) => id ? `<@${id}>` : "Unknown").join(", ")}`,
              "",
              "Select the winner below."
            ].join("\n"))
            .setColor(0xe74c3c);
          await payoutsCh.send({
            embeds: [embed],
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(`eos_tiebreaker:cant_shut_up:${tb.pollId}`)
                .setPlaceholder("Select the winner")
                .addOptions(options)
            )],
            allowedMentions: { parse: ["users"] }
          }).catch(() => undefined);
        } catch (err) {
          console.error("[WIZARD] Failed to post tiebreaker embed:", err);
        }
      }
    }
  }

  // Send POTY/GOTY nomination DMs (regular season advances only, not week 18 → wild_card)
  if (nominationData?.sendNominationDms) {
    try {
      const weekNum: number = nominationData.weekNumber ?? weekNumber;

      const potyNominees = (nominationData.potyNominees ?? []) as Array<{ userId: string; discordId: string | null; displayName: string; highlightId: string; highlightUrl: string | null }>;
      const gotyNominees = (nominationData.gotyNominees ?? []) as Array<{ userId: string; discordId: string | null; displayName: string; gameId: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; label: string }>;

      const nomIds = [...new Set([...potyNominees, ...gotyNominees].map((c) => c.discordId).filter(Boolean))] as string[];
      const nomMembers = nomIds.length > 0
        ? await guild.members.fetch({ user: nomIds }).catch(() => new Map()) as Map<string, any>
        : new Map<string, any>();

      // POTY — Play of the Year: DM coaches who submitted a highlight this week
      for (const coach of potyNominees) {
        if (!coach.discordId) continue;
        const member = nomMembers.get(coach.discordId);
        if (!member) continue;
        try {
          await member.send({
            embeds: [new EmbedBuilder()
              .setTitle(`Play of the Year — Week ${weekNum} Nomination`)
              .setDescription([
                `Your highlight from **Week ${weekNum}** is eligible for a Play of the Year nomination!`,
                "",
                coach.highlightUrl ? `[View your highlight](${coach.highlightUrl})` : "",
                "",
                "Click below to nominate your play for POTY consideration.",
                "",
                "_Nominations are reviewed at the end of the season._"
              ].filter(Boolean).join("\n"))
              .setColor(0xf1c40f)
            ],
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`poty_nominate_own:${guild.id}:${coach.highlightId}`)
                .setLabel("Nominate My Play")
                .setStyle(ButtonStyle.Primary)
            )]
          }).catch(() => undefined);
        } catch { /* skip */ }
      }

      // GOTY — Game of the Year: DM coaches whose H2H game had ≤7pt margin
      for (const coach of gotyNominees) {
        if (!coach.discordId) continue;
        const member = nomMembers.get(coach.discordId);
        if (!member) continue;
        try {
          await member.send({
            embeds: [new EmbedBuilder()
              .setTitle(`Game of the Year — Week ${weekNum} Nomination`)
              .setDescription([
                "Your Week " + weekNum + " game was a close one! It's eligible for a Game of the Year nomination.",
                "",
                `**${coach.awayTeam}** @ **${coach.homeTeam}**`,
                `Final: **${coach.awayScore}** — **${coach.homeScore}**`,
                "",
                "Click below to nominate this game. You'll be asked to share what made it memorable."
              ].join("\n"))
              .setColor(0x3498db)
            ],
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`goty_nominate_btn:${guild.id}:${coach.gameId}`)
                .setLabel("Nominate This Game")
                .setStyle(ButtonStyle.Primary)
            )]
          }).catch(() => undefined);
        } catch { /* skip */ }
      }
    } catch (err) {
      console.error("[WIZARD] Nomination DMs failed:", err);
      warnings.push(`nomination_dms: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Final advance step: send advance DMs and post the advance announcement after every other advance side effect.
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 6 of 6 - Sending Advance DMs",
      "Gathering all advance data and sending final advance notice DMs..."
    )],
    components: []
  });

  try {
    await sendAdvanceDmsOnly(guild);
  } catch (err) {
    console.error("[WIZARD] sendAdvanceDmsOnly failed:", err);
    warnings.push(`advance_dms: ${err instanceof Error ? err.message : String(err)}`);
  }
  advanceWizardSessions.delete(interaction.user.id);
  await interaction.editReply(buildWizardCompletePage(weekNumber, seasonStage, warnings));
}
