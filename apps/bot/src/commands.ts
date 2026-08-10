import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "./config/env.js";

// A Discord server is linked to a league from the site's Discord guild picker
// (apps/site/src/routes/DiscordGuildPicker.tsx) — no in-Discord command needed anymore.
export const commands = [
  new SlashCommandBuilder()
    .setName("app")
    .setDescription("Open this league in the REC Leagues website/app.")
    .toJSON(),
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
    .setName("draft")
    .setDescription("Open this league's fantasy draft controls and board.")
    .toJSON(),
];

function discordRest() {
  return new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
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
  await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId), { body: commands });
  console.log(`Registered guild application commands for ${guildId}.`);
}
