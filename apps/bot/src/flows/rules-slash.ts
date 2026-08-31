import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction, type StringSelectMenuInteraction,
} from "discord.js";
import { COLORS } from "../lib/colors.js";
import { userFacingError } from "../lib/errors.js";
import { buildRuleCategories, type RuleCategory } from "../lib/league-rules.js";
import { recApi } from "../lib/rec-api.js";

export const RULES_SLASH_CUSTOM_IDS = {
  categorySelect: "rec:rules:select",
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

function buildRows(categories: RuleCategory[], index: number) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(RULES_SLASH_CUSTOM_IDS.categorySelect)
    .setPlaceholder("Choose a rules category")
    .addOptions(
      categories.slice(0, 25).map((category, i) => ({
        label: category.label.slice(0, 100),
        value: String(i),
        default: i === index,
      })),
    );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
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
    await interaction.editReply({ embeds: [buildEmbed(categories[0]!, 0, categories.length)], components: buildRows(categories, 0) });
  } catch (error) {
    await interaction.editReply({ content: userFacingError(error) });
  }
}

export async function handleRulesSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const index = Number(interaction.values[0]);
  try {
    await interaction.deferUpdate();
    const categories = await loadCategories(interaction.guildId);
    if (!categories.length) return interaction.editReply({ content: "No rules are configured for this league yet.", embeds: [], components: [] });
    const safeIndex = ((index % categories.length) + categories.length) % categories.length;
    await interaction.editReply({ embeds: [buildEmbed(categories[safeIndex]!, safeIndex, categories.length)], components: buildRows(categories, safeIndex) });
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
