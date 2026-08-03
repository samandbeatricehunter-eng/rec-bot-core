import { formatCoins } from "@rec/shared";
import { lockRecGuideChannel, postDiscordChannelMessage, purgeDiscordChannelMessages } from "../../lib/discord-guild.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { saveGuideMessages } from "../submission-state/submission-state.service.js";

const REC_GOLD = 0xd9a521;
const SITE_URL = process.env.REC_SITE_URL ?? "https://rec-leagues.com";
const mention = (id?: string | null, fallback = "not assigned yet") => id ? `<#${id}>` : `*${fallback}*`;

function guideEmbeds(cfg: { league: Record<string, any>; routes: Record<string, any>; configuration: Record<string, any> }) {
  const { league, routes, configuration: settings } = cfg;
  const cfb = league.game === "cfb_27";
  const economy = settings.coin_economy_enabled !== false;
  const media = settings.media_features_enabled !== false;
  const attributes = economy && settings.attribute_purchases_enabled === true;
  const traits = economy && settings.player_trait_purchases_enabled === true;
  const ruleLabel = (value: unknown) => String(value ?? "not configured").replaceAll("_", " ");
  const customRules = Array.isArray(settings.custom_rules) ? settings.custom_rules : [];
  const footer = { text: `${league.name ?? "REC League"} - REC Guide` };
  const base = (number: number, title: string, parts: Array<string | false | null | undefined>) => ({
    title: `${number}. ${title}`,
    color: REC_GOLD,
    description: parts.filter(Boolean).join("\n\n"),
    footer,
  });

  return [
    base(1, "What REC Leagues Is", [
      `**REC Leagues** connects commissioner-run football leagues at ${SITE_URL} with Discord. **${league.name ?? "This league"}** uses REC for ${cfb ? "College Football 27" : "Madden 27"} schedules, results, media, records, commissioner workflows, and historical profiles.`,
      "Run **/hub** for a private site link. The Hub includes Campus Buzz, matchups, streams, headlines, rankings, My Team, schedules, wagers, the Store, and commissioner tools enabled for this league.",
    ]),
    base(2, "Register, Link Discord & Plans", [
      `Register at **${SITE_URL}**, choose a username, and link the Discord account used in this server. Linking gives the site and bot one identity for records, payouts, media, wallet activity, and League History.`,
      "**Gold** supports participation in up to 5 leagues. **Platinum** supports up to 20 joined leagues, ownership of up to 5 active leagues per game, and Discord bot/commissioner tools. Current prices and billing terms are shown on the REC site before checkout.",
      "Discord-only users may participate where allowed but do not receive registered-user payouts or permanent hosted media. Registering and linking while the league is active reconciles eligible activity already associated with that Discord ID; future activity uses the linked account automatically.",
    ]),
    base(3, "Weekly Discord + Site Workflow", [
      `Submit the two required current-week box-score images in ${mention(routes.box_scores_channel_id, "Box Scores channel not assigned")}, or use the site. Only scheduled H2H or human-vs-CPU coaches are eligible. The bot parses both images and sends the result to commissioner review and correction before approval.`,
      cfb ? "CFB image order: first capture the top of **CFB Tab > Team Schedule > Box Score** (press X on PS5), then scroll and capture the bottom. Do not use the immediate postgame window or phone-camera photos." : "For Madden, capture the two in-game box-score screens available after the game.",
      "Player statistics can be assigned after the box score is pending or approved. One shared H2H box score is enough for both coaches.",
      cfb ? "Recruiting, roster management, redshirts, transfers, development traits, Heisman tracking, bowls/CFP, and class advancement appear according to the current phase and league settings." : null,
    ]),
    base(4, "Streams, Highlights & Media", [
      media ? `Post streams in ${mention(routes.streams_channel_id, "Streams channel not assigned")} or share through the site. Valid streams follow this league's configured requirements and payout rules.` : null,
      media ? `Post highlights in ${mention(routes.highlights_channel_id, "Highlights channel not assigned")} or upload on the site. Linked users' clips are retained in Cloudflare Stream for the season. The first two eligible clips per week may create ${formatCoins(25)} payout reviews. Highlight voting occurs on the website only.` : "Media features are disabled for this league.",
      media ? "Commissioner articles, interviews, weekly stories, and season stories appear in the Hub and mirror to the configured Headlines channel." : null,
    ]),
    base(5, "My Team, Schedules & League History", [
      `**My Team** contains the current matchup, record, roster, schedule, statistics, media tasks, badges${economy ? ", wallet/savings, and EOS progress" : ""}.`,
      "Schedules distinguish H2H, human-vs-CPU, byes, bowls, and playoff games. Approved results and box scores update career and H2H records.",
      "League History preserves registered users' league records, team tenures and school abbreviations, statistics, achievements, earnings, spending, and separate house/peer wager results after they leave or the league ends.",
    ]),
    economy ? base(6, "Economy, Wagers & Store", [
      "This league has the coin economy enabled. Eligible activity can create commissioner-reviewed payouts; purchases reserve funds until approved or fulfilled.",
      "Wagers include enabled house markets, parlays, and peer challenges. Results, refunds, and net house/peer performance are retained in League History.",
      attributes ? "Attribute purchases use this league's selected core attributes, overall/individual core caps, and grouped non-core cap." : "Attribute purchases are disabled for this league.",
      traits ? "Player trait purchases are enabled when supported by the current game." : "Player trait purchases are not currently available.",
    ]) : null,
    base(economy ? 7 : 6, "Rules & Policies", [
      `**Fourth down — regular season:** ${ruleLabel(settings.fourth_down_rule_type_regular ?? settings.fourth_down_rule_type)}${settings.custom_fourth_down_rule_regular ? ` — ${settings.custom_fourth_down_rule_regular}` : ""}.`,
      `**Fourth down — playoffs:** ${ruleLabel(settings.fourth_down_rule_type_playoff ?? settings.fourth_down_rule_type)}${settings.custom_fourth_down_rule_playoff ? ` — ${settings.custom_fourth_down_rule_playoff}` : ""}.`,
      `**Streaming:** regular season ${ruleLabel(settings.regular_season_streaming_requirement)} (${ruleLabel(settings.regular_season_streaming_side ?? settings.streaming_side)}); postseason ${ruleLabel(settings.postseason_streaming_requirement)} (${ruleLabel(settings.postseason_streaming_side ?? settings.streaming_side)}); Game of the Week ${ruleLabel(settings.gotw_streaming_requirement)} (${ruleLabel(settings.gotw_streaming_side)}).`,
      customRules.length ? customRules.map((rule: any) => `**${rule.category ?? "Custom"}:** ${rule.title ?? "Rule"}${rule.description ? ` — ${rule.description}` : ""}`).join("\n") : "Commissioner-created custom rules will appear here when configured.",
    ]),
    base(economy ? 8 : 7, "FAQ & Support", [
      "**No team?** Open the Hub, view Open Teams, request one, and wait for commissioner approval. **Expired link?** Run /hub again.",
      "**Submission blocked?** Confirm that this is your scheduled week/stage, the feature is enabled, and no shared submission already exists. Box scores require both images within 60 seconds in Discord.",
      economy ? "**Purchase or wager blocked?** Check balance, league/season availability, caps, restrictions, and whether the game has already locked." : null,
      `Announcements: ${mention(routes.announcements_channel_id, "not assigned")}. Headlines: ${mention(routes.headlines_channel_id, "not assigned")}. League-specific Rules & Policies on the site are authoritative.`,
    ]),
  ].filter((embed): embed is NonNullable<typeof embed> => Boolean(embed));
}

