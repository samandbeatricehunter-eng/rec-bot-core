import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonContext, resolveSeasonId } from "../league-context/season.service.js";
import { parseBoxScoreImages, type ParsedBoxScore } from "./box-score.parser.js";
import { syncUsersAfterBoxScoreApproval } from "../users/user-profile-stats.service.js";
import { syncCpuTeamsAfterBoxScoreApproval } from "../cpu-team-stats/cpu-team-stats.service.js";
import { rebuildOfficialRecordsAfterBoxScore } from "../official-records/official-records.service.js";

const BOX_SCORE_WIN_PAYOUT = 100;
const BOX_SCORE_LOSS_PAYOUT = 50;

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

  const match = (abbr: string) =>
    (teams ?? []).find(
      (t) =>
        t.abbreviation?.toUpperCase() === abbr.toUpperCase() ||
        t.display_abbr?.toUpperCase() === abbr.toUpperCase()
    );

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

// Helpers for the per-team stats table.
function toInt(value: string | null | undefined): number | null {
  const digits = (value ?? "").replace(/[^0-9-]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return isNaN(n) ? null : n;
}

// ─── Shared game/team resolution from a parsed box score ───────────────────────

type ResolvedGame = {
  team1Name: string | null;
  team2Name: string | null;
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

async function resolveGameContext(
  leagueId: string,
  seasonNumber: number,
  weekNumber: number,
  parsed: ParsedBoxScore,
  expectedGameId: string | null = null,
): Promise<ResolvedGame> {
  const empty: ResolvedGame = {
    team1Name: null, team2Name: null, team1Id: null, team2Id: null, gameId: null,
    homeTeamId: null, awayTeamId: null, homeUserId: null, awayUserId: null, homeScore: null, awayScore: null,
  };

  // Commissioner flow: a specific scheduled game was pre-selected, so it's
  // authoritative. The OCR scoreboard (esp. relocated teams in a stylized font)
  // is only used to orient which column is home vs away — never to reject.
  if (expectedGameId) {
    const { data: game, error } = await supabase
      .from("rec_games")
      .select("id,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name),away_team:rec_teams!rec_games_away_team_id_fkey(id,name)")
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
      return {
        team1Name: away?.name ?? null,
        team2Name: home?.name ?? null,
        team1Id: game.away_team_id,
        team2Id: game.home_team_id,
        gameId: game.id,
        homeTeamId: game.home_team_id,
        awayTeamId: game.away_team_id,
        homeUserId: game.home_user_id ?? null,
        awayUserId: game.away_user_id ?? null,
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
    team1Id: team1?.id ?? null,
    team2Id: team2?.id ?? null,
  };
  if (!team1 || !team2) return out;

  const seasonId = await resolveSeasonId(leagueId, seasonNumber);
  const game = await resolveGame(leagueId, team1.id, team2.id, seasonId, weekNumber);
  if (!game) return out;

  out.gameId = game.id;
  if (game.home_team_id === team1.id) {
    out.homeTeamId = team1.id;
    out.awayTeamId = team2.id;
    out.homeUserId = game.home_user_id ?? null;
    out.awayUserId = game.away_user_id ?? null;
    out.homeScore = parsed.score.team1Score;
    out.awayScore = parsed.score.team2Score;
  } else {
    out.homeTeamId = team2.id;
    out.awayTeamId = team1.id;
    out.homeUserId = game.home_user_id ?? null;
    out.awayUserId = game.away_user_id ?? null;
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
  gameMatched: boolean;
};

export async function parseBoxScorePreview(input: PreviewInput): Promise<PreviewResult> {
  const context = await getCurrentLeagueContext(input.guildId);
  await getDiscordAccount(input.discordId, !input.commissionerSubmission);
  const { seasonNumber, weekNumber } = selectedSeasonWeek(context, input);

  const parsed = await parseBoxScoreImages(input.imageUrls, await loadLabelAliases());
  const resolved = await resolveGameContext(context.leagueId, seasonNumber, weekNumber, parsed);

  return {
    parsed,
    missingRequired: parsed.missingRequired,
    complete: parsed.missingRequired.length === 0,
    team1Name: resolved.team1Name,
    team2Name: resolved.team2Name,
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
};

export async function createBoxScoreSubmission(input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId, !input.commissionerSubmission);
  const leagueId = context.leagueId;
  const { seasonNumber, weekNumber } = selectedSeasonWeek(context, input);
  const phase = context.rec_leagues.season_stage ?? null;

  const parsed = await parseBoxScoreImages(input.imageUrls, await loadLabelAliases());
  // When a commissioner pre-selected the game, it's authoritative — the OCR only
  // orients home/away, so a relocated team or a misread abbreviation can't reject it.
  const resolved = await resolveGameContext(leagueId, seasonNumber, weekNumber, parsed, input.expectedGameId ?? null);
  if (resolved.gameId) await clearStalePendingForGame(resolved.gameId);

  // Verify the submitter is reporting their own current-week game:
  //  1. They are linked to one of the two teams in the box score.
  //  2. Those two teams are scheduled to play each other this week (resolved.gameId).
  const submitterTeamId = input.commissionerSubmission ? null : await getActiveTeamId(leagueId, account!.user_id);
  const linkedToBoxScore = !!submitterTeamId && (submitterTeamId === resolved.team1Id || submitterTeamId === resolved.team2Id);
  const opponentMatches = !!resolved.gameId;
  const flagReasons: string[] = [];
  if (!input.commissionerSubmission) {
    if (!submitterTeamId) {
      flagReasons.push("You aren't linked to a team in this league.");
    } else if (!linkedToBoxScore) {
      flagReasons.push("You aren't linked to either team shown in this box score.");
    }
  }
  if (!opponentMatches) {
    flagReasons.push(`These teams aren't scheduled to play each other in Week ${weekNumber}.`);
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
      image_urls: input.imageUrls,
      team1_abbr: parsed.score?.team1Abbr ?? null,
      team2_abbr: parsed.score?.team2Abbr ?? null,
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

  const matchSuffix = resolved.homeTeamId ? "" : " (unmatched)";
  const header = `Box Score: ${parsed.score?.team1Abbr ?? "?"} vs ${parsed.score?.team2Abbr ?? "?"} — Wk ${weekNumber}${matchSuffix}`;

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
      team1Abbr: parsed.score?.team1Abbr ?? null,
      team2Abbr: parsed.score?.team2Abbr ?? null,
      homeScore: resolved.homeScore,
      awayScore: resolved.awayScore,
      commissionerSubmission: !!input.commissionerSubmission,
    },
  });

  return {
    submissionId: submission.id,
    team1Abbr: parsed.score?.team1Abbr ?? null,
    team2Abbr: parsed.score?.team2Abbr ?? null,
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
  };
}

// ─── Commissioner review ──────────────────────────────────────────────────────

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

  // Approve: record game result + issue payouts
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

  // Issue payouts: winner $100, loser $50. Matched games pay both participants
  // by result; an unmatched (commissioner-approved) score pays just the submitter.
  const payouts: { userId: string; amount: number }[] = [];
  if (sub.home_team_id && sub.away_team_id && (sub.home_user_id || sub.away_user_id)) {
    for (const uid of [sub.home_user_id, sub.away_user_id] as (string | null)[]) {
      if (!uid) continue;
      const amount = winningUserId == null ? BOX_SCORE_LOSS_PAYOUT : (uid === winningUserId ? BOX_SCORE_WIN_PAYOUT : BOX_SCORE_LOSS_PAYOUT);
      payouts.push({ userId: uid, amount });
    }
  } else if (sub.submitted_by_user_id) {
    payouts.push({ userId: sub.submitted_by_user_id, amount: BOX_SCORE_LOSS_PAYOUT });
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

  if (sub.league_id && sub.season_number) {
    await rebuildOfficialRecordsAfterBoxScore({
      leagueId: sub.league_id,
      seasonNumber: sub.season_number,
      homeUserId: sub.home_user_id,
      awayUserId: sub.away_user_id,
    }).catch((error) => {
      console.error("[ERROR] Failed to rebuild official user records after box score approval:", error);
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

  return {
    ok: true,
    action: "approved" as const,
    totalPaid,
    playersPayd: payouts.length,
    sourceChannelId: sub.discord_channel_id ?? null,
    sourceMessageId: sub.discord_message_id ?? null,
  };
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
      time_of_possession: stats["time_of_possession"]?.[side] || null,
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
    .select("id,team1_abbr,team2_abbr,home_score,away_score,week_number,submitted_by_discord_id,created_at,parse_warnings,team_stats,quarter_scores,home_team_id,away_team_id")
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
