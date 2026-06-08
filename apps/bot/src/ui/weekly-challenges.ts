import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";

export const WEEKLY_CHALLENGE_CUSTOM_IDS = {
  panel: "rec:weekly_challenges:panel",
  select: "rec:weekly_challenges:select",
  regenerate: "rec:weekly_challenges:regenerate",
  audit: "rec:weekly_challenges:audit",
  selectGotw: "rec:weekly_challenges:select_gotw",
  catchUpAdvance: "rec:weekly_challenges:catch_up_advance"
} as const;

export function buildWeeklyChallengesPanel() {
  return {
    embeds: [new EmbedBuilder().setTitle("Weekly Challenges").setDescription("Use the dropdown to manage challenge repair/audit tools.")],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(WEEKLY_CHALLENGE_CUSTOM_IDS.select)
        .setPlaceholder("Select a challenge action")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("Re-Generate Weekly Challenges").setValue("regenerate").setDescription("Repair the current week’s challenge assignments."),
          new StringSelectMenuOptionBuilder().setLabel("View Challenge Audit").setValue("audit").setDescription("Show achieved challenges for the last two in-game weeks."),
          new StringSelectMenuOptionBuilder().setLabel("Back to Admin Panel").setValue("back_admin")
        )
    )]
  };
}
