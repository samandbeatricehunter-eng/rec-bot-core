import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";

const OPEN_STATUSES = ["requested", "accepted", "submission_pending", "correction_pending", "admin_review"];

export async function compUserId(authUserId: string): Promise<string> {
  const result = await getPgPool().query(
    `select id from rec_users where supabase_auth_user_id = $1 limit 1`,
    [authUserId],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new ApiError(403, "Complete site registration before using H2H Comp.");
  return String(id);
}

export async function getCompProfile(userId: string) {
  const result = await getPgPool().query(
    `select console, gamer_tag, cross_play_enabled, preferred_game, matchmaking_suspended_until,
            matchmaking_suspension_reason
     from rec_comp_profiles where user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? {
    console: null,
    gamer_tag: null,
    preferred_game: null,
    cross_play_enabled: false,
    matchmaking_suspended_until: null,
    matchmaking_suspension_reason: null,
  };
}

export async function saveCompProfile(input: {
  userId: string;
  console: "xbox" | "ps5" | "pc";
  gamerTag: string;
  crossPlayEnabled: boolean;
  preferredGame: "madden_26" | "madden_27" | "cfb_27";
}) {
  await getPgPool().query(
    `insert into rec_comp_profiles (user_id, console, gamer_tag, cross_play_enabled, preferred_game, updated_at)
     values ($1,$2,$3,$4,$5,now())
     on conflict (user_id) do update set console=excluded.console, gamer_tag=excluded.gamer_tag,
       cross_play_enabled=excluded.cross_play_enabled, preferred_game=excluded.preferred_game, updated_at=now()`,
    [input.userId, input.console, input.gamerTag.trim(), input.crossPlayEnabled, input.preferredGame],
  );
  return getCompProfile(input.userId);
}

async function expireCompState() {
  await getPgPool().query(`delete from rec_comp_queue_entries where expires_at <= now()`);
  await getPgPool().query(
    `update rec_comp_matches set status='expired'
     where status='requested' and request_expires_at <= now()`,
  );
  await getPgPool().query(
    `update rec_comp_matches set status='expired'
     where status in ('accepted','submission_pending','correction_pending')
       and active_expires_at <= now()`,
  );
  await getPgPool().query(
    `with escalated as (
       update rec_comp_box_score_submissions
       set status='admin_review', updated_at=now()
       where status in ('awaiting_opponent','awaiting_submitter') and response_due_at <= now()
       returning id, match_id
     )
     insert into rec_comp_admin_cases (match_id, submission_id, case_type, summary)
     select match_id, id, 'box_score_timeout', 'Comp box score exceeded its 8-hour response window.'
     from escalated`,
  );
  const timedOutReports = await getPgPool().query(
    `update rec_comp_reports
     set status='validated', resolved_at=now(),
       counts_toward_dasher=report_type in ('quit_out','dashed_first_half')
     where status='awaiting_response' and response_due_at <= now()
     returning *`,
  );
  for (const report of timedOutReports.rows) {
    if (report.report_type === "quit_out") {
      const match = await participant(report.match_id, report.reported_user_id);
      if (match.status === "accepted") {
        await finishSimpleResult(match, report.reporter_user_id, report.reported_user_id, "quit_out_timeout");
      }
    }
    await updateCompConductFlags(report.reported_user_id);
  }
}

async function currentCompSeason() {
  let result = await getPgPool().query(
    `select id,starts_at,ends_at from rec_comp_seasons
     where now() between starts_at and ends_at order by starts_at desc limit 1`,
  );
  if (result.rows[0]) return result.rows[0];
  const now = new Date();
  const startMonth = Math.floor(now.getUTCMonth() / 2) * 2;
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1, 6));
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), startMonth + 2, 1, 6));
  const label = `${startsAt.toLocaleString("en-US", { month: "long", timeZone: "UTC" })}–${new Date(endsAt.getTime() - 86400000).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${startsAt.getUTCFullYear()}`;
  await getPgPool().query(
    `insert into rec_comp_seasons(starts_at,ends_at,label)
     values($1,$2,$3) on conflict(starts_at,ends_at) do nothing`,
    [startsAt.toISOString(), endsAt.toISOString(), label],
  );
  result = await getPgPool().query(
    `select id,starts_at,ends_at from rec_comp_seasons
     where now() between starts_at and ends_at order by starts_at desc limit 1`,
  );
  return result.rows[0] ?? null;
}

async function updateCompConductFlags(userId: string) {
  const season = await currentCompSeason();
  if (!season) return;
  const dash = await getPgPool().query(
    `select count(*)::int as count
     from rec_comp_reports
     where reported_user_id=$1 and report_type in ('dashed_first_half','quit_out')
       and counts_toward_dasher
       and created_at between $2 and $3`,
    [userId, season.starts_at, season.ends_at],
  );
  const dashCount = Number(dash.rows[0]?.count ?? 0);
  if (dashCount >= 7) {
    await getPgPool().query(
      `insert into rec_comp_admin_cases(case_type,summary)
       select 'dash_threshold', $1
       where not exists (
         select 1 from rec_comp_admin_cases
         where case_type='dash_threshold' and summary like $2 and status='open'
       )`,
      [
        `User ${userId} has ${dashCount} validated first-half dash/quit reports this Comp season.`,
        `%${userId}%`,
      ],
    );
  }
  if (dashCount >= 10) {
    await getPgPool().query(
      `insert into rec_comp_admin_cases(case_type,summary)
       select 'dasher_tag_approval', $1
       where not exists (
         select 1 from rec_comp_admin_cases
         where case_type='dasher_tag_approval' and summary like $2 and status='open'
       )`,
      [
        `Approve or deny the Dasher tag for user ${userId}; ${dashCount} validated reports this season.`,
        `%${userId}%`,
      ],
    );
  }
}

async function updateConnectionFlag(userId: string) {
  const season = await currentCompSeason();
  if (!season) return;
  const recent = await getPgPool().query(
    `select reporter_user_id
     from rec_comp_reports
     where reported_user_id=$1 and report_type='server_issue'
       and status in ('pending','validated','confirmed')
     order by created_at desc limit 3`,
    [userId],
  );
  if (recent.rows.length < 3 || new Set(recent.rows.map((r) => String(r.reporter_user_id))).size < 3) return;
  await getPgPool().query(
    `insert into rec_comp_user_season_flags(user_id,season_id,flag_type,active,expires_at)
     values($1,$2,'connection_issue',true,now()+interval '24 hours')
     on conflict(user_id,season_id,flag_type) do update
       set active=true,activated_at=now(),expires_at=now()+interval '24 hours'`,
    [userId, season.id],
  );
}

async function assertAvailable(userId: string) {
  const profile = await getCompProfile(userId);
  if (!profile.console || !profile.gamer_tag) {
    throw new ApiError(400, "Save your console and gamertag/PSN before joining matchmaking.");
  }
  if (
    profile.matchmaking_suspended_until &&
    new Date(profile.matchmaking_suspended_until).getTime() > Date.now()
  ) {
    throw new ApiError(403, "Your H2H Comp matchmaking access is currently suspended.");
  }
  const open = await getPgPool().query(
    `select 1 from rec_comp_matches
     where (requester_user_id=$1 or opponent_user_id=$1) and status = any($2::text[]) limit 1`,
    [userId, OPEN_STATUSES],
  );
  if (open.rowCount) throw new ApiError(409, "Finish or cancel your current Comp matchup first.");
}

export async function joinCompQueue(input: {
  userId: string;
  game: string;
  rosterMode: "default" | "cut";
  quarterLength: number | null;
  acceleratedClock: boolean | null;
  acceleratedClockMinimum: number | null;
}) {
  await expireCompState();
  await assertAvailable(input.userId);
  await getPgPool().query(
    `insert into rec_comp_queue_entries
       (user_id,game,roster_mode,quarter_length,accelerated_clock,accelerated_clock_minimum,queued_at,expires_at)
     values ($1,$2,$3,$4,$5,$6,now(),now()+interval '60 minutes')
     on conflict (user_id) do update set game=excluded.game, roster_mode=excluded.roster_mode,
       quarter_length=excluded.quarter_length, accelerated_clock=excluded.accelerated_clock,
       accelerated_clock_minimum=excluded.accelerated_clock_minimum, queued_at=now(),
       expires_at=now()+interval '60 minutes'`,
    [
      input.userId, input.game, input.rosterMode, input.quarterLength, input.acceleratedClock,
      input.acceleratedClock ? input.acceleratedClockMinimum : null,
    ],
  );
  return { queued: true, expiresInMinutes: 60 };
}

export async function leaveCompQueue(userId: string) {
  await getPgPool().query(`delete from rec_comp_queue_entries where user_id=$1`, [userId]);
  return { queued: false };
}

function compatiblePreference(a: any, b: any, key: string): boolean {
  return a[key] == null || b[key] == null || a[key] === b[key];
}

export async function getCompState(userId: string, game: string) {
  await expireCompState();
  const [profile, ownQueue, match] = await Promise.all([
    getCompProfile(userId),
    getPgPool().query(`select * from rec_comp_queue_entries where user_id=$1`, [userId]),
    getPgPool().query(
      `select m.*,
        ru.username requester_username, ou.username opponent_username,
        rp.gamer_tag requester_gamer_tag, op.gamer_tag opponent_gamer_tag
       from rec_comp_matches m
       join rec_users ru on ru.id=m.requester_user_id
       join rec_users ou on ou.id=m.opponent_user_id
       left join rec_comp_profiles rp on rp.user_id=m.requester_user_id
       left join rec_comp_profiles op on op.user_id=m.opponent_user_id
       where (m.requester_user_id=$1 or m.opponent_user_id=$1)
         and m.status = any($2::text[])
       order by m.requested_at desc limit 1`,
      [userId, OPEN_STATUSES],
    ),
  ]);
  const activeMatch = match.rows[0] ?? null;
  if (activeMatch) {
    const [messages, streams, submission, reports] = await Promise.all([
      getPgPool().query(
        `select m.id,m.author_user_id,m.body,m.created_at,u.username,u.display_name
         from rec_comp_messages m join rec_users u on u.id=m.author_user_id
         where m.match_id=$1 order by m.created_at`,
        [activeMatch.id],
      ),
      getPgPool().query(`select * from rec_comp_stream_shares where match_id=$1 order by created_at`, [activeMatch.id]),
      getPgPool().query(
        `select * from rec_comp_box_score_submissions where match_id=$1 order by revision desc limit 1`,
        [activeMatch.id],
      ),
      getPgPool().query(`select * from rec_comp_reports where match_id=$1 order by created_at desc`, [activeMatch.id]),
    ]);
    return {
      currentUserId: userId, profile, ownQueue: ownQueue.rows[0] ?? null, match: activeMatch,
      messages: messages.rows, streams: streams.rows, submission: submission.rows[0] ?? null,
      reports: reports.rows, queue: [],
    };
  }

  const candidates = await getPgPool().query(
    `select q.*,u.username,u.display_name,p.console,p.gamer_tag,p.cross_play_enabled,
      coalesce(r.score,0) power_score,
      exists (
        select 1 from rec_comp_user_season_flags f join rec_comp_seasons s on s.id=f.season_id
        where f.user_id=q.user_id and f.active and f.flag_type='connection_issue'
          and now() between s.starts_at and s.ends_at
      ) connection_issue,
      exists (
        select 1 from rec_comp_user_season_flags f join rec_comp_seasons s on s.id=f.season_id
        where f.user_id=q.user_id and f.active and f.flag_type='dasher'
          and now() between s.starts_at and s.ends_at
      ) dasher
     from rec_comp_queue_entries q
     join rec_users u on u.id=q.user_id and u.supabase_auth_user_id is not null
     join rec_comp_profiles p on p.user_id=q.user_id
     left join rec_global_power_rankings r on r.user_id=q.user_id and r.game=q.game
       and r.scope='comp' and r.computed_date=(
         select max(x.computed_date) from rec_global_power_rankings x
         where x.game=q.game and x.scope='comp'
       )
     where q.game=$2 and q.user_id<>$1 and q.expires_at>now()`,
    [userId, game],
  );
  const own = ownQueue.rows[0] ?? null;
  const ownRank = own
    ? await getPgPool().query(
        `select score from rec_global_power_rankings where user_id=$1 and game=$2 and scope='comp'
         order by computed_date desc limit 1`,
        [userId, game],
      )
    : { rows: [] as any[] };
  const ownScore = Number(ownRank.rows[0]?.score ?? 50);
  const queue = candidates.rows
    .filter((row: any) => {
      if (profile.console !== row.console && !(profile.cross_play_enabled && row.cross_play_enabled)) return false;
      if (!own) return true;
      return own.roster_mode === row.roster_mode &&
        compatiblePreference(own, row, "quarter_length") &&
        compatiblePreference(own, row, "accelerated_clock") &&
        compatiblePreference(own, row, "accelerated_clock_minimum");
    })
    .map((row: any) => ({
      ...row,
      matchupStrength: Math.max(0, 100 - Math.abs(ownScore - Number(row.power_score ?? 50))),
    }))
    .sort((a: any, b: any) => b.matchupStrength - a.matchupStrength);
  return { currentUserId: userId, profile, ownQueue: own, match: null, messages: [], streams: [], submission: null, reports: [], queue };
}

export async function requestCompMatch(input: { userId: string; opponentUserId: string }) {
  await expireCompState();
  await assertAvailable(input.userId);
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    const queues = await client.query(
      `select * from rec_comp_queue_entries where user_id=any($1::uuid[]) for update`,
      [[input.userId, input.opponentUserId]],
    );
    const mine = queues.rows.find((r: any) => r.user_id === input.userId);
    const theirs = queues.rows.find((r: any) => r.user_id === input.opponentUserId);
    if (!mine || !theirs || mine.game !== theirs.game || mine.roster_mode !== theirs.roster_mode) {
      throw new ApiError(409, "That user is no longer available in your compatible queue.");
    }
    const created = await client.query(
      `insert into rec_comp_matches
       (game,roster_mode,requester_user_id,opponent_user_id,quarter_length,accelerated_clock,
        accelerated_clock_minimum)
       values ($1,$2,$3,$4,coalesce($5,$6),coalesce($7,$8),coalesce($9,$10))
       returning *`,
      [
        mine.game, mine.roster_mode, input.userId, input.opponentUserId,
        mine.quarter_length, theirs.quarter_length, mine.accelerated_clock, theirs.accelerated_clock,
        mine.accelerated_clock_minimum, theirs.accelerated_clock_minimum,
      ],
    );
    await client.query("commit");
    await createSiteNotification({
      userId: input.opponentUserId, kind: "comp_match_request", title: "New H2H Comp request",
      body: "A player requested a competitive matchup.", href: `/comp?tab=queue&match=${created.rows[0].id}`,
    });
    return created.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function respondCompMatch(input: { userId: string; matchId: string; accept: boolean }) {
  const result = await getPgPool().query(
    `update rec_comp_matches set
       status=case when $3 then 'accepted' else 'canceled' end,
       accepted_at=case when $3 then now() else accepted_at end,
       active_expires_at=case when $3 then now()+interval '2 hours' else active_expires_at end,
       canceled_at=case when $3 then canceled_at else now() end
     where id=$1 and opponent_user_id=$2 and status='requested' and request_expires_at>now()
     returning *`,
    [input.matchId, input.userId, input.accept],
  );
  const match = result.rows[0];
  if (!match) throw new ApiError(409, "This matchup request is no longer available.");
  if (input.accept) {
    await getPgPool().query(
      `delete from rec_comp_queue_entries where user_id=any($1::uuid[])`,
      [[match.requester_user_id, match.opponent_user_id]],
    );
    await createSiteNotification({
      userId: match.requester_user_id, kind: "comp_match_accepted", title: "H2H Comp request accepted",
      body: "Open the private matchup chat to exchange friend information and start the game.",
      href: `/comp?tab=queue&match=${match.id}`,
    });
  }
  return match;
}

async function participant(matchId: string, userId: string) {
  const result = await getPgPool().query(
    `select * from rec_comp_matches where id=$1 and (requester_user_id=$2 or opponent_user_id=$2)`,
    [matchId, userId],
  );
  const match = result.rows[0];
  if (!match) throw new ApiError(404, "Comp matchup not found.");
  return match;
}

export async function selectCompTeam(input: { userId: string; matchId: string; teamId: string }) {
  const match = await participant(input.matchId, input.userId);
  if (match.roster_mode === "cut") throw new ApiError(400, "CUT matchups do not use default-team selection.");
  if (match.status !== "accepted") throw new ApiError(409, "Team selection is locked after play begins.");
  const column = match.requester_user_id === input.userId ? "requester_team_id" : "opponent_team_id";
  await getPgPool().query(`update rec_comp_matches set ${column}=$2 where id=$1`, [input.matchId, input.teamId]);
  return { ok: true };
}

export async function listDefaultCompTeams(game: string) {
  const result = await getPgPool().query(
    `select distinct on (lower(t.name)) t.id,t.name,t.abbreviation
     from rec_teams t join rec_leagues l on l.id=t.league_id
     where l.game=$1 and coalesce(t.is_relocated,false)=false
     order by lower(t.name),t.created_at`,
    [game],
  );
  return { teams: result.rows };
}

export async function sendCompMessage(input: { userId: string; matchId: string; body: string }) {
  const match = await participant(input.matchId, input.userId);
  if (match.status !== "accepted") throw new ApiError(409, "This matchup chat is not active.");
  const result = await getPgPool().query(
    `insert into rec_comp_messages(match_id,author_user_id,body) values($1,$2,$3) returning *`,
    [input.matchId, input.userId, input.body.trim()],
  );
  return result.rows[0];
}

export async function shareCompStream(input: { userId: string; matchId: string; streamUrl: string }) {
  await participant(input.matchId, input.userId);
  const result = await getPgPool().query(
    `insert into rec_comp_stream_shares(match_id,user_id,stream_url) values($1,$2,$3) returning *`,
    [input.matchId, input.userId, input.streamUrl],
  );
  return result.rows[0];
}

export async function cancelCompMatch(input: { userId: string; matchId: string }) {
  await participant(input.matchId, input.userId);
  await getPgPool().query(
    `update rec_comp_matches set status='canceled',canceled_at=now()
     where id=$1 and status in ('requested','accepted')`,
    [input.matchId],
  );
  return { canceled: true };
}

async function awardCompCoins(userId: string, amount: number, matchId: string, description: string) {
  // Discord-only accounts (no linked site login) are supposed to be excluded from payout
  // eligibility, same as they're already blocked from spending (assertSiteAccountForEconomy) —
  // this credited their (global, cross-league) wallet with no such check. Comp isn't scoped to
  // any one league's payout backlog table, so rather than build a parallel queue for a
  // relatively small, frequent reward, just skip the credit until they link.
  const account = await supabase.from("rec_users").select("supabase_auth_user_id").eq("id", userId).maybeSingle();
  if (!account.data?.supabase_auth_user_id) {
    console.warn(`[WARN] Skipped Comp payout of ${amount} for discord-only user ${userId} (match ${matchId}) — link a site account to earn Comp coins.`);
    return;
  }
  const payout = await supabase.rpc("add_to_wallet", {
    p_user_id: userId, p_amount: amount, p_league_id: null, p_description: description,
    p_transaction_type: "comp_game", p_source: "h2h_comp", p_source_reference: { matchId },
  });
  if (payout.error) throw new ApiError(500, "Failed to issue Comp payout.", payout.error);
}

async function finishSimpleResult(match: any, winnerUserId: string, loserUserId: string, source: string) {
  await getPgPool().query(
    `insert into rec_comp_game_stats(match_id,user_id,opponent_user_id,game,won,lost,points_for,points_against,stats)
     values ($1,$2,$3,$4,true,false,0,0,jsonb_build_object('result_source',$5)),
            ($1,$3,$2,$4,false,true,0,0,jsonb_build_object('result_source',$5))
     on conflict (match_id,user_id) do nothing`,
    [match.id, winnerUserId, loserUserId, match.game, source],
  );
  await getPgPool().query(
    `update rec_comp_matches set status='completed',completed_at=now() where id=$1`,
    [match.id],
  );
  await awardCompCoins(winnerUserId, 150, match.id, "H2H Comp victory");
}

export async function concedeCompMatch(input: { userId: string; matchId: string }) {
  const match = await participant(input.matchId, input.userId);
  if (match.status !== "accepted") throw new ApiError(409, "This matchup cannot be conceded.");
  const winner = match.requester_user_id === input.userId ? match.opponent_user_id : match.requester_user_id;
  await finishSimpleResult(match, winner, input.userId, "concession");
  return { completed: true, winnerUserId: winner };
}

export async function reportCompIssue(input: {
  userId: string; matchId: string; type: string; details?: string | null; evidenceUrls?: string[];
}) {
  const match = await participant(input.matchId, input.userId);
  const reportedUserId = match.requester_user_id === input.userId ? match.opponent_user_id : match.requester_user_id;
  const responseRequired = input.type === "quit_out" || input.type === "dashed_first_half";
  const result = await getPgPool().query(
    `insert into rec_comp_reports
      (match_id,reporter_user_id,reported_user_id,report_type,details,evidence_urls,status,response_due_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [
      input.matchId, input.userId, reportedUserId, input.type, input.details ?? null,
      JSON.stringify(input.evidenceUrls ?? []), responseRequired ? "awaiting_response" : "pending",
      responseRequired ? new Date(Date.now() + 60 * 60 * 1000) : null,
    ],
  );
  if (responseRequired) {
    await createSiteNotification({
      userId: reportedUserId, kind: "comp_report_response", title: "H2H Comp report requires your response",
      body: "Confirm or dispute the reported incident within one hour.", href: `/comp?tab=queue&match=${input.matchId}`,
    });
  } else if (input.type !== "server_issue") {
    await getPgPool().query(
      `insert into rec_comp_admin_cases(match_id,report_id,case_type,summary)
       values($1,$2,$3,$4)`,
      [input.matchId, result.rows[0].id, input.type, input.details || "Comp conduct report"],
    );
  }
  if (input.type === "server_issue") await updateConnectionFlag(reportedUserId);
  return result.rows[0];
}

export async function respondCompReport(input: {
  userId: string; reportId: string; confirm: boolean; response?: string | null;
}) {
  const result = await getPgPool().query(
    `update rec_comp_reports set status=case when $3 then 'confirmed' else 'disputed' end,
      response=$4,resolved_at=case when $3 then now() else null end,
      counts_toward_dasher=case when $3 and report_type='dashed_first_half' then true else false end
     where id=$1 and reported_user_id=$2 and status='awaiting_response' and response_due_at>now()
     returning *`,
    [input.reportId, input.userId, input.confirm, input.response ?? null],
  );
  const report = result.rows[0];
  if (!report) throw new ApiError(409, "This report response window has closed.");
  if (!input.confirm) {
    await getPgPool().query(
      `insert into rec_comp_admin_cases(match_id,report_id,case_type,summary)
       values($1,$2,$3,$4)`,
      [report.match_id, report.id, report.report_type, "Participant disputed the Comp incident report."],
    );
  }
  if (input.confirm && report.report_type === "quit_out") {
    const match = await participant(report.match_id, input.userId);
    await finishSimpleResult(match, report.reporter_user_id, input.userId, "confirmed_quit_out");
  }
  if (input.confirm && report.counts_toward_dasher) {
    await updateCompConductFlags(input.userId);
  }
  return report;
}

export async function submitCompBoxScore(input: {
  userId: string; matchId: string; imageUrls: string[]; parsedPayload: unknown; correctedPayload: unknown;
}) {
  const match = await participant(input.matchId, input.userId);
  if (match.status !== "accepted") throw new ApiError(409, "This matchup is not accepting a box score.");
  const reviewer = match.requester_user_id === input.userId ? match.opponent_user_id : match.requester_user_id;
  const result = await getPgPool().query(
    `insert into rec_comp_box_score_submissions
      (match_id,submitted_by_user_id,reviewer_user_id,image_urls,parsed_payload,corrected_payload,
       status,response_due_at)
     values($1,$2,$3,$4,$5,$6,'awaiting_opponent',now()+interval '8 hours') returning *`,
    [
      input.matchId, input.userId, reviewer, JSON.stringify(input.imageUrls),
      JSON.stringify(input.parsedPayload), JSON.stringify(input.correctedPayload),
    ],
  );
  await getPgPool().query(
    `update rec_comp_matches set status='submission_pending' where id=$1`,
    [input.matchId],
  );
  await createSiteNotification({
    userId: reviewer, kind: "comp_box_score_review", title: "Review an H2H Comp box score",
    body: "Confirm the result or make corrections within eight hours.", href: `/comp?tab=queue&match=${input.matchId}`,
  });
  return result.rows[0];
}

export async function reviewCompBoxScore(input: {
  userId: string; submissionId: string; action: "approve" | "correct" | "deny";
  correctedPayload?: unknown; note?: string | null;
}) {
  const found = await getPgPool().query(
    `select s.id as submission_id, s.match_id, s.submitted_by_user_id, s.reviewer_user_id,
       s.parsed_payload, s.corrected_payload, s.status as submission_status,
       m.game, m.requester_user_id, m.opponent_user_id, m.requester_team_id, m.opponent_team_id
     from rec_comp_box_score_submissions s
     join rec_comp_matches m on m.id=s.match_id where s.id=$1`,
    [input.submissionId],
  );
  const row = found.rows[0];
  if (!row) throw new ApiError(404, "Comp box score not found.");
  if (input.action === "approve") {
    const expectedApprover =
      row.submission_status === "awaiting_submitter" ? row.submitted_by_user_id : row.reviewer_user_id;
    if (expectedApprover !== input.userId) throw new ApiError(403, "You are not the required reviewer.");
    const payload = row.corrected_payload ?? row.parsed_payload;
    const homeScore = Number(payload.homeScore ?? payload.team2Score ?? 0);
    const awayScore = Number(payload.awayScore ?? payload.team1Score ?? 0);
    const homeUser = row.home_user_id ?? row.opponent_user_id;
    const awayUser = row.away_user_id ?? row.requester_user_id;
    await getPgPool().query(
      `insert into rec_comp_game_stats
       (match_id,user_id,opponent_user_id,game,won,lost,tied,points_for,points_against,stats)
       values
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10),
       ($1,$3,$2,$4,$6,$5,$7,$9,$8,$11)
       on conflict(match_id,user_id) do nothing`,
      [
        row.match_id, homeUser, awayUser, row.game, homeScore > awayScore, homeScore < awayScore,
        homeScore === awayScore, homeScore, awayScore, JSON.stringify(payload.homeStats ?? {}),
        JSON.stringify(payload.awayStats ?? {}),
      ],
    );
    await getPgPool().query(
      `update rec_comp_box_score_submissions set status='approved',updated_at=now() where id=$1`,
      [input.submissionId],
    );
    await getPgPool().query(
      `update rec_comp_matches set status='completed',completed_at=now() where id=$1`,
      [row.match_id],
    );
    if (homeScore !== awayScore) {
      await awardCompCoins(homeScore > awayScore ? homeUser : awayUser, 150, row.match_id, "H2H Comp victory");
    }
    return { approved: true };
  }
  if (input.action === "correct") {
    if (row.reviewer_user_id !== input.userId) throw new ApiError(403, "Only the reviewer can correct this submission.");
    await getPgPool().query(
      `update rec_comp_box_score_submissions set corrected_payload=$2,status='awaiting_submitter',
       review_note=$3,response_due_at=now()+interval '8 hours',updated_at=now() where id=$1`,
      [input.submissionId, JSON.stringify(input.correctedPayload ?? {}), input.note ?? null],
    );
    await getPgPool().query(`update rec_comp_matches set status='correction_pending' where id=$1`, [row.match_id]);
    await createSiteNotification({
      userId: row.submitted_by_user_id, kind: "comp_box_score_correction",
      title: "Opponent corrected your H2H Comp box score",
      body: "Approve or deny the corrected result within eight hours.",
      href: `/comp?tab=queue&match=${row.match_id}`,
    });
    return { corrected: true };
  }
  await getPgPool().query(
    `update rec_comp_box_score_submissions set status='admin_review',review_note=$2,updated_at=now() where id=$1`,
    [input.submissionId, input.note ?? "Corrected result denied"],
  );
  await getPgPool().query(`update rec_comp_matches set status='admin_review' where id=$1`, [row.match_id]);
  await getPgPool().query(
    `insert into rec_comp_admin_cases(match_id,submission_id,case_type,summary)
     values($1,$2,'box_score_dispute',$3)`,
    [row.match_id, input.submissionId, input.note ?? "Participants could not agree on the box score."],
  );
  return { adminReview: true };
}
