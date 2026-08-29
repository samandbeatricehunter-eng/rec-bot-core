import {
  CFB_27_TEAMS,
  NFL_TEAMS,
  TOURNAMENT_BRACKET_TYPES,
  TOURNAMENT_HIGHLIGHT_COINS,
  formatTournamentPlayerName,
  generateTournamentBracket,
  parseTournamentRules,
  tournamentBracketType,
  tournamentCountdown,
  tournamentRulesSummary,
  type TournamentPayoutScope,
  type TournamentRules,
} from "@rec/shared";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { getPgPool } from "../../db/client.js";
import { syncTournamentDiscordAnnouncements } from "./tournament-discord.service.js";
import { loadTournamentSchedulingSnapshots } from "./tournament-match-scheduling.service.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { listTournamentStreamHighlights } from "./tournaments-media.service.js";
import {
  normalizeTournamentBoxScore,
  refundTournamentMatchWagers,
  settleTournamentMatchWagers,
} from "./tournaments-wagers.service.js";
import type { TournamentBoxScore } from "./tournaments-odds.js";

const GAME = ["madden_26", "madden_27", "cfb_27"] as const;
type Game = (typeof GAME)[number];

// Discord announcement fanout is a display-only side effect -- never let it block or fail the
// mutation it's attached to.
function notifyDiscord(tournamentId: string) {
  void syncTournamentDiscordAnnouncements(tournamentId).catch((error) =>
    console.error("[ERROR] tournament announcement sync failed (non-fatal):", error));
}

type TournamentRow = {
  id: string;
  title: string;
  description: string | null;
  game: string;
  bracket_type: string;
  payout_scope: TournamentPayoutScope;
  winner_coins: number;
  runner_up_coins: number;
  semifinalist_coins: number;
  status: string;
  created_by_user_id: string;
  starts_at: string | null;
  created_at: string;
  updated_at: string;
  locked_at: string | null;
  completed_at: string | null;
  payouts_issued_at: string | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  kickoff_at: string | null;
  rules: unknown;
  ticker_announcement_id: string | null;
  registration_paused: boolean;
  event_paused: boolean;
  timezone: string | null;
  roster_library_id: string | null;
  team_selection_mode: "typed" | "claim_pool";
  claim_order_mode: "first_come" | "lottery" | null;
  schedule_mode: "single_kickoff" | "per_round";
  logo_url: string | null;
  scheduling_window_hours: number;
  entrant_count?: number;
  approved_count?: number;
  pending_count?: number;
};

type EntrantRow = {
  user_id: string;
  seed: number | null;
  joined_at: string;
  username: string | null;
  display_name: string | null;
  team_abbr: string | null;
  team_name: string | null;
  gamer_tag: string | null;
  entry_status: "pending" | "approved" | "removed";
};

type MatchRow = {
  id: string;
  tournament_id: string;
  bracket_key: string;
  bracket_side: "winners" | "losers" | "grand_final";
  round: number;
  slot: number;
  player_a_user_id: string | null;
  player_b_user_id: string | null;
  winner_user_id: string | null;
  feeds_winner_match_id: string | null;
  feeds_winner_slot: "a" | "b" | null;
  feeds_loser_match_id: string | null;
  feeds_loser_slot: "a" | "b" | null;
  status: string;
  result_method: string | null;
  screenshot_url: string | null;
  conceded_by_user_id: string | null;
  stream_url: string | null;
  required_streamer_user_id: string | null;
  player_a_score: number | null;
  player_b_score: number | null;
  betting_open: boolean;
  box_score: unknown;
};

function playerLabel(row: {
  username?: string | null;
  display_name?: string | null;
  gamer_tag?: string | null;
} | undefined): string {
  if (!row) return "TBD";
  return formatTournamentPlayerName(row.username, row.display_name, row.gamer_tag);
}

function teamCatalog(game: string) {
  if (game === "cfb_27") {
    return CFB_27_TEAMS
      .filter((team) => !team.isSchedulePlaceholder)
      .map((team) => ({ abbr: team.abbreviation, name: team.name, conference: team.conference }));
  }
  return NFL_TEAMS.map((team) => ({ abbr: team.abbreviation, name: team.name, conference: team.conference }));
}

function resolveTeam(game: string, abbr: string) {
  const team = teamCatalog(game).find((item) => item.abbr.toUpperCase() === abbr.trim().toUpperCase());
  if (!team) throw new ApiError(400, game === "cfb_27" ? "Pick a valid college team." : "Pick one of the 32 NFL teams.");
  return team;
}

export function tournamentTeamsForGame(game: string) {
  return teamCatalog(game);
}

async function loadTournament(id: string): Promise<TournamentRow> {
  const result = await getPgPool().query(`select * from rec_site_tournaments where id = $1`, [id]);
  const row = result.rows[0] as TournamentRow | undefined;
  if (!row) throw new ApiError(404, "Tournament not found.");
  return row;
}

function publicTournament(row: TournamentRow, extra: {
  joined?: boolean;
  joinedStatus?: "pending" | "approved" | null;
  entrantCount?: number;
  approvedCount?: number;
  pendingCount?: number;
  championDisplayName?: string | null;
} = {}) {
  const meta = tournamentBracketType(row.bracket_type);
  const rules = parseTournamentRules(row.rules, row.game);
  const entrantCount = extra.entrantCount ?? Number(row.entrant_count ?? 0);
  const countdown = tournamentCountdown({
    status: row.status,
    registrationOpensAt: row.registration_opens_at,
    registrationClosesAt: row.registration_closes_at,
    kickoffAt: row.kickoff_at,
    entrantCount,
    bracketSize: meta?.size ?? null,
    registrationPaused: Boolean(row.registration_paused),
    eventPaused: Boolean(row.event_paused),
  });
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    game: row.game,
    bracketType: row.bracket_type,
    bracketLabel: meta?.label ?? row.bracket_type,
    bracketSize: meta?.size ?? null,
    payoutScope: row.payout_scope,
    winnerCoins: Number(row.winner_coins),
    runnerUpCoins: Number(row.runner_up_coins),
    semifinalistCoins: Number(row.semifinalist_coins),
    status: row.status,
    startsAt: row.starts_at,
    createdAt: row.created_at,
    lockedAt: row.locked_at,
    completedAt: row.completed_at,
    payoutsIssuedAt: row.payouts_issued_at,
    registrationOpensAt: row.registration_opens_at,
    registrationClosesAt: row.registration_closes_at,
    kickoffAt: row.kickoff_at,
    timezone: row.timezone || "America/Chicago",
    registrationPaused: Boolean(row.registration_paused),
    eventPaused: Boolean(row.event_paused),
    rules,
    rulesSummary: tournamentRulesSummary(rules, row.game),
    countdown,
    registrationOpen:
      row.status === "open" &&
      !row.registration_paused &&
      !row.event_paused &&
      countdown.phase === "registration",
    entrantCount,
    approvedCount: extra.approvedCount ?? Number(row.approved_count ?? extra.entrantCount ?? 0),
    pendingCount: extra.pendingCount ?? Number(row.pending_count ?? 0),
    joined: extra.joined ?? false,
    joinedStatus: extra.joinedStatus ?? null,
    championDisplayName: extra.championDisplayName ?? null,
    rosterLibraryId: row.roster_library_id,
    teamSelectionMode: row.team_selection_mode ?? "typed",
    claimOrderMode: row.claim_order_mode ?? null,
    scheduleMode: row.schedule_mode ?? "single_kickoff",
    logoUrl: row.logo_url ?? null,
    schedulingWindowHours: Number(row.scheduling_window_hours ?? 48),
  };
}

export async function listTournaments(input: { recUserId: string; isAdmin?: boolean }) {
  const result = await getPgPool().query(
    `
      select t.*,
        (select count(*)::int from rec_site_tournament_entrants e where e.tournament_id = t.id and e.entry_status = 'approved') as approved_count,
        (select count(*)::int from rec_site_tournament_entrants e where e.tournament_id = t.id and e.entry_status = 'pending') as pending_count,
        (select count(*)::int from rec_site_tournament_entrants e where e.tournament_id = t.id and e.entry_status <> 'removed') as entrant_count,
        exists (
          select 1 from rec_site_tournament_entrants e
          where e.tournament_id = t.id and e.user_id = $1 and e.entry_status <> 'removed'
        ) as joined,
        (
          select e.entry_status from rec_site_tournament_entrants e
          where e.tournament_id = t.id and e.user_id = $1 and e.entry_status <> 'removed'
          limit 1
        ) as joined_status,
        (
          select coalesce(nullif(u.display_name, ''), u.username)
          from rec_site_tournament_matches m
          inner join rec_users u on u.id = m.winner_user_id
          where m.tournament_id = t.id
            and m.status = 'complete'
            and m.winner_user_id is not null
            and m.feeds_winner_match_id is null
          order by case m.bracket_side when 'grand_final' then 0 else 1 end, m.round desc
          limit 1
        ) as champion_name
      from rec_site_tournaments t
      where ($2::boolean or t.status <> 'draft')
      order by
        case t.status when 'open' then 0 when 'locked' then 1 when 'draft' then 2 when 'complete' then 3 else 4 end,
        t.created_at desc
    `,
    [input.recUserId, Boolean(input.isAdmin)],
  );
  return {
    tournaments: result.rows.map((row) =>
      publicTournament(row as TournamentRow, {
        joined: Boolean(row.joined),
        joinedStatus: (row.joined_status as "pending" | "approved" | null) ?? null,
        entrantCount: Number(row.approved_count ?? row.entrant_count ?? 0),
        approvedCount: Number(row.approved_count ?? 0),
        pendingCount: Number(row.pending_count ?? 0),
        championDisplayName: row.champion_name ?? null,
      }),
    ),
  };
}

