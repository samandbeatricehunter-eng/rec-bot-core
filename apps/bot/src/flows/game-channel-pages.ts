import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction } from "discord.js";
import { stageLabel, formatCoins } from "@rec/shared";
import { recApi } from "../lib/rec-api.js";
import { DEV_TIER_EMOJIS } from "../lib/tier-emojis.js";

// ─── Game channel paginated matchup embed (5 looping pages) ──────────────────
// Pages are rendered purely from the matchup payload returned by
// recApi.getGameChannelMatchup, so any page can be (re)built on a button press.
export const GAME_CHANNEL_PAGE_PREFIX = "rec:gamech:page:";
const GAME_CHANNEL_PAGE_COUNT = 5;
const GAME_CHANNEL_PAGE_TITLES = ["Main Matchup", "Posting & Payouts", "Weekly Challenges", "Matchup Identities", "Matchup Breakdown"];

const coin = (amount: number) => formatCoins(amount, { signed: true });

export function gameRulesLines(draft: any, isPlayoff: boolean): string[] {
  const fourthType = isPlayoff ? draft?.fourthDownRuleTypePlayoff : draft?.fourthDownRuleTypeRegular;
  const fourthCustom = isPlayoff ? draft?.customFourthDownRulePlayoff : draft?.customFourthDownRuleRegular;
  let fourthText: string;
  if (!draft || fourthType == null) fourthText = "Follow the current league 4th down rules.";
  else if (fourthType === "none") fourthText = "No 4th down restrictions.";
  else if (fourthType === "standard_rec") fourthText = "Standard REC Rule — only go for it past midfield on 4th & 3 or less; if trailing in the second half you may go for it anytime.";
  else fourthText = fourthCustom && String(fourthCustom).trim() ? String(fourthCustom).trim() : "Custom league 4th down rules apply.";

  const req = isPlayoff ? draft?.postseasonStreamingRequirement : draft?.regularSeasonStreamingRequirement;
  const side = isPlayoff ? draft?.postseasonStreamingSide : draft?.regularSeasonStreamingSide;
  let streamText: string;
  if (!draft || req == null) streamText = "Follow this week's league streaming requirements.";
  else if (req === "disabled") streamText = "Not required.";
  else {
    // "Required" streams are mandatory ("must"); "Recommended" streams are
    // encouraged but optional ("should").
    const isRequired = req === "required";
    const reqLabel = isRequired ? "Required" : "Recommended";
    const verb = isRequired ? "must" : "should";
    const sideLabel =
      side === "home" ? `the home team ${verb} stream`
      : side === "away" ? `the away team ${verb} stream`
      : side === "both" ? `both teams ${verb} stream`
      : `at least one team ${verb} stream`;
    streamText = `${reqLabel} — ${sideLabel}.`;
  }

  return [`**4th Down Rules:** ${fourthText}`, `**Streaming:** ${streamText}`];
}

function weeklyChallengesEmbed() {
  const star = DEV_TIER_EMOJIS.silver;
  const superstar = DEV_TIER_EMOJIS.gold;
  const xfactor = DEV_TIER_EMOJIS.xf;
  return new EmbedBuilder().setTitle("Weekly Challenges").setDescription([
    "**Tiered Challenges**",
    `${star} Total Yards: 400 ${coin(10)} | ${superstar} 600 ${coin(15)} | ${xfactor} 800 ${coin(25)}`,
    `${star} Passing Yards: 250 ${coin(10)} | ${superstar} 400 ${coin(15)} | ${xfactor} 550 ${coin(25)}`,
    `${star} Rushing Yards: 150 ${coin(10)} | ${superstar} 250 ${coin(15)} | ${xfactor} 350 ${coin(25)}`,
    `${star} First Downs: 10 ${coin(10)} | ${superstar} 15 ${coin(15)} | ${xfactor} 20 ${coin(25)}`,
    `${star} Generated Turnovers: 1 ${coin(10)} | ${superstar} 2 ${coin(15)} | ${xfactor} 3 ${coin(25)}`,
    `${star} Committed Turnovers: 1 ${coin(-10)} | ${superstar} 2 ${coin(-15)} | ${xfactor} 3 ${coin(-25)}`,
    `Differential: Positive ${coin(25)} | Negative ${coin(-25)}`,
    `Offensive Redzone: ${star} >65% ${coin(10)} | ${superstar} >85% ${coin(15)} | ${xfactor} 100% ${coin(25)}`,
    `Defensive Redzone Stop Rate: ${star} >65% ${coin(10)} | ${superstar} >85% ${coin(15)} | ${xfactor} 100% ${coin(25)}`,
    "",
    "**Game Bonuses And Penalties**",
    `4th Quarter Comeback ${coin(50)} — win after trailing entering the 4th quarter.`,
    `Upset ${coin(25)} — beat any opponent ranked above you in the power rankings.`,
    `Major Upset ${coin(50)} — beat an opponent 10+ spots above you in the power rankings.`,
    `Shut-Out ${coin(50)} — hold your opponent to 0 points.`,
    `Slow-Starter ${coin(-10)} — score 0 points in the 1st quarter.`,
    `Weak-Closer ${coin(-10)} — lead entering the 4th quarter but lose by 14+ points.`
  ].join("\n"));
}

