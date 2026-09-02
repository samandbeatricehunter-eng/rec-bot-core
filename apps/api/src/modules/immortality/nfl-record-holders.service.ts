// Rise to Immortality: the real-world NFL all-time record book, top 5 per category, tracked
// across three scopes -- single-game, single-season, and career (packages/shared's frozen
// NFL_SINGLE_GAME_RECORDS_TOP5 / NFL_SINGLE_SEASON_RECORDS_TOP5 / NFL_CAREER_RECORDS_TOP5
// datasets). ensureNflRecordBaselinePosted seeds+posts each scope's board once (independently,
// so a league that already had one scope seeded before this feature grew to three still gets
// the other two); checkNflRecordsAfterImport re-checks every scope/category's in-league leaders
// after each import and lets league players climb into (or off of) the top 5 automatically.
// Only unseating rank 1 in any scope -- an actual broken record -- posts an announcement, tags
// the breaker, and (if they're an RTI-created prospect, not a baseline NFL fill player) credits
// a record-break Player XP award through the points loop.
import { NFL_CAREER_RECORDS_TOP5, NFL_SINGLE_SEASON_RECORDS_TOP5, NFL_SINGLE_GAME_RECORDS_TOP5, type NflRecordCategory, type NflRecordTop5Entry } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { editDiscordMessage, postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { getLeagueStatsForLeagueId, getSingleGameLeadersForLeague } from "../league-stats/league-stats.service.js";
import { loadImmortalityLeague } from "./immortality.service.js";

type RecordScope = "game" | "season" | "career";
const SCOPES: RecordScope[] = ["game", "season", "career"];
const SCOPE_DATASET: Record<RecordScope, Record<NflRecordCategory, NflRecordTop5Entry[]>> = {
  game: NFL_SINGLE_GAME_RECORDS_TOP5, season: NFL_SINGLE_SEASON_RECORDS_TOP5, career: NFL_CAREER_RECORDS_TOP5,
};
const SCOPE_LABELS: Record<RecordScope, string> = { game: "Single-Game", season: "Single-Season", career: "Career" };

// Maps a record category to the canonical player-stat key league-stats.service.ts's `leaders`
// object (and getSingleGameLeadersForLeague) is keyed by (see
// packages/shared/src/stats/stat-definitions.ts). tackles_solo has no distinct box-score field
// in this game's canonical stats -- it's shown on every board but never auto-checked.
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
  pass_yards: "Passing Yards",
  pass_tds: "Passing Touchdowns",
  rush_yards: "Rushing Yards",
  rush_tds: "Rushing Touchdowns",
  receptions: "Receptions",
  receiving_yards: "Receiving Yards",
  receiving_tds: "Receiving Touchdowns",
  tackles_combined: "Combined Tackles",
  tackles_solo: "Solo Tackles",
  interceptions: "Interceptions",
  sacks: "Sacks",
};

const ALL_CATEGORIES = Object.keys(NFL_CAREER_RECORDS_TOP5) as NflRecordCategory[];

type BoardRow = {
  category: NflRecordCategory;
  scope: RecordScope;
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
async function postRecordBoard(
  immortalityLeagueId: string,
  scope: RecordScope,
  channelId: string,
  embeds: Array<{ title: string; description: string; color: number }>,
  leadContent?: string,
): Promise<void> {
  const MAX_EMBEDS_PER_MESSAGE = 8;
  const MAX_CHARS_PER_MESSAGE = 5500;
  let index = 0;
  let batchIndex = 0;
  let first = true;
  const tracked = await supabase.from("rec_immortality_nfl_record_messages").select("batch_index,channel_id,message_id")
    .eq("immortality_league_id", immortalityLeagueId).eq("scope", scope);
  const trackedByBatch = new Map<number, { batch_index: number; channel_id: string; message_id: string }>(
    ((tracked.data ?? []) as Array<{ batch_index: number; channel_id: string; message_id: string }>).map((row) => [Number(row.batch_index), row]),
  );
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
    const payload = { content: first ? leadContent : undefined, embeds: batch };
    const prior = trackedByBatch.get(batchIndex);
    let messageId: string | null = null;
    if (prior?.channel_id === channelId) {
      const edited = await editDiscordMessage(channelId, String(prior.message_id), payload);
      if (edited) messageId = String(prior.message_id);
    }
    if (!messageId) {
      const posted = await postDiscordChannelMessage(channelId, payload);
      if (!posted) throw new Error(`Discord did not create the ${scope} record-book message.`);
      messageId = posted.id;
    }
    const savedTracking = await supabase.from("rec_immortality_nfl_record_messages").upsert({
      immortality_league_id: immortalityLeagueId,
      scope,
      batch_index: batchIndex,
      channel_id: channelId,
      message_id: messageId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "immortality_league_id,scope,batch_index" });
    if (savedTracking.error) throw new Error(`Could not save ${scope} record-book message tracking: ${savedTracking.error.message}`);
    first = false;
    batchIndex += 1;
  }
}

