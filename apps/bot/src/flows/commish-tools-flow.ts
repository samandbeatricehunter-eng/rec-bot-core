// Commissioner tool: Grant Bonus (Rise to Immortality) -- awards 100 REC Coins to a member.
// This file used to also host the full matchup-scoped Commish Tools panel (Force Win/Fair Sim/
// AutoPilot grants, Suspend/Boot, Reset Scheduling, Game Day Audit); that tooling was removed
// along with the rest of the game-scheduling system. Grant Bonus is unrelated -- an RTI economy
// feature, not scheduling -- so it survives here under the same /commishtools command.
import {
  ActionRowBuilder, ChatInputCommandInteraction, MessageFlags,
  UserSelectMenuBuilder, type UserSelectMenuInteraction,
} from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";

export const COMMISH_TOOLS_CUSTOM_IDS = {
  grantBonusUserSelect: "rec:commish:grantbonususerselect",
};

// --- /commishtools slash command entry point: Grant Bonus (RTI leagues only) -- not
// matchup-scoped, so it's a user picker. Server-side enforces the RTI-only gate and that the
// picked member is linked to an active team in this league. ---
export async function handleCommishToolsSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only a commissioner or co-commissioner can use Commish Tools.", flags: MessageFlags.Ephemeral });
  await interaction.reply({
    content: "Grant Bonus — select the member to award 100 REC Coins to (they'll get a DM):",
    components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder().setCustomId(COMMISH_TOOLS_CUSTOM_IDS.grantBonusUserSelect).setPlaceholder("Select a member").setMinValues(1).setMaxValues(1),
    )],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleCommishGrantBonusUserSelect(interaction: UserSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) return interaction.reply({ content: "Only a commissioner or co-commissioner can use Commish Tools.", flags: MessageFlags.Ephemeral });
  const targetDiscordId = interaction.values[0];
  if (!targetDiscordId) return;
  try {
    await interaction.deferUpdate();
    const result = await recApi.grantImmortalityCommissionerBonus({ guildId: interaction.guildId, targetDiscordId });
    await interaction.editReply({ content: `✅ Granted 100 REC Coins to <@${targetDiscordId}> for ${result.teamName}. They've been notified by DM.`, components: [] });
  } catch (error) {
    await interaction.editReply({ content: userFacingError(error), components: [] }).catch(() => undefined);
  }
}