export async function getTournamentDetail(input: { recUserId: string; tournamentId: string }) {
  const tournament = await loadTournament(input.tournamentId);
  const [entrants, matches, schedulingSnapshots] = await Promise.all([
    getPgPool().query(
      `
        select e.user_id, e.seed, e.joined_at, e.team_abbr, e.team_name, e.gamer_tag, e.entry_status, u.username, u.display_name
        from rec_site_tournament_entrants e
        inner join rec_users u on u.id = e.user_id
        where e.tournament_id = $1
          and e.entry_status <> 'removed'
        order by e.seed nulls last, e.joined_at asc
      `,
      [input.tournamentId],
    ),
    getPgPool().query(
      `
        select m.*,
          a.username as a_username, a.display_name as a_display_name,
          b.username as b_username, b.display_name as b_display_name,
          w.username as w_username, w.display_name as w_display_name,
          ea.gamer_tag as a_gamer_tag, ea.team_abbr as a_team_abbr, ea.team_name as a_team_name,
          eb.gamer_tag as b_gamer_tag, eb.team_abbr as b_team_abbr, eb.team_name as b_team_name
        from rec_site_tournament_matches m
        left join rec_users a on a.id = m.player_a_user_id
        left join rec_users b on b.id = m.player_b_user_id
        left join rec_users w on w.id = m.winner_user_id
        left join rec_site_tournament_entrants ea
          on ea.tournament_id = m.tournament_id and ea.user_id = m.player_a_user_id
        left join rec_site_tournament_entrants eb
          on eb.tournament_id = m.tournament_id and eb.user_id = m.player_b_user_id
        where m.tournament_id = $1
        order by
          case m.bracket_side when 'winners' then 0 when 'losers' then 1 else 2 end,
          m.round, m.slot
      `,
      [input.tournamentId],
    ),
    loadTournamentSchedulingSnapshots(input.tournamentId),
  ]);
  const rows = entrants.rows as EntrantRow[];
  const mine = rows.find((row) => row.user_id === input.recUserId);
  const approved = rows.filter((row) => row.entry_status === "approved");
  const pending = rows.filter((row) => row.entry_status === "pending");
  const knownGamerTag = await resolveKnownGamerTag(input.recUserId);
  const championRow = matches.rows.find((row) =>
    row.status === "complete" && row.winner_user_id && !row.feeds_winner_match_id,
  );
  return {
    tournament: publicTournament(tournament, {
      joined: Boolean(mine),
      joinedStatus: mine?.entry_status === "removed" ? null : mine?.entry_status ?? null,
      entrantCount: approved.length,
      approvedCount: approved.length,
      pendingCount: pending.length,
      championDisplayName: championRow
        ? playerLabel({ username: championRow.w_username, display_name: championRow.w_display_name })
        : null,
    }),
    knownGamerTag,
    teams: teamCatalog(tournament.game),
    claimedTeams: tournament.team_selection_mode === "claim_pool"
      ? rows.filter((row) => row.team_abbr).map((row) => row.team_abbr as string)
      : [],
    entrants: rows.map((row) => ({
      userId: row.user_id,
      seed: row.seed,
      displayName: playerLabel(row),
      gamerTag: row.gamer_tag,
      teamAbbr: row.team_abbr,
      teamName: row.team_name,
      entryStatus: row.entry_status,
      isYou: row.user_id === input.recUserId,
    })),
    matches: matches.rows.map((row) => ({
      id: row.id,
      key: row.bracket_key,
      side: row.bracket_side,
      round: Number(row.round),
      slot: Number(row.slot),
      scheduledAt: row.scheduled_at ?? null,
      status: row.status,
      homeMustStream: true,
      scheduling: schedulingSnapshots.get(row.id) ?? null,
      resultMethod: row.result_method ?? null,
      screenshotUrl: row.screenshot_url ?? null,
      playerA: row.player_a_user_id
        ? {
            userId: row.player_a_user_id,
            displayName: playerLabel({ username: row.a_username, display_name: row.a_display_name, gamer_tag: row.a_gamer_tag }),
            teamAbbr: row.a_team_abbr ?? null,
            teamName: row.a_team_name ?? null,
            isHome: true,
          }
        : null,
      playerB: row.player_b_user_id
        ? {
            userId: row.player_b_user_id,
            displayName: playerLabel({ username: row.b_username, display_name: row.b_display_name, gamer_tag: row.b_gamer_tag }),
            teamAbbr: row.b_team_abbr ?? null,
            teamName: row.b_team_name ?? null,
            isHome: false,
          }
        : null,
      winnerUserId: row.winner_user_id,
      winnerDisplayName: row.winner_user_id
        ? playerLabel({ username: row.w_username, display_name: row.w_display_name })
        : null,
      streamUrl: row.stream_url ?? null,
      requiredStreamerUserId: row.required_streamer_user_id ?? null,
      playerAScore: row.player_a_score ?? null,
      playerBScore: row.player_b_score ?? null,
      bettingOpen: row.betting_open !== false,
      boxScore: normalizeTournamentBoxScore(row.box_score),
    })),
  };
}

type TournamentFieldInput = {
  bracketType: string;
  payoutScope: TournamentPayoutScope;
  winnerCoins: number;
  runnerUpCoins: number;
  semifinalistCoins: number;
  registrationOpensAt: string;
  registrationClosesAt: string;
  kickoffAt: string;
  teamSelectionMode?: "typed" | "claim_pool";
  claimOrderMode?: "first_come" | "lottery" | null;
};

/** Shared by createTournament and updateTournament so the two never drift apart. Throws
 *  ApiError on the first violation; returns the parsed dates/derived fields callers need. */
function validateTournamentFields(input: TournamentFieldInput) {
  const meta = tournamentBracketType(input.bracketType);
  if (!meta) throw new ApiError(400, "Unknown bracket type.");
  if (input.winnerCoins < 0 || input.runnerUpCoins < 0 || input.semifinalistCoins < 0) {
    throw new ApiError(400, "Payouts cannot be negative.");
  }
  if (input.payoutScope !== "winner" && input.runnerUpCoins <= 0) {
    throw new ApiError(400, "Set a runner-up payout for this prize structure.");
  }
  if (input.payoutScope === "final_four" && input.semifinalistCoins <= 0) {
    throw new ApiError(400, "Set a semifinalist payout for Final Four prizes.");
  }
  const opens = new Date(input.registrationOpensAt);
  const closes = new Date(input.registrationClosesAt);
  const kickoff = new Date(input.kickoffAt);
  if (Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime()) || Number.isNaN(kickoff.getTime())) {
    throw new ApiError(400, "Set registration open, close, and kickoff times.");
  }
  if (closes.getTime() <= opens.getTime()) throw new ApiError(400, "Registration must close after it opens.");
  if (kickoff.getTime() < closes.getTime()) throw new ApiError(400, "Kickoff must be at or after registration closes.");
  const teamSelectionMode = input.teamSelectionMode ?? "typed";
  if (teamSelectionMode === "claim_pool" && !input.claimOrderMode) {
    throw new ApiError(400, "Pick first-come or lottery for how claimed teams are ordered.");
  }
  const claimOrderMode = teamSelectionMode === "claim_pool" ? input.claimOrderMode ?? null : null;
  return { meta, opens, closes, kickoff, teamSelectionMode, claimOrderMode };
}

export async function createTournament(input: {
  recUserId: string;
  title: string;
  description?: string | null;
  game: Game;
  bracketType: string;
  payoutScope: TournamentPayoutScope;
  winnerCoins: number;
  runnerUpCoins: number;
  semifinalistCoins: number;
  registrationOpensAt: string;
  registrationClosesAt: string;
  kickoffAt: string;
  rules: TournamentRules;
  timezone?: string | null;
  rosterLibraryId?: string | null;
  teamSelectionMode?: "typed" | "claim_pool";
  claimOrderMode?: "first_come" | "lottery" | null;
  scheduleMode?: "single_kickoff" | "per_round";
}) {
  const { opens, closes, kickoff, teamSelectionMode, claimOrderMode } = validateTournamentFields(input);
  const scheduleMode = input.scheduleMode ?? "single_kickoff";
  const rules = parseTournamentRules(input.rules, input.game);
  const result = await getPgPool().query(
    `
      insert into rec_site_tournaments
        (title, description, game, bracket_type, payout_scope, winner_coins, runner_up_coins, semifinalist_coins,
         status, created_by_user_id, registration_opens_at, registration_closes_at, kickoff_at, starts_at, rules, timezone,
         roster_library_id, team_selection_mode, claim_order_mode, schedule_mode)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11, $12, $12, $13::jsonb, $14, $15, $16, $17, $18)
      returning *
    `,
    [
      input.title.trim(),
      input.description?.trim() || null,
      input.game,
      input.bracketType,
      input.payoutScope,
      Math.trunc(input.winnerCoins),
      Math.trunc(input.runnerUpCoins),
      Math.trunc(input.semifinalistCoins),
      input.recUserId,
      opens.toISOString(),
      closes.toISOString(),
      kickoff.toISOString(),
      JSON.stringify(rules),
      input.timezone?.trim() || "America/Chicago",
      input.rosterLibraryId || null,
      teamSelectionMode,
      claimOrderMode,
      scheduleMode,
    ],
  );
  const tournament = publicTournament(result.rows[0] as TournamentRow, { entrantCount: 0 });
  await announceTournament(tournament);
  // Registration opens immediately unless the admin scheduled it for later -- the sweep in
  // index.ts (runTournamentRegistrationAnnounceSweep) catches the scheduled-for-later case once
  // registrationOpensAt actually arrives. Either way the tracked embed still needs its first post.
  const opensNow = new Date(tournament.registrationOpensAt ?? 0).getTime() <= Date.now();
  if (opensNow) {
    await getPgPool().query(`update rec_site_tournaments set registration_open_announced_at = now() where id = $1`, [tournament.id]);
  }
  void syncTournamentDiscordAnnouncements(tournament.id, opensNow ? { pingEveryone: "created" } : {}).catch((error) =>
    console.error("[ERROR] tournament announcement sync failed (non-fatal):", error));
  return { tournament };
}

