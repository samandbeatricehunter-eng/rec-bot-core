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
    .setName("rules")
    .setDescription("Browse this league's rules.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("commishtools")
    .setDescription("Commissioner tools: Force Win, Fair Sim, AutoPilot, Suspend, Boot, Reset Scheduling, Game Day Audit.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("tweets")
    .setDescription("Commissioner: post a tweet to the RTI feed as a persona, generic, or custom handle.")
    .addStringOption((opt) => opt
      .setName("persona")
      .setDescription("Who's posting this tweet?")
      .setRequired(true)
      .addChoices(
        { name: "Marcus Vale", value: "marcus" },
        { name: "Jalen Cross", value: "jalen" },
        { name: "Elliot Mercer", value: "elliot" },
        { name: "Darius King", value: "darius" },
        { name: "Gridiron Gospel", value: "generic1" },
        { name: "Cold Takes Only", value: "generic2" },
        { name: "The Tape Don't Lie", value: "generic3" },
        { name: "RTI Recap Radio", value: "generic4" },
        { name: "Custom handle", value: "custom" },
      ))
    .addStringOption((opt) => opt.setName("tweet").setDescription("The tweet text.").setRequired(true).setMaxLength(1000))
    .addStringOption((opt) => opt.setName("custom_handle").setDescription("Handle to post as (only used when persona is Custom handle).").setRequired(false).setMaxLength(50))
    .addStringOption((opt) => opt.setName("custom_display_name").setDescription("Display name for the custom handle (defaults to the handle).").setRequired(false).setMaxLength(50))
    .addMentionableOption((opt) => opt.setName("tag").setDescription("Tag a specific user or role above the tweet (optional).").setRequired(false))
    .addBooleanOption((opt) => opt.setName("tag_everyone").setDescription("Tag @everyone above the tweet (optional).").setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("twitter")
    .setDescription("Post a tweet as your owner, offensive player, or defensive player.")
    .addStringOption((opt) => opt
      .setName("persona")
      .setDescription("Which of your personas is posting?")
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption((opt) => opt.setName("tweet").setDescription("The tweet text.").setRequired(true).setMaxLength(1000))
    .addMentionableOption((opt) => opt.setName("tag").setDescription("Tag a user or role above the tweet (optional).").setRequired(false))
    .addBooleanOption((opt) => opt.setName("tag_everyone").setDescription("Tag @everyone above the tweet (optional).").setRequired(false))
    .toJSON(),
];

function discordRest() {
  return new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
}

/** Resolve the full guild command set, including /boxscore only if the API says this guild
 * should see it right now (league is in box_scores data mode). Falls back to the base commands
 * if the API is unreachable — the API's own sync calls (data mode change) backstop
 * registration between restarts. */
async function guildCommandSet(guildId: string) {
  const base = [...commands];
  try {
    const state = await recApi.isDisplayingBoxScoreCommand(guildId);
    if (state.includeBoxScore) base.push({ name: "boxscore", description: "Get a link to upload a box score for an eligible week." });
  } catch (error) {
    console.error(`Failed to resolve /boxscore visibility for guild ${guildId}:`, error);
  }
  return base;
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
