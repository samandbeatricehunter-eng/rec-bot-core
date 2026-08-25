// Self-serve propose/accept/counter scheduling for tournament matches -- a trimmed, site-only
// port of the league's matchup-scheduling.service.ts core flow (propose/respond/reschedule).
// Deliberately does not port that file's Discord-message tracking, Force Win/Fair Sim
// escalation, availability profiles, or check-in/live-tracking -- none of those apply here.

import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";

type MatchRow = {
  id: string;
  tournament_id: string;
  player_a_user_id: string | null;
  player_b_user_id: string | null;
  status: string;
  required_streamer_user_id: string | null;
};

async function loadMatch(matchId: string): Promise<MatchRow> {
  const result = await getPgPool().query<MatchRow>(
    `select id, tournament_id, player_a_user_id, player_b_user_id, status, required_streamer_user_id
       from rec_site_tournament_matches where id=$1`,
    [matchId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "Match not found.");
  return row;
}

function requireParticipant(match: MatchRow, recUserId: string) {
  if (recUserId !== match.player_a_user_id && recUserId !== match.player_b_user_id) {
    throw new ApiError(403, "Only the two players in this match can do that.");
  }
}

export type TournamentSchedulingStatus =
  | "not_scheduled" | "proposed" | "confirmed" | "reschedule_requested"
  | "live" | "completed" | "needs_admin_help";

type SchedulingRow = {
  match_id: string;
  tournament_id: string;
  status: TournamentSchedulingStatus;
  scheduled_for: string | null;
  confirmed_at: string | null;
  proposed_by_user_id: string | null;
  accepted_by_user_id: string | null;
  game_started_at: string | null;
  game_completed_at: string | null;
  window_opens_at: string | null;
  window_closes_at: string | null;
};

export async function ensureScheduling(matchId: string, tournamentId: string): Promise<SchedulingRow> {
  const existing = await getPgPool().query<SchedulingRow>(
    `select * from rec_site_tournament_match_scheduling where match_id=$1`,
    [matchId],
  );
  if (existing.rows[0]) return existing.rows[0];
  const insert = await getPgPool().query<SchedulingRow>(
    `insert into rec_site_tournament_match_scheduling (match_id, tournament_id)
     values ($1,$2) on conflict (match_id) do update set match_id=excluded.match_id
     returning *`,
    [matchId, tournamentId],
  );
  return insert.rows[0];
}

type ProposalRow = {
  id: string;
  match_id: string;
  proposed_by_user_id: string;
  proposed_for: string;
  status: string;
  counter_to_id: string | null;
};

// Withdraw-old-then-insert-new is a read-then-write pair, not atomic -- see the identical
// comment/handling in matchup-scheduling.service.ts's withdrawPendingAndInsertProposal. The
// partial unique index on (match_id) where status='pending' makes a lost race surface as a
// 23505 the caller retries once, instead of leaving two pending rows.
async function withdrawPendingAndInsertProposal(
  matchId: string, userId: string, proposedForUtc: string, counterToId?: string,
): Promise<ProposalRow> {
  const pool = getPgPool();
  for (let attempt = 0; attempt < 2; attempt++) {
    await pool.query(
      `update rec_site_tournament_match_time_proposals
          set status='withdrawn', responded_at=now()
        where match_id=$1 and status='pending'`,
      [matchId],
    );
    try {
      const insert = await pool.query<ProposalRow>(
        `insert into rec_site_tournament_match_time_proposals
           (match_id, proposed_by_user_id, proposed_for, status, counter_to_id)
         values ($1,$2,$3,'pending',$4)
         returning *`,
        [matchId, userId, proposedForUtc, counterToId ?? null],
      );
      return insert.rows[0];
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "23505" || attempt === 1) throw new ApiError(500, "Failed to save your proposed time.", error);
      // Lost the race -- retry: withdraw the row that just won, insert ours as the new one.
    }
  }
  throw new ApiError(500, "Failed to save your proposed time.");
}