const TOURNAMENT_RESTRICTED_ONCE_LOCKED = [
  "payoutScope", "winnerCoins", "runnerUpCoins", "semifinalistCoins",
  "registrationOpensAt", "registrationClosesAt", "kickoffAt", "rules",
  "rosterLibraryId", "teamSelectionMode", "claimOrderMode", "scheduleMode",
] as const;

/** bracketType/size is intentionally NOT editable here -- changing it after entrants have
 *  joined would break seeding math (padEntrants/seededBracketOrder assume a fixed size decided
 *  at creation). Once a tournament is locked or complete, only branding (title/description/
 *  logo) and the scheduling window may still change -- everything else risks corrupting an
 *  in-flight or finished bracket. */
export async function updateTournament(input: {
  tournamentId: string;
  title?: string;
  description?: string | null;
  payoutScope?: TournamentPayoutScope;
  winnerCoins?: number;
  runnerUpCoins?: number;
  semifinalistCoins?: number;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  kickoffAt?: string;
  rules?: unknown;
  timezone?: string | null;
  rosterLibraryId?: string | null;
  teamSelectionMode?: "typed" | "claim_pool";
  claimOrderMode?: "first_come" | "lottery" | null;
  scheduleMode?: "single_kickoff" | "per_round";
  schedulingWindowHours?: number;
  logoUrl?: string | null;
}) {
  const tournament = await loadTournament(input.tournamentId);
  const locked = tournament.status === "locked" || tournament.status === "complete";
  if (locked) {
    for (const key of TOURNAMENT_RESTRICTED_ONCE_LOCKED) {
      if (input[key] !== undefined) {
        throw new ApiError(409, "This tournament is locked — only branding and scheduling-window changes are allowed.");
      }
    }
  }

  const { opens, closes, kickoff, teamSelectionMode, claimOrderMode } = validateTournamentFields({
    bracketType: tournament.bracket_type,
    payoutScope: input.payoutScope ?? tournament.payout_scope,
    winnerCoins: input.winnerCoins ?? Number(tournament.winner_coins),
    runnerUpCoins: input.runnerUpCoins ?? Number(tournament.runner_up_coins),
    semifinalistCoins: input.semifinalistCoins ?? Number(tournament.semifinalist_coins),
    registrationOpensAt: input.registrationOpensAt ?? tournament.registration_opens_at!,
    registrationClosesAt: input.registrationClosesAt ?? tournament.registration_closes_at!,
    kickoffAt: input.kickoffAt ?? tournament.kickoff_at!,
    teamSelectionMode: input.teamSelectionMode ?? tournament.team_selection_mode,
    claimOrderMode: input.claimOrderMode !== undefined ? input.claimOrderMode : tournament.claim_order_mode,
  });

  const title = (input.title ?? tournament.title).trim();
  const description = input.description !== undefined ? (input.description?.trim() || null) : tournament.description;
  const rules = input.rules !== undefined ? parseTournamentRules(input.rules, tournament.game) : tournament.rules;
  const timezone = input.timezone !== undefined ? (input.timezone?.trim() || "America/Chicago") : (tournament.timezone || "America/Chicago");
  const rosterLibraryId = input.rosterLibraryId !== undefined ? (input.rosterLibraryId || null) : tournament.roster_library_id;
  const scheduleMode = input.scheduleMode ?? tournament.schedule_mode;
  const schedulingWindowHours = input.schedulingWindowHours !== undefined
    ? Math.max(1, Math.trunc(input.schedulingWindowHours))
    : Number(tournament.scheduling_window_hours ?? 48);
  const logoUrl = input.logoUrl !== undefined ? input.logoUrl : tournament.logo_url;

  const result = await getPgPool().query(
    `
      update rec_site_tournaments set
        title = $2, description = $3, payout_scope = $4, winner_coins = $5, runner_up_coins = $6, semifinalist_coins = $7,
        registration_opens_at = $8, registration_closes_at = $9, kickoff_at = $10, starts_at = $10, rules = $11::jsonb, timezone = $12,
        roster_library_id = $13, team_selection_mode = $14, claim_order_mode = $15, schedule_mode = $16,
        scheduling_window_hours = $17, logo_url = $18, updated_at = now()
      where id = $1
      returning *
    `,
    [
      input.tournamentId, title, description,
      input.payoutScope ?? tournament.payout_scope,
      Math.trunc(input.winnerCoins ?? Number(tournament.winner_coins)),
      Math.trunc(input.runnerUpCoins ?? Number(tournament.runner_up_coins)),
      Math.trunc(input.semifinalistCoins ?? Number(tournament.semifinalist_coins)),
      opens.toISOString(), closes.toISOString(), kickoff.toISOString(),
      JSON.stringify(rules), timezone, rosterLibraryId, teamSelectionMode, claimOrderMode, scheduleMode,
      schedulingWindowHours, logoUrl,
    ],
  );
  return { tournament: publicTournament(result.rows[0] as TournamentRow) };
}

/** Modeled 1:1 on setup.service.ts's storeLeagueLogo -- same size/type limits, same
 *  rec-media bucket, same rollback-on-DB-failure behavior. Tournaments are admin-owned
 *  site-wide (not per-league), so the caller only needs requireSiteAdmin, not an ownership
 *  check against a specific user. */
export async function uploadTournamentLogo(input: { tournamentId: string; buffer: Buffer; contentType: string }) {
  if (input.buffer.byteLength > 5 * 1024 * 1024) throw new ApiError(400, "Tournament logos must be 5 MB or smaller.");
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(input.contentType)) {
    throw new ApiError(400, "Tournament logos must be PNG, JPEG, or WebP. Animated GIFs are not accepted.");
  }
  await loadTournament(input.tournamentId);
  const extension = input.contentType === "image/jpeg" ? "jpg" : input.contentType.split("/")[1];
  const path = `${input.tournamentId}/tournament-logo-${randomUUID()}.${extension}`;
  const stored = await supabase.storage.from("rec-media").upload(path, input.buffer, { contentType: input.contentType, cacheControl: "31536000", upsert: false });
  if (stored.error) throw new ApiError(500, "We couldn't upload the tournament logo. Please try again.", stored.error);
  const logoUrl = supabase.storage.from("rec-media").getPublicUrl(path).data.publicUrl;
  const updated = await supabase.from("rec_site_tournaments").update({ logo_url: logoUrl, updated_at: new Date().toISOString() }).eq("id", input.tournamentId).select("id,logo_url").single();
  if (updated.error) {
    await supabase.storage.from("rec-media").remove([path]);
    throw new ApiError(500, "We couldn't save the tournament logo. Please try again.", updated.error);
  }
  return { logoUrl: updated.data.logo_url as string | null };
}

export async function cancelTournament(input: { tournamentId: string }) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status === "complete") throw new ApiError(409, "Completed tournaments cannot be cancelled.");
  await getPgPool().query(
    `update rec_site_tournaments set status = 'cancelled', updated_at = now() where id = $1`,
    [input.tournamentId],
  );
  notifyDiscord(input.tournamentId);
  return { ok: true as const };
}

export async function joinTournament(input: {
  recUserId: string;
  tournamentId: string;
  teamAbbr?: string | null;
  gamerTag: string;
}) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status !== "open") throw new ApiError(409, "This tournament is not accepting registration.");
  if (tournament.event_paused) throw new ApiError(409, "This tournament is closed.");
  if (tournament.registration_paused) throw new ApiError(409, "Registration is closed.");
  const now = Date.now();
  if (tournament.registration_opens_at && new Date(tournament.registration_opens_at).getTime() > now) {
    throw new ApiError(409, "Registration has not opened yet.");
  }
  if (tournament.registration_closes_at && new Date(tournament.registration_closes_at).getTime() <= now) {
    throw new ApiError(409, "Registration is closed.");
  }
  // Lottery-draft tournaments assign teams later, once the draw order runs -- register without one.
  const isLottery = tournament.claim_order_mode === "lottery";
  if (!isLottery && !input.teamAbbr) throw new ApiError(400, "Pick a team.");
  const team = isLottery && !input.teamAbbr ? null : resolveTeam(tournament.game, input.teamAbbr ?? "");
  const gamerTag = input.gamerTag.trim();
  if (gamerTag.length < 2 || gamerTag.length > 32) {
    throw new ApiError(400, "Enter the gamertag / PSN / EA name you will play under.");
  }
  try {
    if (tournament.team_selection_mode === "claim_pool" && team) {
      await withClaimedTeamCheck(tournament.id, team.abbr, async (client) => {
        await client.query(
          `
            insert into rec_site_tournament_entrants
              (tournament_id, user_id, team_abbr, team_name, gamer_tag, entry_status)
            values ($1, $2, $3, $4, $5, 'pending')
          `,
          [input.tournamentId, input.recUserId, team.abbr, team.name, gamerTag],
        );
      });
    } else {
      await getPgPool().query(
        `
          insert into rec_site_tournament_entrants
            (tournament_id, user_id, team_abbr, team_name, gamer_tag, entry_status)
          values ($1, $2, $3, $4, $5, 'pending')
        `,
        [input.tournamentId, input.recUserId, team?.abbr ?? null, team?.name ?? null, gamerTag],
      );
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") throw new ApiError(409, "You are already registered for this tournament.");
    throw error;
  }
  await rememberGamerTag(input.recUserId, gamerTag);
  notifyDiscord(input.tournamentId);
  return getTournamentDetail(input);
}

