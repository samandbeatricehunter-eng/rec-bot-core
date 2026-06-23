import { readFileSync } from "node:fs";
import { debugParseBuffer, parseBoxScoreBuffers } from "../src/modules/box-score/box-score.parser.js";

async function main() {
  const path = process.argv[2];
  if (!path) process.exit(1);
  const buffer = readFileSync(path);

  for (const variant of ["default"] as const) {
    const d = await debugParseBuffer(buffer, variant);
    console.log(`\n=== ${variant} statsTopY=${d.statsTopY.toFixed(3)} score=${d.score?.team1Abbr} ${d.score?.team1Score}-${d.score?.team2Score} ${d.score?.team2Abbr}`);
    console.log(`words=${d.words.length} leftWords=${d.leftWordCount} parsed=${d.stats.length}`);
    const center = d.words.filter((w) => w.x >= 0.18 && w.x <= 0.82 && w.y >= d.statsTopY);
    console.log(`center rows=${d.centerRowCount}`);
    console.log(d.rowLabels?.slice(0, 20).map((l) => `  "${l}"`).join("\n"));
    for (const s of d.stats) console.log(`  ${s.key} t1=${s.team1 || "-"} t2=${s.team2 || "-"}`);
  }

  // const parsed = await parseBoxScoreBuffers([buffer]);
  // console.log("\n=== COMBINED ===");
  // console.log(`missing=${parsed.missingRequired.join(", ")}`);
  // console.log(`4th=${parsed.stats.fourth_down_conversions?.team1}/${parsed.stats.fourth_down_conversions?.team2}`);
}

main();
