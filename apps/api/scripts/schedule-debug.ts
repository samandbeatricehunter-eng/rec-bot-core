// Dump the grouped OCR rows (word text @ x-fraction) for one schedule screenshot,
// so column x-bands can be tuned.
//   pnpm --filter @rec/api exec tsx scripts/schedule-debug.ts schedule_wk9_a.jpg [variant]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { debugScheduleImage } from "../src/modules/schedule/schedule.parser.js";
import type { PreprocessVariant } from "../src/modules/box-score/box-score.parser.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures", "schedule");

async function main() {
  const file = process.argv[2] ?? "schedule_wk9_a.jpg";
  const variant = (process.argv[3] as PreprocessVariant) ?? "stats";
  const rows = await debugScheduleImage(readFileSync(join(FIXTURE_DIR, file)), variant);
  console.log(`${file} (${variant}) — ${rows.length} rows in table region:\n`);
  for (const row of rows) console.log(`y=${row.y}  ${row.words.join("  ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
