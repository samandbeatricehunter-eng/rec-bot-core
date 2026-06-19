import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "./config/env.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("menu")
    .setDescription("Open REC League HQ.")
    .toJSON()
];

export async function registerApplicationCommands() {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: commands });
  console.log("Registered global application commands.");

  if (env.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body: commands });
    console.log(`Registered guild application commands for ${env.DISCORD_GUILD_ID}.`);
  }
}
