// Fuzzy team-name matching shared by CFB features that read free-text team names off
// a screenshot instead of a fixed abbreviation — CFB team identity can be a base
// school name, a custom relocated city/mascot, or (from box-score OCR) a garbled
// mix of both, so matching leans on normalized string similarity across every label
// a team could plausibly be shown under rather than an exact/abbreviation match.
// Originally built for the CFB Team Schedule import (cfb-team-schedule.service.ts);
// reused by the CFB box-score parser's team-resolution fallback.

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export type TeamNameCandidate = { id: string; labels: string[] };

export function buildTeamNameCandidates(team: {
  id: string;
  name?: string | null;
  abbreviation?: string | null;
  display_abbr?: string | null;
  display_city?: string | null;
  display_nick?: string | null;
}): TeamNameCandidate {
  const labels = [
    team.name,
    team.abbreviation,
    team.display_abbr,
    team.display_city,
    team.display_nick,
    team.display_city && team.display_nick ? `${team.display_city} ${team.display_nick}` : null,
  ].filter((v): v is string => Boolean(v && v.trim()));
  return { id: team.id, labels };
}

// Best-match score in [0,1]; null if there's nothing to compare.
export function matchTeamByName(raw: string | null, candidates: TeamNameCandidate[]): { teamId: string; score: number } | null {
  if (!raw) return null;
  const target = normalizeName(raw);
  if (!target) return null;
  let best: { teamId: string; score: number } | null = null;
  for (const candidate of candidates) {
    for (const label of candidate.labels) {
      const normLabel = normalizeName(label);
      if (!normLabel) continue;
      if (normLabel === target) return { teamId: candidate.id, score: 1 };
      const dist = levenshtein(target, normLabel);
      const maxLen = Math.max(target.length, normLabel.length);
      const similarity = maxLen ? 1 - dist / maxLen : 0;
      const containment = normLabel.includes(target) || target.includes(normLabel) ? 0.15 : 0;
      const score = Math.min(1, similarity + containment);
      if (!best || score > best.score) best = { teamId: candidate.id, score };
    }
  }
  return best;
}

// Matches below this are surfaced but not auto-selected.
export const TEAM_NAME_AUTO_MATCH_THRESHOLD = 0.72;

// Recognizable-in-a-noisy-blob threshold — deliberately lower than the schedule
// import's AUTO_MATCH_THRESHOLD since box-score team panels OCR far noisier.
export const TEAM_NAME_BLOB_MATCH_THRESHOLD = 0.6;

// Looser variant for matching against a noisy multi-word OCR blob (e.g. a box-score
// screenshot's team panel, which mixes the real name in with garbled UI chrome)
// rather than a single relatively clean opponent-name string. Scores by what
// fraction of a candidate label's significant (4+ letter) words turn up anywhere
// in the blob — whole-string similarity would otherwise tank a genuine match
// just because of the extra noise tokens diluting the ratio.
//
// Guards against ambiguity the same way matchTeamByName's callers do for
// abbreviations: when the blob is searched across every league team (not just
// checked against one known candidate), two different teams landing within 0.15
// of each other above the pass threshold is treated as no match at all — safer
// than silently resolving to the wrong school.
export function matchTeamNameInBlob(blob: string, candidates: TeamNameCandidate[]): { teamId: string; score: number } | null {
  const normBlob = normalizeName(blob);
  if (!normBlob) return null;

  const scored = candidates.map((candidate) => {
    let best = 0;
    for (const label of candidate.labels) {
      const words = label
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map(normalizeName)
        .filter((w) => w.length >= 4);
      if (!words.length) continue;
      const hits = words.filter((w) => normBlob.includes(w)).length;
      const score = hits / words.length;
      if (score > best) best = score;
    }
    return { teamId: candidate.id, score: best };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score === 0) return null;
  const runnerUp = scored.find((c) => c.teamId !== top.teamId);
  if (runnerUp && top.score >= TEAM_NAME_BLOB_MATCH_THRESHOLD && top.score - runnerUp.score < 0.15) {
    return null;
  }
  return top;
}
