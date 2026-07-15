import { STATS_Y_MIN, LEFT_VAL_X_MAX, RIGHT_VAL_X_MIN, type NormalizedWord, type ParsedStat, type LabelAliases, type MatchVia, STAT_LABEL_MAP } from "./box-score.parser.types.js";
import { groupIntoRows } from "./box-score.parser.ocr.js";

// ─── Stats table parsing ──────────────────────────────────────────────────────

// Rows above the scoreboard-derived boundary (Off Yards / Rush / Pass sit ~3 rows up).
const STAT_ZONE_ABOVE_SLACK = 0.15;

export function statZoneMinY(statsTopY: number): number {
  return Math.max(STATS_Y_MIN - 0.02, statsTopY - STAT_ZONE_ABOVE_SLACK);
}
// Column thresholds (relative to image width). LEFT/RIGHT bounds defined above.
export const CENTER_X_MIN = 0.18;
export const CENTER_X_MAX = 0.82;
const ROW_Y_TOLERANCE = 0.04;
export const LABEL_ROW_Y_TOLERANCE = 0.025;
const ARROW_STAT_ROW_Y_TOLERANCE = 0.045;

const SMALL_ARROW_STAT_KEYS = new Set([
  "turnovers",
  "third_down_conversions",
  "fourth_down_conversions",
  "two_point_conversions",
]);

const CONVERSION_STAT_KEYS = new Set([
  "third_down_conversions",
  "fourth_down_conversions",
  "two_point_conversions",
]);

function normalizeConversionDigits(digits: string): string {
  if (!/^\d{2,4}$/.test(digits)) return "";
  const splits = digits.length === 4 ? [2, 1] : [1];
  for (const split of splits) {
    const made = parseInt(digits.slice(0, split), 10);
    const attempts = parseInt(digits.slice(split), 10);
    if (attempts >= made && attempts <= 25) return `${made}-${attempts}`;
  }
  return "";
}

function validateStatValue(key: string, value: string): string {
  const v = value.trim();
  if (!v) return "";

  if (CONVERSION_STAT_KEYS.has(key)) {
    const ratio = v.match(/^(\d{1,2})\s*[\-/:]\s*(\d{1,2})$/);
    if (ratio) {
      const made = parseInt(ratio[1], 10);
      const attempts = parseInt(ratio[2], 10);
      return attempts >= made && attempts <= 25 ? `${made}-${attempts}` : "";
    }
    return normalizeConversionDigits(v.replace(/\D/g, ""));
  }

  if (key.includes("percentage")) {
    const n = parseInt(v, 10);
    return !isNaN(n) && n >= 0 && n <= 100 ? String(n) : "";
  }
  return /^\d+$/.test(v) ? v : "";
}

function cleanStatValue(raw: string, opts: { side: "left" | "right"; key: string }): string {
  const stripped = raw
    .replace(/[Oo]/g, "0")
    .replace(/[>▶◀◁▷◄]/g, "");

  const cleaned = stripped
    .replace(/^[^0-9:/-]+/, "")
    .replace(/[^0-9:/-]+$/, "")
    .trim();

  // Fused expander/better-stat arrows read as a trailing 4: 0◄ -> 04, 3◄ -> 34.
  if (SMALL_ARROW_STAT_KEYS.has(opts.key) && /^\d4$/.test(cleaned)) {
    return cleaned.slice(0, -1);
  }

  if (cleaned) return cleaned;

  const digitRun = stripped.match(/\d+/);
  if (digitRun) {
    const v = digitRun[0];
    if (SMALL_ARROW_STAT_KEYS.has(opts.key) && v.length === 2 && v.endsWith("4")) {
      return v.slice(0, -1);
    }
    return v;
  }

  return salvageVerticalStrokeDigits(stripped);
}

