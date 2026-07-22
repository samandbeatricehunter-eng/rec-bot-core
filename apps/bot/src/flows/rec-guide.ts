import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, Guild, MessageFlags, PermissionFlagsBits, TextChannel } from "discord.js";
import { formatCoins } from "@rec/shared";
import { COLORS } from "../lib/colors.js";
import { recApi } from "../lib/rec-api.js";
import { fetchRoutedTextChannel } from "../lib/route-channels.js";

export const REC_GUIDE_CUSTOM_IDS = {
  hub: "rec:guide:hub",
  openTeams: "rec:guide:open_teams",
} as const;

function mention(id?: string | null, fallback = "not assigned yet") {
  return id ? `<#${id}>` : `*${fallback}*`;
}

function guideEmbeds(cfg: any): EmbedBuilder[] {
  const league = cfg.league ?? {};
  const routes = cfg.routes ?? {};
  const settings = cfg.configuration ?? cfg.config ?? {};
  const weeklyId = routes.weekly_submissions_channel_id ?? routes.box_scores_channel_id;
  const cfb = league.game === "cfb_27";
  const economy = settings.coin_economy_enabled !== false;
  const media = settings.media_features_enabled !== false;
  const base = (number: number, title: string) => new EmbedBuilder().setColor(COLORS.gold).setTitle(`${number}. ${title}`).setFooter({ text: `${league.name ?? "REC League"} • REC Guide` });
  const embeds = [
    base(1, "Welcome & REC Hub").setDescription([
      `Welcome to **${league.name ?? "the REC League"}** (${cfb ? "College Football 27" : "Madden 27"}). REC manages league activity in Discord and the private web Hub.`,
      "Run **/app** for a personal link. Links expire and must not be shared. Unlinked users can view open teams and submit a request; commissioners approve and link accepted users.",
      "The Hub includes Campus Buzz, headlines, articles, highlights, matchups, streams, rankings, schedules, My Team, wagers, and authorized League Management tools.",
    ].join("\n\n")),
    base(2, "Weekly Submissions").setDescription([
      `Use ${mention(weeklyId, "Weekly Submissions channel not assigned")} each playable week. The channel is reset on advance; use its permanent **Box Scores**, **Player Stats**, and **Recruiting Commits** buttons. Captured messages are deleted to keep the panel clear.`,
      "**Box Scores:** two console screenshots, current week only. One shared H2H submission is enough and commissioner review is required. Unreadable, incomplete, wrong-screen, wrong-week, or phone-camera images may be denied.",
      cfb ? "For CFB: **CFB Tab > Team Schedule > Box Score**, then press **X on PS5**. Do **not** use the immediate postgame box-score window." : "For Madden: capture two in-game box-score screenshots from the screens available when the game ends.",
      "**Player Stats:** optional story detail; a pending or approved box score must already exist for the game, including one submitted by the opponent. Add one or more categories per player.",
      cfb ? "**Recruiting Commits:** enter recruit name, position, stars, city, and state. It is linked to your school and does not require a box score. Commissioners can correct changes." : "**Recruiting Commits:** College Football leagues only.",
    ].join("\n\n")),
    base(3, "Streams & Highlights").setDescription([
      `Post streams in ${mention(routes.streams_channel_id, "Streams channel not assigned")}. A valid stream pays **${formatCoins(50)}**, once per user per league week. Regular-season and postseason requirements follow the league's configured rules; invalid or duplicate streams may be denied.`,
      media ? `Post one in-game highlight per message in ${mention(routes.highlights_channel_id, "Highlights channel not assigned")}. Phone recordings are not accepted. Highlights pay **${formatCoins(25)}** each, up to two payouts per league week; accepted extras can still enter voting.` : "Media features are currently disabled for this league.",
      media ? "Award reactions are Best Throw, Best Catch, Best Run, Best Interception, and Best Hit. A voter may choose only one category per highlight, may vote on multiple highlights, and tied category winners split the payout." : "",
    ].filter(Boolean).join("\n\n")),
    base(4, "My Team, Wagers & Schedules").setDescription([
      `**My Team** shows coach/team details, current matchup, record, point differential, power rank, wallet/savings, projected interest, stats, badges, schedule, media submissions${cfb ? ", and recruiting class" : ""}.`,
      "**Wagers** covers current-week house bets, parlays, peer/open/direct challenges, and the wager board. A sufficient wallet balance is required and settlement uses recorded game results.",
      "**Team Schedules** show linked-team results, upcoming games, CPU games, H2H games, and byes. Power rankings update after each advance in the Hub's **Rankings** tab.",
    ].join("\n\n")),
    base(5, economy ? "Store & Media Desk" : "Media Desk").setDescription([
      economy ? "**Store:** open /app, choose an available product, complete its form, and submit. Funds are reserved during commissioner review. Products, costs, caps, game restrictions, and Season 1 availability come from league settings; check your wallet first." : "The Store is not active because the coin economy is disabled.",
      media ? "**Media Desk:** submit articles and coach interviews from My Team. Current limits and configured payouts are shown in the Hub. Submissions enter commissioner review; interviews use three selected questions and may tag a weekly H2H opponent when available." : "Media Desk submissions are currently disabled.",
    ].join("\n\n")),
    base(6, "Open Teams & Troubleshooting").setDescription([
      "**No team?** Run /openteams, choose Request Team, and wait for commissioner approval. **Expired app link?** Run /app again.",
      "**Can't submit player stats?** A current scheduled game and its pending/approved box score are required. If your opponent submitted it, you may still submit stats for your team.",
      "**Bot deleted my message?** Captured submissions are intentionally removed. **Only one highlight paid?** At most two accepted highlights pay per user per week and duplicates do not create extra payouts.",
      "**Can't purchase?** Economy/product availability, season, balance, or caps may prevent it. **Can't access League Management?** Commissioner permissions are required.",
      `League announcements: ${mention(routes.announcements_channel_id, "not assigned")}. Rules and help should be taken from configured league channels; no separate help channel is currently assigned unless commissioners announce one.`,
    ].join("\n\n")),
  ];
  return embeds;
}