// Pool-depletion check for claim_pool tournaments: serialized per (tournament, team) so two
// entrants racing to claim the same team can't both succeed, same advisory-lock idiom used for
// the matchups-channel post race.
async function withClaimedTeamCheck(
  tournamentId: string,
  teamAbbr: string,
  mutate: (client: PoolClient) => Promise<void>,
) {
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`tournament-claim:${tournamentId}`]);
    const existing = await client.query(
      `select 1 from rec_site_tournament_entrants where tournament_id = $1 and team_abbr = $2 and entry_status <> 'removed'`,
      [tournamentId, teamAbbr],
    );
    if (existing.rows[0]) throw new ApiError(409, "That team has already been claimed.");
    await mutate(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function leaveTournament(input: { recUserId: string; tournamentId: string }) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status !== "open") throw new ApiError(409, "You can only leave before the bracket locks.");
  const deleted = await getPgPool().query(
    `delete from rec_site_tournament_entrants where tournament_id = $1 and user_id = $2 and entry_status = 'pending' returning user_id`,
    [input.tournamentId, input.recUserId],
  );
  if (!deleted.rows[0]) {
    throw new ApiError(409, "Approved entries can only be removed by an admin.");
  }
  notifyDiscord(input.tournamentId);
  return getTournamentDetail(input);
}

async function placePlayer(matchId: string, slot: "a" | "b", userId: string) {
  const column = slot === "a" ? "player_a_user_id" : "player_b_user_id";
  await getPgPool().query(
    `update rec_site_tournament_matches set ${column} = $2 where id = $1`,
    [matchId, userId],
  );
}

async function refreshMatchReadiness(matchId: string) {
  const result = await getPgPool().query(`select * from rec_site_tournament_matches where id = $1`, [matchId]);
  const match = result.rows[0] as MatchRow | undefined;
  if (!match || match.status === "complete" || match.status === "bye") return match;
  const a = match.player_a_user_id;
  const b = match.player_b_user_id;
  if (a && b) {
    // player_a is the required streamer -- set once, the first time both slots are filled, and
    // never overwritten afterward (a later reschedule/replacement shouldn't silently change who
    // has to stream mid-tournament).
    await getPgPool().query(
      `update rec_site_tournament_matches set status = 'ready', required_streamer_user_id = coalesce(required_streamer_user_id, $2) where id = $1`,
      [matchId, a],
    );
    // Open the scheduling window the moment the match becomes proposable -- read once here
    // rather than at propose-time, so it's fixed at whatever the admin's setting was when the
    // round became live, not whatever it happens to be edited to later mid-round.
    const tournamentRow = await getPgPool().query<{ scheduling_window_hours: number }>(
      `select scheduling_window_hours from rec_site_tournaments where id = $1`,
      [match.tournament_id],
    );
    const windowHours = Number(tournamentRow.rows[0]?.scheduling_window_hours ?? 48);
    const { ensureScheduling } = await import("./tournament-match-scheduling.service.js");
    await ensureScheduling(matchId, match.tournament_id);
    await getPgPool().query(
      `update rec_site_tournament_match_scheduling
          set window_opens_at = coalesce(window_opens_at, now()),
              window_closes_at = coalesce(window_closes_at, now() + ($2 || ' hours')::interval)
        where match_id = $1`,
      [matchId, windowHours],
    );
  } else if (a || b) {
    await getPgPool().query(`update rec_site_tournament_matches set status = 'pending' where id = $1`, [matchId]);
  }
  return match;
}

async function resolveByes(tournamentId: string) {
  for (let i = 0; i < 16; i += 1) {
    const pending = await getPgPool().query(
      `
        select m.* from rec_site_tournament_matches m
        where m.tournament_id = $1
          and m.status in ('pending', 'ready')
          and (
            (m.player_a_user_id is not null and m.player_b_user_id is null)
            or (m.player_a_user_id is null and m.player_b_user_id is not null)
          )
          and not exists (
            select 1 from rec_site_tournament_matches feeder
            where feeder.feeds_winner_match_id = m.id
              and feeder.status in ('pending', 'ready')
          )
      `,
      [tournamentId],
    );
    if (!pending.rows.length) break;
    for (const row of pending.rows as MatchRow[]) {
      const winner = row.player_a_user_id ?? row.player_b_user_id;
      if (!winner) continue;
      await getPgPool().query(
        `update rec_site_tournament_matches set winner_user_id = $2, status = 'bye' where id = $1`,
        [row.id, winner],
      );
      if (row.feeds_winner_match_id && row.feeds_winner_slot) {
        await placePlayer(row.feeds_winner_match_id, row.feeds_winner_slot, winner);
        await refreshMatchReadiness(row.feeds_winner_match_id);
      }
    }
  }
}

function shuffledCopy<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function lockTournamentBracket(input: { tournamentId: string; manualByeUserIds?: string[] }) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.event_paused) throw new ApiError(409, "This tournament is closed.");
  if (tournament.status !== "open" && tournament.status !== "draft") {
    throw new ApiError(409, "The bracket is already locked.");
  }
  const meta = tournamentBracketType(tournament.bracket_type);
  if (!meta) throw new ApiError(400, "Unknown bracket type.");
  const entrants = await getPgPool().query(
    `select user_id from rec_site_tournament_entrants where tournament_id = $1 and entry_status = 'approved' order by joined_at asc`,
    [input.tournamentId],
  );
  const registeredIds = (entrants.rows as Array<{ user_id: string }>).map((row) => row.user_id);
  if (registeredIds.length < 2) throw new ApiError(409, "Need at least two players to lock a bracket.");
  if (registeredIds.length > meta.size) throw new ApiError(409, "Too many entrants for this bracket type.");

  // Registration can close under the configured size (confirmed live: a 16-slot tournament
  // locked with only 14 approved entrants) -- locking into the full preset anyway just wastes
  // slots on TBD-vs-bye pairings nobody will ever fill. Downsize to the smallest same-style
  // preset that still fits everyone who actually registered. Bracket sizes are only powers of
  // two, so a non-power-of-two entrant count (like 14) still needs some byes at whatever size is
  // used -- that's inherent to bracket seeding, not something downsizing removes -- but it does
  // stop a big preset from locking in far more empty slots than the real field needs.
  const fittingType = TOURNAMENT_BRACKET_TYPES
    .filter((type) => type.style === meta.style && type.size >= registeredIds.length)
    .sort((a, b) => a.size - b.size)[0];
  const effectiveBracketType = fittingType && fittingType.size < meta.size ? fittingType.key : tournament.bracket_type;
  const effectiveSize = tournamentBracketType(effectiveBracketType)!.size;

  // The standard seeded bracket fold always pairs the padded (null) slots -- which padEntrants
  // always places at the highest seed numbers -- against the LOWEST-numbered real seeds, so
  // whoever occupies seed 1..byesNeeded is exactly who receives a bye. Registration order used
  // to decide that outright (earliest registrants = lowest seeds = automatic byes), which is an
  // arbitrary advantage unrelated to anything competitive. Byes should be handed out at random
  // instead unless specific entrants are deliberately designated for one.
  const byesNeeded = Math.max(0, effectiveSize - registeredIds.length);
  const requestedManualByes = input.manualByeUserIds ?? [];
  if (new Set(requestedManualByes).size !== requestedManualByes.length) {
    throw new ApiError(400, "The same player cannot be selected for more than one bye.");
  }
  const invalidManualByes = requestedManualByes.filter((id) => !registeredIds.includes(id));
  if (invalidManualByes.length) throw new ApiError(400, "Every manual bye recipient must be an approved entrant.");
  if (requestedManualByes.length > byesNeeded) throw new ApiError(400, `This bracket has only ${byesNeeded} bye slot(s).`);
  const manualByes = requestedManualByes;
  const remaining = shuffledCopy(registeredIds.filter((id) => !manualByes.includes(id)));
  const ids = [...manualByes, ...remaining];

  const specs = generateTournamentBracket({ bracketType: effectiveBracketType, entrantIds: ids });
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`delete from rec_site_tournament_matches where tournament_id = $1`, [input.tournamentId]);
    const idByKey = new Map<string, string>();
    for (const spec of specs) {
      const inserted = await client.query(
        `
          insert into rec_site_tournament_matches
            (tournament_id, bracket_key, bracket_side, round, slot, player_a_user_id, player_b_user_id, status, required_streamer_user_id)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          returning id
        `,
        [
          input.tournamentId,
          spec.key,
          spec.side,
          spec.round,
          spec.slot,
          spec.playerA,
          spec.playerB,
          spec.playerA && spec.playerB ? "ready" : "pending",
          spec.playerA && spec.playerB ? spec.playerA : null,
        ],
      );
      idByKey.set(spec.key, String(inserted.rows[0].id));
    }
    for (const spec of specs) {
      const id = idByKey.get(spec.key);
      if (!id) continue;
      await client.query(
        `
          update rec_site_tournament_matches
          set feeds_winner_match_id = $2, feeds_winner_slot = $3,
              feeds_loser_match_id = $4, feeds_loser_slot = $5
          where id = $1
        `,
        [
          id,
          spec.winnerFeed ? idByKey.get(spec.winnerFeed.key) ?? null : null,
          spec.winnerFeed?.slot ?? null,
          spec.loserFeed ? idByKey.get(spec.loserFeed.key) ?? null : null,
          spec.loserFeed?.slot ?? null,
        ],
      );
    }
    let seed = 1;
    for (const userId of ids) {
      await client.query(
        `update rec_site_tournament_entrants set seed = $3 where tournament_id = $1 and user_id = $2`,
        [input.tournamentId, userId, seed],
      );
      seed += 1;
    }
    await client.query(
      `update rec_site_tournaments set status = 'locked', bracket_type = $2, locked_at = now(), updated_at = now() where id = $1`,
      [input.tournamentId, effectiveBracketType],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  await resolveByes(input.tournamentId);
  await maybeCompleteTournament(input.tournamentId);
  notifyDiscord(input.tournamentId);
  return getTournamentDetail({ recUserId: tournament.created_by_user_id, tournamentId: input.tournamentId });
}

