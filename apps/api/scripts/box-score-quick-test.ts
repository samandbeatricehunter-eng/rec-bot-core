import { readFileSync } from "node:fs";
import { parseBoxScoreBuffers, REQUIRED_STAT_KEYS } from "../src/modules/box-score/box-score.parser.js";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: tsx scripts/box-score-quick-test.ts <image>");
    process.exit(1);
  }
  const parsed = await parseBoxScoreBuffers([readFileSync(path)]);
  const incomplete = REQUIRED_STAT_KEYS.filter((key) => {
    const v = parsed.stats[key];
    return !v?.team1?.trim() || !v?.team2?.trim();
  });
  console.log(JSON.stringify({
    score: parsed.score,
    missingRequired: parsed.missingRequired,
    incompleteRequired: incomplete,
    fourthDown: parsed.stats.fourth_down_conversions,
    thirdDown: parsed.stats.third_down_conversions,
    ok: parsed.missingRequired.length === 0 && incomplete.length === 0,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
