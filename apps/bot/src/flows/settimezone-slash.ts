import {
  ActionRowBuilder, ModalBuilder, ModalSubmitInteraction, StringSelectMenuBuilder,
  StringSelectMenuInteraction, TextInputBuilder, TextInputStyle, MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { recApi } from "../lib/rec-api.js";

export const SETTIMEZONE_CUSTOM_IDS = {
  select: "rec:settz:select",
  otherModal: "rec:settz:other_modal",
};

const ZONE_OPTIONS: Array<{ label: string; value: string; iana: string }> = [
  { label: "Eastern", value: "eastern", iana: "America/New_York" },
  { label: "Central", value: "central", iana: "America/Chicago" },
  { label: "Mountain", value: "mountain", iana: "America/Denver" },
  { label: "Pacific", value: "pacific", iana: "America/Los_Angeles" },
  { label: "Alaska", value: "alaska", iana: "America/Anchorage" },
  { label: "Hawaii", value: "hawaii", iana: "Pacific/Honolulu" },
  { label: "Other (enter manually)", value: "other", iana: "" },
];

export async function handleSetTimezoneSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  const select = new StringSelectMenuBuilder()
    .setCustomId(SETTIMEZONE_CUSTOM_IDS.select)
    .setPlaceholder("Choose your timezone")
    .addOptions(ZONE_OPTIONS.map((z) => ({ label: z.label, value: z.value })));
  await interaction.reply({
    content: "This sets your REC timezone, used for game scheduling on both Discord and the site.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleSetTimezoneSelect(interaction: StringSelectMenuInteraction) {
  const choice = ZONE_OPTIONS.find((z) => z.value === interaction.values[0]);
  if (!choice) return interaction.update({ content: "Unknown timezone selection.", components: [] });

  if (choice.value === "other") {
    const modal = new ModalBuilder()
      .setCustomId(SETTIMEZONE_CUSTOM_IDS.otherModal)
      .setTitle("Enter your timezone")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("iana_tz")
            .setLabel("IANA timezone (e.g. Europe/London)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("America/Chicago")
            .setRequired(true),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferUpdate();
  try {
    await recApi.setSchedulingTimezone({ guildId: interaction.guildId!, discordId: interaction.user.id, timezone: choice.iana, source: "discord_manual" });
    await interaction.editReply({ content: `Timezone set to **${choice.label}** (${choice.iana}).`, components: [] });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Failed to save your timezone.", components: [] });
  }
}

export async function handleSetTimezoneOtherModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  const iana = interaction.fields.getTextInputValue("iana_tz").trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await recApi.setSchedulingTimezone({ guildId: interaction.guildId, discordId: interaction.user.id, timezone: iana, source: "discord_manual" });
    await interaction.editReply({ content: `Timezone set to **${iana}**.` });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Failed to save your timezone. Make sure it's a valid IANA zone name." });
  }
}