function gcRankLabel(side: any) {
  return side?.rank ? `#${side.rank}` : "Unranked";
}

function gcShortName(side: any) {
  return String(side?.teamName ?? "Team").slice(0, 18);
}

function gcChannelMention(channelId: string | null | undefined, fallback: string) {
  return channelId ? `<#${channelId}>` : fallback;
}

function gcNum(stats: any, pick: (s: any) => number, signed = false) {
  if (!stats || !stats.gamesLogged) return "—";
  const value = Math.round(pick(stats) * 10) / 10;
  return signed && value > 0 ? `+${value}` : `${value}`;
}

// Fixed-width comparison table inside a code block so the two columns align.
function gcStatTable(awayHead: string, homeHead: string, rows: Array<[string, string, string]>) {
  const labelW = Math.max(11, ...rows.map((r) => r[0].length));
  const colW = Math.max(awayHead.length, homeHead.length, ...rows.map((r) => Math.max(r[1].length, r[2].length)));
  const pad = (s: string, w: number) => (s.length >= w ? s : s + " ".repeat(w - s.length));
  const padStart = (s: string, w: number) => (s.length >= w ? s : " ".repeat(w - s.length) + s);
  const header = `${pad("", labelW)}  ${padStart(awayHead, colW)}  ${padStart(homeHead, colW)}`;
  const body = rows.map((r) => `${pad(r[0], labelW)}  ${padStart(r[1], colW)}  ${padStart(r[2], colW)}`);
  return ["```", header, ...body, "```"].join("\n");
}

function gcPageMain(m: any) {
  const away = m.away;
  const home = m.home;
  const awayHead = gcShortName(away);
  const homeHead = gcShortName(home);
  const ptDiff = (s: any) => Number(s?.pointsForAvg ?? 0) - Number(s?.pointsAgainstAvg ?? 0);
  const table = gcStatTable(awayHead, homeHead, [
    ["Record", away.record.text, home.record.text],
    ["Pts/G", gcNum(away.stats, (s) => s.pointsForAvg), gcNum(home.stats, (s) => s.pointsForAvg)],
    ["Pts Allowed", gcNum(away.stats, (s) => s.pointsAgainstAvg), gcNum(home.stats, (s) => s.pointsAgainstAvg)],
    ["Avg Pt Diff", gcNum(away.stats, ptDiff, true), gcNum(home.stats, ptDiff, true)],
    ["Pass Yds/G", gcNum(away.stats, (s) => s.passingYardsAvg), gcNum(home.stats, (s) => s.passingYardsAvg)],
    ["Rush Yds/G", gcNum(away.stats, (s) => s.rushingYardsAvg), gcNum(home.stats, (s) => s.rushingYardsAvg)],
    ["Turnover +/-", gcNum(away.stats, (s) => s.turnoverDifferential, true), gcNum(home.stats, (s) => s.turnoverDifferential, true)],
  ]);
  const rules = gameRulesLines(m.draft ?? null, m.isPlayoff);
  const boxScores = gcChannelMention(m.routes?.boxScoresChannelId, "the box scores channel");
  return new EmbedBuilder().setTitle("Game of the Week Matchup").setDescription([
    `**${gcRankLabel(away)} ${away.teamName} (${away.record.text})**`,
    "**vs**",
    `**${gcRankLabel(home)} ${home.teamName} (${home.record.text})**`,
    "",
    "__Season Comparison__",
    table,
    ...rules,
    "",
    `After the game, post your box score screenshot in ${boxScores} — see the **Posting & Payouts** page for details.`,
  ].join("\n").slice(0, 4096));
}

