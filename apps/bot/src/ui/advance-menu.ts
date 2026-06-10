import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";
import { NAV_CUSTOM_IDS } from "./navigation.js";

export const ADVANCE_MENU_CUSTOM_IDS = {
  select: "rec:advance_menu:select",
  troubleshootSelect: "rec:advance_menu:troubleshoot_select"
} as const;

export type AdvanceMenuAction =
  | "advance_week"
  | "reissue_eos_payouts"
  | "troubleshoot_advance"
  | "back_admin";

export type TroubleshootMenuAction =
  | "set_next_advance"
  | "reselect_gotw"
  | "regenerate_challenges"
  | "regenerate_potw"
  | "recreate_game_channels"
  | "send_advance_dms"
  | "set_week"
  | "recalculate_eos_payouts"
  | "back_advance_menu";

export function buildAdvanceMenuPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Advance Menu")
        .setDescription([
          "Manage weekly advance actions and end-of-season tools.",
          "",
          "**Advance Current Week** runs the full weekly workflow.",
          "**Re-Issue EOS Payouts** recalculates pending (unapproved) end-of-season payouts — available during playoffs through Super Bowl.",
          "**Troubleshoot Advance Process** contains repair and override tools."
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ADVANCE_MENU_CUSTOM_IDS.select)
          .setPlaceholder("Select an advance action")
          .addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel("Advance Current Week")
              .setValue("advance_week")
              .setDescription("Run the full advance workflow for the current week."),
            new StringSelectMenuOptionBuilder()
              .setLabel("Re-Issue EOS Payouts")
              .setValue("reissue_eos_payouts")
              .setDescription("Recalculate and repost pending end-of-season payouts (playoffs only)."),
            new StringSelectMenuOptionBuilder()
              .setLabel("Troubleshoot Advance Process")
              .setValue("troubleshoot_advance")
              .setDescription("Repair tools: GOTW, challenges, channels, DMs, week/stage, POTW."),
            new StringSelectMenuOptionBuilder()
              .setLabel("Back to Admin Panel")
              .setValue("back_admin")
          )
      )
    ]
  };
}

export function buildTroubleshootMenuPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Troubleshoot Advance Process")
        .setDescription("Repair and override tools for the advance pipeline. Use these to correct issues after a failed or partial advance.")
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ADVANCE_MENU_CUSTOM_IDS.troubleshootSelect)
          .setPlaceholder("Select a repair action")
          .addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel("Set Next Advance Time")
              .setValue("set_next_advance")
              .setDescription("Set the next scheduled advance day, time, and timezone."),
            new StringSelectMenuOptionBuilder()
              .setLabel("Re-Select GOTW")
              .setValue("reselect_gotw")
              .setDescription("Repair or replace the selected Game of the Week."),
            new StringSelectMenuOptionBuilder()
              .setLabel("Re-Generate Challenges")
              .setValue("regenerate_challenges")
              .setDescription("Void current challenges and generate new ones for this week."),
            new StringSelectMenuOptionBuilder()
              .setLabel("Re-Generate POTW")
              .setValue("regenerate_potw")
              .setDescription("Recalculate Player of the Week awards for the current advance."),
            new StringSelectMenuOptionBuilder()
              .setLabel("Recreate Game Channels")
              .setValue("recreate_game_channels")
              .setDescription("Delete and rebuild all active H2H game channels."),
            new StringSelectMenuOptionBuilder()
              .setLabel("Re-Send Advance DMs")
              .setValue("send_advance_dms")
              .setDescription("Re-send advance DMs and game channel invites to all active players."),
            new StringSelectMenuOptionBuilder()
              .setLabel("Set Current Week / Stage")
              .setValue("set_week")
              .setDescription("Manually correct the league week and season stage."),
            new StringSelectMenuOptionBuilder()
              .setLabel("Re-Calculate EOS Payouts")
              .setValue("recalculate_eos_payouts")
              .setDescription("Preview projected end-of-season payout amounts from current standings."),
            new StringSelectMenuOptionBuilder()
              .setLabel("Back to Advance Menu")
              .setValue("back_advance_menu")
          )
      )
    ]
  };
}
