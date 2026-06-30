import { evaluatePayoutTier, nextPayoutTier, type RecEndSeasonPayoutDefinition } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";
import { TEAM_DEFINITIONS, evalTeamStat } from "./eos-payouts.service.js";
import { GLOBAL_BADGES, SEASON_BADGES, WEEKLY_BADGES } from "../box-score-intelligence/badge-rules.js";

// Human label for any badge key, across all scopes.
const BADGE_LABEL = new Map(
  [...WEEKLY_BADGES, ...SEASON_BADGES, ...GLOBAL_BADGES].map((badge) => [badge.key, badge.label] as const),
);
const badgeLabel = (key: string) => BADGE_LABEL.get(key) ?? key;

type BadgeSnapshotEntry = { badge_key: string; badge_scope: string | null; tier: string | null; current_streak: number | null };
type BadgeState = Record<string, BadgeSnapshotEntry[]>;

// ─── Per-advance run marker (written at the end of completeAdvanceWeek) ─────────
// Records the advance timestamp (anchor for "since the previous advance" windows)
// and a snapshot of every active badge per user, so the NEXT advance can diff
// gained / maintained / lost badges for each coach.

export async function recordAdvanceDmRun(input: {
  leagueId: string;
  seasonNumber: number;
  fromWeek: number;
  toWeek: number;
  advancedByDiscordId: string | null;
}): Promise<void> {
  const { data: ownership, error } = await supabase
    .from("rec_badge_ownership")
    .select("user_id,badge_key,badge_scope,tier,current_streak")
    .eq("league_id", input.leagueId)
    .eq("season", input.seasonNumber)
    .eq("active", true);
  if (error) {
    console.error("[ERROR] Failed to snapshot badge ownership for advance DM run:", error);
  }

  const badgeState: BadgeState = {};
  for (const row of ownership ?? []) {
    if (!row.user_id) continue;
    (badgeState[row.user_id] ??= []).push({
      badge_key: row.badge_key,
      badge_scope: row.badge_scope,
      tier: row.tier,
      current_streak: row.current_streak,
    });
  }

  const { error: insertError } = await supabase.from("rec_advance_dm_runs").insert({
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    from_week: input.fromWeek,
    to_week: input.toWeek,
    advanced_by_discord_id: input.advancedByDiscordId,
    badge_state: badgeState,
  });
  if (insertError) console.error("[ERROR] Failed to insert advance DM run:", insertError);
}

// ─── DM payload generation (called when the commissioner confirms sending) ──────

export type AdvanceDmUser = {
  discordId: string;
  displayName: string;
  teamName: string | null;
  sections: {
    transactions: string | null;
    badges: string | null;
    eosProgress: string | null;
    powerRanking: string | null;
  };
};

export type AdvanceDmPayload = {
  users: AdvanceDmUser[];
  fromWeek: number | null;
  toWeek: number | null;
  seasonNumber: number;
  reason?: string;
};