export async function publishRecGuide(guild: Guild): Promise<{ posted: number; channelId: string } | null> {
  const cfg = await recApi.getEconomyConfig(guild.id);
  const channel = await fetchRoutedTextChannel(guild, cfg.routes?.rec_guide_channel_id);
  if (!channel) return null;
  const everyone = guild.roles.everyone;
  const me = guild.members.me ?? await guild.members.fetchMe();
  await channel.permissionOverwrites.edit(everyone, {
    ViewChannel: true, SendMessages: false, CreatePublicThreads: false, CreatePrivateThreads: false,
    SendMessagesInThreads: false, AttachFiles: false, UseExternalStickers: false, AddReactions: true,
  });
  await channel.permissionOverwrites.edit(me, {
    ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true, ManageMessages: true, AddReactions: true,
  });
  const embeds = guideEmbeds(cfg);
  const state = await recApi.getGuideMessageState(guild.id).catch(() => ({ messages: [] }));
  const stored = await Promise.all(state.messages.filter((row) => row.discord_channel_id === channel.id).map((row) => channel.messages.fetch(row.discord_message_id).catch(() => null)));
  let existing = stored.filter((message): message is NonNullable<typeof message> => Boolean(message));
  if (!existing.length) {
    const recent = await channel.messages.fetch({ limit: 100 });
    existing = [...recent.values()].filter((m) => m.author.id === guild.client.user.id && m.embeds[0]?.footer?.text?.endsWith("• REC Guide")).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  }
  const messageIds: string[] = [];
  for (let i = 0; i < embeds.length; i++) {
    const components = i === 0 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(REC_GUIDE_CUSTOM_IDS.hub).setLabel("Open REC App").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(REC_GUIDE_CUSTOM_IDS.openTeams).setLabel("View Open Teams").setStyle(ButtonStyle.Secondary),
    )] : [];
    if (existing[i]) { await existing[i].edit({ embeds: [embeds[i]], components }); messageIds.push(existing[i].id); }
    else { const sent = await channel.send({ embeds: [embeds[i]], components }); messageIds.push(sent.id); }
  }
  for (const obsolete of existing.slice(embeds.length)) await obsolete.delete().catch(() => undefined);
  await recApi.saveGuideMessageState({ guildId: guild.id, channelId: channel.id, messageIds });
  return { posted: embeds.length, channelId: channel.id };
}

export async function handleGuideOpenTeams(interaction: ButtonInteraction) {
  const data = await recApi.getLeagueConferences(interaction.guildId!);
  const teams = (data?.conferences ?? []).flatMap((c: any) => c.teams ?? []).filter((t: any) => !t.discordId && !t.userId);
  const lines = teams.slice(0, 50).map((t: any) => `• ${t.name ?? t.abbreviation}`).join("\n") || "No open teams are currently available.";
  await interaction.reply({ embeds: [new EmbedBuilder().setTitle("Open Teams").setColor(COLORS.gold).setDescription(lines)], flags: MessageFlags.Ephemeral });
}
