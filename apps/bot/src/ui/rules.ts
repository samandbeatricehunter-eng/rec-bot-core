import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";

export const RULES_CUSTOM_IDS = {
  select: "rec:rules:select"
} as const;

export const REC_RULE_SECTIONS = [
  {
    key: "global_locked",
    label: "Global Locked Rules",
    description: "Hardcoded REC standards that are not league-editable.",
    lines: [
      "No nano-blitzing, exploit abuse, or intentional glitch play.",
      "No hovering over the center pre-snap on defense.",
      "Users must follow commissioner/comp committee rulings once issued.",
      "Respectful scheduling communication and sportsmanship are required.",
      "Economy abuse, false payout claims, or manipulated streams/highlights can be denied or reversed."
    ]
  },
  {
    key: "league_setup_rules",
    label: "League Setup Rules",
    description: "Rules controlled by allowed options in League Setup.",
    lines: [
      "Fourth Down Rules are selected from the league setup options only.",
      "Streaming requirements are selected from the league setup options only.",
      "Difficulty, quarter length, accelerated clock, injuries, abilities, and salary-cap settings come from league setup.",
      "Trade approval policy, CPU rules, and position-change policy come from league setup."
    ]
  },
  {
    key: "scheduling_activity_sportsmanship",
    label: "Scheduling, Activity & Sportsmanship",
    description: "Default REC scheduling/activity rule base.",
    lines: [
      "H2H game channels are created on advance for user-vs-user matchups.",
      "Users should check in with their opponent in the game channel as soon as possible.",
      "No check-in by 12 hours may be flagged for Fair Sim or Force Win review depending on who communicated.",
      "Active Checks may be posted by admins. Linked team users who miss the 24-hour check are logged for review.",
      "Required stream compliance is evaluated from the designated streams channel."
    ]
  },
  {
    key: "editable_server_rules",
    label: "What's Locked vs. Server-Specific",
    description: "How REC's rule set is layered.",
    lines: [
      "Global Locked Rules and League Setup Rules apply the same way in every REC league.",
      "Scheduling, Activity & Sportsmanship reflects this server's active settings.",
      "Locked global REC rules and league setup option sets are not editable — they come from REC and your league's setup choices."
    ]
  }
] as const;

export function buildRulesPanel(sectionKey = "global_locked") {
  const section = REC_RULE_SECTIONS.find((item) => item.key === sectionKey) ?? REC_RULE_SECTIONS[0];
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`Rules — ${section.label}`)
        .setDescription([section.description, "", ...section.lines.map((line) => `• ${line}`)].join("\n"))
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(RULES_CUSTOM_IDS.select)
          .setPlaceholder("Select a rule section")
          .addOptions(
            ...REC_RULE_SECTIONS.map((item) => new StringSelectMenuOptionBuilder().setLabel(item.label).setValue(item.key).setDescription(item.description.slice(0, 100))),
            new StringSelectMenuOptionBuilder().setLabel("Back to Admin Panel").setValue("back_admin")
          )
      )
    ]
  };
}