export async function generateAdvanceDms(input: { guildId: string }): Promise<AdvanceDmPayload> {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);

  // The latest run is the advance that just completed; the one before it bounds
  // the "since previous advance" window.
  const { data: runs, error: runsError } = await supabase
    .from("rec_advance_dm_runs")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .order("advanced_at", { ascending: false })
    .limit(2);
  if (runsError) throw runsError;
  const latest = runs?.[0] ?? null;
  const previous = runs?.[1] ?? null;
  if (!latest) return { users: [], fromWeek: null, toWeek: null, seasonNumber, reason: "no_run" };

  const windowStart: string | null = previous?.advanced_at ?? null;
  const windowEnd: string = latest.advanced_at;
  const fromWeek: number = latest.from_week;
  const toWeek: number = latest.to_week;
  const latestState = (latest.badge_state ?? {}) as BadgeState;
  const prevState = (previous?.badge_state ?? {}) as BadgeState;

  // Active linked coaches (team assignment ⋈ discord account).
  const { data: assignments, error: assignError } = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (assignError) throw assignError;

  const teamByUser = new Map<string, string>();
  for (const row of assignments ?? []) if (row.user_id && row.team_id) teamByUser.set(row.user_id, row.team_id);
  const userIds = [...teamByUser.keys()];
  if (!userIds.length) return { users: [], fromWeek, toWeek, seasonNumber, reason: "no_linked_users" };

  const { data: accounts } = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id,username,global_name")
    .in("user_id", userIds);
  const accountByUser = new Map((accounts ?? []).map((a) => [a.user_id, a]));

  // Transactions in the window, grouped by user.
  let ledgerQuery = supabase
    .from("rec_dollar_ledger")
    .select("user_id,amount,description,transaction_type,created_at")
    .eq("league_id", leagueId)
    .in("user_id", userIds)
    .lte("created_at", windowEnd)
    .order("created_at", { ascending: true });
  if (windowStart) ledgerQuery = ledgerQuery.gt("created_at", windowStart);
  const { data: ledger } = await ledgerQuery;
  const ledgerByUser = new Map<string, any[]>();
  for (const row of ledger ?? []) {
    if (!row.user_id) continue;
    (ledgerByUser.get(row.user_id) ?? ledgerByUser.set(row.user_id, []).get(row.user_id)!).push(row);
  }

  // Power rankings for the completed week (gives each team rank + prevRank).
  const rankings = await computePowerRankings(input.guildId, null, { completedWeekNumber: fromWeek }).catch((err) => {
    console.error("[ERROR] Power rankings load failed for advance DMs (non-fatal):", err);
    return null;
  });
  const rankByTeam = new Map<string, { rank: number; prevRank: number | null; change: number | null }>();
  for (const team of (rankings?.teams ?? []) as any[]) {
    rankByTeam.set(team.teamId, { rank: team.rank, prevRank: team.prevRank ?? null, change: team.change ?? null });
  }

  // EOS team-stat progress only applies to regular-season advances (into wk 2–18).
  const eosApplicable = toWeek >= 2 && toWeek <= 18;
  const statsByUser = eosApplicable ? await loadTeamStatsByUser(leagueId, seasonNumber, fromWeek, userIds) : new Map();

  const users: AdvanceDmUser[] = [];
  for (const userId of userIds) {
    const account = accountByUser.get(userId);
    if (!account?.discord_id) continue;
    const teamId = teamByUser.get(userId) ?? null;

    const sections = {
      transactions: buildTransactionsSection(ledgerByUser.get(userId) ?? []),
      badges: buildBadgesSection(prevState[userId] ?? [], latestState[userId] ?? []),
      eosProgress: eosApplicable ? buildEosProgressSection(statsByUser.get(userId) ?? []) : null,
      powerRanking: teamId ? buildPowerRankingSection(rankByTeam.get(teamId)) : null,
    };

    users.push({
      discordId: account.discord_id,
      displayName: account.global_name ?? account.username ?? "Coach",
      teamName: null,
      sections,
    });
  }

  return { users, fromWeek, toWeek, seasonNumber };
}

async function loadTeamStatsByUser(leagueId: string, seasonNumber: number, throughWeek: number, userIds: string[]) {
  const { data } = await supabase
    .from("rec_team_game_stats")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lte("week_number", throughWeek)
    .in("user_id", userIds);
  const byUser = new Map<string, any[]>();
  for (const row of data ?? []) {
    if (!row.user_id) continue;
    (byUser.get(row.user_id) ?? byUser.set(row.user_id, []).get(row.user_id)!).push(row);
  }
  return byUser;
}

// ─── Section formatters ─────────────────────────────────────────────────────────

const money = (amount: number) => `${amount < 0 ? "-" : "+"}$${Math.abs(amount)}`;