// Madden's thin sans-serif "1" glyphs frequently OCR as vertical-stroke letters
// when no digit survives in the token: "11" reads as "n", a lone "1" as
// "l"/"I"/"i"/"|". Only invoked on value-column tokens as a last resort, so a
// stray letter in a number cell is overwhelmingly a misread one.
function salvageVerticalStrokeDigits(token: string): string {
  const t = token.trim();
  if (!t || /\d/.test(t)) return "";
  if (/^[nN]$/.test(t)) return "11";
  if (/^[lIi|!]$/.test(t)) return "1";
  if (/^[lIi|!]{2}$/.test(t)) return "11";
  return "";
}

const LABEL_OCR_ALIASES: Record<string, string> = {
  "of pass yards": "off pass yards",
  "of first down": "off first down",
  "off fist down": "off first down",
  "off first downs": "off first down",
  "off irat down": "off first down",
  "off yards galned": "off yards gained",
  "off yards gai ned": "off yards gained",
  "off rush vards": "off rush yards",
  "tota yards gained": "total yards gained",
  "total vards gained": "total yards gained",
  "pint conversions": "two point conversions",
  "two pint conversions": "two point conversions",
  "red zone of percentage": "red zone off percentage",
  "red zone off uw": "red zone off percentage",
  "ot yards gained": "off yards gained",
  "oft rush vars": "off rush yards",
  "oftpass yards": "off pass yards",
  "tota yor gined": "total yards gained",
  "punt retur yards": "punt return yards",
  "kick retur yards": "kick return yards",
  "fourth down comrsions": "fourth down conversions",
  "tie down conversions": "third down conversions",
  "off pass yard": "off pass yards",
  "of fst down": "off first down",
  "offfistdown down": "off first down",
  "offfistdown": "off first down",
  "fuck return yards": "kick return yards",
  "ick return ards": "kick return yards",
  "total gained": "total yards gained",
  "toa gained": "total yards gained",
  taos: "turnovers",
  tumovers: "turnovers",
  down: "off first down",
};

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