export async function publishRecGuideFromApi(guildId: string, channelIdOverride?: string | null) {
  const context = await getCurrentLeagueContext(guildId);
  const configuration = await supabase.from("rec_league_configuration").select("*").eq("league_id", context.leagueId).maybeSingle();
  const routes = context.routes ?? {};
  const channelId = channelIdOverride ?? (typeof (routes as any).rec_guide_channel_id === "string" ? (routes as any).rec_guide_channel_id : null);
  if (!channelId) return null;
  await lockRecGuideChannel(guildId, channelId);
  await purgeDiscordChannelMessages(channelId);
  const embeds = guideEmbeds({ league: context.rec_leagues, routes, configuration: configuration.data ?? {} });
  const messageIds: string[] = [];
  for (let index = 0; index < embeds.length; index += 1) {
    const sent = await postDiscordChannelMessage(channelId, {
      embeds: [embeds[index]],
      components: index === 0 ? [{ type: 1, components: [
        { type: 2, style: 1, custom_id: "rec:guide:hub", label: "Open REC Hub" },
        { type: 2, style: 2, custom_id: "rec:guide:open_teams", label: "View Open Teams" },
      ] }] : [],
      allowed_mentions: { parse: [] },
    });
    if (sent?.id) messageIds.push(sent.id);
  }
  await saveGuideMessages(guildId, channelId, messageIds);
  return { posted: messageIds.length, channelId };
}
