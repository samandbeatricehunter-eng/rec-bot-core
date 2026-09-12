// Universal Record Book (08_RECORDS/UNIVERSAL_RECORD_BOOK.md in the uploaded XP Progression
// Engine plan): the same "real NFL all-time Top 5, climbable by league performances" system RTI
// leagues already have (immortality/nfl-record-holders.service.ts), generalized to non-RTI
// leagues. Deliberately its own module/table (rec_record_book_entries, keyed by plain league_id)
// rather than a migration of RTI's live immortality_league_id-keyed data -- this no-ops entirely
// for RTI leagues, which keep using their existing, already-working system. Consolidating both
// onto one shared engine is a later cleanup pass, once this side is independently proven.
//
// tackles_combined/tackles_solo are deliberately excluded from the category list here (unlike
// RTI's board, which still carries them) -- per the plan's explicit "Tackles cleanup" rule, the
// canonical imported stat is just `tackles` with no confirmed solo/combined semantic, and RTI's
// own `tackles_solo` category already has no backing stat key at all (never auto-checked). New
// code shouldn't repeat that same fake distinction.
import {
  NFL_CAREER_RECORDS_TOP5, NFL_SINGLE_SEASON_RECORDS_TOP5, NFL_SINGLE_GAME_RECORDS_TOP5,
  RECORD_SET_BONUS_POINTS, type NflRecordCategory, type NflRecordTop5Entry,
} from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { loadImmortalityLeague } from "../immortality/immortality.service.js";
import { getLeagueStatsForLeagueId, getSingleGameLeadersForLeague } from "../league-stats/league-stats.service.js";
import { creditPlayerXp } from "../player-xp/player-xp-ledger.service.js";
import { creditFranchiseXp } from "../franchise-xp/franchise-xp-ledger.service.js";

export type RecordBookScope = "game" | "season" | "career";
const SCOPES: RecordBookScope[] = ["game", "season", "career"];
const SCOPE_DATASET: Record<RecordBookScope, Record<NflRecordCategory, NflRecordTop5Entry[]>> = {
  game: NFL_SINGLE_GAME_RECORDS_TOP5, season: NFL_SINGLE_SEASON_RECORDS_TOP5, career: NFL_CAREER_RECORDS_TOP5,
};

const CATEGORIES: NflRecordCategory[] = [
  "pass_yards", "pass_tds", "rush_yards", "rush_tds", "receptions",
  "receiving_yards", "receiving_tds", "interceptions", "sacks",
];
const CATEGORY_STAT_KEY: Record<NflRecordCategory, string> = {
  pass_yards: "pass_yards", pass_tds: "pass_tds", rush_yards: "rush_yards", rush_tds: "rush_tds",
  receptions: "receptions", receiving_yards: "receiving_yards", receiving_tds: "receiving_tds",
  tackles_combined: "tackles", tackles_solo: "tackles", interceptions: "interceptions", sacks: "sacks",
};
export const RECORD_BOOK_CATEGORY_LABELS: Record<NflRecordCategory, string> = {
  pass_yards: "Passing Yards", pass_tds: "Passing Touchdowns", rush_yards: "Rushing Yards",
  rush_tds: "Rushing Touchdowns", receptions: "Receptions", receiving_yards: "Receiving Yards",
  receiving_tds: "Receiving Touchdowns", tackles_combined: "Combined Tackles", tackles_solo: "Solo Tackles",
  interceptions: "Interceptions", sacks: "Sacks",
};

type EntryRow = {
  id?: string; league_id: string; scope: RecordBookScope; category: NflRecordCategory; rank: number;
  holder_type: "NFL_BASELINE" | "REC_PLAYER"; holder_name: string; value: number;
  player_id: string | null; user_id: string | null; team_id: string | null;
  season_number: number | null; week_number: number | null; set_at: string | null;
};

/** Seeds the NFL baseline Top 5 for any scope this league has no rows for yet. Idempotent --
 * a no-op for a scope that already has entries, so it's safe to call on every check. */
