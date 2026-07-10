// Calibration script for the CFB box-score parser.
//   pnpm --filter @rec/api exec tsx scripts/box-score-cfb-diagnose.ts <img1> [img2 ...]
import { readFileSync } from "node:fs";
import { parseCfbBoxScoreBuffers } from "../src/modules/box-score/box-score-cfb.parser.js";
import { terminateTesseractWorker } from "../src/modules/box-score/box-score.parser.js";

async function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error("Usage: tsx scripts/box-score-cfb-diagnose.ts <img1> [img2 ...]");
    process.exit(1);
  }
  const buffers = paths.map((p) => readFileSync(p));
  const result = await parseCfbBoxScoreBuffers(buffers);
  console.log(JSON.stringify(result, null, 2));
  await terminateTesseractWorker();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