function fixLabelOcr(text: string): string {
  return text
    .replace(/\bfist\b/g, "first")
    .replace(/offfistdown/g, "off first down")
    .replace(/fistdown/g, "first down")
    .replace(/\bfuck\b/g, "kick")
    .replace(/\bof\b(?=\s+(?:yards|rush|pass|first))/g, "off")
    .replace(/^ot\s/, "off ")
    .replace(/^oft\s*/, "off ")
    .replace(/^oftpass/, "off pass")
    .replace(/\bgalned\b/g, "gained")
    .replace(/\bgined\b/g, "gained")
    .replace(/\byor\b/g, "yards")
    .replace(/\bvars\b/g, "yards")
    .replace(/\bvards\b/g, "yards")
    .replace(/\bretur\b/g, "return")
    .replace(/\bcomrsions\b/g, "conversions")
    .replace(/\bbown\b/g, "down")
    .replace(/\bpint\b/g, "point")
    .replace(/\bpossesion\b/g, "possession")
    .replace(/\bfst\b/g, "first")
    .replace(/\byerds\b/g, "yards")
    .replace(/\byords\b/g, "yards")
    .replace(/\bbows\b/g, "down")
    .replace(/\btumovers\b/g, "turnovers")
    .replace(/\bta\s*os\b/g, "turnovers")
    .replace(/\btwa\b/g, "two")
    .replace(/\bcanversions\b/g, "conversions")
    .replace(/\bcarve ach\b/g, "conversions")
    .replace(/\bredzone\b/g, "red zone")
    .replace(/\btime ot\b/g, "time of")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLabel(text: string): string {
  const normalized = fixLabelOcr(text.toLowerCase().replace(/\s+/g, " ").trim());
  return LABEL_OCR_ALIASES[normalized] ?? normalized;
}

function matchStatLabel(normalized: string, aliases: LabelAliases): { key: string; via: MatchVia } | null {
  if (STAT_LABEL_MAP[normalized]) return { key: STAT_LABEL_MAP[normalized], via: "exact" };

  // Learned alias from a previously-approved parse — treat as an exact hit.
  if (aliases[normalized]) return { key: aliases[normalized], via: "alias" };

  // Partial match: known label contained in OCR output, or OCR output contained in known label.
  for (const [label, key] of Object.entries(STAT_LABEL_MAP)) {
    if (normalized.length >= 6 && label.includes(normalized)) return { key, via: "fuzzy" };
    if (label.length >= 6 && normalized.includes(label)) return { key, via: "fuzzy" };
    // First-word match for single-word labels (e.g. "Turnovers")
    if (label.split(" ").length === 1 && normalized.startsWith(label)) return { key, via: "fuzzy" };
  }

  // OCR typo tolerance (e.g. "off fist down" → "off first down").
  for (const [label, key] of Object.entries(STAT_LABEL_MAP)) {
    if (normalized.length >= 8 && levenshtein(normalized, label) <= 2) {
      return { key, via: "fuzzy" };
    }
    if (label.length >= 8 && normalized.length >= 4 && levenshtein(normalized, label) <= 4) {
      return { key, via: "fuzzy" };
    }
  }
  return null;
}

// A stat has exactly one value per column. Pick that single token rather than
// joining everything in the band (which bled in the next row's number) and pick
// the right token within the row: the value sits to the RIGHT of the ▶ expander
// in the left column, and to the LEFT of the ◄ "better stat" arrow in the right
// column — those arrows otherwise get misread as digits.
function findConversionValue(
  candidates: NormalizedWord[],
  targetY: number,
  side: "left" | "right",
  key: string,
): string {
  const sideWords = candidates
    .filter((w) => (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN))
    .map((w) => ({ w, dy: Math.abs(w.y - targetY) }))
    .sort((a, b) => a.dy - b.dy || (side === "left" ? b.w.x - a.w.x : a.w.x - b.w.x));

  const closest = sideWords[0];
  if (!closest || closest.dy > 0.032) return "";

  const rowY = closest.w.y;
  const sameRow = candidates.filter(
    (w) =>
      Math.abs(w.y - rowY) <= 0.012 &&
      (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN),
  );

  const joined = [...sameRow]
    .sort((a, b) => a.x - b.x)
    .map((w) => w.text.replace(/[Oo]/g, "0").replace(/[>▶◀◁▷◄]/g, ""))
    .join("");
  const ratio = joined.match(/(\d+)\s*[\-\/:]\s*(\d+)/);
  if (ratio) return validateStatValue(key, `${ratio[1]}-${ratio[2]}`);

  for (const w of sameRow.sort((a, b) => (side === "left" ? b.x - a.x : a.x - b.x))) {
    const v = validateStatValue(key, cleanStatValue(w.text, { side, key }));
    if (v) return v;
  }

  // Lone made-count with attempts on a adjacent token (▶1 /4 split across tokens).
  const parts = sameRow
    .sort((a, b) => a.x - b.x)
    .map((w) => cleanStatValue(w.text, { side, key }))
    .filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return validateStatValue(key, `${parts[0]}-${parts[1]}`);
  }

  return parts[0] ? validateStatValue(key, parts[0]) : "";
}

