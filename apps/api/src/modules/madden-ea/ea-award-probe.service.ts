// Read-only diagnostic probe for native EA/Blaze Player-of-the-Week / league-award data.
//
// REC's own "Player of the Week" (player-of-week.service.ts / player-of-week-award.service.ts)
// is entirely computed from imported box-score stats -- nothing in this codebase has ever read
// or stored an EA-native award. Commissioners have observed League Hub state fields (e.g.
// isWeeklyAwardsPeriodActive) that this codebase's EaLeagueResponse type never captured (see
// ea-constants.ts) because getLeagueInfo() only reads a handful of named fields off the raw
// response -- anything else EA sends passes through the JSON parse invisibly. This probe:
//   1. re-fetches Mobile_Career_GetLeagueHub (already known to work, commandId 811) and keeps
//      the FULL raw response instead of the narrow typed slice, and
//   2. tries a small, hand-picked whitelist of speculative Mobile_Career_/Mobile_NewsCenter_
//      commandNames guessed from EA's own naming convention for every other Mobile_Career_Get*
//      command this codebase already calls.
// Every attempt -- success or failure -- is logged verbatim to rec_ea_award_probes so the raw
// payloads can be inspected directly via SQL. This never writes to the franchise: every
// candidate is phrased as a read ("Get...") and runDiagnosticProbe never issues anything but
// a Blaze RPC fetch.
//
// This intentionally does NOT accept a commandName (or componentId/commandId) from the caller
// -- the whitelist below is the only thing that can ever be sent to EA from this module.

import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { withEaAdminSession } from "./ea-connections.service.js";
import type { EaClient } from "./ea-client.js";

type ProbeCandidate = {
  key: string;
  commandName: string;
  componentId?: number;
  commandId?: number;
  description: string;
};

// componentId/commandId are deliberately omitted for every speculative entry: sendBlazeRpc
// resolves a command purely from commandName + componentName when they're absent (see the
// comment above sendBlazeRpc in ea-client.ts), so a wrong guess here just fails to resolve
// instead of risking a wrong *numeric* id accidentally matching an unrelated real command.
const AWARD_PROBE_CANDIDATES: ProbeCandidate[] = [
  {
    key: "league_hub_raw",
    commandName: "Mobile_Career_GetLeagueHub",
    commandId: 811,
    description: "Full raw League Hub response (known-good command; typed getLeagueInfo() only reads a handful of its fields).",
  },
  { key: "get_awards", commandName: "Mobile_Career_GetAwards", description: "Speculative: league/season award winners." },
  { key: "get_league_awards", commandName: "Mobile_Career_GetLeagueAwards", description: "Speculative: league award winners." },
  { key: "get_weekly_awards", commandName: "Mobile_Career_GetWeeklyAwards", description: "Speculative: weekly award winners (POTW)." },
  { key: "get_award_winners", commandName: "Mobile_Career_GetAwardWinners", description: "Speculative: award winners by name." },
  { key: "get_player_awards", commandName: "Mobile_Career_GetPlayerAwards", description: "Speculative: per-player award history." },
  { key: "get_season_awards", commandName: "Mobile_Career_GetSeasonAwards", description: "Speculative: annual/EOS award winners." },
  { key: "get_news", commandName: "Mobile_Career_GetNews", description: "Speculative: League Hub news feed." },
  { key: "get_league_news", commandName: "Mobile_Career_GetLeagueNews", description: "Speculative: league news feed." },
  { key: "get_franchise_news", commandName: "Mobile_Career_GetFranchiseNews", description: "Speculative: franchise story/news feed." },
  { key: "get_activity_feed", commandName: "Mobile_Career_GetActivityFeed", description: "Speculative: league activity/events feed." },
  { key: "newscenter_get_news", commandName: "Mobile_NewsCenter_GetNews", description: "Speculative: separate News Center component." },
];

const AWARD_KEYWORDS = [
  "award", "potw", "playerofweek", "player_of_week", "weeklyaward", "annualaward",
  "awardtype", "awardwinner", "newscenter", "franchisenews", "leaguenews",
  "leagueevent", "activityfeed", "story", "stories",
];

export type AwardKeywordHit = { path: string; keyword: string; snippet: string };

