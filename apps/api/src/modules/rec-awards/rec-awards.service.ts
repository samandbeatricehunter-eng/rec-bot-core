import { supabase } from "../../lib/supabase.js";
import { AWARD_DEFINITIONS, AWARD_KEYS, getAwardDef } from "./rec-awards-config.js";
import { creditUserWallet } from "../advance/advance.service.js";

function asNum(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function nowIso() {
  return new Date().toISOString();
}

// Normalize an array of raw scores to 0–100
function normalizeScores(rawMap: Map<string, number>): Map<string, number> {
  const values = [...rawMap.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const result = new Map<string, number>();
  for (const [key, raw] of rawMap) {
    result.set(key, range > 0 ? ((raw - min) / range) * 100 : raw > 0 ? 100 : 0);
  }
  return result;
}

// Build nominees list for one award, returning top N sorted by performance score
function topN(rawMap: Map<string, number>, n: number): { nomineeKey: string; rawScore: number }[] {
  return [...rawMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([nomineeKey, rawScore]) => ({ nomineeKey, rawScore }));
}

async function getLeagueContext(guildId: string) {
  const { data: server } = await supabase
    .from("rec_discord_servers")
    .select("id")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (!server?.id) throw new Error("Server not found.");

  const { data: link } = await supabase
    .from("rec_server_league_links")
    .select("league_id")
    .eq("server_id", server.id)
    .eq("is_primary", true)
    .maybeSingle();
  if (!link?.league_id) throw new Error("No league linked to this server.");

  const { data: league } = await supabase
    .from("rec_leagues")
    .select("id,name,season_number,display_season_number,current_week")
    .eq("id", link.league_id)
    .single();
  if (!league) throw new Error("League not found.");

  const { data: routes } = await supabase
    .from("rec_server_routes")
    .select("*")
    .eq("server_id", server.id)
    .maybeSingle();

  return { leagueId: league.id as string, league, routes, serverId: server.id as string };
}

type CoachAssignment = {
  userId: string;
  teamId: string;
  teamName: string;
  discordId: string | null;
  displayName: string;
};

async function getActiveCoaches(leagueId: string): Promise<CoachAssignment[]> {
  const { data: assignments, error: assignmentsError } = await supabase
    .from("rec_team_assignments")
    .select("user_id, team_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);

  if (assignmentsError) throw assignmentsError;

  const cleanAssignments = (assignments ?? [])
    .map((a: any) => ({ userId: String(a.user_id ?? ""), teamId: String(a.team_id ?? "") }))
    .filter((a) => a.userId && a.teamId);

  const userIds = [...new Set(cleanAssignments.map((a) => a.userId))];
  const teamIds = [...new Set(cleanAssignments.map((a) => a.teamId))];

  const [{ data: discordAccounts, error: discordError }, { data: teams, error: teamsError }] = await Promise.all([
    userIds.length
      ? supabase.from("rec_discord_accounts").select("user_id,discord_id,global_name,username").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? supabase.from("rec_teams").select("id,name,abbreviation").in("id", teamIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (discordError) throw discordError;
  if (teamsError) throw teamsError;

  const discordMap = new Map<string, { discordId: string; displayName: string }>();
  for (const d of discordAccounts ?? []) {
    if (d.user_id) {
      discordMap.set(String(d.user_id), {
        discordId: d.discord_id ? String(d.discord_id) : "",
        displayName: d.global_name ?? d.username ?? "Coach"
      });
    }
  }

  const teamMap = new Map<string, { name: string | null; abbreviation: string | null }>();
  for (const t of teams ?? []) {
    if (t.id) teamMap.set(String(t.id), t as any);
  }

  return cleanAssignments.map((a) => {
    const team = teamMap.get(a.teamId);
    const discord = discordMap.get(a.userId);
    return {
      userId: a.userId,
      teamId: a.teamId,
      teamName: team?.name ?? team?.abbreviation ?? "Unknown",
      discordId: discord?.discordId || null,
      displayName: discord?.displayName ?? team?.name ?? team?.abbreviation ?? "Coach"
    };
  });
}

type PlayerAwardDetail = {
  nomineeKey: string;
  userId: string;
  playerId: string;
  playerName: string;
  position: string;
  teamName: string;
  displayLabel: string;
  statLine: string;
  rawStats: Record<string, unknown>;
  scoreBreakdown: Record<string, number>;
};

const PLAYER_AWARD_KEYS = new Set([
  "mvp", "opoy", "dpoy", "offensive_rookie", "defensive_rookie",
  "best_qb", "best_rb", "best_wr", "best_dl", "best_lb", "best_db", "best_kicker"
]);

// Calls rec_award_candidate_scores RPC — all player-level award scoring runs in SQL
async function getRpcPlayerAwardData(leagueId: string, seasonNumber: number) {
  const { data, error } = await supabase.rpc("rec_award_candidate_scores", {
    p_league_id: leagueId,
    p_season_number: seasonNumber
  });
  if (error) throw error;

  const rawScores: Record<string, Map<string, number>> = {};
  const detailsByAward = new Map<string, Map<string, PlayerAwardDetail>>();
  const candidateKeys = new Set<string>();

  for (const row of data ?? []) {
    const awardKey = String((row as any).award_key ?? "");
    if (!PLAYER_AWARD_KEYS.has(awardKey)) continue;
    const userId = String((row as any).user_id ?? "");
    const teamId = String((row as any).team_id ?? "");
    const playerId = String((row as any).player_id ?? "");
    if (!userId || !teamId || !playerId) continue;

    const nomineeKey = `${teamId}:::${playerId}`;
    const rawScore = asNum((row as any).performance_score);
    if (!Number.isFinite(rawScore) || rawScore <= 0) continue;

    if (!rawScores[awardKey]) rawScores[awardKey] = new Map();
    rawScores[awardKey].set(nomineeKey, rawScore);
    if (!detailsByAward.has(awardKey)) detailsByAward.set(awardKey, new Map());

    const playerName = String((row as any).player_name ?? "Unknown");
    const position = String((row as any).player_position ?? "").toUpperCase();
    const teamName = String((row as any).team_name ?? "Unknown");
    const statLine = String((row as any).stat_line ?? "");
    const rawStats = ((row as any).raw_stats ?? {}) as Record<string, unknown>;

    detailsByAward.get(awardKey)!.set(nomineeKey, {
      nomineeKey,
      userId,
      playerId,
      playerName,
      position,
      teamName,
      displayLabel: `${playerName} (${position || "?"}) · ${teamName}`,
      statLine,
      rawStats: { ...rawStats, playerId, teamId, playerName, position, statLine },
      scoreBreakdown: (rawStats.scoreBreakdown ?? {}) as Record<string, number>
    });
    candidateKeys.add(nomineeKey);
  }

  return { rawScores, detailsByAward, candidateCount: candidateKeys.size };
}

// Calls rec_coach_award_scores RPC — all coach/team award scoring runs in SQL
async function getRpcCoachAwardData(leagueId: string, seasonNumber: number): Promise<any[]> {
  const { data, error } = await supabase.rpc("rec_coach_award_scores", {
    p_league_id: leagueId,
    p_season_number: seasonNumber
  });
  if (error) throw error;
  return data ?? [];
}

function buildBestGmStatLine(data: any): string | undefined {
  if (!data) return undefined;
  const winPct = `${Math.round(asNum(data.win_pct) * 100)}% Win`;
  const sos = `SOS ${(asNum(data.sos) * 100).toFixed(0)}`;
  const ovr = `OVR ${asNum(data.avg_roster_ovr).toFixed(1)}`;
  return `${winPct} | ${sos} | ${ovr}`;
}

export async function generateAwardNominees(guildId: string) {
  const { leagueId, league, routes } = await getLeagueContext(guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);

  const coaches = await getActiveCoaches(leagueId);
  if (!coaches.length) {
    return {
      generated: 0,
      awards: [],
      diagnostics: { earlyReturn: "no_active_coaches", leagueId, seasonNumber, activeCoaches: 0 },
      leagueId,
      seasonNumber,
      announcementsChannelId: routes?.voting_polls_channel_id ?? routes?.announcements_channel_id ?? null
    };
  }

  const teamByUser = new Map<string, CoachAssignment>(coaches.map((c) => [c.userId, c]));
  const allCoachUserIds = [...teamByUser.keys()];

  // Two RPCs replace ~12 separate data-fetch round-trips
  const [playerAwardData, coachAwardRows] = await Promise.all([
    getRpcPlayerAwardData(leagueId, seasonNumber),
    getRpcCoachAwardData(leagueId, seasonNumber)
  ]);

  const playerAwardCandidates = playerAwardData.candidateCount;
  const coachDataByUser = new Map<string, any>(coachAwardRows.map((r: any) => [String(r.user_id), r]));

  // Build score maps
  const rawScores: Record<string, Map<string, number>> = {};

  // Player awards — already scored by the player RPC
  for (const [awardKey, scoreMap] of Object.entries(playerAwardData.rawScores)) {
    rawScores[awardKey] = scoreMap;
  }

  // Coach / team awards — scored by the coach RPC
  for (const coach of coaches) {
    const uid = coach.userId;
    const d = coachDataByUser.get(uid);
    if (!d) continue;

    const set = (key: string, score: number) => {
      if (!rawScores[key]) rawScores[key] = new Map();
      rawScores[key].set(uid, score);
    };

    set("coach_of_the_year", asNum(d.coty_score));
    set("best_ol", asNum(d.best_ol_score));
    set("commissioners_award", 0);
    if (asNum(d.best_h2h_score) >= 0) set("best_h2h_record", asNum(d.best_h2h_score));
    if (asNum(d.stream_count) > 0) set("best_streamer", asNum(d.stream_count));
    if (asNum(d.challenge_score) > 0) set("challenge_king", asNum(d.challenge_score));
    if (asNum(d.badge_score) > 0) set("badge_collector", asNum(d.badge_score));
    if (asNum(d.best_gm_score) > 0) set("best_roster", asNum(d.best_gm_score));
  }

  const votingClosesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const generatedAwards: any[] = [];

  console.log(`[AWARDS] Starting generation for league ${leagueId} season ${seasonNumber}, ${allCoachUserIds.length} coaches, ${playerAwardCandidates} player candidates`);

  for (const def of AWARD_DEFINITIONS) {
    let scoreMap = rawScores[def.key];
    let nomineeCap = def.nomineeCount;

    if (!scoreMap?.size) {
      if (def.key === "commissioners_award" && def.requiresVoting && allCoachUserIds.length > 0) {
        scoreMap = new Map<string, number>(allCoachUserIds.map((uid) => [uid, 0]));
        nomineeCap = Math.min(allCoachUserIds.length, 25);
      } else {
        const { data: award } = await supabase
          .from("rec_awards")
          .upsert({
            league_id: leagueId, season_number: seasonNumber, award_key: def.key,
            award_name: def.name, award_category: def.category,
            requires_voting: def.requiresVoting, payout_amount: def.payoutAmount,
            status: "no_nominees", updated_at: nowIso()
          }, { onConflict: "league_id,season_number,award_key", ignoreDuplicates: false })
          .select("id").maybeSingle();
        if (award?.id) {
          await supabase.from("rec_award_votes").delete().eq("award_id", award.id);
          await supabase.from("rec_award_nominees").delete().eq("award_id", award.id);
          generatedAwards.push({ awardId: award.id, key: def.key, name: def.name, nomineeCount: 0, status: "no_nominees" });
        }
        continue;
      }
    }

    const nominees = topN(scoreMap, nomineeCap);
    const normalizedScores = normalizeScores(new Map(nominees.map((n) => [n.nomineeKey, n.rawScore])));

    const { data: award } = await supabase
      .from("rec_awards")
      .upsert({
        league_id: leagueId, season_number: seasonNumber, award_key: def.key,
        award_name: def.name, award_category: def.category,
        requires_voting: def.requiresVoting, payout_amount: def.payoutAmount,
        status: def.requiresVoting ? "voting" : "commissioner_review",
        voting_opens_at: def.requiresVoting ? new Date().toISOString() : null,
        voting_closes_at: def.requiresVoting ? votingClosesAt : null,
        updated_at: nowIso()
      }, { onConflict: "league_id,season_number,award_key", ignoreDuplicates: false })
      .select("id").maybeSingle();

    if (!award?.id) continue;

    await supabase.from("rec_award_votes").delete().eq("award_id", award.id);
    await supabase.from("rec_award_nominees").delete().eq("award_id", award.id);

    const awardDetailMap = playerAwardData.detailsByAward.get(def.key);
    const isPlayerAward = PLAYER_AWARD_KEYS.has(def.key);

    const nomineeRows = nominees
      .map((nominee) => {
        const playerDetail = awardDetailMap?.get(nominee.nomineeKey) ?? null;
        const userId = playerDetail?.userId ?? nominee.nomineeKey;
        const coach = teamByUser.get(userId);
        if (!coach) return null;
        if (isPlayerAward && !playerDetail) return null;
        const performanceScore = Math.round((normalizedScores.get(nominee.nomineeKey) ?? 0) * 100) / 100;
        const displayLabel = playerDetail?.displayLabel ?? `${coach.teamName} (${coach.displayName})`;
        const coachData = coachDataByUser.get(userId);
        const coachRawStats = coachData
          ? {
              wins: coachData.wins, losses: coachData.losses, win_pct: coachData.win_pct,
              sos: coachData.sos, upset_wins: coachData.upset_wins,
              sacks_taken: coachData.sacks_taken, avg_ol_ovr: coachData.avg_ol_ovr,
              avg_roster_ovr: coachData.avg_roster_ovr,
              challenge_score: coachData.challenge_score, badge_score: coachData.badge_score
            }
          : {};
        return {
          award_id: award.id,
          user_id: userId,
          nominee_key: nominee.nomineeKey,
          team_name: coach.teamName,
          performance_score: performanceScore,
          vote_count: 0,
          final_score: performanceScore,
          display_label: displayLabel,
          player_name: playerDetail?.playerName ?? null,
          raw_stats: playerDetail?.rawStats ?? coachRawStats,
          player_id: playerDetail?.playerId ?? null,
          team_id: coach.teamId,
          nominee_type: playerDetail ? "player" : "coach",
          updated_at: nowIso()
        };
      })
      .filter(Boolean) as any[];

    if (nomineeRows.length > 0) {
      const { error: insertError } = await supabase.from("rec_award_nominees").insert(nomineeRows);
      if (insertError) {
        console.error(`[AWARDS] Insert failed for award "${def.key}" (${award.id}):`, insertError);
      }
    }

    if (!def.requiresVoting && nominees[0]) {
      await supabase.from("rec_awards").update({ status: "commissioner_review", updated_at: nowIso() }).eq("id", award.id);
    }

    // Fetch DB rows to get assigned UUIDs for nomineeOptions
    const { data: nomineesFromDb } = await supabase
      .from("rec_award_nominees")
      .select("id,user_id,nominee_key,final_score,vote_count")
      .eq("award_id", award.id);

    // Key by nominee_key so we can look up by stable key, fall back to user_id
    const dbByNomineeKey = new Map<string, any>();
    const dbByUserId = new Map<string, any>();
    for (const r of nomineesFromDb ?? []) {
      if (r.nominee_key) dbByNomineeKey.set(String(r.nominee_key), r);
      if (r.user_id) dbByUserId.set(String(r.user_id), r);
    }

    const nomineeOptions = nominees.flatMap((nominee) => {
      const playerDetail = awardDetailMap?.get(nominee.nomineeKey) ?? null;
      const userId = playerDetail?.userId ?? nominee.nomineeKey;
      const coach = teamByUser.get(userId);
      if (!coach || (isPlayerAward && !playerDetail)) return [];
      const performanceScore = Math.round((normalizedScores.get(nominee.nomineeKey) ?? 0) * 100) / 100;
      const displayLabel = playerDetail?.displayLabel ?? `${coach.teamName} (${coach.displayName})`;
      const row = dbByNomineeKey.get(nominee.nomineeKey) ?? dbByUserId.get(userId) ?? null;
      return [{
        nomineeId: row?.id ? String(row.id) : undefined,
        userId,
        nomineeKey: nominee.nomineeKey,
        discordId: coach.discordId,
        displayLabel,
        performanceScore,
        statLine: playerDetail?.statLine ?? (def.key === "best_roster" ? buildBestGmStatLine(coachDataByUser.get(userId)) : undefined),
        voteCount: row?.vote_count ?? 0,
        liveScore: row?.final_score ?? performanceScore
      }];
    });

    generatedAwards.push({
      awardId: award.id,
      key: def.key,
      name: def.name,
      description: def.description,
      nomineeCount: nominees.length,
      status: def.requiresVoting ? "voting" : "commissioner_review",
      nomineeOptions,
      payoutAmount: def.payoutAmount,
      prizeText: def.payoutAmount > 0 ? `$${def.payoutAmount}` : "League recognition"
    });
  }

  console.log(`[AWARDS] Generation complete: ${generatedAwards.length} awards`);

  return {
    generated: generatedAwards.length,
    awards: generatedAwards,
    diagnostics: {
      leagueId, seasonNumber,
      generatedAwards: generatedAwards.length,
      activeCoaches: coaches.length,
      playerAwardCandidates,
      coachRpcRows: coachAwardRows.length
    },
    leagueId,
    seasonNumber,
    announcementsChannelId: routes?.voting_polls_channel_id ?? routes?.announcements_channel_id ?? null
  };
}

export async function getAwardVotingSummary(input: { guildId: string; awardId: string }) {
  const { leagueId, league } = await getLeagueContext(input.guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);

  const { data: award } = await supabase
    .from("rec_awards")
    .select("id,award_key,award_name,award_category,requires_voting,status,voting_closes_at,payout_amount")
    .eq("id", input.awardId)
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .maybeSingle();

  if (!award) return null;

  const { data: nominees } = await supabase
    .from("rec_award_nominees")
    .select("id,user_id,team_name,display_label,player_name,performance_score,vote_count,final_score,raw_stats")
    .eq("award_id", input.awardId);

  const { data: votes } = await supabase
    .from("rec_award_votes")
    .select("nominee_user_id")
    .eq("award_id", input.awardId);

  const voteTally = new Map<string, number>();
  for (const vote of votes ?? []) {
    const key = String((vote as any).nominee_user_id ?? "");
    if (!key) continue;
    voteTally.set(key, (voteTally.get(key) ?? 0) + 1);
  }
  const maxVotes = Math.max(...[...voteTally.values(), 0]);

  const rankedNominees = (nominees ?? []).map((nominee: any) => {
    const userId = String(nominee.user_id ?? "");
    const performanceScore = asNum(nominee.performance_score);
    const voteCount = voteTally.get(userId) ?? 0;
    const voteScore = maxVotes > 0 ? (voteCount / maxVotes) * 100 : 0;
    const liveScore = award.requires_voting ? performanceScore * 0.75 + voteScore * 0.25 : performanceScore;
    const rawStats = nominee.raw_stats ?? {};
    return {
      nomineeId: nominee.id,
      userId,
      teamName: nominee.team_name ?? null,
      displayLabel: nominee.display_label ?? nominee.team_name ?? userId,
      playerName: nominee.player_name ?? rawStats?.playerName ?? null,
      position: rawStats?.position ?? null,
      performanceScore: Math.round(performanceScore * 100) / 100,
      voteCount,
      voteScore: Math.round(voteScore * 100) / 100,
      liveScore: Math.round(liveScore * 100) / 100,
      statLine: rawStats?.statLine ?? null,
      rawStats
    };
  }).sort((a: any, b: any) => b.liveScore - a.liveScore || b.performanceScore - a.performanceScore || b.voteCount - a.voteCount);

  if (rankedNominees.length > 0) {
    const updates = rankedNominees.map((n: any) => ({
      id: n.nomineeId, vote_count: n.voteCount,
      final_score: n.liveScore, updated_at: nowIso()
    }));
    await supabase.from("rec_award_nominees").upsert(updates, { onConflict: "id", ignoreDuplicates: false });
  }

  return {
    awardId: String((award as any).id),
    key: (award as any).award_key,
    name: (award as any).award_name,
    category: (award as any).award_category,
    status: (award as any).status,
    requiresVoting: Boolean((award as any).requires_voting),
    closesAt: (award as any).voting_closes_at ?? null,
    totalVotes: (votes ?? []).length,
    payoutAmount: asNum((award as any).payout_amount),
    prizeText: asNum((award as any).payout_amount) > 0 ? `$${asNum((award as any).payout_amount)}` : "League recognition",
    nominees: rankedNominees
  };
}

export async function castAwardVote(input: { guildId: string; voterDiscordId: string; awardId: string; nomineeUserId: string }) {
  const { data: server } = await supabase.from("rec_discord_servers").select("id").eq("guild_id", input.guildId).maybeSingle();
  if (!server?.id) return { recorded: false, reason: "Server not found." };

  const { data: link } = await supabase.from("rec_server_league_links").select("league_id").eq("server_id", server.id).eq("is_primary", true).maybeSingle();
  if (!link?.league_id) return { recorded: false, reason: "No league found." };

  const { data: voterDiscord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.voterDiscordId).maybeSingle();
  if (!voterDiscord?.user_id) return { recorded: false, reason: "Your Discord account is not linked to a REC profile." };

  const { data: voterAssignment } = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", link.league_id).eq("user_id", voterDiscord.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!voterAssignment) return { recorded: false, reason: "Only linked coaches in this league can vote." };

  const { data: award } = await supabase.from("rec_awards").select("id,status,voting_closes_at,award_name").eq("id", input.awardId).maybeSingle();
  if (!award) return { recorded: false, reason: "Award not found." };
  if (award.status !== "voting") return { recorded: false, reason: "Voting for this award is not currently open." };
  if (award.voting_closes_at && new Date(award.voting_closes_at).getTime() < Date.now()) {
    await supabase.from("rec_awards").update({ status: "voting_closed", updated_at: nowIso() }).eq("id", award.id);
    return { recorded: false, reason: "Voting for this award has closed (24h window expired)." };
  }

  // Resolve nominee: try row id → nominee_key (stable composite key) → user_id
  const nomineeIdentifier = input.nomineeUserId;
  let nominee: any = null;
  const debugInfo = { awardId: input.awardId, nomineeIdentifier, resolved: null as string | null };

  const { data: allNomineesForAward } = await supabase.from("rec_award_nominees").select("id,user_id").eq("award_id", input.awardId);

  const { data: byId } = await supabase.from("rec_award_nominees").select("id,user_id").eq("award_id", input.awardId).eq("id", nomineeIdentifier).maybeSingle();
  if (byId?.id) { nominee = byId; debugInfo.resolved = "id"; }

  if (!nominee) {
    const { data: byKey } = await supabase.from("rec_award_nominees").select("id,user_id").eq("award_id", input.awardId).eq("nominee_key", nomineeIdentifier).maybeSingle();
    if (byKey?.id) { nominee = byKey; debugInfo.resolved = "nominee_key"; }
  }

  if (!nominee) {
    const { data: byUser } = await supabase.from("rec_award_nominees").select("id,user_id").eq("award_id", input.awardId).eq("user_id", nomineeIdentifier).maybeSingle();
    if (byUser?.id) { nominee = byUser; debugInfo.resolved = "user_id"; }
  }

  if (!nominee?.user_id) {
    debugInfo.resolved = "FAILED";
    console.error("[AWARDS] Nominee resolution failed:", JSON.stringify({ ...debugInfo, availableNomineeCount: allNomineesForAward?.length ?? 0 }));
    return { recorded: false, reason: `Nominee not found. Checked ${allNomineesForAward?.length ?? 0} nominees in this award.` };
  }

  if (String(voterDiscord.user_id) === String(nominee.user_id)) {
    return { recorded: false, reason: "You cannot vote for yourself." };
  }

  const { error } = await supabase.from("rec_award_votes").upsert({
    award_id: input.awardId,
    voter_user_id: String(voterDiscord.user_id),
    nominee_user_id: String(nominee.user_id),
    updated_at: nowIso()
  }, { onConflict: "award_id,voter_user_id" });

  if (error) return { recorded: false, reason: "Failed to record vote." };
  const liveAward = await getAwardVotingSummary({ guildId: input.guildId, awardId: input.awardId });
  return { recorded: true, awardName: award.award_name, award: liveAward };
}

export async function closeAwardVoting(guildId: string) {
  const { leagueId, league, routes } = await getLeagueContext(guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);

  const { data: awards } = await supabase
    .from("rec_awards")
    .select("id,award_key,award_name,requires_voting,payout_amount")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("status", ["voting", "commissioner_review"]);

  if (!awards?.length) return { closed: 0, results: [], autoApproved: [], announcementsChannelId: null };

  const results: any[] = [];
  const autoApproved: any[] = [];

  for (const award of awards) {
    const { data: nominees } = await supabase
      .from("rec_award_nominees")
      .select("id,user_id,team_name,display_label,performance_score")
      .eq("award_id", award.id);

    const { data: votes } = await supabase
      .from("rec_award_votes")
      .select("nominee_user_id")
      .eq("award_id", award.id);

    const voteTally = new Map<string, number>();
    for (const v of votes ?? []) {
      const key = String((v as any).nominee_user_id ?? "");
      if (key) voteTally.set(key, (voteTally.get(key) ?? 0) + 1);
    }
    const maxVotes = Math.max(...[...voteTally.values(), 0]);

    let winnerNominee: any = null;
    let bestFinalScore = -Infinity;
    const nomineeUpdates: any[] = [];

    for (const nom of nominees ?? []) {
      const perfScore = asNum(nom.performance_score);
      const voteCount = voteTally.get(String(nom.user_id)) ?? 0;
      const voteScore = maxVotes > 0 ? (voteCount / maxVotes) * 100 : 0;
      const finalScore = award.requires_voting ? perfScore * 0.75 + voteScore * 0.25 : perfScore;
      nomineeUpdates.push({ id: nom.id, vote_count: voteCount, final_score: Math.round(finalScore * 100) / 100, updated_at: nowIso() });
      if (finalScore > bestFinalScore) { bestFinalScore = finalScore; winnerNominee = { ...nom, voteCount, finalScore }; }
    }

    if (nomineeUpdates.length > 0) {
      await supabase.from("rec_award_nominees").upsert(nomineeUpdates, { onConflict: "id", ignoreDuplicates: false });
    }

    // Non-voting awards have no community vote — auto-approve immediately
    if (!award.requires_voting && winnerNominee) {
      const { data: discordAcc } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", winnerNominee.user_id).maybeSingle();
      const winnerDiscordId = discordAcc?.discord_id ?? null;

      let payoutLedgerId: string | null = null;
      try {
        const credit = await creditUserWallet({
          userId: String(winnerNominee.user_id),
          leagueId,
          seasonNumber,
          amount: asNum(award.payout_amount),
          transactionType: "credit",
          description: `${award.award_name} — Season ${seasonNumber} award winner`,
          sourceReference: { type: "rec_award", awardId: award.id, idempotencyKey: `award_${award.id}` }
        });
        payoutLedgerId = credit.ledger?.id ?? null;
      } catch (err) {
        console.error(`[closeAwardVoting] Auto-payout failed for ${award.award_key}:`, err);
      }

      await supabase.from("rec_award_winners").upsert({
        league_id: leagueId,
        season_number: seasonNumber,
        award_key: award.award_key,
        award_name: award.award_name,
        winner_user_id: String(winnerNominee.user_id),
        winner_team_name: winnerNominee.team_name ?? null,
        winner_discord_id: winnerDiscordId,
        performance_score: asNum(winnerNominee.performance_score),
        vote_count: 0,
        final_score: Math.round(bestFinalScore * 100) / 100,
        payout_amount: asNum(award.payout_amount),
        payout_issued: payoutLedgerId !== null,
        payout_ledger_id: payoutLedgerId
      }, { onConflict: "league_id,season_number,award_key" });

      await supabase.from("rec_awards").update({ status: "completed", updated_at: nowIso() }).eq("id", award.id);

      autoApproved.push({
        awardId: award.id,
        awardKey: award.award_key,
        awardName: award.award_name,
        payoutAmount: asNum(award.payout_amount),
        winner: {
          userId: String(winnerNominee.user_id),
          discordId: winnerDiscordId,
          teamName: winnerNominee.team_name ?? null,
          displayLabel: winnerNominee.display_label ?? winnerNominee.team_name ?? "Unknown",
          finalScore: Math.round(bestFinalScore * 100) / 100,
          payoutIssued: payoutLedgerId !== null
        }
      });
    } else {
      await supabase.from("rec_awards").update({ status: "commissioner_review", updated_at: nowIso() }).eq("id", award.id);
      results.push({ awardId: award.id, awardKey: award.award_key, awardName: award.award_name, winner: winnerNominee, totalVotes: (votes ?? []).length });
    }
  }

  return {
    closed: awards.length,
    results,
    autoApproved,
    announcementsChannelId: routes?.voting_polls_channel_id ?? routes?.announcements_channel_id ?? null
  };
}

export async function approveAwardWinner(input: { guildId: string; awardId: string; approvedByDiscordId: string }) {
  const { leagueId, league } = await getLeagueContext(input.guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);

  const { data: award } = await supabase
    .from("rec_awards")
    .select("id,award_key,award_name,payout_amount,status")
    .eq("id", input.awardId)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (!award) throw new Error("Award not found.");
  if (!["commissioner_review", "voting_closed"].includes(award.status)) throw new Error("Award is not pending commissioner review.");

  const { data: nominees } = await supabase
    .from("rec_award_nominees")
    .select("user_id,team_name,display_label,performance_score,vote_count,final_score")
    .eq("award_id", award.id)
    .order("final_score", { ascending: false })
    .limit(1);

  const winner = nominees?.[0];
  if (!winner?.user_id) throw new Error("No nominee found for this award.");

  const { data: discordAcc } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", winner.user_id).maybeSingle();
  const winnerDiscordId = discordAcc?.discord_id ?? null;

  let payoutLedgerId: string | null = null;
  try {
    const credit = await creditUserWallet({
      userId: String(winner.user_id),
      leagueId,
      seasonNumber,
      amount: asNum(award.payout_amount),
      transactionType: "credit",
      description: `${award.award_name} — Season ${seasonNumber} award winner`,
      sourceReference: { type: "rec_award", awardId: award.id, idempotencyKey: `award_${award.id}` }
    });
    payoutLedgerId = credit.ledger?.id ?? null;
  } catch (err) {
    console.error("[approveAwardWinner] Payout failed:", err);
  }

  await supabase.from("rec_award_winners").upsert({
    league_id: leagueId,
    season_number: seasonNumber,
    award_key: award.award_key,
    award_name: award.award_name,
    winner_user_id: String(winner.user_id),
    winner_team_name: winner.team_name ?? null,
    winner_discord_id: winnerDiscordId,
    performance_score: asNum(winner.performance_score),
    vote_count: asNum(winner.vote_count),
    final_score: asNum(winner.final_score),
    payout_amount: asNum(award.payout_amount),
    payout_issued: true,
    payout_ledger_id: payoutLedgerId
  }, { onConflict: "league_id,season_number,award_key" });

  await supabase.from("rec_awards").update({ status: "completed", updated_at: nowIso() }).eq("id", award.id);

  return {
    awardId: award.id,
    awardKey: award.award_key,
    awardName: award.award_name,
    winner: {
      userId: String(winner.user_id),
      discordId: winnerDiscordId,
      teamName: winner.team_name,
      displayLabel: winner.display_label,
      performanceScore: asNum(winner.performance_score),
      voteCount: asNum(winner.vote_count),
      finalScore: asNum(winner.final_score),
      payoutAmount: asNum(award.payout_amount),
      payoutIssued: true
    }
  };
}

export async function updateAwardVotingMessage(payload: {
  awardId: string;
  votingChannelId?: string | null;
  votingMessageId?: string | null;
  voteEmbedMessageId?: string | null;
}) {
  const updatePayload: Record<string, string | null> = {};
  if ("votingChannelId" in payload) updatePayload.voting_channel_id = payload.votingChannelId ?? null;
  if ("votingMessageId" in payload) updatePayload.voting_message_id = payload.votingMessageId ?? null;
  if ("voteEmbedMessageId" in payload) updatePayload.vote_embed_message_id = payload.voteEmbedMessageId ?? null;

  const { data, error } = await supabase
    .from("rec_awards")
    .update(updatePayload)
    .eq("id", payload.awardId)
    .select("*")
    .single();

  if (error) throw new Error(`Failed to update award voting message: ${error.message}`);
  return data;
}

export async function getAwardStatus(guildId: string) {
  const { leagueId, league } = await getLeagueContext(guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);

  const { data: awards } = await supabase
    .from("rec_awards")
    .select("id,award_key,award_name,award_category,status,voting_closes_at,requires_voting")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .order("award_category")
    .order("award_key");

  return { awards: awards ?? [], leagueId, seasonNumber };
}

export async function getPendingAwardApprovals(guildId: string) {
  const { leagueId, league, routes } = await getLeagueContext(guildId);
  const seasonNumber = asNum(league.season_number ?? league.display_season_number ?? 1);
  const pendingPayoutsChannelId = (routes as any)?.pending_payouts_channel_id ?? null;

  const { data: awards } = await supabase
    .from("rec_awards")
    .select("id,award_key,award_name,award_category,payout_amount")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("status", "commissioner_review");

  if (!awards?.length) return { awards: [], pendingPayoutsChannelId };

  const results = [];
  for (const award of awards) {
    const { data: nominees } = await supabase
      .from("rec_award_nominees")
      .select("user_id,team_name,display_label,performance_score,vote_count,final_score,raw_stats")
      .eq("award_id", award.id)
      .order("final_score", { ascending: false })
      .limit(5);
    results.push({ ...award, nominees: nominees ?? [] });
  }

  return { awards: results, pendingPayoutsChannelId };
}
