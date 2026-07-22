import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "./config/env.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("app")
    .setDescription("Open the REC Leagues app.")
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