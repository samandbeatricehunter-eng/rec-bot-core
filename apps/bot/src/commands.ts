import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "./config/env.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("menu")
    .setDescription("Open REC League HQ.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("league-mgmt")
    .setDescription("Open the League Mgmt web dashboard (commissioners and co-commissioners only).")
    .toJSON()
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
