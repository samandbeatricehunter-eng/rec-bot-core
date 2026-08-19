// "Ready to Advance" button on the weekly matchups channel post (posted by
// apps/api/src/modules/scheduling/matchups-channel.service.ts). Walks a coach through readying
// up their own current-week game: H2H asks "have you played?" (score self-report if so), CPU
// asks "played, or requesting a Force Win?". Every prompt is ephemeral -- only the resulting
// state change (score recorded, FW requested) shows up publicly, via the matchups post itself
// refreshing (server-side, see ready-to-advance.service.ts).
import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags,
  ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { userFacingError } from "../lib/errors.js";
import { isMissingDiscordAccountError, recApi } from "../lib/rec-api.js";

// The button id must match READY_TO_ADVANCE_BUTTON_ID in
// apps/api/src/modules/scheduling/matchups-channel.service.ts -- the API builds that button's
// component payload directly (raw Discord REST JSON, not discord.js), so there's no shared
// constant to import across the api/bot package boundary.
export const READY_TO_ADVANCE_CUSTOM_IDS = {
  button: "rec:rta:btn",
  h2hYes: "rec:rta:h2hyes:",
  h2hNo: "rec:rta:h2hno:",
  h2hScoreModal: "rec:rta:h2hscore:",
  cpuPlayed: "rec:rta:cpuplayed:",
  cpuFw: "rec:rta:cpufw:",
  cpuScoreModal: "rec:rta:cpuscore:",
};

const NOT_LINKED_NOTE = "Link your Discord account to a team in this league first, then try again.";

function idAfter(prefix: string, customId: string): string {
  return customId.slice(prefix.length);
}

async function replyErr(interaction: ButtonInteraction | ModalSubmitInteraction, error: unknown) {
  const content = userFacingError(error);
  if (interaction.deferred || interaction.replied) return interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

function scoreModal(customId: string, opponentLabel: string) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Report your final score")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("my_score").setLabel("Your score").setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("opp_score").setLabel(`${opponentLabel} score`).setStyle(TextInputStyle.Short).setRequired(true)),
    );
}

export async function handleReadyToAdvanceButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const status = await recApi.getReadyToAdvanceStatus({ guildId: interaction.guildId, discordId: interaction.user.id });
    switch (status.kind) {
      case "no_game":
        await interaction.editReply({ content: "You don't have a game this week." });
        return;
      case "h2h_ready":
        await interaction.editReply({
          content: status.isComplete
            ? `Your game against ${status.opponentLabel} is already marked complete. You're all set.`
            : `Your game against ${status.opponentLabel} is already scheduled. You're all set.`,
        });
        return;
      case "cpu_ready":
        await interaction.editReply({
          content: status.fwRequested ? "You've already requested a Force Win for this game." : "You've already reported a final score for this game.",
        });
        return;
      case "h2h_needs_input": {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${READY_TO_ADVANCE_CUSTOM_IDS.h2hYes}${status.gameId}`).setLabel("Yes, I played").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${READY_TO_ADVANCE_CUSTOM_IDS.h2hNo}${status.gameId}`).setLabel("No, not yet").setStyle(ButtonStyle.Danger),
        );
        await interaction.editReply({ content: `Have you played your game against ${status.opponentLabel} yet?`, components: [row] });
        return;
      }
      case "cpu_needs_input": {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${READY_TO_ADVANCE_CUSTOM_IDS.cpuPlayed}${status.gameId}`).setLabel("I played it").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${READY_TO_ADVANCE_CUSTOM_IDS.cpuFw}${status.gameId}`).setLabel("Request Force Win").setStyle(ButtonStyle.Danger),
        );
        await interaction.editReply({ content: "Did you play your CPU game, or are you requesting a Force Win?", components: [row] });
        return;
      }
      case "not_linked":
      default:
        await interaction.editReply({ content: NOT_LINKED_NOTE });
        return;
    }
  } catch (error) {
    if (isMissingDiscordAccountError(error)) {
      await interaction.editReply({ content: NOT_LINKED_NOTE }).catch(() => undefined);
      return;
    }
    await replyErr(interaction, error);
  }
}

export async function handleH2hYesButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(READY_TO_ADVANCE_CUSTOM_IDS.h2hYes, interaction.customId);
  await interaction.showModal(scoreModal(`${READY_TO_ADVANCE_CUSTOM_IDS.h2hScoreModal}${gameId}`, "Opponent's"));
}

export async function handleH2hNoButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.update({
    content: "You'll need to schedule or play your game before you can ready up — otherwise it'll be a Fair Sim at advance.",
    components: [],
  }).catch(() => undefined);
}

export async function handleCpuPlayedButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(READY_TO_ADVANCE_CUSTOM_IDS.cpuPlayed, interaction.customId);
  await interaction.showModal(scoreModal(`${READY_TO_ADVANCE_CUSTOM_IDS.cpuScoreModal}${gameId}`, "CPU's"));
}

export async function handleCpuFwButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(READY_TO_ADVANCE_CUSTOM_IDS.cpuFw, interaction.customId);
  try {
    await interaction.deferUpdate();
    await recApi.requestReadyToAdvanceCpuForceWin({ guildId: interaction.guildId, discordId: interaction.user.id, gameId });
    await interaction.editReply({ content: "Force Win requested — the matchups post has been updated.", components: [] });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

async function handleScoreModalSubmit(interaction: ModalSubmitInteraction, prefix: string) {
  if (!interaction.inCachedGuild()) return;
  const gameId = idAfter(prefix, interaction.customId);
  const myScore = Number(interaction.fields.getTextInputValue("my_score").trim());
  const opponentScore = Number(interaction.fields.getTextInputValue("opp_score").trim());
  if (!Number.isFinite(myScore) || !Number.isFinite(opponentScore) || myScore < 0 || opponentScore < 0) {
    await interaction.reply({ content: "Scores must be non-negative numbers.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await recApi.reportReadyToAdvanceScore({ guildId: interaction.guildId, discordId: interaction.user.id, gameId, myScore, opponentScore });
    await interaction.editReply({ content: `Recorded ${myScore}-${opponentScore}. You're ready for advance.` });
  } catch (error) {
    await replyErr(interaction, error);
  }
}

export async function handleH2hScoreModalSubmit(interaction: ModalSubmitInteraction) {
  return handleScoreModalSubmit(interaction, READY_TO_ADVANCE_CUSTOM_IDS.h2hScoreModal);
}

export async function handleCpuScoreModalSubmit(interaction: ModalSubmitInteraction) {
  return handleScoreModalSubmit(interaction, READY_TO_ADVANCE_CUSTOM_IDS.cpuScoreModal);
}
