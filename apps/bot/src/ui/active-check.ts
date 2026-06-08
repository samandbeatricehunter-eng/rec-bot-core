import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { NAV_CUSTOM_IDS } from "./navigation.js";

export const ACTIVE_CHECK_CUSTOM_IDS = {
  start: "rec:active_check:start",
  activePrefix: "rec:active_check:active:"
} as const;

export function buildActiveCheckPanel() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle("Active Check")
      .setDescription("Post a 24-hour Active Check in the league announcements channel. Linked team users who do not click Active will be reported to the commissioner office.")],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(ACTIVE_CHECK_CUSTOM_IDS.start).setLabel("Start Active Check").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.adminPanel).setLabel("Back to Admin Panel").setStyle(ButtonStyle.Secondary)
    )]
  };
}

export function buildActiveCheckAnnouncement(event: any, deadlineDisplay: Record<string, string>) {
  return {
    content: "@everyone",
    embeds: [new EmbedBuilder()
      .setTitle("REC Active Check")
      .setDescription([
        "Click **Active** within 24 hours if you are still active in this league.",
        "",
        "Users linked to teams who do not respond before this closes risk being booted.",
        "",
        "Deadline:",
        `EST: ${deadlineDisplay.EST ?? "24 hours after posting"}`,
        `CST: ${deadlineDisplay.CST ?? "24 hours after posting"}`,
        `PST: ${deadlineDisplay.PST ?? "24 hours after posting"}`,
        `AKST: ${deadlineDisplay.AKST ?? "24 hours after posting"}`,
        "",
        event.closes_at ? `Closes: <t:${Math.floor(new Date(event.closes_at).getTime() / 1000)}:R>` : undefined
      ].filter(Boolean).join("\n"))],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${ACTIVE_CHECK_CUSTOM_IDS.activePrefix}${event.id}`).setLabel("Active").setStyle(ButtonStyle.Success)
    )],
    allowedMentions: { parse: ["everyone"] as const }
  };
}