/** Credits an RTI-created prospect (identified by their materialized rec_players row's
 * madden_player_id prefix "rti:") a record-break Player XP award for breaking a #1 record.
 * No-ops for a baseline NFL fill player (nothing to credit) or a player without a resolvable
 * RTI prospect id. Idempotent per (prospect, scope, category) via the ledger's source-id guard. */
async function awardRecordBreakXp(playerId: string, maddenPlayerId: string | null, scope: RecordScope, category: NflRecordCategory): Promise<void> {
  if (!maddenPlayerId?.startsWith("rti:")) return;
  const prospectId = maddenPlayerId.slice("rti:".length);
  const sourceId = `record:${scope}:${category}:${prospectId}`;
  const { awardRecordBreakPoints } = await import("./xp-awards.service.js");
  await awardRecordBreakPoints(prospectId, sourceId);
}

/** Seeds rec_immortality_nfl_records with the real NFL top-5 boards and posts them, once per
 * scope. Idempotent per scope -- a no-op for any scope that already has rows for the league, so
 * it's safe to call repeatedly (and safely picks up a newly-added scope for a league that only
 * had an earlier scope seeded before this feature grew to three). */
export async function ensureNflRecordBaselinePosted(
  leagueId: string,
  options: { refreshAuthoritativeBaseline?: boolean; postExisting?: boolean } = {},
): Promise<void> {
  try {
    const immortalityLeague = await loadImmortalityLeague(leagueId);
    if (!immortalityLeague) return;
    const routes = await findServerRoutesForLeague(leagueId);
    const channelId = routes?.routes?.record_holders_channel_id as string | null | undefined;

    for (const scope of SCOPES) {
      const existing = await supabase.from("rec_immortality_nfl_records").select("*")
        .eq("immortality_league_id", immortalityLeague.id).eq("scope", scope);
      if (existing.error) continue;

      const dataset = SCOPE_DATASET[scope];
      const baselineRows = ALL_CATEGORIES.flatMap((category) => dataset[category].map((entry) => ({
        immortality_league_id: immortalityLeague.id,
        category, label: CATEGORY_LABELS[category], scope, rank: entry.rank,
        holder_name: entry.holder, value: entry.value, is_league_player: false,
      })));
      let rows = existing.data as unknown as BoardRow[];
      if (!rows.length || options.refreshAuthoritativeBaseline) {
        const leagueRows = options.refreshAuthoritativeBaseline ? rows.filter((row) => row.is_league_player) : [];
        rows = ALL_CATEGORIES.flatMap((category) => [...baselineRows.filter((row) => row.category === category), ...leagueRows.filter((row) => row.category === category)]
          .sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 5)
          .map((row, index) => ({ ...row, rank: index + 1 }))) as unknown as BoardRow[];
        if (options.refreshAuthoritativeBaseline && existing.data?.length) {
          const deleted = await supabase.from("rec_immortality_nfl_records").delete()
            .eq("immortality_league_id", immortalityLeague.id).eq("scope", scope);
          if (deleted.error) continue;
        }
        const inserted = await supabase.from("rec_immortality_nfl_records").insert(rows);
        if (inserted.error) continue;
      } else if (!options.postExisting) {
        continue;
      }
      if (!channelId) continue;

      const embeds = ALL_CATEGORIES.map((category) => buildCategoryEmbed(
        CATEGORY_LABELS[category],
        rows.filter((r) => r.category === category) as unknown as BoardRow[],
      ));
      await postRecordBoard(
        immortalityLeague.id, scope, channelId, embeds,
        `📖 **The ${SCOPE_LABELS[scope]} Record Book** — Rise to Immortality tracks the NFL's all-time top 5 in each category. Climb into the top 5 automatically as your totals grow; unseat #1 and you get the headline plus a record-break Player XP award.`,
      );
    }
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
    const boardByScopeCategory = new Map<string, BoardRow[]>();
    for (const row of existing.data as BoardRow[]) {
      const key = `${row.scope}:${row.category}`;
      const list = boardByScopeCategory.get(key) ?? [];
      list.push(row);
      boardByScopeCategory.set(key, list);
    }

    const statKeys = Object.values(CATEGORY_STAT_KEY).filter((key): key is string => Boolean(key));
    const [seasonStats, careerStats, gameLeaders] = await Promise.all([
      getLeagueStatsForLeagueId(leagueId, { scope: "season" }),
      getLeagueStatsForLeagueId(leagueId, { scope: "career" }),
      getSingleGameLeadersForLeague(leagueId, statKeys),
    ]);
    const leadersByScope: Record<RecordScope, Record<string, Array<Record<string, unknown>>>> = {
      game: gameLeaders as unknown as Record<string, Array<Record<string, unknown>>>,
      season: seasonStats.leaders as Record<string, Array<Record<string, unknown>>>,
      career: careerStats.leaders as Record<string, Array<Record<string, unknown>>>,
    };

    // Batch-resolve every candidate league player's owning user + RTI prospect id once, up
    // front, rather than per-category round trips.
    const candidatePlayerIds = new Set<string>();
    for (const scope of SCOPES) {
      for (const category of ALL_CATEGORIES) {
        const statKey = CATEGORY_STAT_KEY[category];
        if (!statKey) continue;
        for (const row of (leadersByScope[scope][statKey] ?? []).slice(0, 5)) candidatePlayerIds.add(String(row.playerId));
      }
    }
    const players = candidatePlayerIds.size
      ? await supabase.from("rec_players").select("id,team_id,madden_player_id").in("id", [...candidatePlayerIds])
      : { data: [] as Array<{ id: string; team_id: string | null; madden_player_id: string | null }> };
    const teamIdByPlayer = new Map<string, string | null>((players.data ?? []).map((p) => [String(p.id), p.team_id ? String(p.team_id) : null]));
    const maddenIdByPlayer = new Map<string, string | null>((players.data ?? []).map((p) => [String(p.id), p.madden_player_id ?? null]));
    const teamIds = new Set([...teamIdByPlayer.values()].filter((id): id is string => Boolean(id)));
    const claims = teamIds.size
      ? await supabase.from("rec_immortality_user_team_assignments").select("team_id,user_id").eq("immortality_league_id", immortalityLeague.id).in("team_id", [...teamIds])
      : { data: [] as Array<{ team_id: string; user_id: string }> };
    const userIdByTeam = new Map<string, string>((claims.data ?? []).map((c) => [String(c.team_id), String(c.user_id)]));

    const routes = await findServerRoutesForLeague(leagueId);
    const channelId = routes?.routes?.record_holders_channel_id as string | null | undefined;
    const changedScopes = new Set<RecordScope>();

    for (const scope of SCOPES) {
      for (const category of ALL_CATEGORIES) {
        const statKey = CATEGORY_STAT_KEY[category];
        const board = (boardByScopeCategory.get(`${scope}:${category}`) ?? []).sort((a, b) => a.rank - b.rank);
        if (!statKey || !board.length) continue;

        const leagueCandidates: BoardRow[] = (leadersByScope[scope][statKey] ?? []).slice(0, 5).map((row) => {
          const playerId = String(row.playerId);
          const teamId = teamIdByPlayer.get(playerId) ?? null;
          const userId = teamId ? (userIdByTeam.get(teamId) ?? null) : null;
          return {
            category, scope, rank: 0, holder_name: String(row.playerName ?? ""), value: Number(row.value ?? 0),
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

        const unchanged = combined.length === board.length && combined.every((row) => {
          const prior = board.find((b) => b.rank === row.rank);
          return prior && prior.holder_name === row.holder_name && Number(prior.value) === row.value && prior.is_league_player === row.is_league_player;
        });
        if (unchanged) continue;

        await supabase.from("rec_immortality_nfl_records").delete().eq("immortality_league_id", immortalityLeague.id).eq("scope", scope).eq("category", category);
        await supabase.from("rec_immortality_nfl_records").insert(combined.map((row) => ({
          immortality_league_id: immortalityLeague.id, category, scope, label: CATEGORY_LABELS[category], rank: row.rank,
          holder_name: row.holder_name, value: row.value, is_league_player: row.is_league_player,
          player_id: row.player_id, user_id: row.user_id, set_at: row.is_league_player ? new Date().toISOString() : null,
        })));

        if (recordBroken && newRank1?.player_id) {
          changedScopes.add(scope);
          await awardRecordBreakXp(newRank1.player_id, maddenIdByPlayer.get(newRank1.player_id) ?? null, scope, category);
        }
        changedScopes.add(scope);
      }
    }

    if (changedScopes.size && channelId) {
      for (const scope of changedScopes) {
        const refreshed = await supabase.from("rec_immortality_nfl_records").select("*")
          .eq("immortality_league_id", immortalityLeague.id).eq("scope", scope);
        const rows = (refreshed.data ?? []) as BoardRow[];
        const embeds = ALL_CATEGORIES.map((category) => buildCategoryEmbed(
          CATEGORY_LABELS[category], rows.filter((row) => row.category === category),
        ));
        await postRecordBoard(
          immortalityLeague.id, scope, channelId, embeds,
          `📖 **The ${SCOPE_LABELS[scope]} Record Book** — live RTI standings. Break #1 to earn a record-break Player XP award.`,
        );
      }
    }
  } catch (err) {
    console.error("[ERROR] Failed to check RTI NFL records after import (non-fatal):", err);
  }
}