async function ensureBaselineSeeded(leagueId: string): Promise<void> {
  for (const scope of SCOPES) {
    const existing = await supabase.from("rec_record_book_entries").select("id").eq("league_id", leagueId).eq("scope", scope).limit(1);
    if (existing.error || existing.data?.length) continue;
    const dataset = SCOPE_DATASET[scope];
    const rows: EntryRow[] = CATEGORIES.flatMap((category) => dataset[category].map((entry) => ({
      league_id: leagueId, scope, category, rank: entry.rank, holder_type: "NFL_BASELINE" as const,
      holder_name: entry.holder, value: entry.value, player_id: null, user_id: null, team_id: null,
      season_number: null, week_number: null, set_at: null,
    })));
    await supabase.from("rec_record_book_entries").insert(rows);
  }
}

/** Credits an XP/media reaction for a league player who just took over rank 1 in some category --
 * mirrors nfl-record-holders.service.ts's awardRecordBreakXp + queueRecordBreakMediaReactions, but
 * through the non-RTI Player XP / Franchise XP ledgers (RTI has its own separate PPP pipeline). */
async function reactToRecordBreak(input: {
  leagueId: string; scope: RecordBookScope; category: NflRecordCategory;
  playerId: string; teamId: string | null; holderName: string; value: number;
}): Promise<void> {
  try {
    const league = await supabase.from("rec_leagues").select("season_number,current_week").eq("id", input.leagueId).maybeSingle();
    const seasonNumber = Number(league.data?.season_number ?? 1);
    const weekNumber = Number(league.data?.current_week ?? 1);
    const sourceId = `record_book:${input.scope}:${input.category}:${input.playerId}`;

    const assignment = input.teamId
      ? await supabase.from("rec_team_assignments").select("user_id").eq("league_id", input.leagueId).eq("team_id", input.teamId).eq("assignment_status", "active").is("ended_at", null).maybeSingle()
      : { data: null as { user_id: string } | null };
    const creditedToUserId = assignment.data?.user_id ? String(assignment.data.user_id) : null;

    await creditPlayerXp({
      leagueId: input.leagueId, playerId: input.playerId, creditedToUserId, seasonNumber, weekNumber,
      eventType: "record_book", sourceId, rawXp: RECORD_SET_BONUS_POINTS,
      metadata: { scope: input.scope, category: input.category, value: input.value },
    }).catch((error) => console.error(`[ERROR] creditPlayerXp for record break ${sourceId} failed (non-fatal):`, error));
    if (creditedToUserId) {
      await creditFranchiseXp({
        leagueId: input.leagueId, userId: creditedToUserId, teamId: input.teamId, seasonNumber, weekNumber,
        eventType: "record_book", sourceId, rawFpp: RECORD_SET_BONUS_POINTS,
        metadata: { scope: input.scope, category: input.category, value: input.value },
      }).catch((error) => console.error(`[ERROR] creditFranchiseXp for record break ${sourceId} failed (non-fatal):`, error));
    }

    const factLine = `${input.holderName} broke the REC ${input.scope === "game" ? "single-game" : input.scope}-scope record for ${RECORD_BOOK_CATEGORY_LABELS[input.category]} with ${Number(input.value).toLocaleString()}.`;
    const { buildClaimGroundedPostBody, pickReactivePersona, reactivePersonaAuthor } = await import("../immortality/social-claim-engine.js");
    const { logMediaEvent } = await import("../immortality/media-events.service.js");
    await logMediaEvent({
      leagueId: input.leagueId, seasonNumber, weekNumber, eventType: "record_watch",
      teamId: input.teamId, playerId: input.playerId, importanceScore: 80,
      facts: { factLine, scope: input.scope, category: input.category, value: input.value },
    }).catch((error) => console.error("[ERROR] logMediaEvent for record break failed (non-fatal):", error));

    const weights = { vaughn: 2, darius: 2, marcus: 1, elliot: 1 };
    const first = pickReactivePersona(weights);
    const second = pickReactivePersona(weights, [first]);
    const rows: Array<{ league_id: string; season_number: number; week_number: number; author_kind: string; author_handle: string; author_display_name: string; body: string; status: "pending"; source: string }> = [];
    for (const persona of [first, second]) {
      const body = await buildClaimGroundedPostBody({
        leagueId: input.leagueId, seasonNumber, weekNumber, eventType: "record_watch", persona,
        subjectKey: `player:${input.playerId}`, factLine, teamId: input.teamId, playerId: input.playerId,
        storylineTitle: `${input.holderName}'s season-long climb`, importanceScore: 80,
      });
      if (!body) continue;
      const author = reactivePersonaAuthor(persona);
      rows.push({
        league_id: input.leagueId, season_number: seasonNumber, week_number: weekNumber,
        author_kind: author.authorKind, author_handle: author.handle, author_display_name: author.displayName,
        body, status: "pending", source: "record_break",
      });
    }
    if (rows.length) await supabase.from("rec_immortality_tweet_queue").insert(rows);
  } catch (error) {
    console.error("[ERROR] reactToRecordBreak failed (non-fatal):", error);
  }
}

