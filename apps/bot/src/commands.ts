import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "./config/env.js";
import { recApi } from "./lib/rec-api.js";

const CLAIM_LEAGUE_COMMAND = new SlashCommandBuilder()
  .setName("claim-league")
  .setDescription("Link this Discord server to a REC league using its invite token.")
  .addStringOption((option) =>
    option.setName("token").setDescription("Invite token from the site's Enable Discord Bot page.").setRequired(true),
  )
  .toJSON();

// /claim-league only makes sense before a server is linked — once claimed, running it again
// is a no-op at best and confusing at worst, so it's dropped from the guild's command set
// the moment rec_discord_servers exists for this guild (see registerGuildCommands below).
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
  new SlashCommandBuilder()
    .setName("viewleague")
    .setDescription("Get a link to this league's public status page.")
    .toJSON(),
  CLAIM_LEAGUE_COMMAND,
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
  let linked = false;
  try {
    linked = (await recApi.getGuildLinkStatus(guildId)).linked;
  } catch (error) {
    console.error(`Failed to check link status for guild ${guildId} before registering commands (defaulting to unlinked):`, error);
  }
  const body = linked ? commands.filter((command) => command.name !== CLAIM_LEAGUE_COMMAND.name) : commands;
  await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId), { body });
  console.log(`Registered guild application commands for ${guildId} (${linked ? "linked — claim-league hidden" : "unlinked"}).`);
}