// Past window_closes_at, new proposals/responses are blocked -- mirrors the league's own
// Force Win precedent (files a flag for manual admin review, never auto-forfeits). Flips the
// scheduling row to 'needs_admin_help' so it's visible in the admin panel without a poller.
async function assertWindowOpen(matchId: string, scheduling: SchedulingRow): Promise<void> {
  if (!scheduling.window_closes_at || new Date(scheduling.window_closes_at).getTime() > Date.now()) return;
  if (scheduling.status !== "needs_admin_help") {
    await getPgPool().query(
      `update rec_site_tournament_match_scheduling set status='needs_admin_help', updated_at=now() where match_id=$1`,
      [matchId],
    );
  }
  throw new ApiError(409, "The scheduling window for this round has closed — contact an admin.");
}

export async function proposeTime(input: { matchId: string; recUserId: string; proposedForUtc: string }) {
  const match = await loadMatch(input.matchId);
  requireParticipant(match, input.recUserId);
  if (match.status !== "ready") throw new ApiError(409, "This match isn't ready to schedule yet.");
  const scheduling = await ensureScheduling(input.matchId, match.tournament_id);
  await assertWindowOpen(input.matchId, scheduling);

  const proposal = await withdrawPendingAndInsertProposal(input.matchId, input.recUserId, input.proposedForUtc);
  await getPgPool().query(
    `update rec_site_tournament_match_scheduling
        set status='proposed', proposed_by_user_id=$2, updated_at=now()
      where match_id=$1`,
    [input.matchId, input.recUserId],
  );
  return proposal;
}

export async function respondToProposal(input: {
  matchId: string;
  recUserId: string;
  proposalId: string;
  action: "accept" | "counter" | "withdraw" | "reject";
  counterForUtc?: string;
}) {
  const pool = getPgPool();
  const match = await loadMatch(input.matchId);
  requireParticipant(match, input.recUserId);
  if (input.action !== "withdraw") {
    const scheduling = await ensureScheduling(input.matchId, match.tournament_id);
    await assertWindowOpen(input.matchId, scheduling);
  }

  const proposalResult = await pool.query<ProposalRow>(
    `select * from rec_site_tournament_match_time_proposals where id=$1 and match_id=$2`,
    [input.proposalId, input.matchId],
  );
  const proposal = proposalResult.rows[0];
  if (!proposal) throw new ApiError(404, "Proposal not found.");
  if (proposal.status !== "pending") throw new ApiError(409, "That proposal has already been resolved.");

  if (input.action === "withdraw") {
    if (proposal.proposed_by_user_id !== input.recUserId) throw new ApiError(403, "Only the proposer can withdraw it.");
    await pool.query(`update rec_site_tournament_match_time_proposals set status='withdrawn', responded_at=now() where id=$1`, [input.proposalId]);
    await pool.query(`update rec_site_tournament_match_scheduling set status='not_scheduled', updated_at=now() where match_id=$1`, [input.matchId]);
    return { status: "withdrawn" as const };
  }

  if (proposal.proposed_by_user_id === input.recUserId) throw new ApiError(403, "You can't respond to your own proposal.");

  if (input.action === "reject") {
    await pool.query(`update rec_site_tournament_match_time_proposals set status='rejected', responded_at=now() where id=$1`, [input.proposalId]);
    await pool.query(`update rec_site_tournament_match_scheduling set status='not_scheduled', updated_at=now() where match_id=$1`, [input.matchId]);
    return { status: "rejected" as const };
  }

  if (input.action === "accept") {
    await pool.query(`update rec_site_tournament_match_time_proposals set status='accepted', responded_at=now() where id=$1`, [input.proposalId]);
    await pool.query(
      `update rec_site_tournament_match_scheduling
          set status='confirmed', scheduled_for=$2, confirmed_at=now(), accepted_by_user_id=$3, updated_at=now()
        where match_id=$1`,
      [input.matchId, proposal.proposed_for, input.recUserId],
    );
    // Mirrored onto the match row itself so the existing read-only "Scheduled for …" display
    // (TournamentDetail.tsx) shows it without needing to know about the scheduling tables.
    await pool.query(`update rec_site_tournament_matches set scheduled_at=$2, updated_at=now() where id=$1`, [input.matchId, proposal.proposed_for]);
    return { status: "confirmed" as const, scheduledFor: proposal.proposed_for };
  }

  // Counter.
  if (!input.counterForUtc) throw new ApiError(400, "A counter needs a proposed time.");
  await pool.query(`update rec_site_tournament_match_time_proposals set status='countered', responded_at=now() where id=$1`, [input.proposalId]);
  const counter = await withdrawPendingAndInsertProposal(input.matchId, input.recUserId, input.counterForUtc, input.proposalId);
  await pool.query(
    `update rec_site_tournament_match_scheduling set status='proposed', proposed_by_user_id=$2, updated_at=now() where match_id=$1`,
    [input.matchId, input.recUserId],
  );
  return counter;
}

