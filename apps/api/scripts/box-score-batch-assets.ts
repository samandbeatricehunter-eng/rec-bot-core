// One-off batch run against Cursor asset paths passed as args or a directory.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseBoxScoreBuffers, REQUIRED_STAT_KEYS } from "../src/modules/box-score/box-score.parser.js";

const OPTIONAL = [
  "third_down_conversions",
  "fourth_down_conversions",
  "two_point_conversions",
  "red_zone_off_td",
  "total_yards_gained",
  "penalty_yards",
  "time_of_possession",
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
  return {
    file: basename(path),
    ok: parsed.missingRequired.length === 0 && inc.length === 0,
    score: parsed.score
      ? `${parsed.score.team1Abbr} ${parsed.score.team1Score}–${parsed.score.team2Score} ${parsed.score.team2Abbr}`
      : "(none)",
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
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: tsx scripts/box-score-batch-assets.ts <file-or-dir> [...more]");
    process.exit(1);
  }

  const paths: string[] = [];
  for (const arg of process.argv.slice(2)) {
    try {
      const entries = readdirSync(arg);
      paths.push(...entries.filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !/\.processed\./i.test(f)).map((f) => join(arg, f)));
    } catch {
      paths.push(arg);
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
  console.log(`\n${passed}/${rows.length} passed\n`);
  for (const r of rows) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.file}`);
    console.log(`   Score: ${r.score}`);
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