/** Recomputes every scope/category's league leaders against the current board, merging in any
 * league performance that cracks the top 5 and detecting an actual #1 break. No-ops entirely for
 * RTI leagues, which have their own separate, already-working record system. Call after any
 * import that could change weekly player stats (mirrors league-records.service.ts's
 * finalizeImportedLeagueStats hook point). */
export async function checkRecordBookAfterImport(leagueId: string): Promise<void> {
  try {
    const immortalityLeague = await loadImmortalityLeague(leagueId);
    if (immortalityLeague) return;

    await ensureBaselineSeeded(leagueId);

    const existing = await supabase.from("rec_record_book_entries").select("*").eq("league_id", leagueId);
    if (existing.error || !existing.data?.length) return;
    const boardByScopeCategory = new Map<string, EntryRow[]>();
    for (const row of existing.data as EntryRow[]) {
      const key = `${row.scope}:${row.category}`;
      const list = boardByScopeCategory.get(key) ?? [];
      list.push(row);
      boardByScopeCategory.set(key, list);
    }

    const statKeys = [...new Set(Object.values(CATEGORY_STAT_KEY))];
    const [seasonStats, careerStats, gameLeaders] = await Promise.all([
      getLeagueStatsForLeagueId(leagueId, { scope: "season" }),
      getLeagueStatsForLeagueId(leagueId, { scope: "career" }),
      getSingleGameLeadersForLeague(leagueId, statKeys),
    ]);
    const leadersByScope: Record<RecordBookScope, Record<string, Array<Record<string, unknown>>>> = {
      game: gameLeaders as unknown as Record<string, Array<Record<string, unknown>>>,
      season: seasonStats.leaders as Record<string, Array<Record<string, unknown>>>,
      career: careerStats.leaders as Record<string, Array<Record<string, unknown>>>,
    };

    const candidatePlayerIds = new Set<string>();
    for (const scope of SCOPES) {
      for (const category of CATEGORIES) {
        const statKey = CATEGORY_STAT_KEY[category];
        for (const row of (leadersByScope[scope][statKey] ?? []).slice(0, 5)) candidatePlayerIds.add(String(row.playerId));
      }
    }
    const players = candidatePlayerIds.size
      ? await supabase.from("rec_players").select("id,team_id").in("id", [...candidatePlayerIds])
      : { data: [] as Array<{ id: string; team_id: string | null }> };
    const teamIdByPlayer = new Map<string, string | null>((players.data ?? []).map((p) => [String(p.id), p.team_id ? String(p.team_id) : null]));

    for (const scope of SCOPES) {
      for (const category of CATEGORIES) {
        const statKey = CATEGORY_STAT_KEY[category];
        const board = (boardByScopeCategory.get(`${scope}:${category}`) ?? []).sort((a, b) => a.rank - b.rank);
        if (!board.length) continue;

        const leagueCandidates: EntryRow[] = (leadersByScope[scope][statKey] ?? []).slice(0, 5).map((row) => {
          const playerId = String(row.playerId);
          return {
            league_id: leagueId, category, scope, rank: 0, holder_type: "REC_PLAYER" as const,
            holder_name: String(row.playerName ?? ""), value: Number(row.value ?? 0),
            player_id: playerId, user_id: null, team_id: teamIdByPlayer.get(playerId) ?? null,
            season_number: null, week_number: null, set_at: null,
          };
        }).filter((c) => c.value > 0);

        const leagueCandidateIds = new Set(leagueCandidates.map((c) => c.player_id));
        const carryOver = board.filter((row) => !(row.holder_type === "REC_PLAYER" && row.player_id && leagueCandidateIds.has(row.player_id)));
        const combined = [...carryOver, ...leagueCandidates]
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)
          .map((row, index) => ({ ...row, rank: index + 1 }));

        const oldRank1 = board.find((row) => row.rank === 1) ?? null;
        const newRank1 = combined.find((row) => row.rank === 1) ?? null;
        const recordBroken = Boolean(
          newRank1?.holder_type === "REC_PLAYER"
          && (oldRank1?.holder_type !== "REC_PLAYER" || oldRank1.player_id !== newRank1.player_id)
          && (!oldRank1 || newRank1.value > oldRank1.value),
        );

        const unchanged = combined.length === board.length && combined.every((row) => {
          const prior = board.find((b) => b.rank === row.rank);
          return prior && prior.holder_name === row.holder_name && Number(prior.value) === row.value && prior.holder_type === row.holder_type;
        });
        if (unchanged) continue;

        await supabase.from("rec_record_book_entries").delete().eq("league_id", leagueId).eq("scope", scope).eq("category", category);
        await supabase.from("rec_record_book_entries").insert(combined.map((row) => ({
          league_id: leagueId, category, scope, rank: row.rank, holder_type: row.holder_type,
          holder_name: row.holder_name, value: row.value, player_id: row.player_id, user_id: row.user_id,
          team_id: row.team_id, set_at: row.holder_type === "REC_PLAYER" ? new Date().toISOString() : null,
        })));

        if (recordBroken && newRank1?.player_id) {
          await reactToRecordBreak({
            leagueId, scope, category, playerId: newRank1.player_id,
            teamId: teamIdByPlayer.get(newRank1.player_id) ?? null,
            holderName: newRank1.holder_name, value: newRank1.value,
          });
        }
      }
    }
  } catch (err) {
    console.error("[ERROR] Failed to check record book after import (non-fatal):", err);
  }
}