function gcPagePosting(m: any) {
  const boxScores = gcChannelMention(m.routes?.boxScoresChannelId, "the box scores channel");
  const streams = gcChannelMention(m.routes?.streamsChannelId, "the streams channel");
  const highlights = gcChannelMention(m.routes?.highlightsChannelId, "the highlights channel");
  return new EmbedBuilder().setTitle("Posting & Payouts").setDescription([
    "__Box Score__",
    `After the game, post your box score screenshot in ${boxScores} — **not** in this channel.`,
    "Failure to post your box score image WILL result in no payouts and no stat accumulation for awards and EOS payouts.",
    "Retroactive box scores will not be accepted. Fair Sims and Force Wins receive no payout.",
    "",
    `__Stream Payout — ${formatCoins(50)}/week__`,
    `Post your stream link or go Discord Live, then drop it in ${streams}. Worth **${formatCoins(50)}**, once per game week.`,
    "",
    `__Highlight Payout — ${formatCoins(25)} each__`,
    `Post your in-game highlights in ${highlights}. Each is worth **${formatCoins(25)}**, with up to **2 paid highlights per week**.`,
    "Highlights also enter Play of the Year voting (regular season) for a shot at the season-end award.",
  ].join("\n").slice(0, 4096));
}

function gcPageChallenges(_m: any) {
  return weeklyChallengesEmbed();
}

function gcCoachIdentityBlock(side: any) {
  const who = side.discordId ? `<@${side.discordId}>` : side.displayName ?? "Coach";
  const identity = side.identity;
  const label = identity?.label ?? "Unscouted Coach";
  const conf = identity?.confidence ? ` (${identity.confidence}%)` : "";
  const summary = identity?.summary ?? "Not enough approved box-score history to scout an identity yet.";
  const evidence = (identity?.evidence ?? []).slice(0, 3).map((line: string) => `• ${line}`).join("\n");
  const allTime = side.allTimeGameRecord;
  const allTimeLine = allTime
    ? `**All-Time (${allTime.label}):** ${allTime.text}${allTime.playoffText !== "0-0" ? ` • Playoffs ${allTime.playoffText}` : ""}${allTime.superbowlWins ? ` • ${allTime.superbowlWins}× SB` : ""}`
    : null;
  const fmtBadges = (badges: any[]) => badges.map((b) => (b.tier ? `${b.tier} ${b.label}` : b.label) + (b.earnedCount > 1 ? ` ×${b.earnedCount}` : "")).join(", ");
  const weekly = side.weeklyBadges?.length ? `**Active badges:** ${fmtBadges(side.weeklyBadges)}` : "**Active badges:** none yet";
  const season = side.seasonBadges?.length ? `**Season badges:** ${fmtBadges(side.seasonBadges)}` : null;
  return [
    `**${who} — ${label}${conf}**`,
    summary,
    allTimeLine,
    weekly,
    season,
    evidence,
  ].filter(Boolean).join("\n");
}

function gcPageIdentities(m: any) {
  return new EmbedBuilder().setTitle("Matchup Identities").setDescription([
    gcCoachIdentityBlock(m.away),
    "",
    gcCoachIdentityBlock(m.home),
  ].join("\n").slice(0, 4096));
}