export async function requestReschedule(input: { matchId: string; recUserId: string }) {
  const match = await loadMatch(input.matchId);
  requireParticipant(match, input.recUserId);
  await getPgPool().query(
    `update rec_site_tournament_match_scheduling
        set status='reschedule_requested', scheduled_for=null, confirmed_at=null, updated_at=now()
      where match_id=$1`,
    [input.matchId],
  );
  await getPgPool().query(`update rec_site_tournament_matches set scheduled_at=null, updated_at=now() where id=$1`, [input.matchId]);
  return { status: "reschedule_requested" as const };
}

/** Flips a match live. Two call paths: a manual "Game Started" click (either participant may
 *  call it), or `auto: true` fired from a stream-link save -- which only actually starts the
 *  match when the SAVING user is the required streamer, so a stream save from the other player
 *  never auto-starts it. Idempotent: a match that's already live or completed is a no-op. */
export async function markTournamentMatchStarted(input: { matchId: string; recUserId: string; auto?: boolean }) {
  const match = await loadMatch(input.matchId);
  if (input.auto) {
    if (match.required_streamer_user_id && input.recUserId !== match.required_streamer_user_id) return null;
  } else {
    requireParticipant(match, input.recUserId);
  }
  await ensureScheduling(input.matchId, match.tournament_id);
  const pool = getPgPool();
  const updated = await pool.query<SchedulingRow>(
    `update rec_site_tournament_match_scheduling
        set status='live', game_started_at=now(), updated_at=now()
      where match_id=$1 and status not in ('live','completed')
      returning *`,
    [input.matchId],
  );
  if (!updated.rows[0]) return null;
  await pool.query(`update rec_site_tournament_matches set status='live', started_at=now() where id=$1 and status='ready'`, [input.matchId]);
  await pool.query(`update rec_site_tournament_match_time_proposals set status='withdrawn', responded_at=now() where match_id=$1 and status='pending'`, [input.matchId]);
  return updated.rows[0];
}

export async function checkInMatch(input: { matchId: string; recUserId: string }) {
  const match = await loadMatch(input.matchId);
  requireParticipant(match, input.recUserId);
  const insert = await getPgPool().query(
    `insert into rec_site_tournament_match_checkins (match_id, user_id)
     values ($1,$2) on conflict (match_id, user_id) do update set checked_in_at=now()
     returning *`,
    [input.matchId, input.recUserId],
  );
  return insert.rows[0];
}

/** Closes out scheduling/live-tracking only -- it does NOT report a winner. The actual result
 *  still goes through the tournament's "Submit results" flow (reportTournamentWinner in
 *  tournaments.service.ts). A match can be marked over without a result yet being submitted. */
export async function markTournamentMatchOver(input: { matchId: string; recUserId: string }) {
  const match = await loadMatch(input.matchId);
  requireParticipant(match, input.recUserId);
  await ensureScheduling(input.matchId, match.tournament_id);
  const updated = await getPgPool().query<SchedulingRow>(
    `update rec_site_tournament_match_scheduling
        set status='completed', game_completed_at=now(), updated_at=now()
      where match_id=$1
      returning *`,
    [input.matchId],
  );
  return updated.rows[0] ?? null;
}

