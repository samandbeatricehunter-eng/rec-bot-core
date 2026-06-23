// Diagnose box-score OCR against a local screenshot.
//
//   pnpm --filter @rec/api exec tsx scripts/box-score-diagnose.ts <path-to-image>
//
// For each preprocessing variant it writes the processed PNG next to the input
// (so you can see what Tesseract sees) and prints every OCR word with its
// normalized coordinates, the parsed score, the parsed stats, and which required
// fields are still missing.
import { readFileSync, writeFileSync } from "node:fs";
import {
  debugParseBuffer,
  REQUIRED_STAT_KEYS,
  type PreprocessVariant,
} from "../src/modules/box-score/box-score.parser.js";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: tsx scripts/box-score-diagnose.ts <path-to-image>");
    process.exit(1);
  }
  const buffer = readFileSync(path);

  for (const variant of ["default", "robust"] as PreprocessVariant[]) {
    const r = await debugParseBuffer(buffer, variant);
    const outPath = `${path}.${variant}.processed.png`;
    writeFileSync(outPath, r.processed);

    console.log(`\n${"=".repeat(70)}\nVARIANT: ${variant}\n${"=".repeat(70)}`);
    console.log(`processed image → ${outPath}`);
    console.log(`statsTopY (stats region starts below this): ${r.statsTopY.toFixed(3)}`);

    console.log("\nSCORE:");
    console.log(r.score ? JSON.stringify(r.score) : "  (none parsed)");

    console.log("\nWORDS (text | conf | x | y):");
    for (const w of [...r.words].sort((a, b) => a.y - b.y || a.x - b.x)) {
      console.log(`  ${w.text.padEnd(22)} ${String(Math.round(w.confidence)).padStart(3)}  x=${w.x.toFixed(3)} y=${w.y.toFixed(3)}`);
    }

    console.log("\nPARSED STATS:");
    for (const s of r.stats) {
      console.log(`  ${s.key.padEnd(26)} t1=${(s.team1 || "-").padEnd(6)} t2=${(s.team2 || "-").padEnd(6)} via=${s.matchedVia}  raw="${s.rawLabel}"`);
    }

    const found = new Set(r.stats.filter((s) => (s.team1 || s.team2)).map((s) => s.key));
    const missing = REQUIRED_STAT_KEYS.filter((k) => !found.has(k));
    console.log(`\nMISSING REQUIRED (this variant only): ${missing.length ? missing.join(", ") : "none"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
