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
