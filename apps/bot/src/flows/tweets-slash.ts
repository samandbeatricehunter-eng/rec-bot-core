import { GuildMember, MessageFlags, Role, User, type ChatInputCommandInteraction } from "discord.js";
import { isDiscordAdminInteraction, replyFullAdminOnly } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";

const PERSONA_LABELS: Record<string, string> = {
  marcus: "Marcus Vale", vaughn: "Vaughn Price", jalen: "Jalen Cross", elliot: "Elliot Mercer", darius: "Darius King",
  nfl_front_office: "NFL Front Office",
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
  // Discord already hosts the attachment at a permanent CDN URL the moment it's uploaded with
  // the slash command -- no need to re-download/re-upload it ourselves, just pass the URL
  // straight into the tweet's embed image.
  const imageAttachment = interaction.options.getAttachment("image");
  const imageUrl = imageAttachment?.url;
  console.log(`[DEBUG] /tweets image attachment: ${JSON.stringify(imageAttachment ? { url: imageAttachment.url, name: imageAttachment.name, contentType: imageAttachment.contentType } : null)}`);

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
      imageUrl,
      mentionContent: resolveMentionContent(interaction),
    });
    const asWhom = persona === "custom" ? `@${customHandle}` : PERSONA_LABELS[persona] ?? persona;
    await interaction.editReply({ content: `Posted to the tweets feed as ${asWhom}.` });
  } catch (error) {
    await interaction.editReply({ content: userFacingError(error) });
  }
}
