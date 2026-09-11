import { REST, Routes } from "discord.js";
import { DISCORD_COMMANDS } from "@rec/shared";
import { env } from "./config/env.js";

export const commands = DISCORD_COMMANDS;

function discordRest() {
  return new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
}

function guildCommandSet(_guildId: string) {
  return [...commands];
}

/** Registering the same command set both globally (applicationCommands) and per-guild
 * (applicationGuildCommands) makes every command show up twice in that guild's slash-command
 * picker -- Discord doesn't dedupe by name across scopes, it just lists both. A stray manual run
 * of the old register-commands.ts script (which used to populate the global set) left every
 * command double-listed in whichever guild also had per-guild registration -- confirmed live via
 * a screenshot showing every command twice. Per-guild registration (registerGuildCommands,
 * called for every visible guild on every boot by registerCommandsForVisibleGuilds in
 * index-timeout.ts, and again on guildCreate) is the only mechanism this bot actually needs, so
 * this clears the global set instead of populating it. Global registrations persist until
 * explicitly cleared -- they don't stop just because the code stopped calling this -- so this is
 * called unconditionally on every boot (index-timeout.ts's clientReady) rather than only from the
 * manual register-commands.ts script, so this deploy fixes the live duplication without anyone
 * needing to run that script by hand. */
export async function clearGlobalApplicationCommands() {
  const rest = discordRest();
  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: [] });
  console.log("Cleared global application commands (per-guild registration is authoritative).");
}

/** Manual one-shot entry point (pnpm --filter @rec/bot register) -- same effect as the automatic
 * boot-time clearGlobalApplicationCommands() call, plus an explicit single-guild refresh for
 * local/manual testing against DISCORD_GUILD_ID. */
export async function registerApplicationCommands() {
  await clearGlobalApplicationCommands();
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