async function creditPayout(userId: string, amount: number, tournamentId: string, place: string) {
  if (amount <= 0) return;
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: userId,
    p_amount: amount,
    p_league_id: null,
    p_description: `Tournament ${place} payout`,
    p_transaction_type: "tournament_payout",
    p_source: "site_tournament",
    p_source_reference: { tournamentId, place },
    p_allow_negative: false,
  });
  if (ledger.error) throw new ApiError(500, "Failed to pay tournament coins.", ledger.error);
}

function otherPlayer(match: MatchRow, winnerId: string): string | null {
  if (match.player_a_user_id === winnerId) return match.player_b_user_id;
  if (match.player_b_user_id === winnerId) return match.player_a_user_id;
  return null;
}

async function maybeCompleteTournament(tournamentId: string) {
  const tournament = await loadTournament(tournamentId);
  if (tournament.status !== "locked") return;
  const matches = await getPgPool().query(
    `select * from rec_site_tournament_matches where tournament_id = $1`,
    [tournamentId],
  );
  const rows = matches.rows as MatchRow[];
  const championship =
    rows.find((row) => row.bracket_side === "grand_final") ??
    rows
      .filter((row) => row.bracket_side === "winners")
      .sort((a, b) => b.round - a.round || a.slot - b.slot)[0];
  if (!championship?.winner_user_id || (championship.status !== "complete" && championship.status !== "bye")) {
    return;
  }

  const winnerId = championship.winner_user_id;
  const runnerUpId = otherPlayer(championship, winnerId);
  const wbRounds = Math.max(0, ...rows.filter((row) => row.bracket_side === "winners").map((row) => row.round));
  const semiLosers = rows
    .filter((row) => row.bracket_side === "winners" && row.round === wbRounds - 1 && row.winner_user_id)
    .map((row) => otherPlayer(row, row.winner_user_id!))
    .filter((id): id is string => Boolean(id) && id !== winnerId && id !== runnerUpId);

  const paid = new Set<string>();
  await creditPayout(winnerId, Number(tournament.winner_coins), tournamentId, "champion");
  paid.add(winnerId);
  if (tournament.payout_scope !== "winner" && runnerUpId) {
    await creditPayout(runnerUpId, Number(tournament.runner_up_coins), tournamentId, "runner-up");
    paid.add(runnerUpId);
  }
  if (tournament.payout_scope === "final_four") {
    for (const userId of semiLosers.slice(0, 2)) {
      if (paid.has(userId)) continue;
      await creditPayout(userId, Number(tournament.semifinalist_coins), tournamentId, "semifinalist");
      paid.add(userId);
    }
  }

  await getPgPool().query(
    `
      update rec_site_tournaments
      set status = 'complete', completed_at = now(), payouts_issued_at = now(), updated_at = now()
      where id = $1
    `,
    [tournamentId],
  );
}

// Shared by the admin-direct path (reportTournamentWinner when isAdmin) and
// approveTournamentMatchResult: applies an already-decided result -- bracket advance, wager
// settlement, global records, byes, tournament completion, Discord sync.
async function finalizeTournamentMatch(input: {
  tournamentId: string;
  match: MatchRow;
  winnerUserId: string;
  playerAScore: number | null;
  playerBScore: number | null;
}) {
  const { tournamentId, match, winnerUserId, playerAScore, playerBScore } = input;
  const loserId = otherPlayer(match, winnerUserId);
  if (loserId) {
    const winnerScore = winnerUserId === match.player_a_user_id ? playerAScore : playerBScore;
    const loserScore = winnerUserId === match.player_a_user_id ? playerBScore : playerAScore;
    await applyGlobalRecords(winnerUserId, loserId, winnerScore, loserScore);
  }
  await settleTournamentMatchWagers(match.id);
  if (match.feeds_winner_match_id && match.feeds_winner_slot) {
    await placePlayer(match.feeds_winner_match_id, match.feeds_winner_slot, winnerUserId);
    await refreshMatchReadiness(match.feeds_winner_match_id);
  }
  if (loserId && match.feeds_loser_match_id && match.feeds_loser_slot) {
    await placePlayer(match.feeds_loser_match_id, match.feeds_loser_slot, loserId);
    await refreshMatchReadiness(match.feeds_loser_match_id);
  }
  await resolveByes(tournamentId);
  await maybeCompleteTournament(tournamentId);
  notifyDiscord(tournamentId);
}

export async function reportTournamentWinner(input: {
  recUserId: string;
  isAdmin: boolean;
  tournamentId: string;
  matchId: string;
  winnerUserId: string;
  resultMethod: "final_screenshot" | "concede" | "opponent_quit";
  screenshotUrl: string | null;
  concededByUserId?: string | null;
  playerAScore?: number | null;
  playerBScore?: number | null;
}) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.event_paused) throw new ApiError(409, "This tournament is closed.");
  if (tournament.status !== "locked") throw new ApiError(409, "Results can only be recorded on a locked bracket.");
  // Only the final-score-screenshot method actually has a screenshot -- a concede/quit-out
  // report has nothing to attach.
  const screenshotUrl = (input.screenshotUrl ?? "").trim() || null;
  if (input.resultMethod === "final_screenshot" && (!screenshotUrl || !/^https?:\/\//i.test(screenshotUrl))) {
    throw new ApiError(400, "Upload a screenshot of the final score.");
  }
  const result = await getPgPool().query(
    `select * from rec_site_tournament_matches where id = $1 and tournament_id = $2`,
    [input.matchId, input.tournamentId],
  );
  const match = result.rows[0] as MatchRow | undefined;
  if (!match) throw new ApiError(404, "Match not found.");
  if (match.status === "complete" || match.status === "bye") throw new ApiError(409, "That match is already decided.");
  if (match.status === "pending_review") throw new ApiError(409, "A result for this match is already awaiting admin review.");
  const players = [match.player_a_user_id, match.player_b_user_id];
  if (!players.includes(input.winnerUserId)) throw new ApiError(400, "Winner must be one of the two players.");
  if (!match.player_a_user_id || !match.player_b_user_id) {
    throw new ApiError(409, "Both players must be set before recording a result.");
  }
  const inMatch = input.recUserId === match.player_a_user_id || input.recUserId === match.player_b_user_id;
  if (!input.isAdmin && !inMatch) throw new ApiError(403, "Only a player in this match or a site admin can report it.");
  let concededBy = input.concededByUserId ?? null;
  if (input.resultMethod === "concede" || input.resultMethod === "opponent_quit") {
    concededBy = concededBy || otherPlayer(match, input.winnerUserId);
    if (!concededBy || !players.includes(concededBy) || concededBy === input.winnerUserId) {
      throw new ApiError(400, input.resultMethod === "concede" ? "Concession must come from the player who lost." : "The quit-out must be attributed to the player who lost.");
    }
  } else {
    concededBy = null;
  }

  const playerAScore = input.playerAScore == null || !Number.isFinite(Number(input.playerAScore))
    ? null
    : Math.max(0, Math.trunc(Number(input.playerAScore)));
  const playerBScore = input.playerBScore == null || !Number.isFinite(Number(input.playerBScore))
    ? null
    : Math.max(0, Math.trunc(Number(input.playerBScore)));

  // Admin-submitted results are already trusted and apply immediately, exactly as before.
  // Player-submitted results now hold in pending_review until an admin approves them --
  // nothing (bracket, wagers, records) advances until then.
  const nextStatus = input.isAdmin ? "complete" : "pending_review";
  await getPgPool().query(
    `
      update rec_site_tournament_matches
      set winner_user_id = $2, status = $3, result_method = $4, screenshot_url = $5,
          conceded_by_user_id = $6, player_a_score = $7, player_b_score = $8, betting_open = false,
          submitted_by_user_id = $9, submitted_at = now()
      where id = $1
    `,
    [match.id, input.winnerUserId, nextStatus, input.resultMethod, screenshotUrl, concededBy, playerAScore, playerBScore,
      input.recUserId],
  );

  if (input.isAdmin) {
    await finalizeTournamentMatch({ tournamentId: input.tournamentId, match, winnerUserId: input.winnerUserId, playerAScore, playerBScore });
  }
  return getTournamentDetail({ recUserId: input.recUserId, tournamentId: input.tournamentId });
}

