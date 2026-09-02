// Rise to Immortality: the real-world NFL all-time record book (packages/shared's frozen
// NFL_CAREER_RECORDS dataset). ensureNflRecordBaselinePosted seeds+posts the book once, the
// first time a league has anything to check it against; checkNflRecordsAfterImport re-checks
// every category's in-league career leader after each import and posts + tags the breaker the
// moment someone's career total actually passes the seeded (or previously broken) mark.
import { NFL_CAREER_RECORDS, type NflRecordCategory } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { getLeagueStatsForLeagueId } from "../league-stats/league-stats.service.js";
import { loadImmortalityLeague, discordIdForRecUser } from "./immortality.service.js";

// Maps a record category to the canonical player-stat key league-stats.service.ts's `leaders`
// object is keyed by (see packages/shared/src/stats/stat-definitions.ts). tackles_solo has no
// distinct box-score field in this game's canonical stats -- it's shown in the baseline post
// but never auto-checked for a break.
const CATEGORY_STAT_KEY: Partial<Record<NflRecordCategory, string>> = {
  pass_yards: "pass_yards",
  pass_tds: "pass_tds",
  rush_yards: "rush_yards",
  rush_tds: "rush_tds",
  receptions: "receptions",
  receiving_yards: "receiving_yards",
  receiving_tds: "receiving_tds",
  tackles_combined: "tackles",
  interceptions: "interceptions",
  sacks: "sacks",
};

/** Seeds rec_immortality_nfl_records with the real NFL marks and posts the baseline record book
 * once. Idempotent -- a no-op once any row exists for the league, so it's safe to call from
 * multiple hook points ("when first linked" plus a safety-net call from the import checker). */
export async function ensureNflRecordBaselinePosted(leagueId: string): Promise<void> {
  try {
    const immortalityLeague = await loadImmortalityLeague(leagueId);
    if (!immortalityLeague) return;

    const existing = await supabase.from("rec_immortality_nfl_records").select("id").eq("immortality_league_id", immortalityLeague.id).limit(1);
    if (existing.error || (existing.data ?? []).length > 0) return;

    const records = Object.values(NFL_CAREER_RECORDS);
    const inserted = await supabase.from("rec_immortality_nfl_records").insert(records.map((record) => ({
      immortality_league_id: immortalityLeague.id,
      category: record.category,
      label: record.label,
      current_holder_name: record.holder,
      current_value: record.value,
    })));
    if (inserted.error) return;

    const routes = await findServerRoutesForLeague(leagueId);
    const channelId = routes?.routes?.record_holders_channel_id as string | null | undefined;
    if (!channelId) return;

    const lines = records.map((record) => `**${record.label}** — ${record.holder}, ${record.value.toLocaleString()}`).join("\n");
    await postDiscordChannelMessage(channelId, {
      embeds: [{
        title: "The Record Book",
        description: `Rise to Immortality tracks these NFL all-time career marks. First to break one gets the headline.\n\n${lines}`,
        color: 0xd9a521,
      }],
    });
  } catch (err) {
    console.error("[ERROR] Failed to post RTI NFL record baseline (non-fatal):", err);
  }
}

/** Called after every EA import for the league. No-ops instantly for non-RTI leagues. */
export async function checkNflRecordsAfterImport(leagueId: string): Promise<void> {
  try {
    const immortalityLeague = await loadImmortalityLeague(leagueId);
    if (!immortalityLeague) return;
    await ensureNflRecordBaselinePosted(leagueId);

    const records = await supabase.from("rec_immortality_nfl_records").select("*").eq("immortality_league_id", immortalityLeague.id);
    if (records.error || !records.data?.length) return;

    const routes = await findServerRoutesForLeague(leagueId);
    const channelId = routes?.routes?.record_holders_channel_id as string | null | undefined;

    const stats = await getLeagueStatsForLeagueId(leagueId, { scope: "career" });
    const leadersByKey = stats.leaders as Record<string, Array<Record<string, unknown>>>;

    for (const record of records.data) {
      const statKey = CATEGORY_STAT_KEY[record.category as NflRecordCategory];
      if (!statKey) continue;
      const top = (leadersByKey[statKey] ?? [])[0];
      if (!top) continue;
      const value = Number(top.value ?? 0);
      if (value <= Number(record.current_value)) continue;

      const player = await supabase.from("rec_players").select("team_id").eq("id", String(top.playerId)).maybeSingle();
      const teamId = (player.data as { team_id?: string } | null)?.team_id ?? null;
      const claim = teamId
        ? await supabase.from("rec_immortality_user_team_assignments").select("user_id").eq("immortality_league_id", immortalityLeague.id).eq("team_id", teamId).maybeSingle()
        : { data: null as { user_id?: string } | null };
      const discordId = claim.data?.user_id ? await discordIdForRecUser(claim.data.user_id).catch(() => null) : null;

      const previousHolder = record.current_holder_name as string;
      const previousValue = Number(record.current_value);

      await supabase.from("rec_immortality_nfl_records").update({
        current_holder_name: String(top.playerName ?? ""), current_value: value, is_broken: true,
        broken_by_player_id: String(top.playerId), broken_by_user_id: claim.data?.user_id ?? null,
        broken_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", record.id);

      if (channelId) {
        const mention = discordId ? `<@${discordId}> ` : "";
        await postDiscordChannelMessage(channelId, {
          content: `${mention}📜 **NFL Record Broken**`,
          embeds: [{
            title: record.label as string,
            description: `**${top.playerName}** now holds this record with **${value.toLocaleString()}**, passing ${previousHolder}'s ${previousValue.toLocaleString()}.`,
            color: 0xd9a521,
          }],
        });
      }
    }
  } catch (err) {
    console.error("[ERROR] Failed to check RTI NFL records after import (non-fatal):", err);
  }
}
