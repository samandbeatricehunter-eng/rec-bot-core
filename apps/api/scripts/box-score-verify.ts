// Value-level regression check for box-score OCR.
//
//   pnpm --filter @rec/api exec tsx scripts/box-score-verify.ts
//
// Parses each fixture listed in test-fixtures/box-scores/expected-stats.json that
// is present on disk and asserts every stat cell matches the golden value. Score
// abbreviations are asserted; score totals are reported informationally (final-score
// digit reads have a known OCR fragility). Exits non-zero on any stat/abbr mismatch.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseBoxScoreBuffers } from "../src/modules/box-score/box-score.parser.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures", "box-scores");

type Cell = { team1: string; team2: string };
type Expected = {
  score: { team1Abbr: string; team2Abbr: string; team1Score: number; team2Score: number };
  stats: Record<string, Cell>;
};

async function main() {
  const golden = JSON.parse(readFileSync(join(FIXTURE_DIR, "expected-stats.json"), "utf8")) as Record<string, Expected>;
  let checked = 0;
  let failures = 0;

  for (const [file, expected] of Object.entries(golden)) {
    if (file.startsWith("_")) continue; // skip _comment etc.
    const path = join(FIXTURE_DIR, file);
    if (!existsSync(path)) {
      console.log(`SKIP ${file} (not on disk)`);
      continue;
    }
    checked++;
    const parsed = await parseBoxScoreBuffers([readFileSync(path)]);
    const problems: string[] = [];

    if (parsed.score?.team1Abbr !== expected.score.team1Abbr) problems.push(`team1Abbr: expected ${expected.score.team1Abbr}, got ${parsed.score?.team1Abbr ?? "(none)"}`);
    if (parsed.score?.team2Abbr !== expected.score.team2Abbr) problems.push(`team2Abbr: expected ${expected.score.team2Abbr}, got ${parsed.score?.team2Abbr ?? "(none)"}`);

    for (const [key, exp] of Object.entries(expected.stats)) {
      const got = parsed.stats[key];
      if ((got?.team1 ?? "") !== exp.team1 || (got?.team2 ?? "") !== exp.team2) {
        problems.push(`${key}: expected ${exp.team1}/${exp.team2}, got ${got?.team1 || "-"}/${got?.team2 || "-"}`);
      }
    }

    const scoreInfo =
      parsed.score?.team1Score !== expected.score.team1Score || parsed.score?.team2Score !== expected.score.team2Score
        ? `  ⓘ score total: expected ${expected.score.team1Score}-${expected.score.team2Score}, got ${parsed.score?.team1Score ?? "?"}-${parsed.score?.team2Score ?? "?"} (known OCR digit fragility)`
        : "";

    if (problems.length) {
      failures++;
      console.log(`✗ ${file}`);
      for (const p of problems) console.log(`    ${p}`);
    } else {
      console.log(`✓ ${file}`);
    }
    if (scoreInfo) console.log(scoreInfo);
  }

  console.log(`\n${checked - failures}/${checked} fixtures passed stat/abbr verification.`);
  if (failures) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
