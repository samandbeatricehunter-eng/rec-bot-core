// Batch stress-test box-score OCR against a folder of screenshots.
//
//   pnpm --filter @rec/api exec tsx scripts/box-score-batch.ts <path-to-folder>
//
// Prints a summary table and writes box-score-batch-report.json in the folder.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import {
  parseBoxScoreBuffers,
  REQUIRED_STAT_KEYS,
} from "../src/modules/box-score/box-score.parser.js";

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

type Row = {
  file: string;
  ok: boolean;
  score: string;
  missingRequired: string[];
  incompleteRequired: string[];
  optionalGaps: string[];
  warnings: number;
};

function incompleteRequired(stats: Record<string, { team1: string; team2: string }>): string[] {
  return REQUIRED_STAT_KEYS.filter((key) => {
    const v = stats[key];
    return !v || !v.team1?.trim() || !v.team2?.trim();
  });
}

function optionalGaps(stats: Record<string, { team1: string; team2: string }>): string[] {
  const optional = [
    "third_down_conversions",
    "fourth_down_conversions",
    "two_point_conversions",
    "total_yards_gained",
  ] as const;
  return optional.filter((key) => {
    const v = stats[key];
    return !v || !v.team1?.trim() || !v.team2?.trim();
  });
}

function formatScore(parsed: Awaited<ReturnType<typeof parseBoxScoreBuffers>>): string {
  const s = parsed.score;
  if (!s) return "(none)";
  return `${s.team1Abbr} ${s.team1Score}–${s.team2Score} ${s.team2Abbr}`;
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: tsx scripts/box-score-batch.ts <path-to-folder>");
    process.exit(1);
  }

  const files = readdirSync(dir)
    .filter((f) => IMAGE_EXT.test(f) && !/\.processed\.(png|jpe?g|webp)$/i.test(f))
    .sort();

  if (!files.length) {
    console.error(`No images found in ${dir}`);
    process.exit(1);
  }

  console.log(`Parsing ${files.length} image(s) from ${dir}…\n`);

  const rows: Row[] = [];
  for (const file of files) {
    process.stdout.write(`  ${file}… `);
    const buffer = readFileSync(join(dir, file));
    const parsed = await parseBoxScoreBuffers([buffer]);
    const inc = incompleteRequired(parsed.stats);
    const row: Row = {
      file,
      ok: parsed.missingRequired.length === 0 && inc.length === 0,
      score: formatScore(parsed),
      missingRequired: parsed.missingRequired,
      incompleteRequired: inc,
      optionalGaps: optionalGaps(parsed.stats),
      warnings: parsed.warnings.length,
    };
    rows.push(row);
    console.log(row.ok ? "OK" : "FAIL");
  }

  const passed = rows.filter((r) => r.ok).length;
  const failed = rows.length - passed;

  console.log(`\n${"=".repeat(72)}`);
  console.log(`RESULT: ${passed}/${rows.length} passed, ${failed} failed\n`);

  for (const row of rows) {
    const flag = row.ok ? "✓" : "✗";
    console.log(`${flag} ${row.file}`);
    console.log(`    Score: ${row.score}`);
    if (row.missingRequired.length) console.log(`    Missing required: ${row.missingRequired.join(", ")}`);
    if (row.incompleteRequired.length) console.log(`    Half-read required: ${row.incompleteRequired.join(", ")}`);
    if (row.optionalGaps.length) console.log(`    Optional gaps: ${row.optionalGaps.join(", ")}`);
  }

  // Failure pattern rollup
  const missCounts = new Map<string, number>();
  for (const row of rows) {
    for (const m of [...row.missingRequired, ...row.incompleteRequired.map((k) => `half:${k}`), ...row.optionalGaps.map((k) => `opt:${k}`)]) {
      missCounts.set(m, (missCounts.get(m) ?? 0) + 1);
    }
  }
  if (missCounts.size) {
    console.log(`\n${"=".repeat(72)}`);
    console.log("Failure patterns (most common first):");
    for (const [field, count] of [...missCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}x  ${field}`);
    }
  }

  const reportPath = join(dir, "box-score-batch-report.json");
  writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), passed, failed, total: rows.length, rows }, null, 2));
  console.log(`\nReport → ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
