import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/generate-nfl-schedules.mjs <games.csv>");
  process.exit(1);
}

/** nflverse abbreviations that differ from REC's nfl-teams.ts */
const NFLVERSE_TO_REC = {
  LA: "LAR",
  JAX: "JAX",
  LV: "LV",
  WAS: "WAS",
};

function toRecAbbr(abbr) {
  return NFLVERSE_TO_REC[abbr] ?? abbr;
}

const text = fs.readFileSync(csvPath, "utf8");
const lines = text.trim().split("\n");
const header = lines[0].split(",");
const seasonIdx = header.indexOf("season");
const weekIdx = header.indexOf("week");
const awayIdx = header.indexOf("away_team");
const homeIdx = header.indexOf("home_team");
const typeIdx = header.indexOf("game_type");

function gamesForSeason(season) {
  const games = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    if (cols[seasonIdx] !== String(season) || cols[typeIdx] !== "REG") continue;
    games.push({
      week: Number(cols[weekIdx]),
      away: toRecAbbr(cols[awayIdx]),
      home: toRecAbbr(cols[homeIdx]),
    });
  }
  games.sort((a, b) => a.week - b.week || a.away.localeCompare(b.away));
  return games;
}

for (const season of [2025, 2026]) {
  const games = gamesForSeason(season);
  const outPath = path.join(__dirname, "..", "packages", "shared", "src", `nfl-schedule-${season}.ts`);
  const body = `/** Auto-generated from nflverse games.csv — ${season} NFL regular season (${games.length} games). */\nexport type NflScheduleGame = { week: number; away: string; home: string };\nexport const NFL_SCHEDULE_${season}: NflScheduleGame[] = ${JSON.stringify(games, null, 2)};\n`;
  fs.writeFileSync(outPath, body);
  console.log(`Wrote ${outPath} (${games.length} games)`);
}
