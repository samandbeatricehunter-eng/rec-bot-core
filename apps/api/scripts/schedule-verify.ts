// OCR verification for the Madden League Schedule list parser.
//
//   pnpm --filter @rec/api exec tsx scripts/schedule-verify.ts
//
// For each week in test-fixtures/schedule/expected-schedule.json whose images are
// present on disk, parses them and diffs the read matchups + final scores against
// the golden transcription (which matches the live mw4 DB schedule). Exits non-zero
// on any matchup miss or score mismatch. Run with the images one set at a time —
// Tesseract thrashes when several parses run in parallel.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseScheduleBuffers, type ParsedScheduleGame } from "../src/modules/schedule/schedule.parser.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures", "schedule");

type ExpectedGame = { away: string; awayScore: number; home: string; homeScore: number };
type ExpectedWeek = { weekNumber: number; images: string[]; games: ExpectedGame[] };

function findParsed(parsed: ParsedScheduleGame[], exp: ExpectedGame): ParsedScheduleGame | null {
  return (
    parsed.find((g) => g.awayAbbr === exp.away && g.homeAbbr === exp.home) ??
    // tolerate away/home swapped read so the report is useful
    parsed.find((g) => g.awayAbbr === exp.home && g.homeAbbr === exp.away) ??
    null
  );
}

async function main() {
  const golden = JSON.parse(readFileSync(join(FIXTURE_DIR, "expected-schedule.json"), "utf8")) as Record<string, ExpectedWeek>;
  let checkedWeeks = 0;
  let failures = 0;

  for (const [key, week] of Object.entries(golden)) {
    if (key.startsWith("_")) continue;
    const paths = week.images.map((name) => join(FIXTURE_DIR, name)).filter(existsSync);
    if (!paths.length) {
      console.log(`SKIP ${key} (no images on disk: ${week.images.join(", ")})`);
      continue;
    }
    checkedWeeks++;
    console.log(`\n=== ${key} (Week ${week.weekNumber}) — ${paths.length} image(s) ===`);
    const parsed = await parseScheduleBuffers(paths.map((p) => readFileSync(p)));

    if (parsed.weekNumber !== week.weekNumber) {
      console.log(`  ⓘ week number: expected ${week.weekNumber}, read ${parsed.weekNumber ?? "?"}`);
    }

    const matchedKeys = new Set<string>();
    let weekProblems = 0;
    for (const exp of week.games) {
      const got = findParsed(parsed.games, exp);
      if (got) matchedKeys.add(`${got.awayAbbr}@${got.homeAbbr}`);
      const expLine = `${exp.away} ${exp.awayScore}-${exp.homeScore} ${exp.home}`;
      if (!got) {
        weekProblems++;
        console.log(`  ✗ MISSING  ${expLine}`);
        continue;
      }
      const scoreOk = got.awayAbbr === exp.away && got.awayScore === exp.awayScore && got.homeScore === exp.homeScore;
      if (scoreOk) {
        console.log(`  ✓ ${expLine}`);
      } else {
        weekProblems++;
        console.log(`  ✗ ${expLine}  →  read ${got.awayAbbr ?? "?"} ${got.awayScore ?? "?"}-${got.homeScore ?? "?"} ${got.homeAbbr ?? "?"}  (matchup "${got.rawMatchup}", result "${got.rawResult}")`);
      }
    }

    const extras = parsed.games.filter((g) => !matchedKeys.has(`${g.awayAbbr}@${g.homeAbbr}`));
    for (const extra of extras) {
      console.log(`  ⚠ EXTRA   read ${extra.awayAbbr ?? "?"} ${extra.awayScore ?? "?"}-${extra.homeScore ?? "?"} ${extra.homeAbbr ?? "?"}  (result "${extra.rawResult}")`);
    }

    console.log(`  ${week.games.length - weekProblems}/${week.games.length} games correct${parsed.warnings.length ? `; warnings: ${parsed.warnings.join("; ")}` : ""}`);
    if (weekProblems) failures++;
  }

  console.log(`\n${checkedWeeks - failures}/${checkedWeeks} weeks fully verified.`);
  if (failures || checkedWeeks === 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
