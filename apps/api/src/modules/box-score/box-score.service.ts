import sharp from "sharp";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonContext, resolveSeasonId } from "../league-context/season.service.js";
import { fetchImageBuffer, parseBoxScoreImages, type ParsedBoxScore, type ParsedScore } from "./box-score.parser.js";
import { syncUsersAfterBoxScoreApproval } from "../users/user-profile-stats.service.js";
import { syncCpuTeamsAfterBoxScoreApproval } from "../cpu-team-stats/cpu-team-stats.service.js";
import { rebuildOfficialRecordsAfterBoxScore } from "../official-records/official-records.service.js";
import { rebuildSeasonDisplayRecords } from "../display-records/display-records.service.js";
import { processGameIntelligence } from "../box-score-intelligence/persistence.js";
import { GLOBAL_BADGES, SEASON_BADGES, WEEKLY_BADGES } from "../box-score-intelligence/badge-rules.js";

const BOX_SCORE_WIN_PAYOUT = 100;
const BOX_SCORE_LOSS_PAYOUT = 50;
const BADGE_BONUS_PAYOUT = 10;

const BADGE_LABELS = new Map(
  [...WEEKLY_BADGES, ...SEASON_BADGES, ...GLOBAL_BADGES].map((badge) => [badge.key, badge.label] as const),
);

type BoxScorePaidPlayer = {
  userId: string;
  amount: number;
  discordId: string | null;
  displayName: string | null;
};

type BadgeBonusPaid = {
  userId: string;
  badgeKey: string;
  badgeLabel: string;
  amount: number;
};

// ─── Learned OCR label aliases (#2) ────────────────────────────────────────────
// Garbled labels that an approved parse mapped to a canonical key, so future
// parses hit them exactly instead of relying on fuzzy matching.

let aliasCache: { aliases: Record<string, string>; at: number } | null = null;
const ALIAS_TTL = 5 * 60 * 1000;

async function loadLabelAliases(): Promise<Record<string, string>> {
  if (aliasCache && Date.now() - aliasCache.at < ALIAS_TTL) return aliasCache.aliases;
  const { data, error } = await supabase.from("rec_ocr_label_aliases").select("raw_label,canonical_key");
  if (error) return aliasCache?.aliases ?? {};
  const aliases: Record<string, string> = {};
  for (const row of data ?? []) aliases[row.raw_label] = row.canonical_key;
  aliasCache = { aliases, at: Date.now() };
  return aliases;
}

// Promote a confirmed parse's fuzzy-matched labels into the alias table.
async function recordLabelAliases(samples: Record<string, string> | null | undefined) {
  if (!samples) return;
  const rows = Object.entries(samples)
    .filter(([, raw]) => typeof raw === "string" && raw.trim().length > 0)
    .map(([key, raw]) => ({ raw_label: raw, canonical_key: key }));
  if (!rows.length) return;
  await supabase.from("rec_ocr_label_aliases").upsert(rows, { onConflict: "raw_label" });
  aliasCache = null; // invalidate so the new aliases load on the next parse
}

// ─── Comeback computation ─────────────────────────────────────────────────────

type ComebackStats = {
  comebackDeficit: number | null;
  comebackDeficitQuarter: number | null;
  comebackRate: number | null;
  comebackWinnerTeamId: string | null;
  fourthQuarterComeback: boolean;
};

function computeComebackStats(
  team1Quarters: number[],
  team2Quarters: number[],
  team1Id: string | null,
  team2Id: string | null,
): ComebackStats {
  const none: ComebackStats = { comebackDeficit: null, comebackDeficitQuarter: null, comebackRate: null, comebackWinnerTeamId: null, fourthQuarterComeback: false };

  const quarters = Math.max(team1Quarters.length, team2Quarters.length);
  if (quarters === 0) return none;

  // Build cumulative scores after each quarter
  const cum1: number[] = [];
  const cum2: number[] = [];
  let s1 = 0, s2 = 0;
  for (let i = 0; i < quarters; i++) {
    s1 += team1Quarters[i] ?? 0;
    s2 += team2Quarters[i] ?? 0;
    cum1.push(s1);
    cum2.push(s2);
  }

  const final1 = cum1[cum1.length - 1] ?? 0;
  const final2 = cum2[cum2.length - 1] ?? 0;
  const team1Won = final1 > final2;
  const team2Won = final2 > final1;
  if (!team1Won && !team2Won) return none; // tie

  // Walk quarter breaks to find max deficit for the winner and 4Q comeback flag
  let maxDeficit = 0;
  let maxDeficitQuarter = 0;
  let fourthQuarterComeback = false;

  for (let i = 0; i < quarters; i++) {
    const q = i + 1;
    const deficit = team1Won ? cum2[i] - cum1[i] : cum1[i] - cum2[i];
    if (deficit > maxDeficit) {
      maxDeficit = deficit;
      maxDeficitQuarter = q;
    }
    // 4th quarter comeback: winner was trailing at end of Q3 (index 2)
    if (i === 2) {
      const trailingAfterQ3 = team1Won ? cum1[i] < cum2[i] : cum2[i] < cum1[i];
      if (trailingAfterQ3) fourthQuarterComeback = true;
    }
  }

  if (maxDeficit === 0) return { ...none, fourthQuarterComeback }; // winner was never behind

  // comeback_rate = deficit / quarters remaining when max deficit occurred
  // floors at 1 so OT/Q4 deficits don't divide by zero
  const quartersRemaining = Math.max(1, 4 - maxDeficitQuarter);
  const comebackRate = Math.round((maxDeficit / quartersRemaining) * 100) / 100;

  return {
    comebackDeficit: maxDeficit,
    comebackDeficitQuarter: maxDeficitQuarter,
    comebackRate,
    comebackWinnerTeamId: team1Won ? team1Id : team2Id,
    fourthQuarterComeback,
  };
}

// ─── Team + game matching ─────────────────────────────────────────────────────

async function resolveTeams(leagueId: string, abbr1: string, abbr2: string) {
  const { data: teams, error } = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,display_abbr")
    .eq("league_id", leagueId);
  if (error) throw new ApiError(500, "Failed to load league teams.", error);

  const levenshtein = (a: string, b: string): number => {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    }
    return dp[m][n];
  };

  const match = (abbr: string) => {
    const u = abbr.toUpperCase();
    const list = teams ?? [];
    const exact = list.find(
      (t) =>
        t.abbreviation?.toUpperCase() === u ||
        t.display_abbr?.toUpperCase() === u,
    );
    if (exact) return exact;

    let best: (typeof list)[number] | null = null;
    let bestDist = Infinity;
    for (const t of list) {
      for (const candidate of [t.abbreviation, t.display_abbr]) {
        if (!candidate) continue;
        const d = levenshtein(u, candidate.toUpperCase());
        if (d < bestDist) {
          bestDist = d;
          best = t;
        }
      }
    }
    return bestDist <= 2 ? best : null;
  };

  return { team1: match(abbr1) ?? null, team2: match(abbr2) ?? null };
}

async function resolveGame(leagueId: string, team1Id: string, team2Id: string, seasonId: string, weekNumber: number) {
  const { data, error } = await supabase
    .from("rec_games")
    .select("id,home_team_id,away_team_id,home_user_id,away_user_id")
    .eq("league_id", leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", weekNumber)
    .or(
      `and(home_team_id.eq.${team1Id},away_team_id.eq.${team2Id}),` +
      `and(home_team_id.eq.${team2Id},away_team_id.eq.${team1Id})`
    )
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to match game record.", error);
  return data ?? null;
}

// ─── User lookup ──────────────────────────────────────────────────────────────

async function getDiscordAccount(discordId: string, required = true) {
  const { data, error } = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", discordId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load Discord account.", error);
  if (!data?.user_id) {
    if (!required) return null;
    throw new ApiError(404, "Discord account is not linked to a REC user.");
  }
  return data;
}