// Admin's review queue: every match currently awaiting approval, across all tournaments, with
// enough context (screenshot, matchup, submitted result) to decide without leaving the page.
export async function listTournamentMatchReviewQueue() {
  const result = await getPgPool().query(
    `
      select m.id, m.tournament_id, m.winner_user_id, m.result_method, m.screenshot_url,
        m.conceded_by_user_id, m.player_a_score, m.player_b_score, m.submitted_at,
        t.title as tournament_title,
        a.username as a_username, a.display_name as a_display_name,
        b.username as b_username, b.display_name as b_display_name,
        ea.team_name as a_team_name, eb.team_name as b_team_name,
        m.player_a_user_id, m.player_b_user_id
      from rec_site_tournament_matches m
      inner join rec_site_tournaments t on t.id = m.tournament_id
      left join rec_users a on a.id = m.player_a_user_id
      left join rec_users b on b.id = m.player_b_user_id
      left join rec_site_tournament_entrants ea on ea.tournament_id = m.tournament_id and ea.user_id = m.player_a_user_id
      left join rec_site_tournament_entrants eb on eb.tournament_id = m.tournament_id and eb.user_id = m.player_b_user_id
      where m.status = 'pending_review'
      order by m.submitted_at asc
    `,
  );
  return {
    queue: result.rows.map((row: any) => ({
      matchId: row.id,
      tournamentId: row.tournament_id,
      tournamentTitle: row.tournament_title,
      playerA: { userId: row.player_a_user_id, displayName: playerLabel({ username: row.a_username, display_name: row.a_display_name }), teamName: row.a_team_name ?? null },
      playerB: { userId: row.player_b_user_id, displayName: playerLabel({ username: row.b_username, display_name: row.b_display_name }), teamName: row.b_team_name ?? null },
      winnerUserId: row.winner_user_id,
      resultMethod: row.result_method,
      screenshotUrl: row.screenshot_url,
      concededByUserId: row.conceded_by_user_id,
      playerAScore: row.player_a_score,
      playerBScore: row.player_b_score,
      submittedAt: row.submitted_at,
    })),
  };
}

export async function approveTournamentMatchResult(input: { recUserId: string; matchId: string }) {
  const result = await getPgPool().query(`select * from rec_site_tournament_matches where id = $1`, [input.matchId]);
  const match = result.rows[0] as MatchRow | undefined;
  if (!match) throw new ApiError(404, "Match not found.");
  if (match.status !== "pending_review") throw new ApiError(409, "This match has no result awaiting review.");
  if (!match.winner_user_id) throw new ApiError(409, "No submitted result to approve.");
  await getPgPool().query(
    `update rec_site_tournament_matches set status = 'complete', reviewed_by_user_id = $2, reviewed_at = now() where id = $1`,
    [match.id, input.recUserId],
  );
  await finalizeTournamentMatch({
    tournamentId: match.tournament_id,
    match,
    winnerUserId: match.winner_user_id,
    playerAScore: match.player_a_score,
    playerBScore: match.player_b_score,
  });
  return { ok: true as const };
}

export async function rejectTournamentMatchResult(input: { recUserId: string; matchId: string }) {
  const result = await getPgPool().query(`select * from rec_site_tournament_matches where id = $1`, [input.matchId]);
  const match = result.rows[0] as MatchRow | undefined;
  if (!match) throw new ApiError(404, "Match not found.");
  if (match.status !== "pending_review") throw new ApiError(409, "This match has no result awaiting review.");
  await getPgPool().query(
    `
      update rec_site_tournament_matches
      set status = 'ready', winner_user_id = null, result_method = null, screenshot_url = null,
          conceded_by_user_id = null, player_a_score = null, player_b_score = null, box_score = null,
          betting_open = true, submitted_by_user_id = null, submitted_at = null,
          reviewed_by_user_id = $2, reviewed_at = now()
      where id = $1
    `,
    [match.id, input.recUserId],
  );
  return { ok: true as const };
}

export async function listTournamentTicker() {
  const result = await getPgPool().query(
    `
      select t.*,
        (select count(*)::int from rec_site_tournament_entrants e where e.tournament_id = t.id and e.entry_status = 'approved') as approved_count,
        (select count(*)::int from rec_site_tournament_entrants e where e.tournament_id = t.id and e.entry_status <> 'removed') as entrant_count
      from rec_site_tournaments t
      where t.status in ('open', 'locked')
      order by coalesce(t.kickoff_at, t.registration_closes_at, t.created_at) asc
      limit 8
    `,
  );
  return {
    items: result.rows.map((row) => publicTournament(row as TournamentRow, {
      entrantCount: Number(row.approved_count ?? row.entrant_count ?? 0),
      approvedCount: Number(row.approved_count ?? 0),
    })),
  };
}

export async function resolveKnownGamerTag(recUserId: string): Promise<string | null> {
  const profile = await getPgPool().query(
    `select gamer_tag from rec_comp_profiles where user_id = $1 and coalesce(gamer_tag, '') <> ''`,
    [recUserId],
  );
  const fromProfile = String(profile.rows[0]?.gamer_tag ?? "").trim();
  if (fromProfile) return fromProfile;
  const imported = await getPgPool().query(
    `
      select t.ea_username
      from rec_team_assignments a
      inner join rec_teams t on t.id = a.team_id
      where a.user_id = $1
        and a.assignment_status = 'active'
        and a.ended_at is null
        and coalesce(t.ea_username, '') <> ''
      order by a.started_at desc
      limit 1
    `,
    [recUserId],
  );
  const fromImport = String(imported.rows[0]?.ea_username ?? "").trim();
  return fromImport || null;
}

async function rememberGamerTag(recUserId: string, gamerTag: string) {
  await getPgPool().query(
    `
      insert into rec_comp_profiles (user_id, gamer_tag, updated_at)
      values ($1, $2, now())
      on conflict (user_id) do update set
        gamer_tag = excluded.gamer_tag,
        updated_at = now()
    `,
    [recUserId, gamerTag],
  );
}

function payoutBlurb(row: ReturnType<typeof publicTournament>): string {
  if (row.payoutScope === "winner") return `${row.winnerCoins.toLocaleString()} coins to the winner`;
  if (row.payoutScope === "final_two") {
    return `${row.winnerCoins.toLocaleString()} / ${row.runnerUpCoins.toLocaleString()} coins (winner / runner-up)`;
  }
  return `${row.winnerCoins.toLocaleString()} / ${row.runnerUpCoins.toLocaleString()} / ${row.semifinalistCoins.toLocaleString()} coins (winner / runner-up / each semi)`;
}

async function announceTournament(tournament: ReturnType<typeof publicTournament>) {
  const href = `/tournaments/${tournament.id}`;
  const title = `Tournament open: ${tournament.title}`;
  const body = [
    `0/${tournament.bracketSize ?? "—"} registered`,
    tournament.bracketLabel,
    payoutBlurb(tournament),
    tournament.rulesSummary,
    "Home player streams. Screenshot the final or a concede.",
  ].join(" · ");
  const announcement = await supabase
    .from("rec_site_announcements")
    .insert({
      title,
      body,
      href,
      published: true,
      sort_order: 0,
      starts_at: tournament.registrationOpensAt,
      ends_at: tournament.kickoffAt,
    })
    .select("id")
    .maybeSingle();
  if (announcement.data?.id) {
    await getPgPool().query(
      `update rec_site_tournaments set ticker_announcement_id = $2 where id = $1`,
      [tournament.id, announcement.data.id],
    );
  }
  await getPgPool().query(
    `
      insert into rec_site_notifications (user_id, kind, title, body, href)
      select id, 'tournament', $1, $2, $3
      from rec_users
      where status = 'active'
        and supabase_auth_user_id is not null
    `,
    [title, body, href],
  );
}

export async function setTournamentRegistrationOpen(input: { tournamentId: string; open: boolean }) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status === "complete" || tournament.status === "cancelled") {
    throw new ApiError(409, "This tournament is finished.");
  }
  if (input.open) {
    await getPgPool().query(
      `
        update rec_site_tournaments
        set registration_paused = false,
            registration_closes_at = case
              when registration_closes_at is not null and registration_closes_at <= now() then null
              else registration_closes_at
            end,
            updated_at = now()
        where id = $1
      `,
      [input.tournamentId],
    );
  } else {
    await getPgPool().query(
      `update rec_site_tournaments set registration_paused = true, updated_at = now() where id = $1`,
      [input.tournamentId],
    );
  }
  if (input.open) {
    await getPgPool().query(`update rec_site_tournaments set registration_open_announced_at = now() where id = $1`, [input.tournamentId]);
    void syncTournamentDiscordAnnouncements(input.tournamentId, { pingEveryone: "registration_open" }).catch((error) =>
      console.error("[ERROR] tournament announcement sync failed (non-fatal):", error));
  } else {
    notifyDiscord(input.tournamentId);
  }
  return { ok: true as const, registrationPaused: !input.open };
}

