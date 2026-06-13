import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

function asNumber(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const DEV_TIER = ["Normal", "Star", "Superstar", "XFactor"] as const;

export const EOS_AWARD_CATEGORIES = [
  {
    key: "most_heart",
    label: "Most Heart",
    description: "Which coach showed the most heart and fight all season, no matter the record?"
  },
  {
    key: "cant_shut_up",
    label: "Can't Shut Up",
    description: "Which coach had the most to say in the chat — win or lose?"
  },
  {
    key: "best_comp",
    label: "Best Competition",
    description: "Which coach was the most fun to play against this season?"
  },
  {
    key: "problem_next_year",
    label: "Problem Next Year",
    description: "Which coach do you least want to face in the upcoming season?"
  }
] as const;

type CategoryKey = (typeof EOS_AWARD_CATEGORIES)[number]["key"];

async function getLeagueContext(guildId: string) {
  const { data: serverRows, error: serverError } = await supabase
    .from("rec_discord_servers")
    .select("id")
    .eq("guild_id", guildId)
    .limit(1);
  if (serverError) throw new ApiError(500, "Failed to load Discord server for EOS awards.", serverError);
  const server = serverRows?.[0];
  if (!server?.id) throw new ApiError(404, "This Discord server is not registered in REC Core.");

  const { data: linkRows, error: linkError } = await supabase
    .from("rec_server_league_links")
    .select("league_id")
    .eq("server_id", server.id)
    .eq("is_primary", true)
    .limit(1);
  if (linkError) throw new ApiError(500, "Failed to load league link for EOS awards.", linkError);
  const link = linkRows?.[0];
  if (!link?.league_id) throw new ApiError(404, "This Discord server does not have a primary REC league linked.");

  const { data: leagueRows, error: leagueError } = await supabase
    .from("rec_leagues")
    .select("id,season_number,display_season_number")
    .eq("id", link.league_id)
    .limit(1);
  if (leagueError) throw new ApiError(500, "Failed to load league information for EOS awards.", leagueError);
  const league = leagueRows?.[0];
  if (!league) throw new ApiError(404, "Linked REC league could not be found.");

  return { leagueId: link.league_id as string, seasonNumber: (league.season_number ?? league.display_season_number ?? 1) as number };
}

async function getActiveNominees(leagueId: string) {
  const { data: assignments } = await supabase
    .from("rec_team_assignments")
    .select("user_id, rec_teams(name, abbreviation)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);

  const userIds = (assignments ?? []).map((a: any) => a.user_id).filter(Boolean);
  if (userIds.length === 0) return [];

  const { data: discordAccounts } = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id")
    .in("user_id", userIds);

  const discordMap = new Map<string, string>();
  for (const row of discordAccounts ?? []) {
    if (row.user_id && row.discord_id) discordMap.set(String(row.user_id), String(row.discord_id));
  }

  return (assignments ?? []).map((a: any) => ({
    userId: String(a.user_id),
    discordId: discordMap.get(String(a.user_id)) ?? null,
    displayName: (a.rec_teams as any)?.name ?? (a.rec_teams as any)?.abbreviation ?? "Unknown Coach"
  }));
}

export async function createEosAwardPolls(leagueId: string, seasonNumber: number) {
  const closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const polls: any[] = [];

  for (const cat of EOS_AWARD_CATEGORIES) {
    const { data } = await supabase
      .from("rec_eos_award_polls")
      .upsert(
        {
          league_id: leagueId,
          season_number: seasonNumber,
          category_key: cat.key,
          category_label: cat.label,
          category_description: cat.description,
          status: "open",
          closes_at: closesAt,
          opened_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        { onConflict: "league_id,season_number,category_key", ignoreDuplicates: false }
      )
      .select()
      .single();
    if (data) polls.push({
      ...data,
      categoryKey: data.category_key,
      categoryLabel: data.category_label,
      categoryDescription: data.category_description ?? null,
      closesAt: data.closes_at ?? null
    });
  }

  const pollIds = polls.map((poll) => poll.id).filter(Boolean);
  if (pollIds.length > 0) {
    await supabase.from("rec_eos_award_votes").delete().in("poll_id", pollIds);
  }

  const nominees = await getActiveNominees(leagueId);
  return { polls, nominees, closesAt };
}

export async function castEosVote(input: {
  guildId: string;
  voterDiscordId: string;
  categoryKey: string;
  nomineeDiscordId: string;
}) {
  const { leagueId, seasonNumber } = await getLeagueContext(input.guildId);

  // Resolve voter user_id
  const { data: voterDiscord, error: voterError } = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", input.voterDiscordId)
    .limit(1);
  if (voterError) throw new ApiError(500, "Failed to resolve voter Discord account for EOS awards.", voterError);
  if (!voterDiscord?.[0]?.user_id) return { recorded: false, reason: "Your Discord account is not linked to a REC user profile." };

  // Resolve nominee user_id
  const { data: nomineeDiscord, error: nomineeError } = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", input.nomineeDiscordId)
    .limit(1);
  if (nomineeError) throw new ApiError(500, "Failed to resolve nominee Discord account for EOS awards.", nomineeError);
  if (!nomineeDiscord?.[0]?.user_id) return { recorded: false, reason: "The selected nominee is not linked to a REC user profile." };

  const voterUserId = String(voterDiscord[0].user_id);
  const nomineeUserId = String(nomineeDiscord[0].user_id);

  // Voter must be a linked coach in this league
  const { data: voterAssignment, error: voterAssignmentError } = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", voterUserId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .limit(1);
  if (voterAssignmentError) throw new ApiError(500, "Failed to verify voter team assignment for EOS awards.", voterAssignmentError);
  if (!voterAssignment?.[0]) return { recorded: false, reason: "Only linked coaches in this league can vote." };

  // Nominee must also be a linked coach
  const { data: nomineeAssignment, error: nomineeAssignmentError } = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", nomineeUserId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .limit(1);
  if (nomineeAssignmentError) throw new ApiError(500, "Failed to verify nominee team assignment for EOS awards.", nomineeAssignmentError);
  if (!nomineeAssignment?.[0]) return { recorded: false, reason: "The selected nominee is not an active coach in this league." };

  // Get the poll
  const { data: pollRows, error: pollError } = await supabase
    .from("rec_eos_award_polls")
    .select("id,status,closes_at")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("category_key", input.categoryKey)
    .limit(1);
  if (pollError) throw new ApiError(500, "Failed to load EOS award poll.", pollError);
  const poll = pollRows?.[0];

  if (!poll) return { recorded: false, reason: "Award poll not found. Voting may not have started yet." };
  if (poll.status !== "open") return { recorded: false, reason: "Voting for this award has closed." };
  if (poll.closes_at && new Date(poll.closes_at).getTime() < Date.now()) {
    // Auto-lock expired polls lazily
    await supabase
      .from("rec_eos_award_polls")
      .update({ status: "locked", locked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", poll.id);
    return { recorded: false, reason: "Voting for this award has closed (24h window expired)." };
  }

  // Upsert vote (replaces previous choice for this voter+poll)
  const { error: voteError } = await supabase.from("rec_eos_award_votes").upsert(
    {
      poll_id: poll.id,
      voter_user_id: voterUserId,
      nominee_user_id: nomineeUserId,
      updated_at: new Date().toISOString()
    },
    { onConflict: "poll_id,voter_user_id" }
  );

  if (voteError) throw new ApiError(500, "Failed to record EOS award vote.", voteError);
  return { recorded: true, categoryLabel: EOS_AWARD_CATEGORIES.find((c) => c.key === input.categoryKey)?.label ?? input.categoryKey };
}

// Returns close-game counts (margin ≤ 7) for each userId in the current season.
async function getCloseGameCounts(leagueId: string, seasonNumber: number, userIds: string[]) {
  if (!userIds.length) return new Map<string, number>();
  const { data: games } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_score,away_score")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("season_stage", "regular_season");
  const counts = new Map<string, number>();
  for (const g of games ?? []) {
    const diff = Math.abs(asNumber(g.home_score) - asNumber(g.away_score));
    if (diff > 7) continue;
    if (g.home_user_id && userIds.includes(String(g.home_user_id))) counts.set(String(g.home_user_id), (counts.get(String(g.home_user_id)) ?? 0) + 1);
    if (g.away_user_id && userIds.includes(String(g.away_user_id))) counts.set(String(g.away_user_id), (counts.get(String(g.away_user_id)) ?? 0) + 1);
  }
  return counts;
}

// Returns season records (wins, point diff) for each userId.
async function getSeasonRecords(leagueId: string, seasonNumber: number, userIds: string[]) {
  if (!userIds.length) return new Map<string, { wins: number; pointDiff: number }>();
  const { data: records } = await supabase
    .from("rec_league_user_records")
    .select("user_id,wins,losses,ties,points_for,points_against")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("user_id", userIds);
  const map = new Map<string, { wins: number; pointDiff: number }>();
  for (const r of records ?? []) {
    map.set(String(r.user_id), { wins: asNumber(r.wins), pointDiff: asNumber(r.points_for) - asNumber(r.points_against) });
  }
  return map;
}

// Returns H2H win counts between tied candidates (how many wins each has vs others in the tied set).
async function getH2HWins(leagueId: string, seasonNumber: number, userIds: string[]) {
  if (userIds.length < 2) return new Map<string, number>();
  const { data: games } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_score,away_score,winning_team_id,home_team_id,away_team_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("season_stage", "regular_season");
  const h2hWins = new Map<string, number>();
  for (const g of games ?? []) {
    const home = String(g.home_user_id ?? "");
    const away = String(g.away_user_id ?? "");
    if (!userIds.includes(home) || !userIds.includes(away)) continue;
    const homeScore = asNumber(g.home_score);
    const awayScore = asNumber(g.away_score);
    if (homeScore > awayScore) h2hWins.set(home, (h2hWins.get(home) ?? 0) + 1);
    else if (awayScore > homeScore) h2hWins.set(away, (h2hWins.get(away) ?? 0) + 1);
  }
  return h2hWins;
}

export async function lockEosAwardPolls(leagueId: string, seasonNumber: number) {
  const { data: polls } = await supabase
    .from("rec_eos_award_polls")
    .select("id,category_key,category_label")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("status", "open");

  if (!polls?.length) return { locked: 0, results: [], commissionerTiebreakers: [] };

  const commissionerTiebreakers: Array<{ pollId: string; categoryKey: string; categoryLabel: string; tiedUserIds: string[]; tiedDiscordIds: (string | null)[] }> = [];
  const results: Array<{ categoryKey: string; categoryLabel: string; winnerUserId: string | null; winnerDiscordId: string | null; voteCount: number; tiebreakerUsed: boolean }> = [];

  for (const poll of polls) {
    const { data: votes } = await supabase
      .from("rec_eos_award_votes")
      .select("nominee_user_id")
      .eq("poll_id", poll.id);

    const tally = new Map<string, number>();
    for (const v of votes ?? []) {
      tally.set(v.nominee_user_id, (tally.get(v.nominee_user_id) ?? 0) + 1);
    }

    let topCount = 0;
    for (const count of tally.values()) { if (count > topCount) topCount = count; }
    const tied = [...tally.entries()].filter(([, c]) => c === topCount).map(([uid]) => uid);
    const isTie = tied.length > 1;

    let winnerUserId: string | null = tied[0] ?? null;
    let tiebreakerUsed = false;

    if (isTie && topCount > 0) {
      tiebreakerUsed = true;
      const categoryKey = poll.category_key as string;

      if (categoryKey === "most_heart") {
        // Tiebreaker: close game count (≥ 7 = strong signal), combined with weighted vote score
        const closeGames = await getCloseGameCounts(leagueId, seasonNumber, tied);
        // Score = votes * 1 + closeGames * 2 (close games outweigh votes)
        let bestScore = -1;
        for (const uid of tied) {
          const score = (tally.get(uid) ?? 0) + (closeGames.get(uid) ?? 0) * 2;
          if (score > bestScore) { bestScore = score; winnerUserId = uid; }
        }

      } else if (categoryKey === "problem_next_year") {
        // Tiebreaker: close games + H2H wins among tied candidates
        const [closeGames, h2hWins] = await Promise.all([
          getCloseGameCounts(leagueId, seasonNumber, tied),
          getH2HWins(leagueId, seasonNumber, tied)
        ]);
        let bestScore = -1;
        for (const uid of tied) {
          const score = (closeGames.get(uid) ?? 0) * 2 + (h2hWins.get(uid) ?? 0) * 3;
          if (score > bestScore) { bestScore = score; winnerUserId = uid; }
        }

      } else if (categoryKey === "best_comp") {
        // Tiebreaker: season wins → point diff → H2H wins
        const [records, h2hWins] = await Promise.all([
          getSeasonRecords(leagueId, seasonNumber, tied),
          getH2HWins(leagueId, seasonNumber, tied)
        ]);
        let bestScore = -Infinity;
        for (const uid of tied) {
          const rec = records.get(uid) ?? { wins: 0, pointDiff: 0 };
          const score = rec.wins * 10000 + rec.pointDiff * 10 + (h2hWins.get(uid) ?? 0);
          if (score > bestScore) { bestScore = score; winnerUserId = uid; }
        }

      } else if (categoryKey === "cant_shut_up") {
        // Commissioner decides — leave winner null, mark tiebreaker_needed
        winnerUserId = null;
        const tiedDiscordIds: (string | null)[] = [];
        for (const uid of tied) {
          const { data: da } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", uid).maybeSingle();
          tiedDiscordIds.push(da?.discord_id ?? null);
        }
        commissionerTiebreakers.push({ pollId: poll.id, categoryKey, categoryLabel: poll.category_label, tiedUserIds: tied, tiedDiscordIds });

        await supabase.from("rec_eos_award_polls").update({
          status: "locked",
          locked_at: new Date().toISOString(),
          tiebreaker_needed: true,
          tied_candidate_ids: tied,
          updated_at: new Date().toISOString()
        }).eq("id", poll.id);

        results.push({ categoryKey: poll.category_key, categoryLabel: poll.category_label, winnerUserId: null, winnerDiscordId: null, voteCount: topCount, tiebreakerUsed: true });
        continue;
      }
    }

    // Resolve winner discord ID
    let winnerDiscordId: string | null = null;
    if (winnerUserId) {
      const { data: dAcc } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", winnerUserId).maybeSingle();
      winnerDiscordId = dAcc?.discord_id ?? null;
    }

    await supabase.from("rec_eos_award_polls").update({
      status: "locked",
      locked_at: new Date().toISOString(),
      winner_user_id: winnerUserId ?? undefined,
      tiebreaker_needed: false,
      updated_at: new Date().toISOString()
    }).eq("id", poll.id);

    results.push({ categoryKey: poll.category_key, categoryLabel: poll.category_label, winnerUserId, winnerDiscordId, voteCount: topCount, tiebreakerUsed });
  }

  return { locked: polls.length, results, commissionerTiebreakers };
}

export async function resolveCanTShutUpTiebreaker(input: { pollId: string; winnerUserId: string }) {
  const { data: poll } = await supabase.from("rec_eos_award_polls").select("id,category_key,tiebreaker_needed").eq("id", input.pollId).maybeSingle();
  if (!poll?.tiebreaker_needed) return { updated: false, reason: "No tiebreaker pending for this poll." };
  const { data: dAcc } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", input.winnerUserId).maybeSingle();
  await supabase.from("rec_eos_award_polls").update({
    winner_user_id: input.winnerUserId,
    tiebreaker_needed: false,
    updated_at: new Date().toISOString()
  }).eq("id", input.pollId);
  return { updated: true, winnerUserId: input.winnerUserId, winnerDiscordId: dAcc?.discord_id ?? null };
}

export async function getEosAwardPolls(guildId: string) {
  const { leagueId, seasonNumber } = await getLeagueContext(guildId);

  const { data: polls } = await supabase
    .from("rec_eos_award_polls")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .order("created_at");

  if (!polls?.length) return { polls: [], nominees: [] };

  // Fetch vote tallies for each poll
  const pollIds = polls.map((p: any) => p.id);
  const { data: allVotes } = await supabase
    .from("rec_eos_award_votes")
    .select("poll_id,nominee_user_id")
    .in("poll_id", pollIds);

  const tallyByPoll = new Map<string, Map<string, number>>();
  for (const v of allVotes ?? []) {
    if (!tallyByPoll.has(v.poll_id)) tallyByPoll.set(v.poll_id, new Map());
    const tally = tallyByPoll.get(v.poll_id)!;
    tally.set(v.nominee_user_id, (tally.get(v.nominee_user_id) ?? 0) + 1);
  }

  const pollsWithTallies = (polls as any[]).map((p: any) => ({
    ...p,
    totalVotes: allVotes?.filter((v) => v.poll_id === p.id).length ?? 0,
    tally: Object.fromEntries(tallyByPoll.get(p.id) ?? new Map())
  }));

  const nominees = await getActiveNominees(leagueId);
  return { polls: pollsWithTallies, nominees };
}
