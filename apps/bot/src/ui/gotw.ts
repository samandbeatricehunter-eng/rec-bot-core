import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from "discord.js";
import { NAV_CUSTOM_IDS } from "./navigation.js";

export const GOTW_CUSTOM_IDS = {
  select: "rec:gotw:select",
  voteAwayPrefix: "rec:gotw:vote:away:",
  voteHomePrefix: "rec:gotw:vote:home:"
} as const;

export function buildGotwSelectionPayload(candidates: any[]) {
  const options = candidates.slice(0, 25).map((candidate: any) => {
    const label = `${candidate.matchup_title}`.slice(0, 80);
    const flag = candidate.previous_gotw_user_flag ? " • Previous GOTW user" : "";
    return new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(candidate.id)
      .setDescription(`GOTW Rating: ${Number(candidate.strength_rating ?? 0).toFixed(1)}${flag}`.slice(0, 100));
  });

  return {
    embeds: [new EmbedBuilder()
      .setTitle("Select Game of the Week")
      .setDescription([
        "Choose this week’s regular-season H2H Game of the Week before advancing.",
        "",
        "Matchups are sorted by projected matchup strength. Games involving a previous GOTW user are flagged in the dropdown."
      ].join("\n"))],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(GOTW_CUSTOM_IDS.select)
          .setPlaceholder("Select this week’s GOTW")
          .addOptions(options)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.adminPanel).setLabel("Back to Admin Panel").setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

export function buildGotwAnnouncementContent(poll: any) {
  const deadline = poll.vote_deadline_display ?? {};
  const deadlineLines = ["EST", "CST", "PST", "AKST"].map((label) => `${label}: ${deadline[label] ?? "4 hours after posting"}`);
  return [
    "@everyone",
    "",
    `<@${poll.away_user_id}> vs <@${poll.home_user_id}>`,
    "",
    `Week ${poll.week_number} GOTW voting is live.`,
    "",
    "Vote deadline:",
    ...deadlineLines
  ].join("\n");
}

export function buildGotwVoteEmbed(poll: any, votes: any[] = []) {
  const awayVotes = votes.filter((vote: any) => String(vote.selected_team_id) === String(poll.away_team_id));
  const homeVotes = votes.filter((vote: any) => String(vote.selected_team_id) === String(poll.home_team_id));
  const total = awayVotes.length + homeVotes.length;
  const awayPct = total ? Math.round((awayVotes.length / total) * 100) : 0;
  const homePct = total ? Math.round((homeVotes.length / total) * 100) : 0;
  const awayNames = awayVotes.length ? awayVotes.map((vote: any) => `<@${vote.discord_id}>`).join(", ") : "No votes yet";
  const homeNames = homeVotes.length ? homeVotes.map((vote: any) => `<@${vote.discord_id}>`).join(", ") : "No votes yet";

  return new EmbedBuilder()
    .setTitle("REC Game of the Week Poll")
    .setDescription([
      `**${poll.question}**`,
      "",
      `Voting closes: ${poll.poll_expires_at ? `<t:${Math.floor(new Date(poll.poll_expires_at).getTime() / 1000)}:R>` : "4 hours after posting"}`,
      "",
      `**${poll.away_team_name}** — ${awayVotes.length} vote(s), ${awayPct}%`,
      awayNames,
      "",
      `**${poll.home_team_name}** — ${homeVotes.length} vote(s), ${homePct}%`,
      homeNames,
      "",
      "You may switch your vote. Only your latest vote counts. Correct guesses pay $10."
    ].join("\n"));
}

export function buildGotwVoteRows(poll: any) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GOTW_CUSTOM_IDS.voteAwayPrefix}${poll.id}:${poll.away_team_id}`)
      .setLabel(`Vote ${poll.away_team_name}`.slice(0, 80))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${GOTW_CUSTOM_IDS.voteHomePrefix}${poll.id}:${poll.home_team_id}`)
      .setLabel(`Vote ${poll.home_team_name}`.slice(0, 80))
      .setStyle(ButtonStyle.Success)
  )];
}
