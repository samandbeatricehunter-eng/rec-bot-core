import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { REC_ROUTE_CHANNELS } from "@rec/shared";
import { buildNavigationRow } from "./navigation.js";
import { LEAGUE_SETUP_CUSTOM_IDS, type LeagueSetupDraft } from "./league-setup-types.js";
import { baseEmbed } from "./league-setup-shared.js";

export const LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS = {
  ...Object.fromEntries(
    Object.entries(REC_ROUTE_CHANNELS).map(([key, config]) => [
      key,
      { label: config.label, field: config.inputField },
    ])
  ),
} as Record<keyof typeof REC_ROUTE_CHANNELS, { label: string; field: string }>;

function formatChannelValue(value?: string | null) {
  return value ? `<#${value}> (${value})` : "Not set";
}

export function setLeagueSetupServerChannel(draft: LeagueSetupDraft, channelType: string, value: string | null) {
  const option = LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS[channelType as keyof typeof LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS];
  if (!option) return;
  (draft as any)[option.field] = value;
}

export function buildLeagueSetupServerChannelModal(channelType: string, draft: LeagueSetupDraft) {
  const option = LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS[channelType as keyof typeof LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS];
  const current = option ? String((draft as any)[option.field] ?? "") : "";
  return new ModalBuilder()
    .setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.serverSetupChannelModal}:${channelType}`)
    .setTitle(`Assign ${option?.label ?? "Channel"}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.serverSetupChannelInput)
          .setLabel("Discord Channel/Category ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(current)
          .setPlaceholder("Paste the Discord ID, or leave blank to clear it.")
      )
    );
}

export function buildLeagueSetupServerSetupWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: Server Setup", draft)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Assign Discord channels and categories used by league features. These can also be edited later from Settings.",
      "",
      ...Object.entries(LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS).map(([, config]) => `**${config.label}:** ${formatChannelValue((draft as any)[config.field])}`)
    ].join("\n"));

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.serverSetupSelect)
          .setPlaceholder("Select a channel/category assignment")
          .addOptions(
            ...Object.entries(LEAGUE_SETUP_SERVER_CHANNEL_OPTIONS).map(([value, config]) =>
              new StringSelectMenuOptionBuilder().setLabel(config.label).setValue(value)
            )
          )
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.serverSetupDone).setLabel(draft.editMode ? "Back to Settings" : "Continue").setStyle(ButtonStyle.Success)
      ),
      buildNavigationRow()
    ]
  };
}

// formatChannelValue is also needed by the review windows.
export { formatChannelValue };
