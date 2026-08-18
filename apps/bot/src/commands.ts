import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "./config/env.js";
import { recApi } from "./lib/rec-api.js";

// Mirrors apps/api/src/lib/discord-guild.ts's BASE_GUILD_COMMANDS_JSON / DRAFT_COMMAND_JSON.
// /draft is registered conditionally: only within ~1hr of a scheduled fantasy draft or while
// one is live. The guild PUT replaces the ENTIRE command set, so the ready/guildCreate refresh
// below queries the API for whether /draft belongs in this guild RIGHT NOW — otherwise it would
// overwrite and silently strip a /draft that the API had already correctly registered.
export const commands = [
  new SlashCommandBuilder()
    .setName("openteams")
    .setDescription("View open and claimed teams in this league.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("matchup")
    .setDescription("Show your current-week matchup.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Show your team's full season schedule.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("viewleague")
    .setDescription("Get a link to this league's public status page.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("highlights")
    .setDescription("Get a link to upload a highlight for an eligible week.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("linkleague")
    .setDescription("Link one of your unclaimed REC leagues to this Discord server.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("standings")
    .setDescription("Show current season standings.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("wallet")
    .setDescription("Check your coin balance and savings.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("powerrankings")
    .setDescription("Show current power rankings.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("settimezone")
    .setDescription("Set your timezone for REC game scheduling.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("setavailability")
    .setDescription("Set your weekly availability for REC game scheduling.")
    .toJSON(),
];

function discordRest() {
  return new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
}

/** Resolve the full guild command set, including /draft and /boxscore only if the API says
 * this guild should see them right now (/draft: within ~1hr of a scheduled fantasy draft, or
 * live; /boxscore: league is in box_scores data mode). Falls back to the base commands if the
 * API is unreachable — the API's own sync calls (data mode change, fantasy-draft schedule
 * transitions) backstop registration between restarts. */
async function guildCommandSet(guildId: string) {
  const base = [...commands];
  try {
    const state = await recApi.isDisplayingDraftCommand(guildId);
    if (state.includeDraft) base.push({ name: "draft", description: "Check in for the fantasy draft." });
  } catch (error) {
    console.error(`Failed to resolve /draft visibility for guild ${guildId}:`, error);
  }
  try {
    const state = await recApi.isDisplayingBoxScoreCommand(guildId);
    if (state.includeBoxScore) base.push({ name: "boxscore", description: "Get a link to upload a box score for an eligible week." });
  } catch (error) {
    console.error(`Failed to resolve /boxscore visibility for guild ${guildId}:`, error);
  }
  return base;
}

export async function registerApplicationCommands() {
  const rest = discordRest();

  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: commands });
  console.log("Registered global application commands.");

  if (env.DISCORD_GUILD_ID) {
    await registerGuildCommands(env.DISCORD_GUILD_ID);
  }
}

export async function registerGuildCommands(guildId: string) {
  const rest = discordRest();
  const body = await guildCommandSet(guildId);
  await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId), { body });
  console.log(`Registered guild application commands for ${guildId}.`);
}
