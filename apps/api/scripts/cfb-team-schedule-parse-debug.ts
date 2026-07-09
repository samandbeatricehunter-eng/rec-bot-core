// Runs the ACTUAL parseTeamScheduleBuffers pipeline (not just raw OCR row dump) against
// fixture files, so parser logic changes can be verified against real screenshots.
//   pnpm --filter @rec/api exec tsx scripts/cfb-team-schedule-parse-debug.ts img1.jpg [img2.jpg]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseTeamScheduleBuffers } from "../src/modules/schedule/cfb-team-schedule.parser.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures", "cfb-team-schedule");

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Usage: tsx scripts/cfb-team-schedule-parse-debug.ts <filename> [filename2]");
    process.exit(1);
  }
  const buffers = files.map((f) => readFileSync(join(FIXTURE_DIR, f)));
  const result = await parseTeamScheduleBuffers(buffers);
  console.log(`${result.rows.length} rows:\n`);
  for (const r of result.rows) {
    console.log(
      `week=${String(r.weekNumber).padStart(4)}  label=${JSON.stringify(r.weekLabel).padEnd(20)}  bye=${r.isBye}  rank=${r.opponentRank ?? "-"}  homeAway=${r.homeAway ?? "-"}  opp=${JSON.stringify(r.opponentRaw)}`
    );
  }
  console.log("\nWarnings:");
  for (const w of result.warnings) console.log(` - ${w}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