function findValueNearY(candidatesAll: NormalizedWord[], targetY: number, side: "left" | "right", key: string): string {
  // Turnovers sits only ~0.037 above the third-down row. Confine its search to
  // its own row so a faint or unread cell can't borrow the third-down digit
  // (DAL/DET right read 6, WAS/LCV left read 4 — both actually neighbours).
  const candidates =
    key === "turnovers"
      ? candidatesAll.filter((w) => Math.abs(w.y - targetY) < 0.028)
      : candidatesAll;

  if (key === "turnovers") {
    const leftMax = 0.24;
    const rightMin = 0.76;
    const rowWords = candidates.filter((w) => (side === "left" ? w.x < leftMax : w.x > rightMin));
    const joined = rowWords
      .sort((a, b) => a.x - b.x)
      .map((w) => w.text.replace(/[Oo]/g, "0").replace(/[>▶◀◁▷◄»«]/g, ""))
      .join("");
    const digit = joined.match(/\d{1,2}/);
    if (digit) {
      const n = parseInt(digit[0], 10);
      if (n >= 0 && n <= 10) return String(n);
    }
    // No digit on the row — only the ◄ marker / faint "0" glyph (reads as
    // ] [ ) ( | etc.). A turnovers cell is never blank, so treat that as 0.
    const noise = joined.replace(/\s/g, "");
    if (noise.length > 0 && /^[\]\[)(}{|!lIiː:;.,]+$/.test(noise)) return "0";
  }

  const yTolerance = SMALL_ARROW_STAT_KEYS.has(key)
    ? ARROW_STAT_ROW_Y_TOLERANCE
    : ROW_Y_TOLERANCE;

  const nearby = candidates.filter((w) => Math.abs(w.y - targetY) < yTolerance);
  if (nearby.length === 0) return "";

  // Keep only the row physically closest to the label; drop adjacent rows that
  // crept into the band. Arrow-adjacent stats need a tighter band so Q3/Q4 values
  // don't bleed into each other (e.g. fourth-down 3 vs two-point 0).
  const rowSlack = SMALL_ARROW_STAT_KEYS.has(key) ? 0.006 : 0.012;
  const minDy = Math.min(...nearby.map((w) => Math.abs(w.y - targetY)));
  const sameRow = nearby.filter((w) => Math.abs(w.y - targetY) <= minDy + rowSlack);

  if (key.includes("percentage")) {
    const pctRow = sameRow
      .filter((w) => (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN))
      .sort((a, b) => a.x - b.x);
    const joinedDigits = pctRow.map((w) => w.text.replace(/\D/g, "")).join("");
    if (joinedDigits.length <= 3) {
      const pct = validateStatValue(key, joinedDigits);
      if (pct) return pct;
    }
    const orphanPct = candidates
      .filter((w) => (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN))
      .map((w) => ({
        w,
        dy: Math.abs(w.y - targetY),
        v: validateStatValue(key, w.text.replace(/\D/g, "")),
      }))
      .filter((c) => c.v && c.dy < 0.04)
      .sort((a, b) => a.dy - b.dy);
    if (orphanPct[0]) return orphanPct[0].v;
  }

  // Left column: value is the rightmost token (▶ is to its left).
  // Right column: value is the leftmost token (◄ is to its right).
  sameRow.sort((a, b) => (side === "left" ? b.x - a.x : a.x - b.x));

  const ranked = sameRow
    .map((w) => {
      const v = validateStatValue(key, cleanStatValue(w.text, { side, key }));
      return { w, v, q: cellQuality(key, v), conf: w.confidence };
    })
    .filter((c) => c.v)
    .sort((a, b) => b.q - a.q || b.conf - a.conf || (side === "left" ? b.w.x - a.w.x : a.w.x - b.w.x));

  if (ranked[0]) return ranked[0].v;

  // Turnovers / arrow stats: lone digits beside ▶ often fail generic cleaning.
  if (key === "turnovers" || SMALL_ARROW_STAT_KEYS.has(key)) {
    const rowScan = candidates
      .filter(
        (w) =>
          Math.abs(w.y - targetY) < 0.04 &&
          (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN),
      )
      .sort((a, b) => Math.abs(a.y - targetY) - Math.abs(b.y - targetY) || (side === "left" ? b.x - a.x : a.x - b.x));
    for (const w of rowScan) {
      const digit = w.text.replace(/[Oo]/g, "0").replace(/\D/g, "");
      if (/^\d{1,2}$/.test(digit)) {
        const n = parseInt(digit, 10);
        if (n >= 0 && n <= 10) return String(n);
      }
    }
  }

  const orphan = candidates
    .filter((w) => (side === "left" ? w.x < LEFT_VAL_X_MAX : w.x > RIGHT_VAL_X_MIN))
    .map((w) => ({
      w,
      dy: Math.abs(w.y - targetY),
      v: validateStatValue(key, cleanStatValue(w.text, { side, key })),
      q: cellQuality(key, validateStatValue(key, cleanStatValue(w.text, { side, key }))),
    }))
    .filter((c) => c.v && c.dy < 0.035)
    .sort((a, b) => a.dy - b.dy || b.q - a.q || (side === "left" ? b.w.x - a.w.x : a.w.x - b.w.x));
  if (orphan[0]) return orphan[0].v;

  for (const w of sameRow) {
    const v = cleanStatValue(w.text, { side, key });
    if (v) return v;
  }

  // Last resort for arrow stats: a lone digit sometimes lands on the adjacent
  // OCR row when Madden fuses the value with the ◄ marker (e.g. 3◄ -> 34).
  if (SMALL_ARROW_STAT_KEYS.has(key)) {
    const orphan = candidates
      .filter((w) => Math.abs(w.y - targetY) < yTolerance + 0.025)
      .map((w) => ({ word: w, v: cleanStatValue(w.text, { side, key }) }))
      .filter((c) => c.v !== "" || /^[oO0°©¢]$/.test(c.word.text.trim()))
      .map((c) => (c.v === "" && /^[oO0°©¢]$/.test(c.word.text.trim()) ? { ...c, v: "0" } : c))
      .filter((c) => c.v)
      .sort((a, b) => Math.abs(a.word.y - targetY) - Math.abs(b.word.y - targetY) || (side === "left" ? b.word.x - a.word.x : a.word.x - b.word.x))[0];
    if (orphan) return orphan.v;
  }

  return "";
}