export async function setTournamentEventOpen(input: { tournamentId: string; open: boolean }) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status === "complete" || tournament.status === "cancelled") {
    throw new ApiError(409, "Finished tournaments cannot be reopened.");
  }
  await getPgPool().query(
    `update rec_site_tournaments set event_paused = $2, updated_at = now() where id = $1`,
    [input.tournamentId, !input.open],
  );
  notifyDiscord(input.tournamentId);
  return { ok: true as const, eventPaused: !input.open };
}

// Round-by-round scheduling only makes sense once the bracket exists -- round counts vary by
// size/style (a double-elim losers bracket has more rounds than its winners bracket), so this
// is set as a follow-up admin action after lockTournamentBracket generates every match row,
// rather than predicted at creation time.
export async function listTournamentRounds(input: { tournamentId: string }) {
  const matches = await getPgPool().query(
    `select distinct bracket_side, round from rec_site_tournament_matches where tournament_id = $1 order by bracket_side, round`,
    [input.tournamentId],
  );
  const schedules = await getPgPool().query(
    `select bracket_side, round, scheduled_at from rec_site_tournament_round_schedules where tournament_id = $1`,
    [input.tournamentId],
  );
  const scheduledByKey = new Map(schedules.rows.map((row) => [`${row.bracket_side}:${row.round}`, row.scheduled_at]));
  return {
    rounds: matches.rows.map((row) => ({
      bracketSide: row.bracket_side as string,
      round: Number(row.round),
      scheduledAt: scheduledByKey.get(`${row.bracket_side}:${row.round}`) ?? null,
    })),
  };
}

export async function setTournamentRoundSchedule(input: {
  tournamentId: string;
  bracketSide: "winners" | "losers" | "grand_final";
  round: number;
  scheduledAt: string;
}) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.schedule_mode !== "per_round") {
    throw new ApiError(409, "This tournament isn't using per-round scheduling.");
  }
  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw new ApiError(400, "Enter a valid date/time.");
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(
      `
        insert into rec_site_tournament_round_schedules (tournament_id, bracket_side, round, scheduled_at)
        values ($1, $2, $3, $4)
        on conflict (tournament_id, bracket_side, round) do update set scheduled_at = excluded.scheduled_at, updated_at = now()
      `,
      [input.tournamentId, input.bracketSide, input.round, scheduledAt.toISOString()],
    );
    await client.query(
      `update rec_site_tournament_matches set scheduled_at = $4 where tournament_id = $1 and bracket_side = $2 and round = $3`,
      [input.tournamentId, input.bracketSide, input.round, scheduledAt.toISOString()],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return listTournamentRounds({ tournamentId: input.tournamentId });
}

export async function addTournamentUser(input: {
  recUserId: string;
  tournamentId: string;
  userId: string;
  teamAbbr: string;
  gamerTag: string;
  into: "registration" | "tournament";
}) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status === "complete" || tournament.status === "cancelled") {
    throw new ApiError(409, "This tournament is finished.");
  }
  const team = resolveTeam(tournament.game, input.teamAbbr);
  const gamerTag = input.gamerTag.trim();
  if (gamerTag.length < 2 || gamerTag.length > 32) {
    throw new ApiError(400, "Enter a gamertag / PSN / EA name.");
  }
  const user = await getPgPool().query(`select id from rec_users where id = $1`, [input.userId]);
  if (!user.rows[0]) throw new ApiError(404, "User not found.");
  const status = input.into === "tournament" ? "approved" : "pending";
  if (status === "approved") {
    const meta = tournamentBracketType(tournament.bracket_type);
    const count = await getPgPool().query(
      `select count(*)::int as n from rec_site_tournament_entrants where tournament_id = $1 and entry_status = 'approved'`,
      [input.tournamentId],
    );
    if (Number(count.rows[0]?.n ?? 0) >= (meta?.size ?? 0)) {
      throw new ApiError(409, "The approved field is full for this bracket.");
    }
  }
  const existing = await getPgPool().query(
    `select entry_status, team_abbr from rec_site_tournament_entrants where tournament_id = $1 and user_id = $2`,
    [input.tournamentId, input.userId],
  );
  const upsert = async (client: Pick<PoolClient, "query">) => {
    if (existing.rows[0]) {
      await client.query(
        `
          update rec_site_tournament_entrants
          set entry_status = $3, team_abbr = $4, team_name = $5, gamer_tag = $6
          where tournament_id = $1 and user_id = $2
        `,
        [input.tournamentId, input.userId, status, team.abbr, team.name, gamerTag],
      );
    } else {
      await client.query(
        `
          insert into rec_site_tournament_entrants
            (tournament_id, user_id, team_abbr, team_name, gamer_tag, entry_status)
          values ($1, $2, $3, $4, $5, $6)
        `,
        [input.tournamentId, input.userId, team.abbr, team.name, gamerTag, status],
      );
    }
  };
  // Admin re-assigning the SAME user to the SAME team they already hold isn't a new claim.
  const isSameTeam = existing.rows[0]?.team_abbr === team.abbr;
  if (tournament.team_selection_mode === "claim_pool" && !isSameTeam) {
    await withClaimedTeamCheck(tournament.id, team.abbr, (client) => upsert(client));
  } else {
    await upsert(getPgPool());
  }
  await rememberGamerTag(input.userId, gamerTag);
  notifyDiscord(input.tournamentId);
  return getTournamentDetail({ recUserId: input.recUserId, tournamentId: input.tournamentId });
}

export async function setTournamentEntryStatus(input: {
  recUserId: string;
  tournamentId: string;
  userId: string;
  entryStatus: "pending" | "approved" | "removed";
}) {
  const tournament = await loadTournament(input.tournamentId);
  if (tournament.status === "complete") throw new ApiError(409, "Completed tournaments cannot change the field.");
  if (input.entryStatus === "approved") {
    const meta = tournamentBracketType(tournament.bracket_type);
    const count = await getPgPool().query(
      `select count(*)::int as n from rec_site_tournament_entrants where tournament_id = $1 and entry_status = 'approved' and user_id <> $2`,
      [input.tournamentId, input.userId],
    );
    if (Number(count.rows[0]?.n ?? 0) >= (meta?.size ?? 0)) {
      throw new ApiError(409, "The approved field is full for this bracket.");
    }
  }
  if (input.entryStatus === "removed" && tournament.status === "locked") {
    await forfeitUserMatches(input.tournamentId, input.userId);
  }
  const result = await getPgPool().query(
    `
      update rec_site_tournament_entrants
      set entry_status = $3
      where tournament_id = $1 and user_id = $2
      returning user_id
    `,
    [input.tournamentId, input.userId, input.entryStatus],
  );
  if (!result.rows[0]) throw new ApiError(404, "That user is not in this tournament.");
  if (input.entryStatus === "removed" && tournament.status === "open") {
    await getPgPool().query(
      `delete from rec_site_tournament_entrants where tournament_id = $1 and user_id = $2`,
      [input.tournamentId, input.userId],
    );
  }
  notifyDiscord(input.tournamentId);
  return getTournamentDetail({ recUserId: input.recUserId, tournamentId: input.tournamentId });
}

async function forfeitUserMatches(tournamentId: string, userId: string) {
  const matches = await getPgPool().query(
    `
      select * from rec_site_tournament_matches
      where tournament_id = $1
        and status in ('pending', 'ready')
        and (player_a_user_id = $2 or player_b_user_id = $2)
    `,
    [tournamentId, userId],
  );
  for (const match of matches.rows as MatchRow[]) {
    const winner = match.player_a_user_id === userId ? match.player_b_user_id : match.player_a_user_id;
    if (!winner) {
      await getPgPool().query(
        `update rec_site_tournament_matches set player_a_user_id = null, player_b_user_id = null, status = 'pending' where id = $1`,
        [match.id],
      );
      continue;
    }
    await getPgPool().query(
      `
        update rec_site_tournament_matches
        set winner_user_id = $2, status = 'bye', result_method = 'bye'
        where id = $1
      `,
      [match.id, winner],
    );
    if (match.feeds_winner_match_id && match.feeds_winner_slot) {
      await placePlayer(match.feeds_winner_match_id, match.feeds_winner_slot, winner);
      await refreshMatchReadiness(match.feeds_winner_match_id);
    }
    await refundTournamentMatchWagers(match.id, "Match forfeited.");
  }
  await resolveByes(tournamentId);
}

function recordLine(row: { wins?: number; losses?: number; ties?: number; pointDifferential?: number } | null) {
  if (!row) return "0-0";
  const record = Number(row.ties ?? 0) > 0
    ? `${Number(row.wins ?? 0)}-${Number(row.losses ?? 0)}-${Number(row.ties ?? 0)}`
    : `${Number(row.wins ?? 0)}-${Number(row.losses ?? 0)}`;
  const diff = Number(row.pointDifferential ?? 0);
  const signed = diff > 0 ? `+${diff}` : String(diff);
  return `${record} · ${signed}`;
}

async function loadGlobalRecords(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map<string, { wins: number; losses: number; ties: number; pointDifferential: number }>();
  const result = await getPgPool().query(
    `select user_id, wins, losses, ties, point_differential from rec_global_user_records where user_id = any($1::uuid[])`,
    [ids],
  );
  return new Map(result.rows.map((row) => [String(row.user_id), {
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    ties: Number(row.ties ?? 0),
    pointDifferential: Number(row.point_differential ?? 0),
  }]));
}

