import { lockRecGuideChannel, postDiscordChannelMessage, purgeDiscordChannelMessages } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { saveGuideMessages } from "../submission-state/submission-state.service.js";
import { supabase } from "../../lib/supabase.js";

const REC_GOLD = 0xd9a521;

function mention(id?: string | null, fallback = "not assigned yet") {
  return id ? `<#${id}>` : `*${fallback}*`;
}

function guideEmbeds(cfg: { league: Record<string, any>; routes: Record<string, any>; configuration: Record<string, any> }) {
  const league = cfg.league ?? {};
  const routes = cfg.routes ?? {};
  const settings = cfg.configuration ?? {};
  const routeId = (key: string) => typeof routes[key] === "string" ? routes[key] as string : null;
  const weeklyId = routeId("weekly_submissions_channel_id") ?? routeId("box_scores_channel_id");
  const cfb = league.game === "cfb_27";
  const economy = settings.coin_economy_enabled !== false;
  const media = settings.media_features_enabled !== false;
  const footer = { text: `${league.name ?? "REC League"} - REC Guide` };
  const base = (number: number, title: string, description: string) => ({ title: `${number}. ${title}`, color: REC_GOLD, description, footer });
  return [
    base(1, "Welcome & REC Hub", [
      `Welcome to **${league.name ?? "the REC League"}** (${cfb ? "College Football 27" : "Madden 27"}). REC manages league activity in Discord and the private web Hub.`,
      "Run **/hub** for a personal link. Links expire and must not be shared. Unlinked users can view open teams and submit a request; commissioners approve and link accepted users.",
      "The Hub includes Campus Buzz, headlines, articles, highlights, matchups, streams, rankings, schedules, My Team, wagers, and authorized League Management tools.",
    ].join("\n\n")),
    base(2, "Weekly Submissions", [
      `Use ${mention(weeklyId, "Weekly Submissions channel not assigned")} each playable week. The channel is reset on advance; use its permanent **Box Scores**, **Player Stats**, and **Recruiting Commits** buttons. Captured messages are deleted to keep the panel clear.`,
      "**Box Scores:** two console screenshots, current week only. One shared H2H submission is enough and commissioner review is required. Unreadable, incomplete, wrong-screen, wrong-week, or phone-camera images may be denied.",
      cfb ? "For CFB: **CFB Tab > Team Schedule > Box Score**, then press **X on PS5**. Do **not** use the immediate postgame box-score window." : "For Madden: capture two in-game box-score screenshots from the screens available when the game ends.",
      "**Player Stats:** optional story detail; a pending or approved box score must already exist for the game, including one submitted by the opponent. Add one or more categories per player.",
      cfb ? "**Recruiting Commits:** enter recruit name, position, stars, city, and state. It is linked to your school and does not require a box score. Commissioners can correct changes." : "**Recruiting Commits:** College Football leagues only.",
    ].join("\n\n")),
    base(3, "Streams & Highlights", [
      `Post streams in ${mention(routeId("streams_channel_id"), "Streams channel not assigned")}. A valid stream pays **$50**, once per user per league week. Regular-season and postseason requirements follow the league's configured rules; invalid or duplicate streams may be denied.`,
      media ? `Post one in-game highlight per message in ${mention(routeId("highlights_channel_id"), "Highlights channel not assigned")}. Phone recordings are not accepted. Highlights pay **$25** each, up to two payouts per league week; accepted extras can still enter voting.` : "Media features are currently disabled for this league.",
      media ? "Award reactions are Best Throw, Best Catch, Best Run, Best Interception, and Best Hit. A voter may choose only one category per highlight, may vote on multiple highlights, and tied category winners split the payout." : "",
    ].filter(Boolean).join("\n\n")),
    base(4, "My Team, Wagers & Schedules", [
      `**My Team** shows coach/team details, current matchup, record, point differential, power rank, wallet/savings, projected interest, stats, badges, schedule, media submissions${cfb ? ", and recruiting class" : ""}.`,
      "**Wagers** covers current-week house bets, parlays, peer/open/direct challenges, and the wager board. A sufficient wallet balance is required and settlement uses recorded game results.",
      "**Team Schedules** show linked-team results, upcoming games, CPU games, H2H games, and byes. Power rankings update in the Hub after each advance.",
    ].join("\n\n")),
    base(5, economy ? "Store & Media Desk" : "Media Desk", [
      economy ? "**Store:** open /hub, choose an available product, complete its form, and submit. Funds are reserved during commissioner review. Products, costs, caps, game restrictions, and Season 1 availability come from league settings; check your wallet first." : "The Store is not active because the coin economy is disabled.",
      media ? "**Media Desk:** submit articles and coach interviews from My Team. Current limits and configured payouts are shown in the Hub. Submissions enter commissioner review; interviews use three selected questions and may tag a weekly H2H opponent when available." : "Media Desk submissions are currently disabled.",
    ].join("\n\n")),
    base(6, "Open Teams & Troubleshooting", [
      "**No team?** Run /hub, view Open Teams, choose Request Team, and wait for commissioner approval. **Expired Hub link?** Run /hub again.",
      "**Can't submit player stats?** A current scheduled game and its pending/approved box score are required. If your opponent submitted it, you may still submit stats for your team.",
      "**Bot deleted my message?** Captured submissions are intentionally removed. **Only one highlight paid?** At most two accepted highlights pay per user per week and duplicates do not create extra payouts.",
      "**Can't purchase?** Economy/product availability, season, balance, or caps may prevent it. **Can't access League Management?** Commissioner permissions are required.",
      `League announcements: ${mention(routeId("announcements_channel_id"), "not assigned")}. Rules and help should be taken from configured league channels; no separate help channel is currently assigned unless commissioners announce one.`,
    ].join("\n\n")),
  ];
}

export async function publishRecGuideFromApi(guildId: string, channelIdOverride?: string | null) {
  const context = await getCurrentLeagueContext(guildId);
  const configuration = await supabase.from("rec_league_configuration").select("*").eq("league_id", context.leagueId).maybeSingle();
  const routes = context.routes ?? {};
  const storedChannelId = typeof (routes as any).rec_guide_channel_id === "string" ? (routes as any).rec_guide_channel_id : null;
  const channelId = channelIdOverride ?? storedChannelId;
  if (!channelId) return null;
  await lockRecGuideChannel(guildId, channelId);
  await purgeDiscordChannelMessages(channelId);
  const embeds = guideEmbeds({ league: context.rec_leagues, routes, configuration: configuration.data ?? {} });
  const messageIds: string[] = [];
  for (let i = 0; i < embeds.length; i++) {
    const sent = await postDiscordChannelMessage(channelId, {
      embeds: [embeds[i]],
      components: i === 0 ? [{
        type: 1,
        components: [
          { type: 2, style: 1, custom_id: "rec:guide:hub", label: "Open REC Hub" },
          { type: 2, style: 2, custom_id: "rec:guide:open_teams", label: "View Open Teams" },
        ],
      }] : [],
      allowed_mentions: { parse: [] },
    });
    if (sent?.id) messageIds.push(sent.id);
  }
  await saveGuideMessages(guildId, channelId, messageIds);
  return { posted: messageIds.length, channelId };
}
