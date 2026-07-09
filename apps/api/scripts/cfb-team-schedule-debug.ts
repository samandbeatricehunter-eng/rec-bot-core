// Dump the grouped OCR rows (word text @ x-fraction) for one CFB Team Schedule
// screenshot, so the week-label band and vs/at/BYE anchor matching can be tuned.
//   pnpm --filter @rec/api exec tsx scripts/cfb-team-schedule-debug.ts uaf_a.jpg [variant]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { debugTeamScheduleImage } from "../src/modules/schedule/cfb-team-schedule.parser.js";
import type { PreprocessVariant } from "../src/modules/box-score/box-score.parser.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures", "cfb-team-schedule");

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: tsx scripts/cfb-team-schedule-debug.ts <filename> [variant]");
    console.error(`Looks for the file in ${FIXTURE_DIR}`);
    process.exit(1);
  }
  const variant = (process.argv[3] as PreprocessVariant) ?? "stats";
  const rows = await debugTeamScheduleImage(readFileSync(join(FIXTURE_DIR, file)), variant);
  console.log(`${file} (${variant}) — ${rows.length} rows in table region:\n`);
  for (const row of rows) console.log(`y=${row.y}  ${row.words.join("  ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