// The team a user is actively assigned to in this league (for verifying a box
// score submitter is reporting their own game).
async function getActiveTeamId(leagueId: string, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load team assignment.", error);
  return data?.team_id ?? null;
}

async function userHasApprovedBoxScoreForWeek(
  leagueId: string,
  userId: string,
  seasonNumber: number,
  weekNumber: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("rec_box_score_submissions")
    .select("id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .eq("submitted_by_user_id", userId)
    .eq("status", "approved")
    .limit(1);
  if (error) throw new ApiError(500, "Failed to check box score payout status.", error);
  return (data ?? []).length > 0;
}

async function getUserScheduledGameForWeek(
  leagueId: string,
  teamId: string,
  seasonNumber: number,
  weekNumber: number,
) {
  const seasonId = await resolveSeasonId(leagueId, seasonNumber);
  const { data, error } = await supabase
    .from("rec_games")
    .select("id,home_team_id,away_team_id,home_user_id,away_user_id")
    .eq("league_id", leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", weekNumber)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load scheduled game.", error);
  return data ?? null;
}

export type BoxScoreUploadEligibility = {
  seasonNumber: number;
  weekNumber: number;
  hasApprovedForWeek: boolean;
  hasScheduledGame: boolean;
  teamId: string | null;
  gameId: string | null;
};

export async function getBoxScoreUploadEligibility(input: { guildId: string; discordId: string }): Promise<BoxScoreUploadEligibility> {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId, true);
  const { seasonNumber, weekNumber } = selectedSeasonWeek(context);
  const leagueId = context.leagueId;
  const teamId = await getActiveTeamId(leagueId, account!.user_id);
  const hasApprovedForWeek = await userHasApprovedBoxScoreForWeek(leagueId, account!.user_id, seasonNumber, weekNumber);
  const game = teamId ? await getUserScheduledGameForWeek(leagueId, teamId, seasonNumber, weekNumber) : null;

  return {
    seasonNumber,
    weekNumber,
    hasApprovedForWeek,
    hasScheduledGame: !!game,
    teamId,
    gameId: game?.id ?? null,
  };
}

