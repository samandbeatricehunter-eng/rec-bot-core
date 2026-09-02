// Rise to Immortality: the real-world NFL all-time record book, top 5 per category (packages/
// shared's frozen NFL_CAREER_RECORDS_TOP5 dataset). ensureNflRecordBaselinePosted seeds+posts
// the board once; checkNflRecordsAfterImport re-checks every category's in-league career
// leaders after each import and lets league players climb into (or off of) the top 5
// automatically. Only unseating rank 1 -- an actual broken record -- posts an announcement and
// tags the breaker; ranks 2-5 update silently.
import { NFL_CAREER_RECORDS_TOP5, type NflRecordCategory } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { getLeagueStatsForLeagueId } from "../league-stats/league-stats.service.js";
import { loadImmortalityLeague, discordIdForRecUser } from "./immortality.service.js";

// Maps a record category to the canonical player-stat key league-stats.service.ts's `leaders`
// object is keyed by (see packages/shared/src/stats/stat-definitions.ts). tackles_solo has no
// distinct box-score field in this game's canonical stats -- it's shown on the board but never
// auto-checked for a league player climbing into it.
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

const CATEGORY_LABELS: Record<NflRecordCategory, string> = {
  pass_yards: "Career Passing Yards",
  pass_tds: "Career Passing Touchdowns",
  rush_yards: "Career Rushing Yards",
  rush_tds: "Career Rushing Touchdowns",
  receptions: "Career Receptions",
  receiving_yards: "Career Receiving Yards",
  receiving_tds: "Career Receiving Touchdowns",
  tackles_combined: "Career Combined Tackles",
  tackles_solo: "Career Solo Tackles",
  interceptions: "Career Interceptions",
  sacks: "Career Sacks",
};

const ALL_CATEGORIES = Object.keys(NFL_CAREER_RECORDS_TOP5) as NflRecordCategory[];

type BoardRow = {
  category: NflRecordCategory;
  rank: number;
  holder_name: string;
  value: number;
  is_league_player: boolean;
  player_id: string | null;
  user_id: string | null;
};

function buildCategoryEmbed(label: string, rows: BoardRow[]) {
  const lines = [...rows].sort((a, b) => a.rank - b.rank).map((r) =>
    `**${r.rank}.** ${r.holder_name} — **${Number(r.value).toLocaleString()}**${r.is_league_player ? " 🏈" : ""}`
  ).join("\n");
  return { title: label, description: lines || "—", color: 0xd9a521 };
}

// Splits category embeds across as many Discord messages as needed to stay under both the
// 10-embeds-per-message and ~6000-total-embed-characters-per-message limits.
async function postRecordBoard(channelId: string, embeds: Array<{ title: string; description: string; color: number }>, leadContent?: string): Promise<void> {
  const MAX_EMBEDS_PER_MESSAGE = 8;
  const MAX_CHARS_PER_MESSAGE = 5500;
  let index = 0;
  let first = true;
  while (index < embeds.length) {
    const batch: typeof embeds = [];
    let chars = 0;
    while (index < embeds.length && batch.length < MAX_EMBEDS_PER_MESSAGE) {
      const next = embeds[index]!;
      const nextLen = next.title.length + next.description.length;
      if (batch.length > 0 && chars + nextLen > MAX_CHARS_PER_MESSAGE) break;
      batch.push(next);
      chars += nextLen;
      index += 1;
    }
    await postDiscordChannelMessage(channelId, { content: first ? leadContent : undefined, embeds: batch });
    first = false;
  }
}

/** Seeds rec_immortality_nfl_records with the real NFL top-5 boards and posts them once.
 * Idempotent -- a no-op once any row exists for the league, so it's safe to call from multiple
 * hook points ("when first linked" plus a safety-net call from the import checker). */
