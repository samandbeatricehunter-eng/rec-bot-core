import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseBoxScoreBuffers } from "../src/modules/box-score/box-score.parser.js";

async function main() {
  const path = process.argv[2];
  if (!path) process.exit(1);
  const parsed = await parseBoxScoreBuffers([readFileSync(path)]);
  const score = parsed.score;
  console.log(`\n=== ${basename(path)} ===`);
  if (!score) { console.log("NO SCORE"); return; }
  console.log(`${score.team1Abbr} ${score.team1Quarters.join("-")} = ${score.team1Score}`);
  console.log(`${score.team2Abbr} ${score.team2Quarters.join("-")} = ${score.team2Score}`);
}
main();
