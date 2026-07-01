// Box-score OCR parser — thin orchestrator.
//
// The implementation is split across sibling modules by concern:
//   box-score.parser.types.ts — shared types, constants, Tesseract worker lifecycle,
//                                and required-field helpers
//   box-score.parser.ocr.ts   — image preprocessing + word extraction (default/left/right columns)
//   box-score.parser.score.ts — scoreboard header (team abbr + quarter/total score) parsing
//   box-score.parser.stats.ts — stat-table label matching, value extraction, positional fill-ins
//
// This file wires those pieces together into the main parse passes and
// re-exports the same public API the module has always exposed.
import {
  extractLeftColumnWords,
  extractNormalizedWords,
  extractRightColumnWords,
  flattenPageWords,
  groupIntoRows,
  mergeStatWords,
  preprocessImage,
  type PreprocessVariant,
} from "./box-score.parser.ocr.js";
import { parseScoreHeader, pickBestScore } from "./box-score.parser.score.js";
import {
  CENTER_X_MIN,
  CENTER_X_MAX,
  LABEL_ROW_Y_TOLERANCE,
  detectScrolledScreenshot,
  fillInferredTopOffense,
  isLabelMatchedStat,
  mergeSide,
  normalizeLabel,
  parseStatRows,
} from "./box-score.parser.stats.js";
import {
  ALL_STAT_KEYS,
  STATS_Y_MIN,
  computeMissingRequired,
  getWorker,
  hasBothSides,
  hasIncompleteRequiredCell,
  hasValue,
  terminateTesseractWorker,
  withOcrLock,
  type LabelAliases,
  type NormalizedWord,
  type ParsedBoxScore,
  type ParsedScore,
  type ParsedStat,
} from "./box-score.parser.types.js";

// ─── Re-exports: OCR worker lifecycle ───────────────────────────────────────
export { withOcrLock, getWorker, terminateTesseractWorker, flattenPageWords, preprocessImage, groupIntoRows };

// ─── Re-exports: shared types ───────────────────────────────────────────────
export type {
  NormalizedWord,
  ParsedScore,
  MatchVia,
  ParsedStat,
  LabelAliases,
  ParsedBoxScore,
} from "./box-score.parser.types.js";
export type { PreprocessVariant } from "./box-score.parser.ocr.js";
export { REQUIRED_STAT_KEYS } from "./box-score.parser.types.js";

// ─── Image fetch helper ───────────────────────────────────────────────────────

export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// ─── Main parse entry point ───────────────────────────────────────────────────

type PassResult = {
  score: ParsedScore | null;
  stats: ParsedStat[];
  warnings: string[];
  statsTopY: number;
  defaultWords: NormalizedWord[];
};

