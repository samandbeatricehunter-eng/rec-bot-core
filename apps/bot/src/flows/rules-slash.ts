import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  type ButtonInteraction, type ChatInputCommandInteraction,
} from "discord.js";
import { COLORS } from "../lib/colors.js";
import { userFacingError } from "../lib/errors.js";
import { buildRuleCategories, type RuleCategory } from "../lib/league-rules.js";
import { recApi } from "../lib/rec-api.js";

export const RULES_SLASH_CUSTOM_IDS = {
  pagePrefix: "rec:rules:page:",
  postPrefix: "rec:rules:post:",
};

function buildEmbed(category: RuleCategory, index: number, total: number) {
  const lines = category.rows.map((r) => `**${r.label}:** ${r.value}`).join("\n").slice(0, 4096);
  return new EmbedBuilder()
    .setTitle(category.label)
    .setColor(COLORS.gold)
    .setDescription(lines || "Nothing set for this category.")
    .setFooter({ text: `Category ${index + 1} of ${total}` });
}

function buildRows(index: number, total: number) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${RULES_SLASH_CUSTOM_IDS.pagePrefix}${(index - 1 + total) % total}`).setLabel("Previous").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${RULES_SLASH_CUSTOM_IDS.pagePrefix}${(index + 1) % total}`).setLabel("Next").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${RULES_SLASH_CUSTOM_IDS.postPrefix}${index}`).setLabel("Post Publicly").setStyle(ButtonStyle.Primary),
    ),
  ];
}

async function loadCategories(guildId: string): Promise<RuleCategory[]> {
  const { draft } = await recApi.getLeagueRulesDraft(guildId);
  return buildRuleCategories(draft);
}

export async function handleRulesSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const categories = await loadCategories(interaction.guildId);
    if (!categories.length) return interaction.editReply({ content: "No rules are configured for this league yet." });
    await interaction.editReply({ embeds: [buildEmbed(categories[0]!, 0, categories.length)], components: buildRows(0, categories.length) });
  } catch (error) {
    await interaction.editReply({ content: userFacingError(error) });
  }
}

export async function handleRulesPage(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const index = Number(interaction.customId.slice(RULES_SLASH_CUSTOM_IDS.pagePrefix.length));
  try {
    await interaction.deferUpdate();
    const categories = await loadCategories(interaction.guildId);
    if (!categories.length) return interaction.editReply({ content: "No rules are configured for this league yet.", embeds: [], components: [] });
    const safeIndex = ((index % categories.length) + categories.length) % categories.length;
    await interaction.editReply({ embeds: [buildEmbed(categories[safeIndex]!, safeIndex, categories.length)], components: buildRows(safeIndex, categories.length) });
  } catch (error) {
    await interaction.followUp({ content: userFacingError(error), flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export async function handleRulesPost(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const index = Number(interaction.customId.slice(RULES_SLASH_CUSTOM_IDS.postPrefix.length));
  try {
    await interaction.deferReply();
    const categories = await loadCategories(interaction.guildId);
    if (!categories.length) return interaction.editReply({ content: "No rules are configured for this league yet." });
    const safeIndex = ((index % categories.length) + categories.length) % categories.length;
    await interaction.editReply({ content: `Posted by ${interaction.user}:`, embeds: [buildEmbed(categories[safeIndex]!, safeIndex, categories.length)] });
  } catch (error) {
    await interaction.editReply({ content: userFacingError(error) }).catch(() => undefined);
  }
}
