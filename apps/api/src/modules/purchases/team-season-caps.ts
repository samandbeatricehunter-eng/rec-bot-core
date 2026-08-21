/** Legend (and similar roster) season caps belong to the team, not the current owner.
 * A fulfilled Cam Newton bought by a previous Chargers coach still occupies a slot after
 * the team is reassigned — counting `rec_purchases.user_id` would let the new owner buy
 * up to the cap again. */

export type TeamScopedPurchaseRow = {
  team_id?: string | null;
  details?: Record<string, unknown> | null;
};

export type RosterLegendRow = {
  full_name?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

export function normalizeLegendName(name: string | null | undefined): string {
  return String(name ?? "").trim().toLowerCase();
}

export function purchaseBelongsToTeam(row: TeamScopedPurchaseRow, teamId: string): boolean {
  if (row.team_id === teamId) return true;
  const details = row.details ?? {};
  return details.purchasingTeamId === teamId || details.teamId === teamId;
}

function legendIdentity(details: Record<string, unknown> | null | undefined): { legendId: string | null; name: string } {
  const legendId = typeof details?.legendId === "string" && details.legendId ? details.legendId : null;
  const name = normalizeLegendName(typeof details?.name === "string" ? details.name : null);
  return { legendId, name };
}

/** Distinct legend slots on a team: active purchases for that team, plus roster legends
 * that aren't already represented by a purchase (inherited / imported without a row). */
export function countTeamLegendSlots(input: {
  teamId: string;
  purchases: TeamScopedPurchaseRow[];
  rosterLegends: RosterLegendRow[];
}): number {
  const teamPurchases = input.purchases.filter((row) => purchaseBelongsToTeam(row, input.teamId));
  const legendIds = new Set<string>();
  const names = new Set<string>();
  for (const row of teamPurchases) {
    const { legendId, name } = legendIdentity(row.details);
    if (legendId) legendIds.add(legendId);
    if (name) names.add(name);
  }
  let extra = 0;
  for (const player of input.rosterLegends) {
    const payload = player.raw_payload ?? {};
    const legendId = typeof payload.legendId === "string" && payload.legendId ? payload.legendId : null;
    const name = normalizeLegendName(player.full_name);
    if (legendId && legendIds.has(legendId)) continue;
    if (name && names.has(name)) continue;
    extra += 1;
    if (name) names.add(name);
  }
  return teamPurchases.length + extra;
}
