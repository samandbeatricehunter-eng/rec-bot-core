import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
} from "discord.js";
import { recApi } from "../lib/rec-api.js";

// Must match the API's FANTASY_CHECKIN_CUSTOM_IDS (apps/api/src/modules/fantasy-draft/
// fantasy-draft.service.ts) — both sides rebuild this same live embed.
export const FANTASY_CHECKIN_CUSTOM_IDS = {
  in: "rec:fantasy_checkin:in",
  out: "rec:fantasy_checkin:out",
} as const;

const CHECKIN_EMBED_COLOR = 0xd9a521;

type CheckinRow = { teamId: string; teamName: string; checkedIn: boolean };

function buildCheckinEmbed(checkins: CheckinRow[]) {
  const checkedCount = checkins.filter((c) => c.checkedIn).length;
  const description = checkins
    .map((c) => (c.checkedIn ? `✅ **${c.teamName}** — Checked In` : `❌ **${c.teamName}** — NOT Checked In`))
    .join("\n");
  return new EmbedBuilder()
    .setTitle("Fantasy Draft Check-In")
    .setColor(CHECKIN_EMBED_COLOR)
    .setDescription(`The fantasy draft is live! Tap **Check In** so your pick doesn't get skipped.\n\n${description}`)
    .setFooter({ text: `Checked in: ${checkedCount}/${checkins.length}` });
}

function buildCheckinComponents() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(FANTASY_CHECKIN_CUSTOM_IDS.in).setStyle(ButtonStyle.Success).setLabel("Check In"),
    new ButtonBuilder().setCustomId(FANTASY_CHECKIN_CUSTOM_IDS.out).setStyle(ButtonStyle.Danger).setLabel("Check Out"),
  );
}

/** Self-service check-in/out from the live check-in embed. The clicking user's Discord
 * account must be linked and assigned to a team in this league; the API resolves that team.
 * On success the embed is refreshed in place so everyone sees the new status. */
export async function handleFantasyCheckinButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  const checkedIn = interaction.customId === FANTASY_CHECKIN_CUSTOM_IDS.in;
  await interaction.deferUpdate();

  try {
    await recApi.setFantasyDraftSelfCheckin(interaction.guildId, interaction.user.id, checkedIn);
  } catch (error) {
    return interaction.followUp({
      content: `Check-in failed: ${error instanceof Error ? error.message : String(error)}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    const { checkins } = await recApi.getFantasyDraftCheckins(interaction.guildId);
    await interaction.editReply({ embeds: [buildCheckinEmbed(checkins)], components: [buildCheckinComponents()] });
  } catch (error) {
    return interaction.followUp({
      content: `Check-in updated, but the board couldn't refresh: ${error instanceof Error ? error.message : String(error)}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
