import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { NAV_CUSTOM_IDS } from "./navigation.js";

export const WEEKLY_CHALLENGE_CUSTOM_IDS = {
  panel: "rec:weekly_challenges:panel",
  regenerate: "rec:weekly_challenges:regenerate",
  audit: "rec:weekly_challenges:audit"
} as const;

export function buildWeeklyChallengesPanel() {
  return {
    embeds: [new EmbedBuilder().setTitle("Weekly Challenges").setDescription("Regenerate active weekly challenges or view challenge payout audit.")],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(WEEKLY_CHALLENGE_CUSTOM_IDS.regenerate).setLabel("Re-Generate Weekly Challenges").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(WEEKLY_CHALLENGE_CUSTOM_IDS.audit).setLabel("View Challenge Audit").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.adminPanel).setLabel("Back to Admin Panel").setStyle(ButtonStyle.Secondary)
    )]
  };
}
