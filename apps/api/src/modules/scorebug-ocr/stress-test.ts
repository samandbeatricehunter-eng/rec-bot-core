// Standalone calibration script -- NOT part of `pnpm test` (see apps/api/package.json's explicit
// test file list). Run manually: `tsx src/modules/scorebug-ocr/stress-test.ts <directory>`.
// Reads every .jpg in <directory> (default: ./ocr-samples next to this file, override via CLI
// arg), runs the scaffolding parser against each, and prints per-field results for manual
// comparison against the actual frame -- see docs/scorebug-ocr-regions.md.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseScorebugFrame } from "./scorebug-parser.js";
import { terminateTesseractWorker } from "../box-score/box-score.parser.types.js";

async function main() {
  const dir = resolve(process.argv[2] ?? join(import.meta.dirname, "ocr-samples"));
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".jpg") || f.toLowerCase().endsWith(".jpeg"));
  if (!files.length) {
    console.error(`No .jpg files found in ${dir}`);
    process.exit(1);
  }

  console.log(`Running scorebug parser against ${files.length} frame(s) in ${dir}\n`);

  let liveCount = 0;
  let notLiveCount = 0;
  const fieldHitCounts: Record<string, number> = {};

  for (const file of files) {
    const buffer = readFileSync(join(dir, file));
    const start = Date.now();
    let result;
    try {
      result = await parseScorebugFrame(buffer);
    } catch (error) {
      console.log(`✗ ${file} -- FAILED: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    const elapsedMs = Date.now() - start;

    if (result.isLiveScorebug) liveCount++; else notLiveCount++;
    for (const [field, value] of Object.entries(result)) {
      if (field === "raw" || field === "isLiveScorebug") continue;
      if (value !== null && value !== "unknown") fieldHitCounts[field] = (fieldHitCounts[field] ?? 0) + 1;
    }

    console.log(`--- ${file} (${elapsedMs}ms) ---`);
    console.log(`  live scorebug: ${result.isLiveScorebug}`);
    console.log(`  away ${result.awayScore ?? "?"}  x  home ${result.homeScore ?? "?"}   possession: ${result.possession}`);
    console.log(`  quarter: ${result.quarter ?? "?"}   clock: ${result.gameClock ?? "?"}   play clock: ${result.playClock ?? "?"}`);
    console.log(`  down/distance: ${JSON.stringify(result.downDistance)}   yard line: ${result.yardLine ?? "?"} (${result.yardLineDirection})`);
    console.log(`  raw OCR text: ${Object.entries(result.raw).map(([k, v]) => `${k}="${(v as { rawText: string }).rawText}"(${(v as { confidence: number }).confidence.toFixed(0)}%)`).join("  ")}`);
    console.log();
  }

  console.log("=== Summary ===");
  console.log(`Frames processed: ${files.length}`);
  console.log(`Classified as live scorebug: ${liveCount}   Classified as not-live: ${notLiveCount}`);
  console.log("Non-null field hit rate:");
  for (const [field, count] of Object.entries(fieldHitCounts)) {
    console.log(`  ${field}: ${count}/${files.length}`);
  }

  await terminateTesseractWorker();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