export function parseStatRows(words: NormalizedWord[], aliases: LabelAliases, statsTopY: number = STATS_Y_MIN): ParsedStat[] {
  const zoneMinY = statZoneMinY(statsTopY);
  const statZone = words.filter((w) => w.y >= zoneMinY);

  const leftVals  = statZone.filter((w) => w.x < LEFT_VAL_X_MAX);
  const rightVals = statZone.filter((w) => w.x > RIGHT_VAL_X_MIN);
  const center    = statZone.filter((w) => w.x >= CENTER_X_MIN && w.x <= CENTER_X_MAX);

  // Group center words into label rows
  const centerRows = groupIntoRows(center, LABEL_ROW_Y_TOLERANCE);

  const stats: ParsedStat[] = [];
  const seenKeys = new Set<string>();

  for (const row of centerRows) {
    const sortedRow = [...row].sort((a, b) => a.x - b.x);
    const normalized = normalizeLabel(sortedRow.map((w) => w.text).join(" "));
    const rowY = sortedRow.reduce((s, w) => s + w.y, 0) / sortedRow.length;
    const match = matchStatLabel(normalized, aliases);

    if (!match || seenKeys.has(match.key)) continue;
    seenKeys.add(match.key);

    const team1Val = findValueNearY(leftVals, rowY, "left", match.key);
    const team2Val = findValueNearY(rightVals, rowY, "right", match.key);

    stats.push({
      key: match.key,
      team1: team1Val,
      team2: team2Val,
      rawLabel: normalized,
      matchedVia: match.via,
      rowY,
    });
  }

  return fillPositionalKickReturn(
    fillPositionalOffFirstDown(
      fillPositionalTurnovers(stats, centerRows, leftVals, rightVals),
      leftVals,
      rightVals,
    ),
    leftVals,
    rightVals,
  );
}