function buildTransactionsSection(rows: any[]): string | null {
  if (!rows.length) return null;
  const incoming = rows.filter((r) => Number(r.amount) > 0);
  const outgoing = rows.filter((r) => Number(r.amount) < 0);
  const net = rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  const lines: string[] = [`**Net: ${money(net)}**`];
  const fmt = (r: any) => `• ${money(Number(r.amount))} — ${String(r.description ?? r.transaction_type ?? "Transaction").slice(0, 80)}`;

  if (incoming.length) {
    lines.push("__Earned / received__");
    lines.push(...incoming.slice(0, 10).map(fmt));
    if (incoming.length > 10) lines.push(`• …and ${incoming.length - 10} more`);
  }
  if (outgoing.length) {
    lines.push("__Spent / paid out__");
    lines.push(...outgoing.slice(0, 6).map(fmt));
    if (outgoing.length > 6) lines.push(`• …and ${outgoing.length - 6} more`);
  }
  return lines.join("\n").slice(0, 1024);
}

function buildBadgesSection(prev: BadgeSnapshotEntry[], now: BadgeSnapshotEntry[]): string | null {
  const prevByKey = new Map(prev.map((b) => [b.badge_key, b]));
  const nowByKey = new Map(now.map((b) => [b.badge_key, b]));

  const gained = now.filter((b) => !prevByKey.has(b.badge_key));
  const lost = prev.filter((b) => !nowByKey.has(b.badge_key));
  const maintained = now.filter((b) => prevByKey.has(b.badge_key));

  // Season conversions: season-scope badges newly earned, or whose tier changed.
  const seasonConversions = now.filter((b) => {
    if (b.badge_scope !== "season") return false;
    const before = prevByKey.get(b.badge_key);
    return !before || before.tier !== b.tier;
  });

  if (!gained.length && !lost.length && !maintained.length && !seasonConversions.length) return null;

  const lines: string[] = [];
  if (gained.length) lines.push(`**Gained (${gained.length}):** ${gained.map((b) => badgeLabel(b.badge_key)).join(", ")}`);
  if (maintained.length) lines.push(`**Maintained (${maintained.length}):** ${maintained.map((b) => badgeLabel(b.badge_key)).join(", ")}`);
  if (lost.length) lines.push(`**Lost (${lost.length}):** ${lost.map((b) => badgeLabel(b.badge_key)).join(", ")}`);
  if (seasonConversions.length) {
    lines.push(
      "**Season badges:** " +
        seasonConversions.map((b) => `${badgeLabel(b.badge_key)}${b.tier ? ` (${String(b.tier).toUpperCase()})` : ""}`).join(", "),
    );
  }
  return lines.join("\n").slice(0, 1024);
}

function tierTarget(def: RecEndSeasonPayoutDefinition, value: number): string {
  const current = evaluatePayoutTier(value, def.tiers);
  const next = nextPayoutTier(value, def.tiers);
  const shown = Math.round(value * 10) / 10;
  const currentLabel = current ? `Tier ${current.tier} ($${current.amount})` : "no tier yet";
  if (!next) return `**${def.label}:** ${shown} — ${currentLabel} (max tier reached)`;
  const verb = def.direction === "lower_is_better" ? "≤" : "≥";
  return `**${def.label}:** ${shown} — ${currentLabel} → need ${verb}${next.threshold} for Tier ${next.tier} ($${next.amount})`;
}

function buildEosProgressSection(rows: any[]): string | null {
  if (!rows.length) return null;
  const lines = TEAM_DEFINITIONS.map((def) => tierTarget(def, evalTeamStat(def.statKey, rows)));
  if (!lines.length) return null;
  return lines.join("\n").slice(0, 1024);
}

function buildPowerRankingSection(entry: { rank: number; prevRank: number | null; change: number | null } | undefined): string | null {
  if (!entry) return null;
  if (entry.prevRank == null) return `Now ranked **#${entry.rank}** (first ranking of the season).`;
  const move =
    entry.change == null || entry.change === 0
      ? "no change"
      : entry.change > 0
        ? `up ${entry.change}`
        : `down ${Math.abs(entry.change)}`;
  return `**#${entry.prevRank} → #${entry.rank}** (${move})`;
}