async function applyGlobalRecords(
  winnerId: string,
  loserId: string,
  winnerScore: number | null,
  loserScore: number | null,
) {
  const hasScores = winnerScore != null && loserScore != null;
  const wScore = hasScores ? Number(winnerScore) : 0;
  const lScore = hasScores ? Number(loserScore) : 0;
  const diff = hasScores ? wScore - lScore : 0;
  const close = hasScores && Math.abs(diff) <= 7 ? 1 : 0;
  const blow = hasScores && diff >= 22 ? 1 : 0;
  await bumpGlobalRecord(winnerId, { wins: 1, losses: 0, pf: wScore, pa: lScore, diff, close, blowWin: blow, blowLoss: 0 });
  await bumpGlobalRecord(loserId, { wins: 0, losses: 1, pf: lScore, pa: wScore, diff: -diff, close, blowWin: 0, blowLoss: blow });
}

async function bumpGlobalRecord(userId: string, delta: {
  wins: number;
  losses: number;
  pf: number;
  pa: number;
  diff: number;
  close: number;
  blowWin: number;
  blowLoss: number;
}) {
  await getPgPool().query(
    `
      insert into rec_global_user_records (
        user_id, wins, losses, ties, playoff_wins, playoff_losses, superbowl_wins, superbowl_losses,
        point_differential, close_games_within_7, blowout_wins_by_22_plus, blowout_losses_by_22_plus,
        points_for, points_against, games_played, avg_point_differential, created_at, updated_at
      )
      values ($1, $2, $3, 0, 0, 0, 0, 0, $4, $5, $6, $7, $8, $9, 1, $4, now(), now())
      on conflict (user_id) do update set
        wins = rec_global_user_records.wins + excluded.wins,
        losses = rec_global_user_records.losses + excluded.losses,
        point_differential = rec_global_user_records.point_differential + excluded.point_differential,
        close_games_within_7 = rec_global_user_records.close_games_within_7 + excluded.close_games_within_7,
        blowout_wins_by_22_plus = rec_global_user_records.blowout_wins_by_22_plus + excluded.blowout_wins_by_22_plus,
        blowout_losses_by_22_plus = rec_global_user_records.blowout_losses_by_22_plus + excluded.blowout_losses_by_22_plus,
        points_for = rec_global_user_records.points_for + excluded.points_for,
        points_against = rec_global_user_records.points_against + excluded.points_against,
        games_played = rec_global_user_records.games_played + 1,
        avg_point_differential = ((rec_global_user_records.point_differential + excluded.point_differential)::numeric
          / nullif(rec_global_user_records.games_played + 1, 0)),
        updated_at = now()
      where rec_global_user_records.legacy_locked is not true
    `,
    [userId, delta.wins, delta.losses, delta.diff, delta.close, delta.blowWin, delta.blowLoss, delta.pf, delta.pa],
  );
}

export async function listMyTournamentHome(input: { recUserId: string }) {
  const listed = await listTournaments(input);
  const mine = listed.tournaments.filter((row) => row.joined && (row.status === "open" || row.status === "locked"));
  const cards: Array<{
    tournament: ReturnType<typeof publicTournament>;
    you: { userId: string; displayName: string; teamAbbr: string | null; teamName: string | null; record: string } | null;
    opponent: { userId: string; displayName: string; teamAbbr: string | null; teamName: string | null; record: string } | null;
    match: { id: string; status: string; homeMustStream: boolean } | null;
  }> = [];
  for (const tournament of mine) {
    const detail = await getTournamentDetail({ recUserId: input.recUserId, tournamentId: tournament.id });
    const you = detail.entrants.find((entrant) => entrant.isYou) ?? null;
    const liveMatch = detail.matches.find((match) =>
      (match.playerA?.userId === input.recUserId || match.playerB?.userId === input.recUserId)
      && (match.status === "ready" || match.status === "pending"),
    ) ?? detail.matches.find((match) =>
      match.playerA?.userId === input.recUserId || match.playerB?.userId === input.recUserId,
    ) ?? null;
    const opponent = liveMatch
      ? (liveMatch.playerA?.userId === input.recUserId ? liveMatch.playerB : liveMatch.playerA)
      : null;
    const records = await loadGlobalRecords([
      you?.userId ?? input.recUserId,
      opponent?.userId ?? "",
    ]);
    const youRecord = records.get(input.recUserId) ?? null;
    const opponentRecord = opponent ? records.get(opponent.userId) ?? null : null;
    cards.push({
      tournament,
      you: you ? {
        userId: you.userId,
        displayName: you.displayName,
        teamAbbr: you.teamAbbr,
        teamName: you.teamName,
        record: recordLine(youRecord),
      } : null,
      opponent: opponent ? {
        userId: opponent.userId,
        displayName: opponent.displayName,
        teamAbbr: opponent.teamAbbr,
        teamName: opponent.teamName,
        record: recordLine(opponentRecord),
      } : null,
      match: liveMatch ? {
        id: liveMatch.id,
        status: liveMatch.status,
        homeMustStream: true,
      } : null,
    });
  }
  return { cards };
}

function requireHttpUrl(value: string, label: string) {
  const url = value.trim();
  if (!/^https?:\/\//i.test(url) || url.length > 500) throw new ApiError(400, `Enter a valid ${label}.`);
  return url;
}

async function loadMatch(tournamentId: string, matchId: string): Promise<MatchRow> {
  const result = await getPgPool().query(
    `select * from rec_site_tournament_matches where id = $1 and tournament_id = $2`,
    [matchId, tournamentId],
  );
  const match = result.rows[0] as MatchRow | undefined;
  if (!match) throw new ApiError(404, "Match not found.");
  return match;
}

function assertMatchParticipant(match: MatchRow, recUserId: string, isAdmin: boolean) {
  const inMatch = recUserId === match.player_a_user_id || recUserId === match.player_b_user_id;
  if (!isAdmin && !inMatch) throw new ApiError(403, "Only a player in this match can upload.");
}

export async function setTournamentMatchStream(input: {
  recUserId: string;
  isAdmin: boolean;
  tournamentId: string;
  matchId: string;
  streamUrl: string;
}) {
  const match = await loadMatch(input.tournamentId, input.matchId);
  // Only the required streamer (player_a, the stable first-seated slot) may set the stream link
  // -- an admin can still do it on their behalf. Sharing it is also what flips the match live;
  // a stream save from the non-required side must never trigger that.
  if (!input.isAdmin && match.required_streamer_user_id && input.recUserId !== match.required_streamer_user_id) {
    throw new ApiError(403, "Only the player required to stream can set the stream link.");
  }
  assertMatchParticipant(match, input.recUserId, input.isAdmin);
  const streamUrl = requireHttpUrl(input.streamUrl, "stream link");
  await getPgPool().query(`update rec_site_tournament_matches set stream_url = $2 where id = $1`, [match.id, streamUrl]);
  const { markTournamentMatchStarted } = await import("./tournament-match-scheduling.service.js");
  await markTournamentMatchStarted({ matchId: match.id, recUserId: input.recUserId, auto: true }).catch((error) =>
    console.error("[WARN] Failed to auto-start tournament match after stream save (non-fatal):", error));
  return getTournamentDetail({ recUserId: input.recUserId, tournamentId: input.tournamentId });
}

export async function listTournamentHighlights(input: { tournamentId: string; recUserId: string; isAdmin: boolean }) {
  return listTournamentStreamHighlights(input);
}

export async function reviewTournamentHighlight(input: {
  recUserId: string;
  highlightId: string;
  status: "approved" | "rejected";
}) {
  const result = await getPgPool().query(
    `select * from rec_site_tournament_highlights where id = $1`,
    [input.highlightId],
  );
  const row = result.rows[0] as {
    id: string;
    user_id: string;
    tournament_id: string;
    status: string;
    media_status: string | null;
    payout_issued_at: string | null;
  } | undefined;
  if (!row) throw new ApiError(404, "Highlight not found.");
  if (row.status !== "pending") throw new ApiError(409, "That highlight was already reviewed.");
  if (input.status === "approved" && row.media_status !== "ready") {
    throw new ApiError(409, "Wait until the clip finishes encoding before approving it.");
  }
  await getPgPool().query(
    `update rec_site_tournament_highlights set status = $2, payout_issued_at = case when $2 = 'approved' then now() else payout_issued_at end where id = $1`,
    [row.id, input.status],
  );
  if (input.status === "approved" && !row.payout_issued_at) {
    const ledger = await supabase.rpc("add_to_wallet", {
      p_user_id: row.user_id,
      p_amount: TOURNAMENT_HIGHLIGHT_COINS,
      p_league_id: null,
      p_description: "Approved tournament highlight",
      p_transaction_type: "tournament_highlight",
      p_source: "site_tournament",
      p_source_reference: { highlightId: row.id, tournamentId: row.tournament_id },
      p_allow_negative: false,
    });
    if (ledger.error) throw new ApiError(500, "Failed to pay highlight coins.", ledger.error);
  }
  return listTournamentHighlights({ tournamentId: row.tournament_id, recUserId: input.recUserId, isAdmin: true });
}

export async function setTournamentMatchBetting(input: { tournamentId: string; matchId: string; open: boolean }) {
  const match = await loadMatch(input.tournamentId, input.matchId);
  if (match.status === "complete" || match.status === "bye") throw new ApiError(409, "Finished matches stay closed.");
  await getPgPool().query(`update rec_site_tournament_matches set betting_open = $2 where id = $1`, [match.id, input.open]);
  return { ok: true as const, bettingOpen: input.open };
}

