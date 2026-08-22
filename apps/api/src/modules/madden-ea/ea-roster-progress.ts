export type RosterWriteResult = {
  records: number;
  written: number;
  skipped: number;
  duplicate: boolean;
};

/** Progress count for a roster/FA write. Unchanged (hash-skipped) rows still count — otherwise
 *  a reimport reports "0 records" even though EA returned a full roster. */
export function rosterWriteResult(written: number, skipped: number): RosterWriteResult {
  return {
    written,
    skipped,
    records: written + skipped,
    duplicate: written === 0 && skipped > 0,
  };
}

/** Unchanged roster blob: skip the round trip unless team/FA status actually moved. */
export function rosterUnchangedWrite(
  existing: { hash: string; teamId: string | null; isFreeAgent: boolean } | undefined,
  next: { hash: string; teamId: string | null; isFreeAgent: boolean },
): "full" | "status" | "skip" {
  if (!existing || existing.hash !== next.hash) return "full";
  const sameFa = existing.isFreeAgent === next.isFreeAgent;
  const sameTeam = next.isFreeAgent
    ? existing.teamId == null
    : next.teamId == null || existing.teamId === next.teamId;
  return sameFa && sameTeam ? "skip" : "status";
}
