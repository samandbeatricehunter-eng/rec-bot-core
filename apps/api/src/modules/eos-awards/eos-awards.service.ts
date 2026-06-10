import { supabase } from "../../lib/supabase.js";

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
  const { data: server } = await supabase
    .from("rec_discord_servers")
    .select("id,league_id")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (!server?.league_id) throw new Error("No league found for this server.");
  const { data: league } = await supabase
    .from("rec_leagues")
    .select("id,season_number,display_season_number")
    .eq("id", server.league_id)
    .maybeSingle();
  if (!league) throw new Error("League not found.");
  return { leagueId: server.league_id as string, seasonNumber: (league.season_number ?? league.display_season_number ?? 1) as number };
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
    if (data) polls.push(data);
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
  const { data: voterDiscord } = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", input.voterDiscordId)
    .maybeSingle();
  if (!voterDiscord?.user_id) return { recorded: false, reason: "Your Discord account is not linked to a REC user profile." };

  // Resolve nominee user_id
  const { data: nomineeDiscord } = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", input.nomineeDiscordId)
    .maybeSingle();
  if (!nomineeDiscord?.user_id) return { recorded: false, reason: "The selected nominee is not linked to a REC user profile." };

  const voterUserId = String(voterDiscord.user_id);
  const nomineeUserId = String(nomineeDiscord.user_id);

  // No self-voting
  if (voterUserId === nomineeUserId) return { recorded: false, reason: "You cannot vote for yourself." };

  // Voter must be a linked coach in this league
  const { data: voterAssignment } = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", voterUserId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (!voterAssignment) return { recorded: false, reason: "Only linked coaches in this league can vote." };

  // Nominee must also be a linked coach
  const { data: nomineeAssignment } = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", nomineeUserId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (!nomineeAssignment) return { recorded: false, reason: "The selected nominee is not an active coach in this league." };

  // Get the poll
  const { data: poll } = await supabase
    .from("rec_eos_award_polls")
    .select("id,status,closes_at")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("category_key", input.categoryKey)
    .maybeSingle();

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
  const { error } = await supabase.from("rec_eos_award_votes").upsert(
    {
      poll_id: poll.id,
      voter_user_id: voterUserId,
      nominee_user_id: nomineeUserId,
      updated_at: new Date().toISOString()
    },
    { onConflict: "poll_id,voter_user_id" }
  );

  if (error) return { recorded: false, reason: "Failed to record your vote. Please try again." };
  return { recorded: true, categoryLabel: EOS_AWARD_CATEGORIES.find((c) => c.key === input.categoryKey)?.label ?? input.categoryKey };
}

export async function lockEosAwardPolls(leagueId: string, seasonNumber: number) {
  const { data: polls } = await supabase
    .from("rec_eos_award_polls")
    .select("id,category_key,category_label")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("status", "open");

  if (!polls?.length) return { locked: 0, results: [] };

  const results: Array<{ categoryKey: string; categoryLabel: string; winnerUserId: string | null; winnerDiscordId: string | null; voteCount: number }> = [];

  for (const poll of polls) {
    // Tally votes
    const { data: votes } = await supabase
      .from("rec_eos_award_votes")
      .select("nominee_user_id")
      .eq("poll_id", poll.id);

    const tally = new Map<string, number>();
    for (const v of votes ?? []) {
      tally.set(v.nominee_user_id, (tally.get(v.nominee_user_id) ?? 0) + 1);
    }

    let winnerUserId: string | null = null;
    let topCount = 0;
    for (const [uid, count] of tally) {
      if (count > topCount) { topCount = count; winnerUserId = uid; }
    }

    // Resolve winner discord ID
    let winnerDiscordId: string | null = null;
    if (winnerUserId) {
      const { data: dAcc } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", winnerUserId).maybeSingle();
      winnerDiscordId = dAcc?.discord_id ?? null;
    }

    await supabase
      .from("rec_eos_award_polls")
      .update({
        status: "locked",
        locked_at: new Date().toISOString(),
        winner_user_id: winnerUserId ?? undefined,
        updated_at: new Date().toISOString()
      })
      .eq("id", poll.id);

    results.push({ categoryKey: poll.category_key, categoryLabel: poll.category_label, winnerUserId, winnerDiscordId, voteCount: topCount });
  }

  return { locked: polls.length, results };
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