function gcEdge(label: string, m: any, pick: (s: any) => number, higherIsBetter = true) {
  const a = m.away.stats;
  const h = m.home.stats;
  if (!a?.gamesLogged || !h?.gamesLogged) return null;
  const av = Math.round(pick(a) * 10) / 10;
  const hv = Math.round(pick(h) * 10) / 10;
  const awayLeads = higherIsBetter ? av > hv : av < hv;
  const homeLeads = higherIsBetter ? hv > av : hv < av;
  const leader = awayLeads ? gcShortName(m.away) : homeLeads ? gcShortName(m.home) : "Even";
  return `**${label}:** ${leader} (${av} vs ${hv})`;
}

function gcPageBreakdown(m: any) {
  const edges = [
    gcEdge("Passing", m, (s) => s.passingYardsAvg),
    gcEdge("Rushing", m, (s) => s.rushingYardsAvg),
    gcEdge("Scoring", m, (s) => s.pointsForAvg),
    gcEdge("Defense (pts allowed)", m, (s) => s.pointsAgainstAvg, false),
    gcEdge("Ball Security (TOs/G)", m, (s) => s.turnoversCommittedAvg, false),
    gcEdge("Explosiveness (total yds/G)", m, (s) => s.totalYardsAvg),
  ].filter(Boolean) as string[];

  const body = edges.length
    ? ["__Statistical Edges__", ...edges, ""]
    : ["Not enough logged games on both sides to compare yet — check back once Week 1 box scores are in.", ""];

  return new EmbedBuilder().setTitle("Matchup Breakdown").setDescription([
    `**${gcShortName(m.away)}** — ${m.away.identity?.label ?? "Unscouted Coach"}`,
    m.away.identity?.summary ?? "No scouting identity yet.",
    "",
    `**${gcShortName(m.home)}** — ${m.home.identity?.label ?? "Unscouted Coach"}`,
    m.home.identity?.summary ?? "No scouting identity yet.",
    "",
    ...body,
  ].join("\n").slice(0, 4096));
}

export function buildGameChannelPage(m: any, page: number) {
  const p = ((page % GAME_CHANNEL_PAGE_COUNT) + GAME_CHANNEL_PAGE_COUNT) % GAME_CHANNEL_PAGE_COUNT;
  const builders = [gcPageMain, gcPagePosting, gcPageChallenges, gcPageIdentities, gcPageBreakdown];
  const embed = builders[p](m);
  return embed.setFooter({ text: `Page ${p + 1}/${GAME_CHANNEL_PAGE_COUNT} • ${GAME_CHANNEL_PAGE_TITLES[p]} • ${stageLabel(m.stage, m.week)}` });
}

export function buildGameChannelNavRow(page: number) {
  const p = ((page % GAME_CHANNEL_PAGE_COUNT) + GAME_CHANNEL_PAGE_COUNT) % GAME_CHANNEL_PAGE_COUNT;
  const prev = (p + GAME_CHANNEL_PAGE_COUNT - 1) % GAME_CHANNEL_PAGE_COUNT;
  const next = (p + 1) % GAME_CHANNEL_PAGE_COUNT;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${GAME_CHANNEL_PAGE_PREFIX}${prev}`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("rec:gamech:indicator").setLabel(`${p + 1}/${GAME_CHANNEL_PAGE_COUNT}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`${GAME_CHANNEL_PAGE_PREFIX}${next}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary),
  );
}

// Public, restart-proof page flip: anyone in the game channel can page through.
// Re-fetches the matchup by channel id (no menu session needed) so the data
// stays current as box scores come in during the week.
export async function handleGameChannelPage(interaction: ButtonInteraction) {
  const page = Number(interaction.customId.slice(GAME_CHANNEL_PAGE_PREFIX.length)) || 0;
  await interaction.deferUpdate().catch(() => undefined);
  if (!interaction.guildId) return;
  const matchup = await recApi
    .getGameChannelMatchup({ guildId: interaction.guildId, discordChannelId: interaction.channelId })
    .catch(() => null);
  if (!matchup) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Matchup").setDescription("Couldn't load matchup data right now. Try again in a moment.")],
      components: [buildGameChannelNavRow(page)],
    }).catch(() => undefined);
  }
  return interaction.editReply({
    embeds: [buildGameChannelPage(matchup, page)],
    components: [buildGameChannelNavRow(page)],
  }).catch(() => undefined);
}
