import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";
import { NAV_CUSTOM_IDS } from "./navigation.js";

export const ADVANCE_MENU_CUSTOM_IDS = {
  select: "rec:advance_menu:select"
} as const;

export type AdvanceMenuAction =
  | "advance_week"
  | "set_week"
  | "recreate_game_channels"
  | "regenerate_challenges"
  | "reselect_gotw"
  | "challenge_audit"
  | "catch_up_advance"
  | "back_admin";

export function buildAdvanceMenuPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Advance Menu")
        .setDescription([
          "Manage weekly advance actions and repair tools.",
          "",
          "Regular advance should run the full weekly workflow. Catch-Up Advance processes imported historical weeks without user DMs, GOTW scheduling, or game-channel creation."
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ADVANCE_MENU_CUSTOM_IDS.select)
          .setPlaceholder("Select an advance action")
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("Advance Current Week").setValue("advance_week").setDescription("Run the normal advance workflow."),
            new StringSelectMenuOptionBuilder().setLabel("Set Current Week / Stage").setValue("set_week").setDescription("Manually correct the league week/stage."),
            new StringSelectMenuOptionBuilder().setLabel("Recreate Game Channels").setValue("recreate_game_channels").setDescription("Delete/recreate current H2H game channels."),
            new StringSelectMenuOptionBuilder().setLabel("Re-Select GOTW").setValue("reselect_gotw").setDescription("Repair or replace the selected Game of the Week."),
            new StringSelectMenuOptionBuilder().setLabel("Re-Generate Challenges").setValue("regenerate_challenges").setDescription("Repair this week’s generated challenges."),
            new StringSelectMenuOptionBuilder().setLabel("Audit Challenges").setValue("challenge_audit").setDescription("View the last two in-game weeks."),
            new StringSelectMenuOptionBuilder().setLabel("Catch-Up Advance").setValue("catch_up_advance").setDescription("Process imported week without DMs/GOTW/game channels."),
            new StringSelectMenuOptionBuilder().setLabel("Back to Admin Panel").setValue("back_admin")
          )
      )
    ]
  };
}