function fillPositionalOffFirstDown(
  stats: ParsedStat[],
  leftVals: NormalizedWord[],
  rightVals: NormalizedWord[],
): ParsedStat[] {
  const existing = stats.find((s) => s.key === "off_first_down");
  if (existing?.team1?.trim() && existing?.team2?.trim()) return stats;

  const pass = stats.find((s) => s.key === "off_pass_yards");
  const punt = stats.find((s) => s.key === "punt_return_yards");
  if (!pass?.rowY || !punt?.rowY) return stats;

  const rowY = pass.rowY + (punt.rowY - pass.rowY) / 2;
  const team1 = findValueNearY(leftVals, rowY, "left", "off_first_down") || existing?.team1 || "";
  const team2 = findValueNearY(rightVals, rowY, "right", "off_first_down") || existing?.team2 || "";
  if (!team1 && !team2) return stats;

  const out = stats.filter((s) => s.key !== "off_first_down");
  out.push({
    key: "off_first_down",
    team1,
    team2,
    rawLabel: "(positional off first down)",
    matchedVia: "fuzzy",
    rowY,
  });
  return out;
}

function fillPositionalKickReturn(
  stats: ParsedStat[],
  leftVals: NormalizedWord[],
  rightVals: NormalizedWord[],
): ParsedStat[] {
  const existing = stats.find((s) => s.key === "kick_return_yards");
  if (existing?.team1?.trim() && existing?.team2?.trim()) return stats;

  const punt = stats.find((s) => s.key === "punt_return_yards");
  if (!punt?.rowY) return stats;

  const total = stats.find((s) => s.key === "total_yards_gained");
  const rowY = total?.rowY
    ? punt.rowY + (total.rowY - punt.rowY) / 2
    : punt.rowY + OFFENSE_ROW_STEP;

  const team1 = findValueNearY(leftVals, rowY, "left", "kick_return_yards") || existing?.team1 || "";
  const team2 = findValueNearY(rightVals, rowY, "right", "kick_return_yards") || existing?.team2 || "";
  if (!team1 && !team2) return stats;

  const out = stats.filter((s) => s.key !== "kick_return_yards");
  out.push({
    key: "kick_return_yards",
    team1,
    team2,
    rawLabel: "(positional kick return yards)",
    matchedVia: "fuzzy",
    rowY,
  });
  return out;
}

function avgRowY(row: NormalizedWord[]): number {
  return row.reduce((s, w) => s + w.y, 0) / row.length;
}

/** Turnovers label often OCRs to garbage ("te", "taos"); it always sits between Total Yards and Third Down. */
function fillPositionalTurnovers(
  stats: ParsedStat[],
  centerRows: NormalizedWord[][],
  leftVals: NormalizedWord[],
  rightVals: NormalizedWord[],
): ParsedStat[] {
  const existing = stats.find((s) => s.key === "turnovers");
  if (existing?.team1?.trim() && existing?.team2?.trim()) return stats;

  const total = stats.find((s) => s.key === "total_yards_gained");
  const third = stats.find((s) => s.key === "third_down_conversions");
  if (!total?.rowY || !third?.rowY) return stats;

  const between = centerRows
    .map((row) => ({ row, y: avgRowY(row) }))
    .filter(({ y }) => y > total.rowY! && y < third.rowY!)
    .sort((a, b) => a.y - b.y);
  const turnoverRow = between[0];
  if (!turnoverRow) return stats;

  const rowY = turnoverRow.y;
  const team1 = findValueNearY(leftVals, rowY, "left", "turnovers") || existing?.team1 || "";
  const team2 = findValueNearY(rightVals, rowY, "right", "turnovers") || existing?.team2 || "";
  if (!team1 && !team2) return stats;

  const out = stats.filter((s) => s.key !== "turnovers");
  out.push({
    key: "turnovers",
    team1,
    team2,
    rawLabel: turnoverRow.row.map((w) => w.text).join(" ") || "(positional turnovers)",
    matchedVia: "fuzzy",
    rowY,
  });
  return out;
}

