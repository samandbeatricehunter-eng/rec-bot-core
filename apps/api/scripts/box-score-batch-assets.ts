// One-off batch run against Cursor asset paths passed as args or a directory.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBoxScoreBuffers, REQUIRED_STAT_KEYS } from "../src/modules/box-score/box-score.parser.js";

type ExpectedScore = { team1: string; team2: string; team1Score: number; team2Score: number };

const expectedPath = join(dirname(fileURLToPath(import.meta.url)), "../test-fixtures/box-scores/expected-scores.json");
const EXPECTED: Record<string, ExpectedScore> = existsSync(expectedPath)
  ? JSON.parse(readFileSync(expectedPath, "utf8").replace(/^\uFEFF/, ""))
  : {};

function scoreMatchesExpected(file: string, score: { team1Abbr: string; team2Abbr: string; team1Score: number; team2Score: number } | null) {
  const exp = EXPECTED[file];
  if (!exp || !score) return exp ? false : true;
  return (
    score.team1Abbr === exp.team1 &&
    score.team2Abbr === exp.team2 &&
    score.team1Score === exp.team1Score &&
    score.team2Score === exp.team2Score
  );
}

const OPTIONAL = [
  "third_down_conversions",
  "fourth_down_conversions",
  "two_point_conversions",
  "total_yards_gained",
] as const;

function incompleteRequired(stats: Record<string, { team1: string; team2: string }>) {
  return REQUIRED_STAT_KEYS.filter((key) => {
    const v = stats[key];
    return !v || !v.team1?.trim() || !v.team2?.trim();
  });
}

function optionalGaps(stats: Record<string, { team1: string; team2: string }>) {
  return OPTIONAL.filter((key) => {
    const v = stats[key];
    return !v || !v.team1?.trim() || !v.team2?.trim();
  });
}

async function parseFile(path: string) {
  const buffer = readFileSync(path);
  const parsed = await parseBoxScoreBuffers([buffer]);
  const inc = incompleteRequired(parsed.stats);
  const fd = parsed.stats.fourth_down_conversions;
  const file = basename(path);
  const scoreOk = scoreMatchesExpected(file, parsed.score);
  return {
    file,
    ok: parsed.missingRequired.length === 0 && inc.length === 0,
    scoreOk,
    score: parsed.score
      ? `${parsed.score.team1Abbr} ${parsed.score.team1Score}–${parsed.score.team2Score} ${parsed.score.team2Abbr}`
      : "(none)",
    expectedScore: EXPECTED[file]
      ? `${EXPECTED[file].team1} ${EXPECTED[file].team1Score}–${EXPECTED[file].team2Score} ${EXPECTED[file].team2}`
      : undefined,
    missingRequired: parsed.missingRequired,
    incompleteRequired: inc,
    optionalGaps: optionalGaps(parsed.stats),
    fourthDown: fd ? `${fd.team1 || "?"} / ${fd.team2 || "?"}` : "? / ?",
    thirdDown: parsed.stats.third_down_conversions
      ? `${parsed.stats.third_down_conversions.team1 || "?"} / ${parsed.stats.third_down_conversions.team2 || "?"}`
      : "? / ?",
  };
}

async function main() {
  const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "../test-fixtures/box-scores/manifest.json");
  const imageDir =
    process.env.BOX_SCORE_IMAGE_DIR ??
    join(process.env.APPDATA ?? "", "Cursor/User/workspaceStorage/empty-window/images");

  let paths: string[] = [];
  const target = process.argv[2];

  if (target === "--manifest" || (!target && existsSync(manifestPath))) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "")) as {
      files: string[];
      excluded?: { file: string; reason: string }[];
    };
    if (manifest.excluded?.length) {
      console.log(`Benchmark set: ${manifest.files.length} files (${manifest.excluded.length} excluded)\n`);
    }
    paths = manifest.files.map((f) => join(imageDir, f));
  } else if (!target) {
    console.error("Usage: tsx scripts/box-score-batch-assets.ts [--manifest | <file-or-dir> ...]");
    process.exit(1);
  } else {
    for (const arg of process.argv.slice(2)) {
      try {
        const entries = readdirSync(arg);
        paths.push(...entries.filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !/\.processed\./i.test(f)).map((f) => join(arg, f)));
      } catch {
        paths.push(arg);
      }
    }
  }

  const rows = [];
  for (const path of paths) {
    process.stdout.write(`Parsing ${basename(path)}… `);
    const row = await parseFile(path);
    rows.push(row);
    console.log(row.ok ? "OK" : "FAIL");
  }

  const passed = rows.filter((r) => r.ok).length;
  const scoresPassed = rows.filter((r) => r.scoreOk).length;
  console.log(`\n${passed}/${rows.length} stats passed | ${scoresPassed}/${rows.length} scores exact\n`);
  for (const r of rows) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.scoreOk ? "S✓" : "S✗"} ${r.file}`);
    console.log(`   Score: ${r.score}`);
    if (r.expectedScore && !r.scoreOk) console.log(`   Expected: ${r.expectedScore}`);
    console.log(`   4th down: ${r.fourthDown}  |  3rd down: ${r.thirdDown}`);
    if (r.missingRequired.length) console.log(`   Missing: ${r.missingRequired.join(", ")}`);
    if (r.incompleteRequired.length) console.log(`   Half-read: ${r.incompleteRequired.join(", ")}`);
    if (r.optionalGaps.length) console.log(`   Optional gaps: ${r.optionalGaps.join(", ")}`);
  }

  const missCounts = new Map<string, number>();
  for (const r of rows) {
    for (const m of [...r.missingRequired, ...r.incompleteRequired.map((k) => `half:${k}`), ...r.optionalGaps.map((k) => `opt:${k}`)]) {
      missCounts.set(m, (missCounts.get(m) ?? 0) + 1);
    }
  }
  if (missCounts.size) {
    console.log("\nFailure patterns:");
    for (const [k, c] of [...missCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c}x ${k}`);
  }

  writeFileSync(join(process.cwd(), "box-score-batch-report.json"), JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
