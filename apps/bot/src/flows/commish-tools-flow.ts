// Commissioner-only ephemeral panel: Grant FW, Grant FS, Suspend User, Boot User, Reset
// Scheduling. Gated the same way as the old standalone Reset button (isDiscordAdminInteraction);
// the API routes behind every action here are ALSO gated server-side (permission:
// "co_commissioner"), so this bot-side check is a UX nicety, not the only enforcement.
import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, MessageFlags,
  ModalBuilder, ModalSubmitInteraction, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";
import { idAfter } from "./game-scheduling-panel.js";

export const COMMISH_TOOLS_CUSTOM_IDS = {
  panel: "rec:gamesched:panel:commishtools:",
  menu: "rec:commish:menu:",
  matchupSelect: "rec:commish:matchupselect",
  // "Start" buttons (posted from the Commish Tools menu, customId suffix is just a gameId) and
  // "Side" buttons (posted after Home/Away is picked, suffix is "home:<gameId>"/"away:<gameId>")
  // deliberately use DIFFERENT prefixes even though they're steps in the same flow -- sharing one
  // prefix would make the "start" button's startsWith() dispatch check also match the "side"
  // buttons (same class of bug fixed for the AutoPilot-resolve customIds earlier in this project).
  grantFw: "rec:commish:grantfw:",
  grantFwSide: "rec:commish:grantfwside:",
  grantFs: "rec:commish:grantfs:",
  grantAutopilot: "rec:commish:grantap:",
  grantAutopilotSide: "rec:commish:grantapside:",
  suspend: "rec:commish:suspend:",
  suspendSide: "rec:commish:suspendside:",
  suspendModal: "rec:commish:suspendmodal:",
  boot: "rec:commish:boot:",
  bootSide: "rec:commish:bootside:",
  bootConfirm: "rec:commish:bootconfirm:",
  bootModal: "rec:commish:bootmodal:",
  reset: "rec:commish:reset:",
  resetWipeConfirm: "rec:commish:resetwipeconfirm:",
  audit: "rec:commish:audit",
};

async function replyErr(interaction: ButtonInteraction | ModalSubmitInteraction, error: unknown) {
  const content = userFacingError(error);
  if (interaction.deferred || interaction.replied) return interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

function denyNonCommish(interaction: ButtonInteraction) {
  return interaction.reply({ content: "Only a commissioner or co-commissioner can use Commish Tools.", flags: MessageFlags.Ephemeral });
}

function actionMenuComponents(gameId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${COMMISH_TOOLS_CUSTOM_IDS.grantFw}${gameId}`).setLabel("Grant FW").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${COMMISH_TOOLS_CUSTOM_IDS.grantFs}${gameId}`).setLabel("Grant FS").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${COMMISH_TOOLS_CUSTOM_IDS.grantAutopilot}${gameId}`).setLabel("Grant AutoPilot").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${COMMISH_TOOLS_CUSTOM_IDS.suspend}${gameId}`).setLabel("Suspend User").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${COMMISH_TOOLS_CUSTOM_IDS.boot}${gameId}`).setLabel("Boot User").setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${COMMISH_TOOLS_CUSTOM_IDS.reset}${gameId}`).setLabel("Reset Scheduling").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export async function handleCommishToolsPanel(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const gameId = idAfter(COMMISH_TOOLS_CUSTOM_IDS.panel, interaction.customId);
  await interaction.reply({ content: "Commish Tools — choose an action:", components: actionMenuComponents(gameId), flags: MessageFlags.Ephemeral });
}

// --- /commishtools slash command entry point: matchup select, then the same action menu ---
export async function handleCommishToolsSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only a commissioner or co-commissioner can use Commish Tools.", flags: MessageFlags.Ephemeral });

  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  const games = await recApi.listManualScoreGames({ guildId: interaction.guildId, weekNumber: week?.league?.current_week ?? undefined }).catch(() => null);
  const options = (games?.games ?? []).slice(0, 24).map((g: any) =>
    new StringSelectMenuOptionBuilder().setLabel(`${g.awayName} at ${g.homeName}`.slice(0, 100)).setValue(g.gameId),
  );
  options.push(new StringSelectMenuOptionBuilder().setLabel("Game Day Audit (all active channels)").setValue("__audit__"));

  await interaction.reply({
    content: "Commish Tools — pick a matchup, or run a Game Day Audit across every active game channel:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(COMMISH_TOOLS_CUSTOM_IDS.matchupSelect).setPlaceholder("Select a matchup").addOptions(options),
    )],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleCommishToolsMatchupSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction as unknown as ButtonInteraction);
  const value = interaction.values[0] ?? "";
  if (value === "__audit__") return runGameDayAudit(interaction);
  await interaction.update({ content: "Commish Tools — choose an action:", components: actionMenuComponents(value) });
}