// Helpers for the per-team stats table.
function toInt(value: string | null | undefined): number | null {
  const digits = (value ?? "").replace(/[^0-9-]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return isNaN(n) ? null : n;
}

// ─── Screenshot persistence ────────────────────────────────────────────────────
// The Discord CDN URL dies once the source message is deleted, so re-host the
// screenshot in a public Storage bucket and keep its stable URL on the submission
// for the pending-payout / inbox embeds to reference.
const BOX_SCORE_IMAGE_BUCKET = "box-scores";

// Re-host a Discord screenshot to the public bucket and return its stable URL.
// Generic so the schedule/weekly-scores flow can reuse it (key becomes the object
// path). Non-fatal: returns null on any failure, callers fall back to the CDN URL.
export async function persistUploadImage(key: string, imageUrl: string): Promise<string | null> {
  try {
    const buffer = await fetchImageBuffer(imageUrl);
    const ext = (/\.(jpe?g|webp|png)/i.exec(imageUrl)?.[1] ?? "png").toLowerCase();
    const normalizedExt = ext === "jpg" ? "jpeg" : ext;
    const contentType = normalizedExt === "jpeg" ? "image/jpeg" : normalizedExt === "webp" ? "image/webp" : "image/png";
    const path = `${key}.${normalizedExt}`;
    const { error } = await supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).upload(path, buffer, { contentType, upsert: true });
    if (error) {
      console.error("[WARN] Failed to upload screenshot to storage (non-fatal):", error);
      return null;
    }
    const { data } = supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (err) {
    console.error("[WARN] Failed to re-host screenshot (non-fatal):", err);
    return null;
  }
}

// Re-host one or more screenshots as a SINGLE image (stacked vertically) so an embed
// — which only renders one image — can show every uploaded shot. Falls back to
// re-hosting the first image, then to its CDN URL, on any failure.
export async function persistStitchedUploadImage(key: string, imageUrls: string[]): Promise<string | null> {
  const urls = imageUrls.filter(Boolean);
  if (urls.length <= 1) return persistUploadImage(key, urls[0] ?? "");
  try {
    const buffers = await Promise.all(urls.map(fetchImageBuffer));
    const width = Math.max(...(await Promise.all(buffers.map(async (b) => (await sharp(b).metadata()).width ?? 0))));
    const tiles = await Promise.all(buffers.map((b) => sharp(b).resize({ width, fit: "inside" }).png().toBuffer()));
    const heights = await Promise.all(tiles.map(async (t) => (await sharp(t).metadata()).height ?? 0));
    const totalHeight = heights.reduce((s, h) => s + h, 0);
    let top = 0;
    const composite = tiles.map((input, i) => {
      const layer = { input, top, left: 0 };
      top += heights[i];
      return layer;
    });
    const stitched = await sharp({ create: { width, height: totalHeight, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite(composite)
      .png()
      .toBuffer();
    const path = `${key}.png`;
    const { error } = await supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).upload(path, stitched, { contentType: "image/png", upsert: true });
    if (error) {
      console.error("[WARN] Failed to upload stitched screenshot (non-fatal):", error);
      return persistUploadImage(key, urls[0]);
    }
    const { data } = supabase.storage.from(BOX_SCORE_IMAGE_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? (await persistUploadImage(key, urls[0]));
  } catch (err) {
    console.error("[WARN] Failed to stitch screenshots (non-fatal):", err);
    return persistUploadImage(key, urls[0]);
  }
}

// Stat fields a commissioner can correct (mirrors the embed's preferred order).
const CORRECTABLE_STAT_KEYS = [
  "off_yards_gained",
  "off_rush_yards",
  "off_pass_yards",
  "off_first_down",
  "punt_return_yards",
  "kick_return_yards",
  "total_yards_gained",
  "turnovers",
  "third_down_conversions",
  "fourth_down_conversions",
  "two_point_conversions",
  "red_zone_off_percentage",
] as const;
const CORRECTABLE_STAT_KEY_SET = new Set<string>(CORRECTABLE_STAT_KEYS);

// Reshape a stored submission row into the payload the payout-review embed expects
// (same shape as CreateSubmissionResult). Used by the correction flow so a patched
// row re-renders identically to a fresh submission.
function shapeSubmissionForEmbed(sub: any): CreateSubmissionResult {
  const team1IsHome = !!(sub.team1_id && sub.home_team_id && sub.home_team_id === sub.team1_id);
  const team1Score = team1IsHome ? sub.home_score : sub.away_score;
  const team2Score = team1IsHome ? sub.away_score : sub.home_score;
  return {
    submissionId: sub.id,
    team1Abbr: sub.team1_abbr ?? null,
    team2Abbr: sub.team2_abbr ?? null,
    team1Name: null,
    team2Name: null,
    team1Score: team1Score ?? null,
    team2Score: team2Score ?? null,
    homeScore: sub.home_score ?? null,
    awayScore: sub.away_score ?? null,
    weekNumber: sub.week_number,
    gameMatched: !!sub.game_id,
    warnings: (sub.parse_warnings as string[] | null) ?? [],
    stats: (sub.team_stats as Record<string, { team1: string; team2: string }>) ?? {},
    quarterScores: (sub.quarter_scores as { team1: number[]; team2: number[] } | null) ?? null,
    submittedByDiscordId: sub.submitted_by_discord_id,
    flagged: !!sub.flagged,
    flagReasons: (sub.flag_reasons as string[] | null) ?? [],
    imageUrl: sub.image_storage_url ?? null,
  };
}

// ─── Shared game/team resolution from a parsed box score ───────────────────────

type ResolvedGame = {
  team1Name: string | null;
  team2Name: string | null;
  team1Abbr: string | null;
  team2Abbr: string | null;
  team1Id: string | null;
  team2Id: string | null;
  gameId: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeUserId: string | null;
  awayUserId: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

function selectedSeasonWeek(context: any, requested?: { seasonNumber?: number | null; weekNumber?: number | null }) {
  const currentSeason = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const seasonNumber = Number(requested?.seasonNumber ?? currentSeason);
  const weekNumber = Number(requested?.weekNumber ?? currentWeek);

  if (!Number.isInteger(seasonNumber) || seasonNumber < 1) throw new ApiError(400, "Invalid season number.");
  if (!Number.isInteger(weekNumber) || weekNumber < 1) throw new ApiError(400, "Invalid week number.");
  if (seasonNumber === currentSeason && weekNumber > currentWeek) {
    throw new ApiError(400, `Week ${weekNumber} has not been reached yet.`);
  }

  return { seasonNumber, weekNumber };
}

function abbrEditDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

// Sanity check for self-serve uploads: confirm the OCR scoreboard abbreviations
// correspond to the scheduled matchup. Tolerant of one misread side (relocated
// teams / stylized fonts) — true if at least one scheduled team is recognizable.
async function boxScoreAbbrsMatchScheduledGame(
  leagueId: string,
  gameId: string,
  abbr1: string,
  abbr2: string,
): Promise<boolean> {
  const { data: game, error } = await supabase
    .from("rec_games")
    .select("home_team:rec_teams!rec_games_home_team_id_fkey(abbreviation,display_abbr,original_abbreviation),away_team:rec_teams!rec_games_away_team_id_fkey(abbreviation,display_abbr,original_abbreviation)")
    .eq("league_id", leagueId)
    .eq("id", gameId)
    .maybeSingle();
  if (error || !game) return true; // can't verify → don't block the submitter

  const ocr = [abbr1, abbr2].map((a) => (a ?? "").toUpperCase().replace(/[^A-Z]/g, "")).filter(Boolean);
  if (!ocr.length) return true;

  const candidates = (t: any) =>
    [t?.abbreviation, t?.display_abbr, t?.original_abbreviation]
      .filter(Boolean)
      .map((s: string) => s.toUpperCase());
  const recognizable = (t: any) =>
    ocr.some((o) => candidates(t).some((c) => c === o || abbrEditDistance(o, c) <= 1));

  return recognizable((game as any).away_team) || recognizable((game as any).home_team);
}

// The user currently linked to each given team (active assignment), keyed by
// team id. rec_games.home_user_id/away_user_id are frequently null or stale, so
// the active assignment is the source of truth for who gets paid and recorded.
async function activeUsersForTeams(leagueId: string, teamIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(teamIds.filter((t): t is string => !!t))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from("rec_team_assignments")
    .select("team_id,user_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .in("team_id", ids);
  if (error) throw new ApiError(500, "Failed to load team assignments for payout routing.", error);
  const map = new Map<string, string>();
  for (const r of data ?? []) if (r.team_id && r.user_id) map.set(r.team_id, r.user_id);
  return map;
}

async function resolveGameContext(
  leagueId: string,
  seasonNumber: number,
  weekNumber: number,
  parsed: ParsedBoxScore,
  expectedGameId: string | null = null,
): Promise<ResolvedGame> {
  const empty: ResolvedGame = {
    team1Name: null, team2Name: null, team1Abbr: null, team2Abbr: null, team1Id: null, team2Id: null, gameId: null,
    homeTeamId: null, awayTeamId: null, homeUserId: null, awayUserId: null, homeScore: null, awayScore: null,
  };

  // Commissioner flow: a specific scheduled game was pre-selected, so it's
  // authoritative. The OCR scoreboard (esp. relocated teams in a stylized font)
  // is only used to orient which column is home vs away — never to reject.
  if (expectedGameId) {
    const { data: game, error } = await supabase
      .from("rec_games")
      .select("id,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr)")
      .eq("league_id", leagueId)
      .eq("id", expectedGameId)
      .maybeSingle();
    if (error) throw new ApiError(500, "Failed to load the selected scheduled game.", error);
    if (game) {
      // Box score invariant: the top/left column is always the away team and the
      // bottom/right column is always the home team. The parser reads the top/left
      // column as team1 and the bottom/right as team2, so team1 = away, team2 = home.
      const home: any = game.home_team;
      const away: any = game.away_team;
      const users = await activeUsersForTeams(leagueId, [game.home_team_id, game.away_team_id]);
      return {
        team1Name: away?.name ?? null,
        team2Name: home?.name ?? null,
        team1Abbr: away?.display_abbr ?? away?.abbreviation ?? null,
        team2Abbr: home?.display_abbr ?? home?.abbreviation ?? null,
        team1Id: game.away_team_id,
        team2Id: game.home_team_id,
        gameId: game.id,
        homeTeamId: game.home_team_id,
        awayTeamId: game.away_team_id,
        homeUserId: users.get(game.home_team_id) ?? game.home_user_id ?? null,
        awayUserId: users.get(game.away_team_id) ?? game.away_user_id ?? null,
        homeScore: parsed.score?.team2Score ?? null,
        awayScore: parsed.score?.team1Score ?? null,
      };
    }
    // Selected game vanished — fall through to OCR derivation below.
  }

  if (!parsed.score) return empty;

  const { team1, team2 } = await resolveTeams(leagueId, parsed.score.team1Abbr, parsed.score.team2Abbr);
  const out: ResolvedGame = {
    ...empty,
    team1Name: team1?.name ?? null,
    team2Name: team2?.name ?? null,
    team1Abbr: team1?.display_abbr ?? team1?.abbreviation ?? null,
    team2Abbr: team2?.display_abbr ?? team2?.abbreviation ?? null,
    team1Id: team1?.id ?? null,
    team2Id: team2?.id ?? null,
  };
  if (!team1 || !team2) return out;

  const seasonId = await resolveSeasonId(leagueId, seasonNumber);
  const game = await resolveGame(leagueId, team1.id, team2.id, seasonId, weekNumber);
  if (!game) return out;

  const users = await activeUsersForTeams(leagueId, [game.home_team_id, game.away_team_id]);
  out.gameId = game.id;
  out.homeUserId = users.get(game.home_team_id) ?? game.home_user_id ?? null;
  out.awayUserId = users.get(game.away_team_id) ?? game.away_user_id ?? null;
  if (game.home_team_id === team1.id) {
    out.homeTeamId = team1.id;
    out.awayTeamId = team2.id;
    out.homeScore = parsed.score.team1Score;
    out.awayScore = parsed.score.team2Score;
  } else {
    out.homeTeamId = team2.id;
    out.awayTeamId = team1.id;
    out.homeScore = parsed.score.team2Score;
    out.awayScore = parsed.score.team1Score;
  }
  return out;
}

// ─── Parse preview (stateless — no DB write) ───────────────────────────────────

export type PreviewInput = { guildId: string; discordId: string; imageUrls: string[]; seasonNumber?: number | null; weekNumber?: number | null; commissionerSubmission?: boolean | null };
export type PreviewResult = {
  parsed: ParsedBoxScore;
  missingRequired: string[];
  complete: boolean;
  team1Name: string | null;
  team2Name: string | null;
  team1Abbr: string | null;
  team2Abbr: string | null;
  gameMatched: boolean;
};

export async function parseBoxScorePreview(input: PreviewInput): Promise<PreviewResult> {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId, !input.commissionerSubmission);
  const { seasonNumber, weekNumber } = selectedSeasonWeek(context, input);

  // Self-serve preview anchors on the submitter's scheduled game (same as submit),
  // so the matched teams shown to the user don't depend on OCR reading both abbrs.
  // A self-serve user can only upload their OWN scheduled game.
  let anchorGameId: string | null = null;
  if (!input.commissionerSubmission && account?.user_id) {
    const teamId = await getActiveTeamId(context.leagueId, account.user_id);
    if (!teamId) throw new ApiError(400, "You aren't linked to a team in this league, so you can't upload a box score here.");
    const game = await getUserScheduledGameForWeek(context.leagueId, teamId, seasonNumber, weekNumber);
    if (!game) throw new ApiError(400, `You don't have a scheduled game in Week ${weekNumber}.`);
    anchorGameId = game.id;
  }

  const parsed = await parseBoxScoreImages(input.imageUrls, await loadLabelAliases());
  const resolved = await resolveGameContext(context.leagueId, seasonNumber, weekNumber, parsed, anchorGameId);

  // Reject a self-serve upload that isn't the submitter's own scheduled matchup.
  if (!input.commissionerSubmission && anchorGameId && parsed.score) {
    const looksRight = await boxScoreAbbrsMatchScheduledGame(context.leagueId, anchorGameId, parsed.score.team1Abbr, parsed.score.team2Abbr);
    if (!looksRight) {
      throw new ApiError(400, `This box score isn't your Week ${weekNumber} matchup. You can only upload your own scheduled game in this channel.`);
    }
  }

  return {
    parsed,
    missingRequired: parsed.missingRequired,
    complete: parsed.missingRequired.length === 0,
    team1Name: resolved.team1Name,
    team2Name: resolved.team2Name,
    team1Abbr: resolved.team1Abbr ?? parsed.score?.team1Abbr ?? null,
    team2Abbr: resolved.team2Abbr ?? parsed.score?.team2Abbr ?? null,
    gameMatched: !!resolved.gameId,
  };
}

// ─── Create submission (persists as pending + commissioner inbox) ──────────────

export type CreateSubmissionInput = {
  guildId: string;
  discordId: string;
  imageUrls: string[];
  discordChannelId?: string | null;
  discordMessageId?: string | null;
  ledgerDiscordMessageId?: string | null;
  seasonNumber?: number | null;
  weekNumber?: number | null;
  expectedGameId?: string | null;
  commissionerSubmission?: boolean | null;
};

export type CreateSubmissionResult = {
  submissionId: string;
  team1Abbr: string | null;
  team2Abbr: string | null;
  team1Name: string | null;
  team2Name: string | null;
  team1Score: number | null;
  team2Score: number | null;
  homeScore: number | null;
  awayScore: number | null;
  weekNumber: number;
  gameMatched: boolean;
  warnings: string[];
  stats: Record<string, { team1: string; team2: string }>;
  quarterScores: { team1: number[]; team2: number[] } | null;
  submittedByDiscordId: string;
  flagged: boolean;
  flagReasons: string[];
  imageUrl: string | null;
};

export async function createBoxScoreSubmission(input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId, !input.commissionerSubmission);
  const leagueId = context.leagueId;
  const { seasonNumber, weekNumber } = selectedSeasonWeek(context, input);
  const phase = context.rec_leagues.season_stage ?? null;

  // Self-serve: anchor resolution on the submitter's scheduled game for the week,
  // so routing never depends on OCR reading both team abbreviations correctly.
  let selfServeGameId: string | null = null;
  if (!input.commissionerSubmission && account?.user_id) {
    if (await userHasApprovedBoxScoreForWeek(leagueId, account.user_id, seasonNumber, weekNumber)) {
      throw new ApiError(409, "You already have an approved box score payout for this game week.");
    }
    const teamId = await getActiveTeamId(leagueId, account.user_id);
    if (!teamId) {
      throw new ApiError(400, "You aren't linked to a team in this league.");
    }
    const scheduledGame = await getUserScheduledGameForWeek(leagueId, teamId, seasonNumber, weekNumber);
    if (!scheduledGame) {
      throw new ApiError(400, `You don't have a scheduled game in Week ${weekNumber}.`);
    }
    selfServeGameId = scheduledGame.id;
  }

  const parsed = await parseBoxScoreImages(input.imageUrls, await loadLabelAliases());

  // Game resolution priority: the commissioner's pre-selected game, otherwise the
  // submitter's scheduled game. Either way the game is authoritative and the OCR
  // scoreboard only orients home/away (top/left = away) — a relocated team or a
  // misread abbreviation can't misroute it.
  const effectiveGameId = input.expectedGameId ?? selfServeGameId;
  const resolved = await resolveGameContext(leagueId, seasonNumber, weekNumber, parsed, effectiveGameId);
  if (resolved.gameId) await clearStalePendingForGame(resolved.gameId);

  // Display the resolved league team's abbreviation (authoritative), falling back
  // to the raw OCR scoreboard only when the game couldn't be resolved.
  const displayTeam1Abbr = resolved.team1Abbr ?? parsed.score?.team1Abbr ?? null;
  const displayTeam2Abbr = resolved.team2Abbr ?? parsed.score?.team2Abbr ?? null;

  const flagReasons: string[] = [];
  if (!resolved.gameId) {
    flagReasons.push(`No scheduled game was found for Week ${weekNumber}.`);
  }
  // Self-serve: reject a box score that isn't the submitter's own scheduled
  // matchup (they may only upload their own game). Commissioner uploads are exempt.
  if (!input.commissionerSubmission && resolved.gameId && parsed.score) {
    const looksRight = await boxScoreAbbrsMatchScheduledGame(
      leagueId, resolved.gameId, parsed.score.team1Abbr, parsed.score.team2Abbr,
    );
    if (!looksRight) {
      throw new ApiError(400, `This box score isn't your Week ${weekNumber} matchup. You can only upload your own scheduled game in this channel.`);
    }
  }
  const flagged = flagReasons.length > 0;

  const comeback = parsed.score
    ? computeComebackStats(parsed.score.team1Quarters, parsed.score.team2Quarters, resolved.team1Id, resolved.team2Id)
    : { comebackDeficit: null, comebackDeficitQuarter: null, comebackRate: null, comebackWinnerTeamId: null, fourthQuarterComeback: false };

  const quarterScores = parsed.score
    ? { team1: parsed.score.team1Quarters, team2: parsed.score.team2Quarters }
    : null;

  const { data: submission, error } = await supabase
    .from("rec_box_score_submissions")
    .insert({
      league_id: leagueId,
      season_number: seasonNumber,
      week_number: weekNumber,
      phase,
      submitted_by_discord_id: input.discordId,
      submitted_by_user_id: account?.user_id ?? null,
      discord_guild_id: input.guildId,
      discord_channel_id: input.discordChannelId ?? null,
      discord_message_id: input.discordMessageId ?? null,
      ledger_discord_message_id: input.ledgerDiscordMessageId ?? null,
      image_urls: input.imageUrls,
      team1_abbr: displayTeam1Abbr,
      team2_abbr: displayTeam2Abbr,
      team1_id: resolved.team1Id,
      team2_id: resolved.team2Id,
      flagged,
      flag_reasons: flagReasons,
      home_team_id: resolved.homeTeamId,
      away_team_id: resolved.awayTeamId,
      home_user_id: resolved.homeUserId,
      away_user_id: resolved.awayUserId,
      home_score: resolved.homeScore,
      away_score: resolved.awayScore,
      quarter_scores: quarterScores,
      team_stats: parsed.stats,
      game_id: resolved.gameId,
      parse_warnings: parsed.warnings,
      parse_label_samples: parsed.labelSamples,
      comeback_deficit: comeback.comebackDeficit,
      comeback_deficit_quarter: comeback.comebackDeficitQuarter,
      comeback_rate: comeback.comebackRate,
      comeback_winner_team_id: comeback.comebackWinnerTeamId,
      fourth_quarter_comeback: comeback.fourthQuarterComeback,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !submission) {
    if (error?.code === "23505") {
      throw new ApiError(409, "A box score payout review is already pending or approved for this scheduled game.", error);
    }
    throw new ApiError(500, "Failed to save box score submission.", error);
  }

  // Re-host the screenshot so the payout embeds keep it after the source Discord
  // message is deleted. Non-fatal — fall back to the (soon-expiring) Discord URL.
  const firstImage = input.imageUrls[0] ?? null;
  let imageStorageUrl: string | null = null;
  if (firstImage) {
    imageStorageUrl = await persistUploadImage(submission.id, firstImage);
    if (imageStorageUrl) {
      await supabase
        .from("rec_box_score_submissions")
        .update({ image_storage_url: imageStorageUrl })
        .eq("id", submission.id);
    }
  }

  const matchSuffix = resolved.homeTeamId ? "" : " (unmatched)";
  const header = `Box Score: ${displayTeam1Abbr ?? "?"} vs ${displayTeam2Abbr ?? "?"} — Wk ${weekNumber}${matchSuffix}`;

  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: leagueId,
    season_number: seasonNumber,
    week_number: weekNumber,
    queue_type: "box_score",
    status: "pending",
    priority: 0,
    header,
    summary: `${resolved.homeScore ?? "?"} – ${resolved.awayScore ?? "?"} final score. Submitted by <@${input.discordId}>.`,
    requester_discord_id: input.discordId,
    requester_user_id: account?.user_id ?? null,
    source_table: "rec_box_score_submissions",
    source_id: submission.id,
    payload: {
      submissionId: submission.id,
      team1Abbr: displayTeam1Abbr,
      team2Abbr: displayTeam2Abbr,
      homeScore: resolved.homeScore,
      awayScore: resolved.awayScore,
      commissionerSubmission: !!input.commissionerSubmission,
    },
  });

  return {
    submissionId: submission.id,
    team1Abbr: displayTeam1Abbr,
    team2Abbr: displayTeam2Abbr,
    team1Name: resolved.team1Name,
    team2Name: resolved.team2Name,
    team1Score: parsed.score?.team1Score ?? null,
    team2Score: parsed.score?.team2Score ?? null,
    homeScore: resolved.homeScore,
    awayScore: resolved.awayScore,
    weekNumber,
    gameMatched: !!resolved.gameId,
    warnings: parsed.warnings,
    stats: parsed.stats,
    quarterScores,
    submittedByDiscordId: input.discordId,
    flagged,
    flagReasons,
    imageUrl: imageStorageUrl ?? firstImage,
  };
}

export async function updateBoxScoreLedgerMessage(submissionId: string, ledgerDiscordMessageId: string) {
  const { data, error } = await supabase
    .from("rec_box_score_submissions")
    .update({ ledger_discord_message_id: ledgerDiscordMessageId, updated_at: new Date().toISOString() })
    .eq("id", submissionId)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to store box score ledger message id.", error);
  if (!data) throw new ApiError(404, "Submission not found.");
  return { ok: true };
}

// ─── Commissioner review ──────────────────────────────────────────────────────

function badgeBonusIdempotencyKey(event: {
  league_id: string;
  season: number;
  week: number;
  game_id: string | null;
  user_id: string;
  badge_key: string;
}, submissionId: string) {
  const gameRef = event.game_id ?? `submission:${submissionId}`;
  return `badge_bonus:${event.league_id}:${event.season}:${event.week}:${gameRef}:${event.user_id}:${event.badge_key}`;
}

async function issueBadgeBonusesForSubmission(sub: {
  id: string;
  league_id: string;
  season_number: number;
  week_number: number;
  game_id: string | null;
}): Promise<BadgeBonusPaid[]> {
  const query = supabase
    .from("rec_badge_events")
    .select("id,league_id,user_id,badge_key,badge_scope,tier,season,week,game_id")
    .eq("league_id", sub.league_id)
    .eq("season", sub.season_number)
    .eq("week", sub.week_number)
    .not("user_id", "is", null);

  if (sub.game_id) query.eq("game_id", sub.game_id);
  else query.is("game_id", null);

  const { data, error } = await query;
  if (error) throw new ApiError(500, "Failed to load earned badge bonuses.", error);

  const paid: BadgeBonusPaid[] = [];
  for (const event of data ?? []) {
    if (!event.user_id) continue;
    const badgeLabel = BADGE_LABELS.get(event.badge_key) ?? event.badge_key;
    await supabase.rpc("add_to_wallet", {
      p_user_id: event.user_id,
      p_amount: BADGE_BONUS_PAYOUT,
      p_league_id: sub.league_id,
      p_description: `Badge bonus: ${badgeLabel} - Wk ${sub.week_number}`,
      p_transaction_type: "badge_bonus",
      p_source: "box_score",
      p_source_reference: {
        idempotencyKey: badgeBonusIdempotencyKey(
          {
            league_id: event.league_id,
            season: event.season,
            week: event.week,
            game_id: event.game_id,
            user_id: event.user_id,
            badge_key: event.badge_key,
          },
          sub.id,
        ),
      },
    }).throwOnError();
    paid.push({ userId: event.user_id, badgeKey: event.badge_key, badgeLabel, amount: BADGE_BONUS_PAYOUT });
  }

  return paid;
}

export type ReviewBoxScoreInput = {
  submissionId: string;
  action: "approve" | "deny";
  reviewedByDiscordId: string;
  deniedReason?: string | null;
};

export async function reviewBoxScore(input: ReviewBoxScoreInput) {
  const { data: sub, error: fetchErr } = await supabase
    .from("rec_box_score_submissions")
    .select("*")
    .eq("id", input.submissionId)
    .eq("status", "pending")
    .maybeSingle();

  if (fetchErr) throw new ApiError(500, "Failed to load submission.", fetchErr);
  if (!sub) throw new ApiError(404, "Pending submission not found.");

  if (input.action === "deny") {
    await supabase
      .from("rec_box_score_submissions")
      .update({
        status: "denied",
        reviewed_by_discord_id: input.reviewedByDiscordId,
        reviewed_at: new Date().toISOString(),
        denied_reason: input.deniedReason ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.submissionId);

    await supabase
      .from("rec_commissioners_inbox")
      .update({ status: "denied", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: new Date().toISOString(), review_reason: input.deniedReason ?? null })
      .eq("source_table", "rec_box_score_submissions")
      .eq("source_id", input.submissionId);

    return { ok: true, action: "denied" as const };
  }

  // Approve: record game result + issue payouts.
  // Correction contract: payouts and badges are computed HERE, at approval, from
  // the freshly-loaded `sub` — never at submission time. A commissioner's pending
  // corrections (score/matchup → winner & routing; stats → badges) are already
  // patched into this row, so the payout and badge computation below reflect them.
  // Do not move payout/badge issuance earlier (e.g. into createBoxScoreSubmission)
  // or corrections would stop affecting them.
  const now = new Date().toISOString();
  if (sub.game_id) await assertNoExistingBoxScorePayout(sub.game_id, sub.id);

  // Winner (null on a tie or an unscored game).
  const winningUserId: string | null =
    sub.home_score != null && sub.away_score != null && sub.home_score !== sub.away_score
      ? (sub.home_score > sub.away_score ? sub.home_user_id : sub.away_user_id)
      : null;

  // Write game result if we have matched teams and scores
  if (sub.home_team_id && sub.away_team_id && sub.home_score != null && sub.away_score != null) {
    const isTie = sub.home_score === sub.away_score;
    const losingUserId = isTie
      ? null
      : (sub.home_score > sub.away_score ? sub.away_user_id : sub.home_user_id);
    const recordsApplyKey = sub.game_id
      ? `boxscore:game:${sub.game_id}`
      : `boxscore:${sub.league_id}:${sub.season_number}:${sub.week_number}:${sub.home_team_id}:${sub.away_team_id}`;

    const { error: resultError } = await supabase.from("rec_game_results").upsert(
      {
        league_id: sub.league_id,
        season_number: sub.season_number,
        week_number: sub.week_number,
        game_type: sub.phase ?? "regular_season",
        home_team_id: sub.home_team_id,
        away_team_id: sub.away_team_id,
        home_user_id: sub.home_user_id,
        away_user_id: sub.away_user_id,
        home_score: sub.home_score,
        away_score: sub.away_score,
        winning_user_id: winningUserId,
        losing_user_id: losingUserId,
        winning_team_id: isTie ? null : (sub.home_score > sub.away_score ? sub.home_team_id : sub.away_team_id),
        losing_team_id: isTie ? null : (sub.home_score > sub.away_score ? sub.away_team_id : sub.home_team_id),
        is_user_h2h: Boolean(sub.home_user_id && sub.away_user_id),
        is_cpu_game: !(sub.home_user_id && sub.away_user_id),
        is_tie: isTie,
        is_playoff: Number(sub.week_number ?? 0) > 18,
        is_super_bowl: Number(sub.week_number ?? 0) >= 22,
        source: "box_score_screenshot",
        records_apply_key: recordsApplyKey,
        created_at: now,
        updated_at: now,
      },
      { onConflict: "records_apply_key", ignoreDuplicates: false },
    );
    if (resultError) throw new ApiError(500, "Failed to record box score game result.", resultError);
  }

  await syncUsersAfterBoxScoreApproval(sub);

  // Record flat per-team-per-game stats (two rows, offense + generated/allowed)
  // before rebuilding stat rollups.
  await recordTeamGameStats(sub);
  await syncCpuTeamsAfterBoxScoreApproval(sub).catch((error) => {
    console.error("[ERROR] Failed to sync CPU team season stats after box score approval:", error);
  });

  // Import-time badge + story computation (blueprint): qualify badges, recompute
  // streak/season/global progress, and generate the game story. Non-fatal — a
  // failure here must never block the payout/approval. Advance only reads these.
  await processGameIntelligence(sub).catch((error) => {
    console.error("[ERROR] Failed to compute box score intelligence (badges/story):", error);
  });
  const badgeBonuses = await issueBadgeBonusesForSubmission(sub);

  // Issue payouts only to linked-user participants (winner $100, loser $50). A
  // CPU-vs-CPU game — no linked user on either team — is still recorded but pays
  // no one (the commissioner who uploaded it is never paid).
  const payouts: { userId: string; amount: number }[] = [];
  if (sub.home_team_id && sub.away_team_id) {
    for (const uid of [sub.home_user_id, sub.away_user_id] as (string | null)[]) {
      if (!uid) continue;
      const amount = winningUserId == null ? BOX_SCORE_LOSS_PAYOUT : (uid === winningUserId ? BOX_SCORE_WIN_PAYOUT : BOX_SCORE_LOSS_PAYOUT);
      payouts.push({ userId: uid, amount });
    }
  }

  let totalPaid = 0;
  for (const p of payouts) {
    await supabase.rpc("add_to_wallet", {
      p_user_id: p.userId,
      p_amount: p.amount,
      p_league_id: sub.league_id,
      p_description: `Box score payout ($${p.amount}) — Wk ${sub.week_number}`,
      p_transaction_type: "box_score_payout",
      p_source: "box_score",
      p_source_reference: { submissionId: sub.id },
    }).throwOnError();
    totalPaid += p.amount;
  }
  for (const bonus of badgeBonuses) totalPaid += bonus.amount;

  if (sub.league_id && sub.season_number) {
    await rebuildOfficialRecordsAfterBoxScore({
      leagueId: sub.league_id,
      seasonNumber: sub.season_number,
      homeUserId: sub.home_user_id,
      awayUserId: sub.away_user_id,
    }).catch((error) => {
      console.error("[ERROR] Failed to rebuild official user records after box score approval:", error);
    });
    // Team Record (display) reflects every season game regardless of source, so
    // rebuild it on approval too — not only on advance.
    await rebuildSeasonDisplayRecords(sub.league_id, sub.season_number).catch((error) => {
      console.error("[ERROR] Failed to rebuild display records after box score approval:", error);
    });
  }

  const submissionUpdate = await supabase
    .from("rec_box_score_submissions")
    .update({
      status: "approved",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      reviewed_at: now,
      payout_issued: true,
      updated_at: now,
    })
    .eq("id", input.submissionId);
  if (submissionUpdate.error) throw new ApiError(500, "Failed to mark box score submission approved.", submissionUpdate.error);

  const inboxUpdate = await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "approved", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: now })
    .eq("source_table", "rec_box_score_submissions")
    .eq("source_id", input.submissionId);
  if (inboxUpdate.error) throw new ApiError(500, "Failed to update box score commissioner inbox item.", inboxUpdate.error);

  // Approval confirms the parse — promote any fuzzy-matched labels to aliases.
  await recordLabelAliases(sub.parse_label_samples as Record<string, string> | null);

  const paidPlayers = await getBoxScorePaidPlayers(payouts);

  return {
    ok: true,
    action: "approved" as const,
    totalPaid,
    paidPlayers,
    badgeBonuses,
    badgeBonusPaid: badgeBonuses.reduce((sum, bonus) => sum + bonus.amount, 0),
    badgeBonusCount: badgeBonuses.length,
    playersPaid: payouts.length,
    playersPayd: payouts.length,
    sourceChannelId: sub.discord_channel_id ?? null,
    sourceMessageId: sub.discord_message_id ?? null,
    ledgerChannelId: sub.discord_channel_id ?? null,
    ledgerMessageId: sub.ledger_discord_message_id ?? null,
  };
}

// ─── Commissioner corrections (patch a pending submission before approval) ─────

export type CorrectBoxScoreInput = {
  submissionId: string;
  reviewedByDiscordId: string;
  field: string; // a stat key, or "score" | "quarters" | "matchup"
  team1?: string | null;
  team2?: string | null;
  gameId?: string | null;
};

function correctionScoreInt(raw: string | null | undefined): number | null {
  const digits = (raw ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return isNaN(n) ? null : n;
}

function correctionQuarterList(raw: string | null | undefined): number[] {
  return (raw ?? "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n));
}

function correctionStatValue(field: string, raw: string | null | undefined): string {
  const v = (raw ?? "").replace(/[^0-9]/g, "");
  if (!v) return "";
  if (field.includes("percentage")) {
    const n = parseInt(v, 10);
    return !isNaN(n) && n >= 0 && n <= 100 ? String(n) : "";
  }
  return String(parseInt(v, 10));
}

function comebackUpdate(comeback: ComebackStats) {
  return {
    comeback_deficit: comeback.comebackDeficit,
    comeback_deficit_quarter: comeback.comebackDeficitQuarter,
    comeback_rate: comeback.comebackRate,
    comeback_winner_team_id: comeback.comebackWinnerTeamId,
    fourth_quarter_comeback: comeback.fourthQuarterComeback,
  };
}

export async function correctBoxScoreSubmission(input: CorrectBoxScoreInput): Promise<CreateSubmissionResult> {
  const { data: sub, error } = await supabase
    .from("rec_box_score_submissions")
    .select("*")
    .eq("id", input.submissionId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load submission for correction.", error);
  if (!sub) throw new ApiError(404, "No pending box score submission to correct (it may already be approved or denied).");

  const update: Record<string, any> = { updated_at: new Date().toISOString() };

  if (input.field === "score") {
    const t1 = correctionScoreInt(input.team1);
    const t2 = correctionScoreInt(input.team2);
    // Map team1 (top/left = away) and team2 (bottom/right = home) onto home/away,
    // honoring the resolved team↔home orientation when the game is matched.
    const team1IsHome = !!(sub.team1_id && sub.home_team_id && sub.home_team_id === sub.team1_id);
    update.home_score = team1IsHome ? t1 : t2;
    update.away_score = team1IsHome ? t2 : t1;
  } else if (input.field === "quarters") {
    const q1 = correctionQuarterList(input.team1);
    const q2 = correctionQuarterList(input.team2);
    update.quarter_scores = { team1: q1, team2: q2 };
    Object.assign(update, comebackUpdate(computeComebackStats(q1, q2, sub.team1_id, sub.team2_id)));
    // Derive the final score from the corrected quarters automatically.
    if (q1.length > 0 || q2.length > 0) {
      const t1Total = q1.reduce((s, n) => s + n, 0);
      const t2Total = q2.reduce((s, n) => s + n, 0);
      const team1IsHome = !!(sub.team1_id && sub.home_team_id && sub.home_team_id === sub.team1_id);
      update.home_score = team1IsHome ? t1Total : t2Total;
      update.away_score = team1IsHome ? t2Total : t1Total;
    }
  } else if (input.field === "matchup") {
    if (!input.gameId) throw new ApiError(400, "Select a scheduled game to re-link this box score.");
    const shaped = shapeSubmissionForEmbed(sub);
    const quarters = (sub.quarter_scores as { team1: number[]; team2: number[] } | null) ?? { team1: [], team2: [] };
    const scoreLike: ParsedScore = {
      team1Abbr: sub.team1_abbr ?? "",
      team2Abbr: sub.team2_abbr ?? "",
      team1Score: shaped.team1Score ?? 0,
      team2Score: shaped.team2Score ?? 0,
      team1Quarters: quarters.team1 ?? [],
      team2Quarters: quarters.team2 ?? [],
    };
    const parsedLike: ParsedBoxScore = {
      score: scoreLike,
      stats: (sub.team_stats as Record<string, { team1: string; team2: string }>) ?? {},
      warnings: [],
      missingRequired: [],
      labelSamples: {},
    };
    const resolved = await resolveGameContext(sub.league_id, sub.season_number, sub.week_number, parsedLike, input.gameId);
    if (!resolved.gameId) throw new ApiError(400, "That scheduled game could not be loaded.");
    if (resolved.gameId !== sub.game_id) await clearStalePendingForGame(resolved.gameId);
    update.game_id = resolved.gameId;
    update.team1_id = resolved.team1Id;
    update.team2_id = resolved.team2Id;
    update.team1_abbr = resolved.team1Abbr ?? sub.team1_abbr;
    update.team2_abbr = resolved.team2Abbr ?? sub.team2_abbr;
    update.home_team_id = resolved.homeTeamId;
    update.away_team_id = resolved.awayTeamId;
    update.home_user_id = resolved.homeUserId;
    update.away_user_id = resolved.awayUserId;
    update.home_score = resolved.homeScore;
    update.away_score = resolved.awayScore;
    update.flagged = false;
    update.flag_reasons = [];
    Object.assign(
      update,
      comebackUpdate(computeComebackStats(scoreLike.team1Quarters, scoreLike.team2Quarters, resolved.team1Id, resolved.team2Id)),
    );
  } else if (CORRECTABLE_STAT_KEY_SET.has(input.field)) {
    const stats = { ...((sub.team_stats as Record<string, { team1: string; team2: string }>) ?? {}) };
    stats[input.field] = {
      team1: correctionStatValue(input.field, input.team1),
      team2: correctionStatValue(input.field, input.team2),
    };
    // Keep the defensive red-zone mirror consistent (def % = 100 − opponent off %).
    if (input.field === "red_zone_off_percentage") {
      const t1Off = parseInt(stats[input.field].team1, 10);
      const t2Off = parseInt(stats[input.field].team2, 10);
      stats["red_zone_def_percentage"] = {
        team1: isNaN(t2Off) ? "" : String(100 - t2Off),
        team2: isNaN(t1Off) ? "" : String(100 - t1Off),
      };
    }
    update.team_stats = stats;
  } else {
    throw new ApiError(400, `Unknown correction field: ${input.field}`);
  }

  const { error: updateError } = await supabase
    .from("rec_box_score_submissions")
    .update(update)
    .eq("id", sub.id)
    .eq("status", "pending");
  if (updateError) {
    if (updateError.code === "23505") {
      throw new ApiError(409, "Another box score payout is already pending or approved for that scheduled game.", updateError);
    }
    throw new ApiError(500, "Failed to apply box score correction.", updateError);
  }

  return shapeSubmissionForEmbed({ ...sub, ...update });
}

async function getBoxScorePaidPlayers(payouts: { userId: string; amount: number }[]): Promise<BoxScorePaidPlayer[]> {
  const uniqueUserIds = [...new Set(payouts.map((p) => p.userId))];
  if (uniqueUserIds.length === 0) return [];

  const { data, error } = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id,username,global_name")
    .in("user_id", uniqueUserIds);

  if (error) {
    console.error("[WARN] Failed to load paid player Discord accounts for box score approval:", error);
    return payouts.map((p) => ({ userId: p.userId, amount: p.amount, discordId: null, displayName: null }));
  }

  const accountByUserId = new Map((data ?? []).map((row) => [row.user_id, row]));
  return payouts.map((p) => {
    const account = accountByUserId.get(p.userId);
    return {
      userId: p.userId,
      amount: p.amount,
      discordId: account?.discord_id ?? null,
      displayName: account?.global_name ?? account?.username ?? null,
    };
  });
}

// On a fresh submission: an already-approved/paid review for this game is final
// (block). A still-pending review is stale once a new screenshot arrives (the
// commissioner is re-uploading, or a prior deny failed to land), so supersede it
// instead of trapping the resubmission behind a 409.
async function clearStalePendingForGame(gameId: string) {
  const { data, error } = await supabase
    .from("rec_box_score_submissions")
    .select("id,status,payout_issued")
    .eq("game_id", gameId)
    .in("status", ["pending", "approved"]);
  if (error) throw new ApiError(500, "Failed to check existing box score payouts.", error);
  const rows = data ?? [];
  if (rows.some((r) => r.status === "approved" || r.payout_issued)) {
    throw new ApiError(409, "A payout has already been issued for this scheduled game.");
  }
  const pendingIds = rows.filter((r) => r.status === "pending").map((r) => r.id);
  if (pendingIds.length === 0) return;

  const now = new Date().toISOString();
  await supabase
    .from("rec_box_score_submissions")
    .update({ status: "denied", reviewed_at: now, denied_reason: "Superseded by a newer submission for this game.", updated_at: now })
    .in("id", pendingIds);
  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "denied", reviewed_at: now, review_reason: "Superseded by a newer submission for this game." })
    .eq("source_table", "rec_box_score_submissions")
    .in("source_id", pendingIds);
}

async function assertNoExistingBoxScorePayout(gameId: string, currentSubmissionId: string | null) {
  let query = supabase
    .from("rec_box_score_submissions")
    .select("id,status,payout_issued")
    .eq("game_id", gameId)
    .in("status", ["pending", "approved"])
    .limit(1);
  if (currentSubmissionId) query = query.neq("id", currentSubmissionId);

  const { data, error } = await query;
  if (error) throw new ApiError(500, "Failed to check existing box score payouts.", error);
  const existing = (data ?? [])[0];
  if (!existing) return;
  if (existing.status === "approved" || existing.payout_issued) {
    throw new ApiError(409, "A payout has already been issued for this scheduled game.");
  }
  throw new ApiError(409, "A box score payout review is already pending for this scheduled game.");
}

// ─── Per-team game stats (flat, two rows per game) ─────────────────────────────

const STAT_KEY_TO_COLUMN: Record<string, string> = {
  off_yards_gained: "off_yards_gained",
  off_rush_yards: "off_rush_yards",
  off_pass_yards: "off_pass_yards",
  off_first_down: "off_first_down",
  punt_return_yards: "punt_return_yards",
  kick_return_yards: "kick_return_yards",
  total_yards_gained: "total_yards_gained",
  turnovers: "turnovers_committed",
  red_zone_off_percentage: "red_zone_off_percentage",
};

async function recordTeamGameStats(sub: any) {
  if (!sub.team1_id && !sub.team2_id) return; // nothing resolved to attribute stats to
  const stats = (sub.team_stats ?? {}) as Record<string, { team1: string; team2: string }>;
  const quarters = (sub.quarter_scores ?? null) as { team1: number[]; team2: number[] } | null;

  // Map OCR team1/team2 to home/away so scores and users line up.
  const team1IsHome = sub.team1_id && sub.home_team_id === sub.team1_id;
  const team1Score = team1IsHome ? sub.home_score : sub.away_score;
  const team2Score = team1IsHome ? sub.away_score : sub.home_score;
  const team1User = team1IsHome ? sub.home_user_id : sub.away_user_id;
  const team2User = team1IsHome ? sub.away_user_id : sub.home_user_id;

  const sideOf = (side: "team1" | "team2") => {
    const isTeam1 = side === "team1";
    const teamId = isTeam1 ? sub.team1_id : sub.team2_id;
    const oppId = isTeam1 ? sub.team2_id : sub.team1_id;
    const userId = isTeam1 ? team1User : team2User;
    const oppUser = isTeam1 ? team2User : team1User;
    const ptsFor = isTeam1 ? team1Score : team2Score;
    const ptsAgainst = isTeam1 ? team2Score : team1Score;
    const oppSide: "team1" | "team2" = isTeam1 ? "team2" : "team1";

    const result = ptsFor == null || ptsAgainst == null ? null : ptsFor > ptsAgainst ? "win" : ptsFor < ptsAgainst ? "loss" : "tie";
    const isComebackWinner = sub.comeback_winner_team_id && sub.comeback_winner_team_id === teamId;

    const offensive: Record<string, string> = {};
    const defensive: Record<string, string> = {};
    for (const [key, val] of Object.entries(stats)) {
      offensive[key] = val?.[side] ?? "";
      defensive[key] = val?.[oppSide] ?? "";
    }

    const row: Record<string, any> = {
      league_id: sub.league_id,
      season_number: sub.season_number,
      week_number: sub.week_number,
      phase: sub.phase,
      game_id: sub.game_id,
      submission_id: sub.id,
      team_id: teamId,
      opponent_team_id: oppId,
      user_id: userId,
      opponent_user_id: oppUser,
      is_home: isTeam1 ? !!team1IsHome : !team1IsHome,
      result,
      points_for: ptsFor ?? null,
      points_against: ptsAgainst ?? null,
      // generated/allowed = opponent's offense mirrored.
      generated_turnovers: toInt(stats["turnovers"]?.[oppSide]),
      yards_allowed: toInt(stats["total_yards_gained"]?.[oppSide]),
      rush_yards_allowed: toInt(stats["off_rush_yards"]?.[oppSide]),
      pass_yards_allowed: toInt(stats["off_pass_yards"]?.[oppSide]),
      first_downs_allowed: toInt(stats["off_first_down"]?.[oppSide]),
      red_zone_def_percentage: toInt(stats["red_zone_def_percentage"]?.[side]),
      comeback_deficit: isComebackWinner ? sub.comeback_deficit : null,
      comeback_deficit_quarter: isComebackWinner ? sub.comeback_deficit_quarter : null,
      comeback_rate: isComebackWinner ? sub.comeback_rate : null,
      fourth_quarter_comeback: isComebackWinner ? sub.fourth_quarter_comeback : false,
      quarter_scores: quarters ? quarters[side] : null,
      offensive_stats: offensive,
      defensive_stats: defensive,
    };
    for (const [key, column] of Object.entries(STAT_KEY_TO_COLUMN)) {
      row[column] = toInt(stats[key]?.[side]);
    }
    return row;
  };

  const rows = [sub.team1_id ? sideOf("team1") : null, sub.team2_id ? sideOf("team2") : null].filter(Boolean);
  if (!rows.length) return;
  const { error } = await supabase.from("rec_team_game_stats").upsert(rows, { onConflict: "submission_id,team_id" });
  if (error) throw new ApiError(500, "Failed to record team game stats from box score.", error);
}

// ─── List pending submissions ─────────────────────────────────────────────────

export async function listPendingBoxScores(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { data, error } = await supabase
    .from("rec_box_score_submissions")
    .select("id,team1_abbr,team2_abbr,home_score,away_score,week_number,submitted_by_discord_id,created_at,parse_warnings,team_stats,quarter_scores,home_team_id,away_team_id,team1_id,image_storage_url")
    .eq("league_id", context.leagueId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new ApiError(500, "Failed to load pending submissions.", error);
  return { submissions: data ?? [] };
}

export async function getBoxScoreSubmission(submissionId: string) {
  const { data, error } = await supabase
    .from("rec_box_score_submissions")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load submission.", error);
  if (!data) throw new ApiError(404, "Submission not found.");
  return data;
}

export async function listScheduledGamesForWeek(guildId: string, weekNumber: number, seasonNumber?: number | null) {
  const { context, selectedSeason, seasonId } = await resolveSeasonContext(guildId, seasonNumber);
  const selected = selectedSeasonWeek(context, { seasonNumber: selectedSeason, weekNumber });
  const { data, error } = await supabase
    .from("rec_games")
    .select("id,season_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,status,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_abbr),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_abbr)")
    .eq("league_id", context.leagueId)
    .eq("season_id", seasonId)
    .eq("week_number", selected.weekNumber)
    .order("created_at", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load scheduled games.", error);
  return {
    league: {
      id: context.leagueId,
      seasonNumber: selected.seasonNumber,
      currentWeek: Number(context.rec_leagues.current_week ?? 1),
      weekNumber: selected.weekNumber,
    },
    games: data ?? [],
  };
}
