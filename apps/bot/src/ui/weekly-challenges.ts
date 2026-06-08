import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { ACTIVE_CHECK_CUSTOM_IDS } from "./active-check.js";
import { NAV_CUSTOM_IDS } from "./navigation.js";

export const WEEKLY_CHALLENGE_CUSTOM_IDS = {
  panel: "rec:weekly_challenges:panel",
  regenerate: "rec:weekly_challenges:regenerate",
  audit: "rec:weekly_challenges:audit",
  selectGotw: "rec:weekly_challenges:select_gotw",
  catchUpAdvance: "rec:weekly_challenges:catch_up_advance"
} as const;

export function buildWeeklyChallengesPanel() {
  return {
    embeds: [new EmbedBuilder().setTitle("Weekly Challenges").setDescription("Regenerate active weekly challenges or view challenge payout audit.")],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(WEEKLY_CHALLENGE_CUSTOM_IDS.selectGotw).setLabel("Select GOTW").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(WEEKLY_CHALLENGE_CUSTOM_IDS.regenerate).setLabel("Re-Generate Weekly Challenges").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(WEEKLY_CHALLENGE_CUSTOM_IDS.audit).setLabel("View Challenge Audit").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(WEEKLY_CHALLENGE_CUSTOM_IDS.catchUpAdvance).setLabel("Catch-Up Advance").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(ACTIVE_CHECK_CUSTOM_IDS.start).setLabel("Active Check").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.adminPanel).setLabel("Back to Admin Panel").setStyle(ButtonStyle.Secondary)
    )]
  };
}
