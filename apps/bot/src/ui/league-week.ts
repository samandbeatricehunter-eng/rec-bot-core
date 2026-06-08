import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { NAV_CUSTOM_IDS } from "./navigation.js";

export const LEAGUE_WEEK_CUSTOM_IDS = {
  panel: "rec:league_week:panel",
  view: "rec:league_week:view",
  set: "rec:league_week:set",
  setModal: "rec:league_week:set_modal",
  weekInput: "rec:league_week:week",
  seasonInput: "rec:league_week:season",
  stageSelect: "rec:league_week:stage"
} as const;

export function buildLeagueWeekPanel() {
  return {
    embeds: [new EmbedBuilder().setTitle("League Week").setDescription("View or manually correct current league week/stage.")],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(LEAGUE_WEEK_CUSTOM_IDS.view).setLabel("View Current Week").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(LEAGUE_WEEK_CUSTOM_IDS.set).setLabel("Set Current Week / Stage").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.adminPanel).setLabel("Back to Admin Panel").setStyle(ButtonStyle.Secondary)
    )]
  };
}

export function buildLeagueWeekStageRow() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(LEAGUE_WEEK_CUSTOM_IDS.stageSelect).setPlaceholder("Select stage").addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Regular Season").setValue("regular_season"),
      new StringSelectMenuOptionBuilder().setLabel("Wild Card").setValue("wild_card"),
      new StringSelectMenuOptionBuilder().setLabel("Divisional").setValue("divisional"),
      new StringSelectMenuOptionBuilder().setLabel("Conference Championship").setValue("conference_championship"),
      new StringSelectMenuOptionBuilder().setLabel("Super Bowl").setValue("super_bowl"),
      new StringSelectMenuOptionBuilder().setLabel("Offseason").setValue("offseason")
    )
  );
}

export function buildLeagueWeekSetModal(stage: string) {
  return new ModalBuilder().setCustomId(`${LEAGUE_WEEK_CUSTOM_IDS.setModal}:${stage}`).setTitle("Set League Week").addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(LEAGUE_WEEK_CUSTOM_IDS.weekInput).setLabel("Week Number").setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(LEAGUE_WEEK_CUSTOM_IDS.seasonInput).setLabel("Season Number (optional)").setStyle(TextInputStyle.Short).setRequired(false))
  );
}