async function runGameDayAudit(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  try {
    const result = await recApi.gameDayAudit({ guildId: interaction.guildId!, discordId: interaction.user.id });
    if (!result.entries.length) {
      await interaction.editReply({ content: "No active game channels to audit.", components: [] });
      return;
    }
    const recommendationLabel = (r: string | null) => r === "fair_sim" ? "⚪ Recommend: Fair Sim (neither coach engaged)"
      : r === "force_win_home" ? "🔴 Recommend: Force Win for the home coach (away coach unresponsive)"
      : r === "force_win_away" ? "🔴 Recommend: Force Win for the away coach (home coach unresponsive)"
      : "🟢 Both coaches engaged — no recommendation";
    const coachLine = (label: string, c: { teamName: string; messageCount: number; firstMessageTodayAt: string | null; submittedTimesCount: number }) => {
      const first = c.firstMessageTodayAt ? `<t:${Math.floor(new Date(c.firstMessageTodayAt).getTime() / 1000)}:t>` : "no messages today";
      return `**${label} (${c.teamName})**: ${c.messageCount} messages, first today at ${first}, ${c.submittedTimesCount} time(s) submitted`;
    };
    const embeds = result.entries.slice(0, 10).map((entry) => new EmbedBuilder()
      .setTitle(`${entry.away.teamName} at ${entry.home.teamName}`)
      .setDescription([coachLine("Home", entry.home), coachLine("Away", entry.away), "", recommendationLabel(entry.recommendation)].join("\n")));
    await interaction.editReply({ content: `Game Day Audit — ${result.entries.length} active channel(s):`, embeds, components: [] });
  } catch (error) {
    await interaction.editReply({ content: userFacingError(error), components: [] });
  }
}

// --- Grant AutoPilot ---
export async function handleCommishGrantAutopilotStart(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const gameId = idAfter(COMMISH_TOOLS_CUSTOM_IDS.grantAutopilot, interaction.customId);
  await interaction.reply({ content: "Grant AutoPilot to which side?", components: [sideRow(COMMISH_TOOLS_CUSTOM_IDS.grantAutopilotSide, gameId)], flags: MessageFlags.Ephemeral });
}

export async function handleCommishGrantAutopilotSide(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const { side, gameId } = parseSideAndGameId(idAfter(COMMISH_TOOLS_CUSTOM_IDS.grantAutopilotSide, interaction.customId));
  try {
    await interaction.deferUpdate();
    const result = await recApi.grantAutoPilotCommissioner({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, side });
    await interaction.editReply({ content: `✅ AutoPilot granted to ${result.cite}.`, components: [] });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

function sideRow(prefix: string, gameId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}home:${gameId}`).setLabel("Home").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${prefix}away:${gameId}`).setLabel("Away").setStyle(ButtonStyle.Secondary),
  );
}

function parseSideAndGameId(rest: string): { side: "home" | "away"; gameId: string } {
  const [side, gameId] = rest.split(":");
  return { side: side as "home" | "away", gameId };
}

// --- Grant FW ---
export async function handleCommishGrantFwStart(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const gameId = idAfter(COMMISH_TOOLS_CUSTOM_IDS.grantFw, interaction.customId);
  await interaction.reply({ content: "Grant Force Win to which side?", components: [sideRow(COMMISH_TOOLS_CUSTOM_IDS.grantFwSide, gameId)], flags: MessageFlags.Ephemeral });
}

