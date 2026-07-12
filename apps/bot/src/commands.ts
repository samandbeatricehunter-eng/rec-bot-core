import { ApplicationCommandType, EntryPointCommandHandlerType, REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "./config/env.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("menu")
    .setDescription("Open REC League HQ.")
    .toJSON()
];

// Entry Point commands (how a user launches a Discord Activity) must be registered
// globally only — Discord rejects them as guild commands — and an application may only
// have one. handler: AppHandler means our bot receives the interaction and decides
// whether to launch (vs. Discord auto-launching for anyone with no gate), so the same
// commissioner/co-commissioner check that gates the League Mgmt button applies here too.
// See apps/bot/src/index-timeout.ts's isPrimaryEntryPointCommand() handler.
export const globalOnlyCommands = [
  {
    name: "league-mgmt",
    description: "Open League Mgmt in the REC web app (commissioners/co-commissioners only).",
    type: ApplicationCommandType.PrimaryEntryPoint,
    handler: EntryPointCommandHandlerType.AppHandler,
  },
];

function discordRest() {
  return new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
}

export async function registerApplicationCommands() {
  const rest = discordRest();

  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: [...commands, ...globalOnlyCommands] });
  console.log("Registered global application commands.");

  if (env.DISCORD_GUILD_ID) {
    await registerGuildCommands(env.DISCORD_GUILD_ID);
  }
}

// Guild-scoped commands only — the Entry Point command is global-only and is registered
// separately (and exclusively) by registerApplicationCommands above.
export async function registerGuildCommands(guildId: string) {
  const rest = discordRest();
  await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId), { body: commands });
  console.log(`Registered guild application commands for ${guildId}.`);
}
