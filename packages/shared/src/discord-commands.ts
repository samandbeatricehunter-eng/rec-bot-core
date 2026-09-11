// Single source of truth for this bot's registered slash-command set. Both apps/bot (which
// actually PUTs this to Discord on boot/guildCreate) and apps/api (which currently has no live
// caller for command registration, but should build off this if it ever needs to) read from
// here so the two can't drift out of sync the way apps/bot/src/commands.ts's `commands` array
// and apps/api/src/lib/discord-guild.ts's now-removed BASE_GUILD_COMMANDS_JSON did (the API
// list had gone stale: missing `commishtools`/`tweets` entirely, and still listed `highlights`
// while the bot's actually-registered list had silently dropped it).
//
// Plain JSON in Discord's Application Command Object shape (not discord.js's SlashCommandBuilder)
// because @rec/shared has no runtime dependencies and apps/api has no discord.js dependency.

import { discordTweetPersonaChoices } from "./media-social/tweet-personalities.js";

export const DISCORD_COMMAND_OPTION_TYPE = {
  STRING: 3,
  BOOLEAN: 5,
  MENTIONABLE: 9,
  ATTACHMENT: 11,
} as const;

export type DiscordCommandOption = {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  max_length?: number;
  choices?: Array<{ name: string; value: string }>;
  autocomplete?: boolean;
};

export type DiscordCommandDefinition = {
  name: string;
  description: string;
  options?: DiscordCommandOption[];
};

// Linked-league member commands, commissioner commands, and the unlinked/setup-guild command.
// Deliberately NOT registered (per current product direction): /twitter, /availability, /draft,
// /openteams, /viewleague. /availability has no standalone command — /matchup owns that entry
// point. /league, /teams, and /profile don't have bot handlers built yet.
export const DISCORD_COMMANDS: DiscordCommandDefinition[] = [
  { name: "matchup", description: "Show your current-week matchup." },
  { name: "schedule", description: "Show your team's full season schedule." },
  { name: "linkleague", description: "Link one of your unclaimed REC leagues to this Discord server." },
  { name: "standings", description: "Show current season standings." },
  { name: "wallet", description: "Check your coin balance and savings." },
  { name: "powerrankings", description: "Show current power rankings." },
  { name: "rules", description: "Browse this league's rules." },
  { name: "highlights", description: "Get a link to upload a highlight for an eligible week." },
  { name: "commishtools", description: "Commissioner tools: Force Win, Fair Sim, AutoPilot, Suspend, Boot, Reset Scheduling, Game Day Audit." },
  {
    name: "tweets",
    description: "Commissioner: post a tweet to the RTI feed as a persona, generic, or custom handle.",
    options: [
      {
        type: DISCORD_COMMAND_OPTION_TYPE.STRING,
        name: "persona",
        description: "Who's posting this tweet?",
        required: true,
        // Sourced from the canonical tweet_personalities.json roster (media-social/tweet-personalities.ts)
        // rather than hand-typed here, so the command can never drift from the identity catalog.
        choices: [...discordTweetPersonaChoices(), { name: "Custom handle", value: "custom" }],
      },
      { type: DISCORD_COMMAND_OPTION_TYPE.STRING, name: "tweet", description: "The tweet text.", required: true, max_length: 1000 },
      { type: DISCORD_COMMAND_OPTION_TYPE.STRING, name: "custom_handle", description: "Handle to post as (only used when persona is Custom handle).", max_length: 50 },
      { type: DISCORD_COMMAND_OPTION_TYPE.STRING, name: "custom_display_name", description: "Display name for the custom handle (defaults to the handle).", max_length: 50 },
      { type: DISCORD_COMMAND_OPTION_TYPE.ATTACHMENT, name: "image", description: "Optional image to attach to the tweet." },
      { type: DISCORD_COMMAND_OPTION_TYPE.MENTIONABLE, name: "tag", description: "Tag a specific user or role above the tweet (optional)." },
      { type: DISCORD_COMMAND_OPTION_TYPE.BOOLEAN, name: "tag_everyone", description: "Tag @everyone above the tweet (optional)." },
    ],
  },
];
