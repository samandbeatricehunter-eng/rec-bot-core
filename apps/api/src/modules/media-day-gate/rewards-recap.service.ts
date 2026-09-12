// Rewards Recap (Post-Advance Experience, Phase C): the animated "here's what you earned last
// week" presentation that opens the Media Day gate, before any questions are shown. Reads
// straight from the Player XP / Franchise XP ledgers for the week that was just credited at
// advance (see weekly-challenge-issuance.service.ts's creditGradedWeeklyChallengesForLeagueAtAdvance
// and advance-results.service.ts's game_win/record_book crediting) rather than threading a bespoke
// event list through every crediting call site -- the ledger IS the authoritative record of what
// got paid, so reading it back is simpler and can't drift from what advance actually credited.
import { displayedXpFromPoints, XP_ECONOMY_POINTS_PER_XP, type WeeklyChallengeTier } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

export type RewardsRecapLine = { label: string; points: number };
export type RewardsRecapSubject = {
  subjectKey: string;
  name: string;
  kind: "player" | "franchise";
  beforePoints: number;
  afterPoints: number;
  beforeXp: number;
  afterXp: number;
  lines: RewardsRecapLine[];
};
export type RewardsRecapResult = { seasonNumber: number; weekNumber: number; subjects: RewardsRecapSubject[] };

function tierLabel(tier: unknown): string {
  const value = String(tier ?? "");
  return value ? value[0]!.toUpperCase() + value.slice(1) : "";
}

function labelForLedgerRow(eventType: string, metadata: Record<string, unknown> | null): string {
  const meta = metadata ?? {};
  if (eventType === "weekly_challenge") {
    const tier = tierLabel(meta.tier as WeeklyChallengeTier | undefined);
    const side = String(meta.side ?? "").replace("_", " ");
    return `Weekly challenge (${side}): ${tier}`;
  }
  if (eventType === "game_win") {
    if (meta.isNationalChampionship) return "Championship win";
    if (meta.isPlayoff) return "Playoff win";
    return "Game win";
  }
  if (eventType === "record_book") return "Broke a REC all-time record";
  return eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** One subject's before/after totals + this-week's lines, from a player's or franchise's ledger
 * rows for exactly this league/season/week. */
async function buildSubject(input: {
  subjectKey: string; name: string; kind: "player" | "franchise";
  ledgerTable: "rec_player_xp_ledger" | "rec_franchise_xp_ledger"; stateTable: "rec_player_xp_state" | "rec_franchise_xp_state";
  idColumn: "player_id" | "user_id"; idValue: string; leagueId: string; seasonNumber: number; weekNumber: number;
}): Promise<RewardsRecapSubject | null> {
  const pointsColumn = input.kind === "player" ? "awarded_xp" : "raw_fpp";
  const ledgerRows = await supabase.from(input.ledgerTable)
    .select(`event_type,metadata,${pointsColumn},created_at`)
    .eq("league_id", input.leagueId).eq(input.idColumn, input.idValue)
    .eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber)
    .order("created_at", { ascending: true });
  const rows = (ledgerRows.data ?? []) as Array<Record<string, unknown> & { event_type: string; metadata: Record<string, unknown> | null; created_at: string }>;
  if (!rows.length) return null;

  const lines = rows.map((row) => ({ label: labelForLedgerRow(row.event_type, row.metadata), points: Number(row[pointsColumn] ?? 0) }));
  const gainedPoints = lines.reduce((sum, line) => sum + line.points, 0);

  const stateColumn = input.kind === "player" ? "balance_xp" : "balance_fpp";
  const state = await supabase.from(input.stateTable).select(stateColumn)
    .eq("league_id", input.leagueId).eq(input.idColumn, input.idValue).maybeSingle();
  const afterPoints = Number((state.data as Record<string, unknown> | null)?.[stateColumn] ?? gainedPoints);
  const beforePoints = Math.max(0, afterPoints - gainedPoints);

  return {
    subjectKey: input.subjectKey, name: input.name, kind: input.kind,
    beforePoints, afterPoints, beforeXp: displayedXpFromPoints(beforePoints), afterXp: displayedXpFromPoints(afterPoints),
    lines,
  };
}

/** Resolves the caller's own team/players and builds the Recap for the most recently-completed
 * week/stage on record for their league -- the shape the Media Day gate actually needs (no
 * week/team to pass; always "what did I just earn"). */
export async function getRewardsRecap(input: { guildId: string; discordId: string }): Promise<RewardsRecapResult> {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = Number(league.season_number ?? league.display_season_number ?? 1);
  const weekNumber = Number(league.current_week ?? 1);

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const userId = account.data?.user_id ? String(account.data.user_id) : null;
  if (!userId) return { seasonNumber, weekNumber, subjects: [] };

  const assignment = await supabase.from("rec_team_assignments").select("team_id,team:rec_teams(name)")
    .eq("league_id", context.leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  const teamId = assignment.data?.team_id ? String(assignment.data.team_id) : null;
  const teamName = ((assignment.data as { team?: { name?: string } | null } | null)?.team?.name) ?? "Your team";

  const subjects: RewardsRecapSubject[] = [];
  if (teamId) {
    const franchise = await buildSubject({
      subjectKey: "franchise", name: teamName, kind: "franchise",
      ledgerTable: "rec_franchise_xp_ledger", stateTable: "rec_franchise_xp_state", idColumn: "user_id",
      idValue: userId, leagueId: context.leagueId, seasonNumber, weekNumber,
    });
    if (franchise) subjects.push(franchise);

    const players = await supabase.from("rec_players").select("id,full_name").eq("team_id", teamId);
    for (const player of players.data ?? []) {
      const subject = await buildSubject({
        subjectKey: `player:${player.id}`, name: String(player.full_name), kind: "player",
        ledgerTable: "rec_player_xp_ledger", stateTable: "rec_player_xp_state", idColumn: "player_id",
        idValue: String(player.id), leagueId: context.leagueId, seasonNumber, weekNumber,
      });
      if (subject) subjects.push(subject);
    }
  }

  return { seasonNumber, weekNumber, subjects };
}

export { XP_ECONOMY_POINTS_PER_XP };