export type RecordBookResult = {
  scope: RecordBookScope;
  categories: Array<{ category: NflRecordCategory; label: string; entries: Array<{
    rank: number; holderType: "NFL_BASELINE" | "REC_PLAYER"; holderName: string; value: number;
    playerId: string | null; teamId: string | null;
  }> }>;
};

/** Read-only view for the website. Seeds the baseline on first-ever read so a league that's never
 * had an import yet (or is non-RTI and has never triggered checkRecordBookAfterImport) still sees
 * the real NFL boards immediately instead of an empty page. */
export async function getRecordBookForLeagueId(leagueId: string, scope: RecordBookScope): Promise<RecordBookResult> {
  await ensureBaselineSeeded(leagueId);
  const rows = await supabase.from("rec_record_book_entries").select("*").eq("league_id", leagueId).eq("scope", scope);
  const byCategory = new Map<string, EntryRow[]>();
  for (const row of (rows.data ?? []) as EntryRow[]) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }
  return {
    scope,
    categories: CATEGORIES.map((category) => ({
      category, label: RECORD_BOOK_CATEGORY_LABELS[category],
      entries: (byCategory.get(category) ?? []).sort((a, b) => a.rank - b.rank).map((row) => ({
        rank: row.rank, holderType: row.holder_type, holderName: row.holder_name, value: Number(row.value),
        playerId: row.player_id, teamId: row.team_id,
      })),
    })),
  };
}

export async function getRecordBook(guildId: string, scope: RecordBookScope): Promise<RecordBookResult> {
  const context = await getCurrentLeagueContext(guildId);
  return getRecordBookForLeagueId(context.leagueId, scope);
}