const OFFENSE_ROW_STEP = 0.0385;

/** Fill top offensive values only when the Off Yards Gained label is on screen. */
export function fillInferredTopOffense(
  words: NormalizedWord[],
  stats: ParsedStat[],
  aliases: LabelAliases,
  statsTopY: number,
): ParsedStat[] {
  const keys = new Set(stats.map((s) => s.key));
  if (
    keys.has("off_yards_gained") &&
    keys.has("off_rush_yards") &&
    keys.has("off_pass_yards")
  ) {
    return stats;
  }
  // Scrolled screenshots start at Off First Down — do not infer clipped top rows.
  if (!hasOffYardsGainedLabel(stats)) return stats;

  const zoneMinY = statZoneMinY(statsTopY);
  const valueMinY = Math.max(STATS_Y_MIN - 0.04, statsTopY - 0.16);
  const statZone = words.filter((w) => w.y >= zoneMinY);
  const valueZone = words.filter((w) => w.y >= valueMinY);
  const center = statZone.filter((w) => w.x >= CENTER_X_MIN && w.x <= CENTER_X_MAX);
  const leftVals = valueZone.filter((w) => w.x < LEFT_VAL_X_MAX);
  const rightVals = valueZone.filter((w) => w.x > RIGHT_VAL_X_MIN);

  let anchorY: number | null = null;
  for (const row of groupIntoRows(center, LABEL_ROW_Y_TOLERANCE)) {
    const label = normalizeLabel([...row].sort((a, b) => a.x - b.x).map((w) => w.text).join(" "));
    const match = matchStatLabel(label, aliases);
    if (match?.key === "off_first_down") {
      anchorY = row.reduce((s, w) => s + w.y, 0) / row.length;
      break;
    }
  }
  if (anchorY == null) return stats;

  const out = [...stats];
  const seen = new Set(out.map((s) => s.key));
  for (const { key, offset } of [
    { key: "off_pass_yards", offset: 1 },
    { key: "off_rush_yards", offset: 2 },
    { key: "off_yards_gained", offset: 3 },
  ] as const) {
    if (seen.has(key)) continue;
    const targetY = anchorY - offset * OFFENSE_ROW_STEP;
    const team1 = findValueNearY(leftVals, targetY, "left", key);
    const team2 = findValueNearY(rightVals, targetY, "right", key);
    if (team1 || team2) {
      out.push({ key, team1, team2, rawLabel: `(inferred ${key})`, matchedVia: "fuzzy" });
      seen.add(key);
    }
  }
  return out;
}

export function cellQuality(key: string, value: string): number {
  const v = value.trim();
  if (!v) return 0;

  if (key.includes("percentage")) {
    const n = parseInt(v, 10);
    return !isNaN(n) && n >= 0 && n <= 100 ? 10 : 2;
  }

  const n = parseInt(v, 10);
  if (isNaN(n)) return 0;
  if (key.includes("yards") || key.includes("down")) return n >= 0 && n <= 999 ? 10 : 2;
  if (SMALL_ARROW_STAT_KEYS.has(key)) return n >= 0 && n <= 20 ? 8 : 3;
  return 6;
}

export function mergeSide(existing: string, candidate: string, key: string): string {
  if (!candidate.trim()) return existing;
  if (!existing.trim()) return candidate;
  return cellQuality(key, candidate) > cellQuality(key, existing) ? candidate : existing;
}

export function isLabelMatchedStat(stat: ParsedStat): boolean {
  return !stat.rawLabel.startsWith("(inferred");
}

export function hasOffYardsGainedLabel(stats: ParsedStat[]): boolean {
  return stats.some((s) => s.key === "off_yards_gained" && isLabelMatchedStat(s));
}

export function detectScrolledScreenshot(stats: ParsedStat[]): boolean {
  return !hasOffYardsGainedLabel(stats);
}
