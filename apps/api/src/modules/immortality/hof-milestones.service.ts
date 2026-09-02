// Rise to Immortality: "HOF Milestones" -- one career-stats card per materialized prospect,
// posted to hof_milestones_channel_id the moment their prospect card first posts (franchise
// chosen) and re-rendered in place every advance after that. Career totals + franchise
// regular-season/postseason/Super Bowl record (the record of whichever user currently owns this
// player's team, via rec_league_user_records -- the same career W-L ledger the site's own
// records pages already read).
import { postDiscordChannelMessage, editDiscordMessage } from "../../lib/discord-guild.js";
import { supabase } from "../../lib/supabase.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { getLeagueStatsForLeagueId } from "../league-stats/league-stats.service.js";
import { statLinesForPosition } from "./player-stat-line.js";
import { loadImmortalityLeague } from "./immortality.service.js";

async function franchiseRecordLines(recLeagueId: string, immortalityLeagueId: string, teamId: string | null): Promise<string[]> {
  if (!teamId) return [];
  const claim = await supabase.from("rec_immortality_user_team_assignments").select("user_id").eq("immortality_league_id", immortalityLeagueId).eq("team_id", teamId).maybeSingle();
  if (!claim.data?.user_id) return [];
  const record = await supabase.from("rec_league_user_records").select("wins,losses,ties,playoff_wins,playoff_losses,superbowl_wins,superbowl_losses").eq("league_id", recLeagueId).eq("user_id", claim.data.user_id).maybeSingle();
  if (!record.data) return [];
  const r = record.data as Record<string, number>;
  return [
    `Franchise Record: ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""} (Regular Season), ${r.playoff_wins}-${r.playoff_losses} (Postseason), ${r.superbowl_wins}-${r.superbowl_losses} (Super Bowl)`,
  ];
}

async function buildHofEmbed(recLeagueId: string, immortalityLeagueId: string, prospect: { id: string; first_name: string | null; last_name: string | null; position: string | null; player_id: string | null }) {
  const stats = await getLeagueStatsForLeagueId(recLeagueId, { scope: "career" });
  const playerRow = (stats.players as Array<Record<string, unknown>>).find((row) => String(row.id) === String(prospect.player_id));
  const totals = (playerRow?.stats as Record<string, unknown>) ?? {};
  const teamId = (playerRow?.teamId as string | null) ?? null;
  const statLines = statLinesForPosition(String(prospect.position ?? ""), totals);
  const recordLines = await franchiseRecordLines(recLeagueId, immortalityLeagueId, teamId);
  const name = `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Prospect";
  return {
    title: `${name} — Career Milestones`,
    description: [...statLines, ...recordLines].join("\n"),
    color: 0xffd700,
  };
}

/** Posts (first time) or edits (every advance after) a single prospect's HOF Milestones card.
 * No-ops if the prospect hasn't been materialized to a roster yet -- nothing to show. */
export async function postOrRefreshHofMilestoneCard(prospectId: string): Promise<void> {
  try {
    const prospect = await supabase.from("rec_immortality_prospects")
      .select("id,immortality_league_id,first_name,last_name,position,player_id,hof_channel_id,hof_message_id")
      .eq("id", prospectId).maybeSingle();
    if (prospect.error || !prospect.data || !prospect.data.player_id) return;

    const immortalityLeague = await supabase.from("rec_immortality_leagues").select("league_id").eq("id", prospect.data.immortality_league_id).maybeSingle();
    const recLeagueId = immortalityLeague.data?.league_id as string | undefined;
    if (!recLeagueId) return;

    const embed = await buildHofEmbed(recLeagueId, prospect.data.immortality_league_id, prospect.data);

    if (prospect.data.hof_channel_id && prospect.data.hof_message_id) {
      await editDiscordMessage(prospect.data.hof_channel_id, prospect.data.hof_message_id, { embeds: [embed] });
      return;
    }

    const routes = await findServerRoutesForLeague(recLeagueId);
    const channelId = routes?.routes?.hof_milestones_channel_id as string | null | undefined;
    if (!channelId) return;
    const posted = await postDiscordChannelMessage(channelId, { embeds: [embed] });
    if (posted?.id) {
      await supabase.from("rec_immortality_prospects").update({
        hof_channel_id: channelId, hof_message_id: posted.id,
      }).eq("id", prospectId);
    }
  } catch (err) {
    console.error(`[ERROR] Failed to post/refresh HOF Milestones card for prospect ${prospectId} (non-fatal):`, err);
  }
}

/** Called once per advance -- refreshes every already-posted HOF Milestones card for the
 * league. No-ops instantly for non-RTI leagues. */
export async function refreshHofMilestonesForLeague(leagueId: string): Promise<void> {
  const immortalityLeague = await loadImmortalityLeague(leagueId);
  if (!immortalityLeague) return;
  const posted = await supabase.from("rec_immortality_prospects").select("id")
    .eq("immortality_league_id", immortalityLeague.id).not("player_id", "is", null);
  if (posted.error || !posted.data?.length) return;
  for (const row of posted.data) await postOrRefreshHofMilestoneCard(row.id);
}
