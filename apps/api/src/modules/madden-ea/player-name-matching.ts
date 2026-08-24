// Pure name-normalization/fuzzy-matching helpers for restoring a player's photo_url across EA
// re-imports when their madden_player_id changes (EA does this on re-signs/roster-ID
// reassignment) and only a name-based match can find the old row. No DB imports, so this is
// directly unit-testable and safe to import from a test without pulling in a live Supabase
// client (ea-connections.service.ts, the only real caller, has heavy module-scope dependencies
// that aren't safe to import outside the running server process).

/** Lowercased, accent-stripped, punctuation-stripped, whitespace-collapsed -- fixes the common
 *  drift between two names that are "the same" but spelled/typed slightly differently across
 *  imports (O'Brien vs OBrien, a stray period, curly vs straight apostrophes, double spaces). */
export function normalizePlayerName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents (combining diacritical marks)
    .toLowerCase()
    .replace(/['".,-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Classic edit distance -- small, dependency-free, and all that's needed for short name
 *  strings (rosters run to a few hundred names at most). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[b.length];
}
