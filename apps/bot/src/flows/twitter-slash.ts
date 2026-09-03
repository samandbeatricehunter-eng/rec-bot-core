import { GuildMember, MessageFlags, Role, User, type AutocompleteInteraction, type ChatInputCommandInteraction } from "discord.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";

function resolveMentionContent(interaction: ChatInputCommandInteraction): string | undefined {
  if (interaction.options.getBoolean("tag_everyone")) return "@everyone";
  const mentionable = interaction.options.getMentionable("tag");
  if (mentionable instanceof Role) return `<@&${mentionable.id}>`;
  if (mentionable instanceof GuildMember || mentionable instanceof User) return `<@${mentionable.id}>`;
  return undefined;
}

export async function handleTwitterPersonaAutocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.inCachedGuild()) return interaction.respond([]);
  try {
    const { personas } = await recApi.listPlayerTwitterPersonas({
      guildId: interaction.guildId,
      discordId: interaction.user.id,
    });
    const focused = interaction.options.getFocused().trim().toLowerCase();
    const matches = personas.filter((persona) => {
      if (!focused) return true;
      return persona.name.toLowerCase().includes(focused)
        || persona.handle.toLowerCase().includes(focused)
        || persona.roleLabel.toLowerCase().includes(focused)
        || persona.key.includes(focused);
    });
    await interaction.respond(matches.slice(0, 3).map((persona) => ({
      name: `${persona.name} — ${persona.roleLabel}`.slice(0, 100),
      value: persona.key,
    })));
  } catch {
    await interaction.respond([]).catch(() => undefined);
  }
}

export async function handleTwitterSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });

  const persona = interaction.options.getString("persona", true);
  if (persona !== "owner" && persona !== "offense" && persona !== "defense") {
    return interaction.reply({
      content: "Pick one of your personas from the list — Owner, Offensive player, or Defensive player.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const tweetText = interaction.options.getString("tweet", true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await recApi.postPlayerTwitterTweet({
      guildId: interaction.guildId,
      discordId: interaction.user.id,
      persona,
      tweetText,
      mentionContent: resolveMentionContent(interaction),
    });
    await interaction.editReply({ content: `Posted to the tweets feed as ${result.postedAs}.` });
  } catch (error) {
    await interaction.editReply({ content: userFacingError(error) });
  }
}