/** Not an automated forfeit engine -- tournaments have no Force Win/Fair Sim rule set to
 *  auto-resolve against. Flags the match for manual admin review; the admin either resets
 *  scheduling for a retry, or reports a walkover via the normal result-submission path. */
export async function markCantMakeMatch(input: { matchId: string; recUserId: string }) {
  const match = await loadMatch(input.matchId);
  requireParticipant(match, input.recUserId);
  await ensureScheduling(input.matchId, match.tournament_id);
  const updated = await getPgPool().query<SchedulingRow>(
    `update rec_site_tournament_match_scheduling
        set status='needs_admin_help', updated_at=now()
      where match_id=$1
      returning *`,
    [input.matchId],
  );
  await getPgPool().query(`update rec_site_tournament_match_time_proposals set status='withdrawn', responded_at=now() where match_id=$1 and status='pending'`, [input.matchId]);
  return updated.rows[0] ?? null;
}

export async function resetMatchScheduling(matchId: string) {
  const pool = getPgPool();
  await pool.query(`update rec_site_tournament_match_time_proposals set status='withdrawn', responded_at=now() where match_id=$1 and status='pending'`, [matchId]);
  await pool.query(`delete from rec_site_tournament_match_checkins where match_id=$1`, [matchId]);
  await pool.query(
    `update rec_site_tournament_match_scheduling
        set status='not_scheduled', scheduled_for=null, confirmed_at=null, proposed_by_user_id=null, accepted_by_user_id=null,
            game_started_at=null, game_completed_at=null, window_opens_at=null, window_closes_at=null, updated_at=now()
      where match_id=$1`,
    [matchId],
  );
  await pool.query(`update rec_site_tournament_matches set scheduled_at=null, updated_at=now() where id=$1`, [matchId]);
  return { status: "not_scheduled" as const };
}

export type MatchSchedulingSnapshot = {
  status: SchedulingRow["status"];
  scheduledFor: string | null;
  windowClosesAt: string | null;
  checkedInUserIds: string[];
  pendingProposal: { id: string; proposedByUserId: string; proposedFor: string } | null;
};

/** Batched read for getTournamentDetail -- one round-trip for every match in a tournament, no N+1. */
export async function loadTournamentSchedulingSnapshots(tournamentId: string): Promise<Map<string, MatchSchedulingSnapshot>> {
  const pool = getPgPool();
  const [scheduling, pending, checkins] = await Promise.all([
    pool.query<SchedulingRow>(`select * from rec_site_tournament_match_scheduling where tournament_id=$1`, [tournamentId]),
    pool.query<ProposalRow & { match_id: string }>(
      `select p.* from rec_site_tournament_match_time_proposals p
         inner join rec_site_tournament_matches m on m.id = p.match_id
        where m.tournament_id=$1 and p.status='pending'`,
      [tournamentId],
    ),
    pool.query<{ match_id: string; user_id: string }>(
      `select c.match_id, c.user_id from rec_site_tournament_match_checkins c
         inner join rec_site_tournament_matches m on m.id = c.match_id
        where m.tournament_id=$1`,
      [tournamentId],
    ),
  ]);
  const pendingByMatch = new Map(pending.rows.map((row) => [row.match_id, row]));
  const checkinsByMatch = new Map<string, string[]>();
  for (const row of checkins.rows) {
    const list = checkinsByMatch.get(row.match_id) ?? [];
    list.push(row.user_id);
    checkinsByMatch.set(row.match_id, list);
  }
  const snapshots = new Map<string, MatchSchedulingSnapshot>();
  for (const row of scheduling.rows) {
    const pendingRow = pendingByMatch.get(row.match_id);
    snapshots.set(row.match_id, {
      status: row.status,
      scheduledFor: row.scheduled_for,
      windowClosesAt: row.window_closes_at,
      checkedInUserIds: checkinsByMatch.get(row.match_id) ?? [],
      pendingProposal: pendingRow
        ? { id: pendingRow.id, proposedByUserId: pendingRow.proposed_by_user_id, proposedFor: pendingRow.proposed_for }
        : null,
    });
  }
  return snapshots;
}