/** Recursively walks a parsed JSON value looking for award/news-shaped keys or string values. */
export function scanForAwardKeywords(value: unknown, path = "$", hits: AwardKeywordHit[] = [], depth = 0): AwardKeywordHit[] {
  if (hits.length >= 100 || depth > 10) return hits;
  if (value == null) return hits;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    const keyword = AWARD_KEYWORDS.find((candidate) => lower.includes(candidate));
    if (keyword) hits.push({ path, keyword, snippet: value.slice(0, 200) });
    return hits;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && hits.length < 100; i += 1) scanForAwardKeywords(value[i], `${path}[${i}]`, hits, depth + 1);
    return hits;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (hits.length >= 100) break;
      const lowerKey = key.toLowerCase();
      const keywordInKey = AWARD_KEYWORDS.find((candidate) => lowerKey.includes(candidate));
      if (keywordInKey) hits.push({ path: `${path}.${key}`, keyword: keywordInKey, snippet: "(key match)" });
      scanForAwardKeywords(nested, `${path}.${key}`, hits, depth + 1);
    }
    return hits;
  }
  return hits;
}

async function recordProbe(
  leagueId: string,
  candidate: ProbeCandidate,
  requestPayload: Record<string, unknown>,
  triggeredByDiscordId: string | null,
  outcome:
    | { status: "success"; response: unknown; matched: AwardKeywordHit[] }
    | { status: "error"; error: string },
) {
  await getPgPool().query(
    `insert into rec_ea_award_probes
       (league_id, probe_key, command_name, component_id, command_id, request_payload,
        status, response_payload, matched_award_keywords, error_message, triggered_by_discord_id)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11)`,
    [
      leagueId, candidate.key, candidate.commandName, candidate.componentId ?? null, candidate.commandId ?? null,
      JSON.stringify(requestPayload), outcome.status,
      outcome.status === "success" ? JSON.stringify(outcome.response ?? null) : null,
      outcome.status === "success" ? JSON.stringify(outcome.matched) : null,
      outcome.status === "error" ? outcome.error : null,
      triggeredByDiscordId,
    ],
  ).catch((error) => console.error("[EA award probe] Failed to write probe row (non-fatal):", error));
}

export type AwardProbeResult = {
  key: string;
  commandName: string;
  description: string;
  status: "success" | "error";
  matchedKeywords: AwardKeywordHit[];
  errorMessage: string | null;
};

/**
 * Runs the full award-probe whitelist against a league's live EA connection, once, and logs
 * every attempt to rec_ea_award_probes for SQL inspection. Never touches the franchise -- every
 * candidate is a read command and no write RPC is ever invoked. All candidates share a single
 * Blaze session (bootstrapped once by withEaAdminSession) rather than re-authenticating per
 * attempt, since EA rate-limits logins.
 */
export async function probeEaAwards(leagueId: string, triggeredByDiscordId: string | null): Promise<AwardProbeResult[]> {
  const ran = await withEaAdminSession(leagueId, async (client: EaClient, eaLeagueId: number) => {
    const results: AwardProbeResult[] = [];
    for (const candidate of AWARD_PROBE_CANDIDATES) {
      const requestPayload = { leagueId: eaLeagueId };
      try {
        const response = await client.runDiagnosticProbe({
          commandName: candidate.commandName,
          componentId: candidate.componentId,
          commandId: candidate.commandId,
          requestPayload,
        });
        const matched = scanForAwardKeywords(response);
        await recordProbe(leagueId, candidate, requestPayload, triggeredByDiscordId, { status: "success", response, matched });
        results.push({ key: candidate.key, commandName: candidate.commandName, description: candidate.description, status: "success", matchedKeywords: matched, errorMessage: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordProbe(leagueId, candidate, requestPayload, triggeredByDiscordId, { status: "error", error: message });
        results.push({ key: candidate.key, commandName: candidate.commandName, description: candidate.description, status: "error", matchedKeywords: [], errorMessage: message });
      }
    }
    return results;
  });
  if (ran === null) throw new ApiError(409, "This league isn't connected to EA yet.");
  return ran;
}

export type StoredAwardProbe = {
  id: string;
  probeKey: string;
  commandName: string;
  status: string;
  matchedKeywords: AwardKeywordHit[] | null;
  errorMessage: string | null;
  createdAt: string;
};

/** Lists previously-run probe results for a league -- does not re-run anything against EA. */
export async function listEaAwardProbes(leagueId: string): Promise<StoredAwardProbe[]> {
  const result = await getPgPool().query<{
    id: string;
    probe_key: string;
    command_name: string;
    status: string;
    matched_award_keywords: AwardKeywordHit[] | null;
    error_message: string | null;
    created_at: string;
  }>(
    `select id, probe_key, command_name, status, matched_award_keywords, error_message, created_at
       from rec_ea_award_probes where league_id=$1 order by created_at desc limit 50`,
    [leagueId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    probeKey: row.probe_key,
    commandName: row.command_name,
    status: row.status,
    matchedKeywords: row.matched_award_keywords,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  }));
}