export async function handleCommishGrantFwSide(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const { side, gameId } = parseSideAndGameId(idAfter(COMMISH_TOOLS_CUSTOM_IDS.grantFwSide, interaction.customId));
  try {
    await interaction.deferUpdate();
    const result = await recApi.grantForceWinCommissioner({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, side });
    await interaction.editReply({ content: `✅ Force Win granted to ${result.cite}.`, components: [] });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

// --- Grant FS ---
export async function handleCommishGrantFs(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const gameId = idAfter(COMMISH_TOOLS_CUSTOM_IDS.grantFs, interaction.customId);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await recApi.grantFairSimCommissioner({ guildId: interaction.guildId, discordId: interaction.user.id, gameId });
    await interaction.editReply({ content: "✅ Fair Sim granted for this game." });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

// --- Suspend User ---
export async function handleCommishSuspendStart(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const gameId = idAfter(COMMISH_TOOLS_CUSTOM_IDS.suspend, interaction.customId);
  await interaction.reply({ content: "Suspend which side?", components: [sideRow(COMMISH_TOOLS_CUSTOM_IDS.suspendSide, gameId)], flags: MessageFlags.Ephemeral });
}

export async function handleCommishSuspendSide(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const { side, gameId } = parseSideAndGameId(idAfter(COMMISH_TOOLS_CUSTOM_IDS.suspendSide, interaction.customId));
  const modal = new ModalBuilder()
    .setCustomId(`${COMMISH_TOOLS_CUSTOM_IDS.suspendModal}${side}:${gameId}`)
    .setTitle(`Suspend ${side} coach`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("reason").setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("weeks").setLabel("Length (1-4 weeks)").setStyle(TextInputStyle.Short).setPlaceholder("1").setRequired(true).setMaxLength(1),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleCommishSuspendModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only a commissioner or co-commissioner can use Commish Tools.", flags: MessageFlags.Ephemeral });
  const { side, gameId } = parseSideAndGameId(interaction.customId.slice(COMMISH_TOOLS_CUSTOM_IDS.suspendModal.length));
  const reason = interaction.fields.getTextInputValue("reason");
  const weeksRaw = interaction.fields.getTextInputValue("weeks").trim();
  const weeks = Number(weeksRaw);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 4) {
    return interaction.reply({ content: "Length must be a whole number between 1 and 4.", flags: MessageFlags.Ephemeral });
  }
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await recApi.suspendUserCommissioner({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, side, reason, weeks });
    await interaction.editReply({ content: `✅ ${side === "home" ? "Home" : "Away"} coach suspended for ${weeks} week${weeks === 1 ? "" : "s"}.` });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

// --- Boot User (extra confirm step -- kicks from the Discord server, a harder-to-reverse action) ---
export async function handleCommishBootStart(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const gameId = idAfter(COMMISH_TOOLS_CUSTOM_IDS.boot, interaction.customId);
  await interaction.reply({ content: "Boot which side? This unlinks their team and kicks them from the server.", components: [sideRow(COMMISH_TOOLS_CUSTOM_IDS.bootSide, gameId)], flags: MessageFlags.Ephemeral });
}

export async function handleCommishBootSide(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const { side, gameId } = parseSideAndGameId(idAfter(COMMISH_TOOLS_CUSTOM_IDS.bootSide, interaction.customId));
  await interaction.update({
    content: `⚠️ This will unlink the ${side} coach's team and kick them from the Discord server. Are you sure?`,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${COMMISH_TOOLS_CUSTOM_IDS.bootConfirm}${side}:${gameId}`).setLabel("Confirm Boot").setStyle(ButtonStyle.Danger),
    )],
  });
}

export async function handleCommishBootConfirm(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const { side, gameId } = parseSideAndGameId(idAfter(COMMISH_TOOLS_CUSTOM_IDS.bootConfirm, interaction.customId));
  const modal = new ModalBuilder()
    .setCustomId(`${COMMISH_TOOLS_CUSTOM_IDS.bootModal}${side}:${gameId}`)
    .setTitle(`Boot ${side} coach`)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("reason").setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500),
    ));
  await interaction.showModal(modal);
}

export async function handleCommishBootModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only a commissioner or co-commissioner can use Commish Tools.", flags: MessageFlags.Ephemeral });
  const { side, gameId } = parseSideAndGameId(interaction.customId.slice(COMMISH_TOOLS_CUSTOM_IDS.bootModal.length));
  const reason = interaction.fields.getTextInputValue("reason");
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await recApi.bootUserCommissioner({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, side, reason });
    await interaction.editReply({ content: `✅ ${side === "home" ? "Home" : "Away"} coach booted.` });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

// --- Reset Scheduling (folded in from the old standalone Reset button; message-wipe gets its own confirm) ---
export async function handleCommishResetStart(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const gameId = idAfter(COMMISH_TOOLS_CUSTOM_IDS.reset, interaction.customId);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await recApi.resetScheduling({ guildId: interaction.guildId, discordId: interaction.user.id, gameId });
    await interaction.editReply({
      content: "🔄 Scheduling reset for this game.",
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${COMMISH_TOOLS_CUSTOM_IDS.resetWipeConfirm}${gameId}`).setLabel("Wipe scheduling messages").setStyle(ButtonStyle.Danger),
      )],
    });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleCommishResetWipeConfirm(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return denyNonCommish(interaction);
  const gameId = idAfter(COMMISH_TOOLS_CUSTOM_IDS.resetWipeConfirm, interaction.customId);
  try {
    await interaction.deferUpdate();
    await recApi.resetScheduling({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, wipeMessages: true });
    await interaction.editReply({ content: "🔄 Scheduling reset; REC scheduling pings and offer/response messages were wiped. User messages and original embeds were preserved.", components: [] });
  } catch (error) {
    await replyErr(interaction, error);
  }
}