export async function ensureNflRecordBaselinePosted(leagueId: string): Promise<void> {
  try {
    const immortalityLeague = await loadImmortalityLeague(leagueId);
    if (!immortalityLeague) return;

    const existing = await supabase.from("rec_immortality_nfl_records").select("id").eq("immortality_league_id", immortalityLeague.id).limit(1);
    if (existing.error || (existing.data ?? []).length > 0) return;

    const rows = ALL_CATEGORIES.flatMap((category) => NFL_CAREER_RECORDS_TOP5[category].map((entry) => ({
      immortality_league_id: immortalityLeague.id,
      category, label: CATEGORY_LABELS[category], rank: entry.rank,
      holder_name: entry.holder, value: entry.value, is_league_player: false,
    })));
    const inserted = await supabase.from("rec_immortality_nfl_records").insert(rows);
    if (inserted.error) return;

    const routes = await findServerRoutesForLeague(leagueId);
    const channelId = routes?.routes?.record_holders_channel_id as string | null | undefined;
    if (!channelId) return;

    const embeds = ALL_CATEGORIES.map((category) => buildCategoryEmbed(
      CATEGORY_LABELS[category],
      rows.filter((r) => r.category === category) as unknown as BoardRow[],
    ));
    await postRecordBoard(
      channelId, embeds,
      "📖 **The Record Book** — Rise to Immortality tracks the NFL's all-time top 5 in each category. Climb into the top 5 automatically as your career totals grow; unseat #1 and you get the headline.",
    );
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

    const existing = await supabase.from("rec_immortality_nfl_records").select("*").eq("immortality_league_id", immortalityLeague.id);
    if (existing.error || !existing.data?.length) return;
    const boardByCategory = new Map<NflRecordCategory, BoardRow[]>();
    for (const row of existing.data as BoardRow[]) {
      const list = boardByCategory.get(row.category) ?? [];
      list.push(row);
      boardByCategory.set(row.category, list);
    }

    const stats = await getLeagueStatsForLeagueId(leagueId, { scope: "career" });
    const leadersByKey = stats.leaders as Record<string, Array<Record<string, unknown>>>;

    // Batch-resolve every candidate league player's owning user once, up front, rather than
    // per-category round trips.
    const candidatePlayerIds = new Set<string>();
    for (const category of ALL_CATEGORIES) {
      const statKey = CATEGORY_STAT_KEY[category];
      if (!statKey) continue;
      for (const row of (leadersByKey[statKey] ?? []).slice(0, 5)) candidatePlayerIds.add(String(row.playerId));
    }
    const players = candidatePlayerIds.size
      ? await supabase.from("rec_players").select("id,team_id").in("id", [...candidatePlayerIds])
      : { data: [] as Array<{ id: string; team_id: string | null }> };
    const teamIdByPlayer = new Map<string, string | null>((players.data ?? []).map((p) => [String(p.id), p.team_id ? String(p.team_id) : null]));
    const teamIds = new Set([...teamIdByPlayer.values()].filter((id): id is string => Boolean(id)));
    const claims = teamIds.size
      ? await supabase.from("rec_immortality_user_team_assignments").select("team_id,user_id").eq("immortality_league_id", immortalityLeague.id).in("team_id", [...teamIds])
      : { data: [] as Array<{ team_id: string; user_id: string }> };
    const userIdByTeam = new Map<string, string>((claims.data ?? []).map((c) => [String(c.team_id), String(c.user_id)]));

    const routes = await findServerRoutesForLeague(leagueId);
    const channelId = routes?.routes?.record_holders_channel_id as string | null | undefined;
    const brokenEmbeds: Array<{ title: string; description: string; color: number }> = [];
    const mentionUserIds = new Set<string>();

    for (const category of ALL_CATEGORIES) {
      const statKey = CATEGORY_STAT_KEY[category];
      const board = (boardByCategory.get(category) ?? []).sort((a, b) => a.rank - b.rank);
      if (!statKey || !board.length) continue;

      const leagueCandidates: BoardRow[] = (leadersByKey[statKey] ?? []).slice(0, 5).map((row) => {
        const playerId = String(row.playerId);
        const teamId = teamIdByPlayer.get(playerId) ?? null;
        const userId = teamId ? (userIdByTeam.get(teamId) ?? null) : null;
        return {
          category, rank: 0, holder_name: String(row.playerName ?? ""), value: Number(row.value ?? 0),
          is_league_player: true, player_id: playerId, user_id: userId,
        };
      }).filter((c) => c.value > 0);

      const leagueCandidateIds = new Set(leagueCandidates.map((c) => c.player_id));
      const carryOver = board.filter((row) => !(row.is_league_player && row.player_id && leagueCandidateIds.has(row.player_id)));
      const combined = [...carryOver, ...leagueCandidates]
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
        .map((row, index) => ({ ...row, rank: index + 1 }));

      const oldRank1 = board.find((row) => row.rank === 1) ?? null;
      const newRank1 = combined.find((row) => row.rank === 1) ?? null;
      const recordBroken = Boolean(
        newRank1?.is_league_player
        && (!oldRank1?.is_league_player || oldRank1.player_id !== newRank1.player_id)
        && (!oldRank1 || newRank1.value > oldRank1.value),
      );

      // Nothing to change this cycle -- board is identical to what's already stored.
      const unchanged = combined.length === board.length && combined.every((row) => {
        const prior = board.find((b) => b.rank === row.rank);
        return prior && prior.holder_name === row.holder_name && Number(prior.value) === row.value && prior.is_league_player === row.is_league_player;
      });
      if (unchanged) continue;

      await supabase.from("rec_immortality_nfl_records").delete().eq("immortality_league_id", immortalityLeague.id).eq("category", category);
      await supabase.from("rec_immortality_nfl_records").insert(combined.map((row) => ({
        immortality_league_id: immortalityLeague.id, category, label: CATEGORY_LABELS[category], rank: row.rank,
        holder_name: row.holder_name, value: row.value, is_league_player: row.is_league_player,
        player_id: row.player_id, user_id: row.user_id, set_at: row.is_league_player ? new Date().toISOString() : null,
      })));

      if (recordBroken && newRank1) {
        brokenEmbeds.push(buildCategoryEmbed(`📜 Record Broken — ${CATEGORY_LABELS[category]}`, combined));
        if (newRank1.user_id) {
          const discordId = await discordIdForRecUser(newRank1.user_id).catch(() => null);
          if (discordId) mentionUserIds.add(discordId);
        }
      }
    }

    if (brokenEmbeds.length && channelId) {
      const mentions = [...mentionUserIds].map((id) => `<@${id}>`).join(" ");
      await postRecordBoard(channelId, brokenEmbeds, mentions || undefined);
    }
  } catch (err) {
    console.error("[ERROR] Failed to check RTI NFL records after import (non-fatal):", err);
  }
}