async function parseImage(buffer: Buffer, aliases: LabelAliases, variant: PreprocessVariant = "default"): Promise<PassResult> {
  const warnings: string[] = [];
  let score: ParsedScore | null = null;
  let stats: ParsedStat[] = [];
  let statsTopY = STATS_Y_MIN;
  let defaultWords: NormalizedWord[] = [];

  try {
    const defaultExtract = await extractNormalizedWords(buffer, "default");
    defaultWords = defaultExtract.words;
    const statExtract = await extractNormalizedWords(buffer, variant === "default" ? "stats" : variant);
    const leftWords = await extractLeftColumnWords(buffer);
    const rightWords = await extractRightColumnWords(buffer);

    const headerDefault = parseScoreHeader(defaultExtract.words);
    const headerStat = parseScoreHeader(statExtract.words);
    score = pickBestScore(headerDefault?.score, headerStat?.score);
    statsTopY = headerDefault?.statsTopY ?? headerStat?.statsTopY ?? STATS_Y_MIN;

    if (!score) warnings.push("Could not parse score header from this image.");

    const statWords = mergeStatWords(leftWords, rightWords, statExtract.words, defaultExtract.words, statsTopY);
    stats = fillInferredTopOffense(
      statWords,
      parseStatRows(statWords, aliases, statsTopY),
      aliases,
      statsTopY,
    );

    if (detectScrolledScreenshot(stats)) {
      warnings.push("Box score appears scrolled — scroll up so Off Yards Gained is visible.");
    }
  } catch (err) {
    warnings.push(`OCR error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { score, stats, warnings, statsTopY, defaultWords };
}

// Merge a set of per-image (and per-variant) parse results into one box score.
// Stats prefer the first non-empty value found per key, so an earlier/proven
// pass wins and later passes only fill gaps.
function combineResults(results: PassResult[]): ParsedBoxScore {
  const score = pickBestScore(...results.map((r) => r.score));

  const labelSamples: Record<string, string> = {};
  for (const r of results) {
    for (const stat of r.stats) {
      if (stat.matchedVia === "fuzzy" && stat.rawLabel && !(stat.key in labelSamples)) {
        labelSamples[stat.key] = stat.rawLabel;
      }
    }
  }

  const labelMatchedKeys = new Set<string>();
  for (const r of results) {
    for (const stat of r.stats) {
      if (isLabelMatchedStat(stat)) labelMatchedKeys.add(stat.key);
    }
  }

  const topOffenseVisible = labelMatchedKeys.has("off_yards_gained");

  const statsMap: Record<string, { team1: string; team2: string }> = {};
  for (const r of results) {
    for (const stat of r.stats) {
      if (!topOffenseVisible && (stat.key === "off_yards_gained" || stat.key === "off_rush_yards" || stat.key === "off_pass_yards")) {
        continue;
      }
      const candidate = { team1: stat.team1, team2: stat.team2 };
      const existing = statsMap[stat.key];
      if (!existing) {
        statsMap[stat.key] = candidate;
        continue;
      }
      statsMap[stat.key] = {
        team1: mergeSide(existing.team1, candidate.team1, stat.key),
        team2: mergeSide(existing.team2, candidate.team2, stat.key),
      };
    }
  }

  // Return-yard rows can be OCR-hostile because the expander arrow sits right
  // next to a single zero. If total yards and one return-yard row are known,
  // infer the missing return cell from total = offense + punt return + kick return.
  const fillMissingReturnYards = (side: "team1" | "team2") => {
    const total = parseInt(statsMap["total_yards_gained"]?.[side] ?? "", 10);
    const off = parseInt(statsMap["off_yards_gained"]?.[side] ?? "", 10);
    const punt = statsMap["punt_return_yards"]?.[side] ?? "";
    const kick = statsMap["kick_return_yards"]?.[side] ?? "";
    if (isNaN(total) || isNaN(off)) return;
    if (punt !== "" && kick === "") {
      const puntNum = parseInt(punt, 10);
      if (!isNaN(puntNum)) {
        const derived = total - off - puntNum;
        if (derived >= 0) {
          statsMap["kick_return_yards"] = {
            ...(statsMap["kick_return_yards"] ?? { team1: "", team2: "" }),
            [side]: String(derived),
          };
        }
      }
    } else if (punt === "" && kick !== "") {
      const kickNum = parseInt(kick, 10);
      if (!isNaN(kickNum)) {
        const derived = total - off - kickNum;
        if (derived >= 0) {
          statsMap["punt_return_yards"] = {
            ...(statsMap["punt_return_yards"] ?? { team1: "", team2: "" }),
            [side]: String(derived),
          };
        }
      }
    }
  };
  fillMissingReturnYards("team1");
  fillMissingReturnYards("team2");

  // Off Yards Gained = Total Yards − return yards when the label row was read but a cell was blank.
  const deriveOffYardsFromTotal = (side: "team1" | "team2") => {
    if (!topOffenseVisible) return;
    const off = statsMap["off_yards_gained"]?.[side]?.trim() ?? "";
    if (off) return;
    const total = parseInt(statsMap["total_yards_gained"]?.[side] ?? "", 10);
    const punt = parseInt(statsMap["punt_return_yards"]?.[side] ?? "0", 10);
    const kick = parseInt(statsMap["kick_return_yards"]?.[side] ?? "0", 10);
    if (isNaN(total) || isNaN(punt) || isNaN(kick)) return;
    const derived = total - punt - kick;
    if (derived >= 0) {
      statsMap["off_yards_gained"] = {
        ...(statsMap["off_yards_gained"] ?? { team1: "", team2: "" }),
        [side]: String(derived),
      };
    }
  };
  if (topOffenseVisible) {
    deriveOffYardsFromTotal("team1");
    deriveOffYardsFromTotal("team2");
  }

  const deriveRushPassFromOffYards = (side: "team1" | "team2") => {
    if (!topOffenseVisible) return;
    const off = parseInt(statsMap["off_yards_gained"]?.[side] ?? "", 10);
    if (isNaN(off)) return;
    const rush = statsMap["off_rush_yards"]?.[side]?.trim() ?? "";
    const pass = statsMap["off_pass_yards"]?.[side]?.trim() ?? "";
    if (rush && !pass) {
      const r = parseInt(rush, 10);
      if (!isNaN(r) && off >= r) {
        statsMap["off_pass_yards"] = {
          ...(statsMap["off_pass_yards"] ?? { team1: "", team2: "" }),
          [side]: String(off - r),
        };
      }
    } else if (pass && !rush) {
      const p = parseInt(pass, 10);
      if (!isNaN(p) && off >= p) {
        statsMap["off_rush_yards"] = {
          ...(statsMap["off_rush_yards"] ?? { team1: "", team2: "" }),
          [side]: String(off - p),
        };
      }
    }
  };
  if (topOffenseVisible) {
    deriveRushPassFromOffYards("team1");
    deriveRushPassFromOffYards("team2");
  }

  // Off Yards Gained is trustworthy when Total Yards corroborates it
  // (Total = Off + Punt Return + Kick Return). With no Total to check against,
  // treat it as trustworthy — it reads cleanly far more often than not.
  const offYardsCorroborated = (side: "team1" | "team2"): boolean => {
    const off = parseInt(statsMap["off_yards_gained"]?.[side] ?? "", 10);
    if (isNaN(off)) return false;
    const total = parseInt(statsMap["total_yards_gained"]?.[side] ?? "", 10);
    if (isNaN(total)) return true;
    const punt = parseInt(statsMap["punt_return_yards"]?.[side] ?? "0", 10) || 0;
    const kick = parseInt(statsMap["kick_return_yards"]?.[side] ?? "0", 10) || 0;
    return off === total - punt - kick;
  };

  // Madden invariant: Off Rush + Off Pass = Off Yards Gained. When both cells were
  // read but their sum doesn't match Off Yards, one was misread — almost always a
  // ◄ "better-stat" arrow read as a digit or a dropped leading digit, which shrinks
  // the wrong cell. Trust Off Yards (when corroborated) plus the larger component and
  // recompute the smaller one. (DAL/DET: DET "117◄" split into 17 + 4, so rush read
  // as 4; pass 146 > 4 ⇒ rush = 263 − 146 = 117.)
  const repairRushPassFromOffYards = (side: "team1" | "team2") => {
    if (!topOffenseVisible) return;
    const off = parseInt(statsMap["off_yards_gained"]?.[side] ?? "", 10);
    const rush = parseInt(statsMap["off_rush_yards"]?.[side] ?? "", 10);
    const pass = parseInt(statsMap["off_pass_yards"]?.[side] ?? "", 10);
    if (isNaN(off) || isNaN(rush) || isNaN(pass)) return;
    if (rush + pass === off) return;          // already consistent
    if (off < 0 || !offYardsCorroborated(side)) return;
    if (rush >= pass) {
      if (rush <= off) statsMap["off_pass_yards"] = { ...statsMap["off_pass_yards"]!, [side]: String(off - rush) };
    } else {
      if (pass <= off) statsMap["off_rush_yards"] = { ...statsMap["off_rush_yards"]!, [side]: String(off - pass) };
    }
  };
  if (topOffenseVisible) {
    repairRushPassFromOffYards("team1");
    repairRushPassFromOffYards("team2");
  }

  // Derive Total Yards Gained = Off Yards + Punt Return + Kick Return when it
  // wasn't read directly (it lives on the second screenshot we no longer require).
  if (!hasValue(statsMap["total_yards_gained"])) {
    const off = statsMap["off_yards_gained"];
    const pr = statsMap["punt_return_yards"];
    const kr = statsMap["kick_return_yards"];
    const sum = (a?: string, b?: string, c?: string): string => {
      const nums = [a, b, c].map((v) => parseInt(v ?? "", 10));
      if (nums.some((n) => isNaN(n))) return "";
      return String(nums.reduce((s, n) => s + n, 0));
    };
    if (hasValue(off) && hasValue(pr) && hasValue(kr)) {
      statsMap["total_yards_gained"] = {
        team1: sum(off.team1, pr.team1, kr.team1),
        team2: sum(off.team2, pr.team2, kr.team2),
      };
    }
  }

  // Derive defensive red zone % as 100 - opponent's offensive red zone %.
  // If NO converted 66% offensively, AK's defense stopped them 34% of the time.
  const offPct = statsMap["red_zone_off_percentage"];
  if (offPct) {
    const t1Off = parseInt(offPct.team1, 10);
    const t2Off = parseInt(offPct.team2, 10);
    statsMap["red_zone_def_percentage"] = {
      team1: isNaN(t2Off) ? "" : String(100 - t2Off),
      team2: isNaN(t1Off) ? "" : String(100 - t1Off),
    };
  }

  // Warn about any expected stats that couldn't be parsed.
  const warnings = results.flatMap((r) => r.warnings);
  for (const key of ALL_STAT_KEYS) {
    if (!hasBothSides(statsMap[key])) warnings.push(`Stat not found: ${key}`);
  }

  const missingRequired = computeMissingRequired(score, statsMap);

  return { score, stats: statsMap, warnings, missingRequired, labelSamples };
}

async function parseImageStatsPass(
  buffer: Buffer,
  aliases: LabelAliases,
  variant: "stats" | "robust",
  score: ParsedScore | null,
  statsTopY: number,
  defaultWords: NormalizedWord[],
): Promise<PassResult> {
  const statExtract = await extractNormalizedWords(buffer, variant);
  const leftWords = await extractLeftColumnWords(buffer);
  const rightWords = await extractRightColumnWords(buffer);
  const statWords = mergeStatWords(leftWords, rightWords, statExtract.words, defaultWords, statsTopY);
  return {
    score,
    stats: fillInferredTopOffense(statWords, parseStatRows(statWords, aliases, statsTopY), aliases, statsTopY),
    warnings: [],
    statsTopY,
    defaultWords,
  };
}

async function parseBoxScoreFromBuffers(buffers: Buffer[], aliases: LabelAliases = {}): Promise<ParsedBoxScore> {
  const primaryResults = await Promise.all(buffers.map((b) => parseImage(b, aliases, "default")));
  let combined = combineResults(primaryResults);

  if (combined.missingRequired.length > 0 || hasIncompleteRequiredCell(combined.stats)) {
    const fallbackResults = await Promise.all(
      buffers.map((buffer, idx) =>
        parseImageStatsPass(
          buffer,
          aliases,
          "robust",
          primaryResults[idx].score,
          primaryResults[idx].statsTopY,
          primaryResults[idx].defaultWords,
        ),
      ),
    );
    const statsPassResults = await Promise.all(
      buffers.map((buffer, idx) =>
        parseImageStatsPass(
          buffer,
          aliases,
          "stats",
          primaryResults[idx].score,
          primaryResults[idx].statsTopY,
          primaryResults[idx].defaultWords,
        ),
      ),
    );
    combined = combineResults([...primaryResults, ...fallbackResults, ...statsPassResults]);
  }

  return combined;
}

// The single default Box Score screenshot carries every required field. Still
// accepts more than one image — a submitter can re-post when the OCR misses a
// field — and merges them, preferring the first non-empty value found per key.
export async function parseBoxScoreImages(imageUrls: string[], aliases: LabelAliases = {}): Promise<ParsedBoxScore> {
  const buffers = await Promise.all(imageUrls.map(fetchImageBuffer));
  return parseBoxScoreFromBuffers(buffers, aliases);
}

/** Local-file entry point for batch scripts and tests. */
export async function parseBoxScoreBuffers(buffers: Buffer[], aliases: LabelAliases = {}): Promise<ParsedBoxScore> {
  return parseBoxScoreFromBuffers(buffers, aliases);
}

// ─── Debug helper (used by scripts/box-score-diagnose.ts) ──────────────────────
// Runs one preprocessing variant against a local buffer and returns the
// processed image plus the OCR words/coords and parse, so we can see exactly
// what the parser sees for a given screenshot.
export async function debugParseBuffer(buffer: Buffer, variant: PreprocessVariant = "default") {
  const defaultExtract = await extractNormalizedWords(buffer, "default");
  const statExtract = await extractNormalizedWords(buffer, variant === "default" ? "stats" : variant);
  const leftWords = await extractLeftColumnWords(buffer);
  const rightWords = await extractRightColumnWords(buffer);
  const headerDefault = parseScoreHeader(defaultExtract.words);
  const statsTopY = headerDefault?.statsTopY ?? STATS_Y_MIN;
  const statWords = mergeStatWords(leftWords, rightWords, statExtract.words, defaultExtract.words, statsTopY);
  const stats = parseStatRows(statWords, {}, statsTopY);
  const center = statWords.filter((w) => w.x >= CENTER_X_MIN && w.x <= CENTER_X_MAX && w.y >= statsTopY);
  const centerRows = groupIntoRows(center, LABEL_ROW_Y_TOLERANCE);
  const rowLabels = centerRows.map((row) =>
    normalizeLabel([...row].sort((a, b) => a.x - b.x).map((w) => w.text).join(" ")),
  );
  const { processed } = await preprocessImage(buffer, variant);
  return {
    processed,
    words: statWords,
    leftWordCount: leftWords.length,
    score: headerDefault?.score ?? null,
    statsTopY,
    stats,
    centerRowCount: centerRows.length,
    rowLabels,
  };
}

/** Script helper: inspect left-column OCR tokens. */
export async function debugLeftColumnWords(buffer: Buffer) {
  return extractLeftColumnWords(buffer);
}
