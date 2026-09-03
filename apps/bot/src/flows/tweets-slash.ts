import { GuildMember, MessageFlags, Role, User, type ChatInputCommandInteraction } from "discord.js";
import { isDiscordAdminInteraction, replyFullAdminOnly } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";

const PERSONA_LABELS: Record<string, string> = {
  marcus: "Marcus Vale", jalen: "Jalen Cross", elliot: "Elliot Mercer", darius: "Darius King",
  generic1: "Gridiron Gospel", generic2: "Cold Takes Only", generic3: "The Tape Don't Lie", generic4: "RTI Recap Radio",
  custom: "a custom handle",
};

function resolveMentionContent(interaction: ChatInputCommandInteraction): string | undefined {
  if (interaction.options.getBoolean("tag_everyone")) return "@everyone";
  const mentionable = interaction.options.getMentionable("tag");
  if (mentionable instanceof Role) return `<@&${mentionable.id}>`;
  if (mentionable instanceof GuildMember || mentionable instanceof User) return `<@${mentionable.id}>`;
  return undefined;
}

export async function handleTweetsSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isDiscordAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "post as the RTI tweets feed");

  const persona = interaction.options.getString("persona", true);
  const tweetText = interaction.options.getString("tweet", true);
  const customHandle = interaction.options.getString("custom_handle") ?? undefined;
  const customDisplayName = interaction.options.getString("custom_display_name") ?? undefined;

  if (persona === "custom" && !customHandle?.trim()) {
    return interaction.reply({ content: "Persona is set to Custom handle -- fill in `custom_handle` too.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await recApi.postManualTweet({
      guildId: interaction.guildId,
      persona,
      customHandle,
      customDisplayName,
      tweetText,
      mentionContent: resolveMentionContent(interaction),
    });
    const asWhom = persona === "custom" ? `@${customHandle}` : PERSONA_LABELS[persona] ?? persona;
    await interaction.editReply({ content: `Posted to the tweets feed as ${asWhom}.` });
  } catch (error) {
    await interaction.editReply({ content: userFacingError(error) });
  }
}
