import fs from "node:fs";

const seed = JSON.parse(fs.readFileSync("docs/legends/shared-catalog-seed.json", "utf8"));
const existing = fs.existsSync("docs/legends/legend-biometric-backfill.json")
  ? JSON.parse(fs.readFileSync("docs/legends/legend-biometric-backfill.json", "utf8")) : [];
const result = new Map(existing.map((row) => [row.name, row]));
const response = await fetch("https://github.com/nflverse/nflverse-data/releases/download/players/players.csv");
if (!response.ok) throw new Error(`nflverse players download failed: ${response.status}`);
const csv = await response.text();
function parseCsvLine(line) {
  const values = []; let value = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') { if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted; }
    else if (char === "," && !quoted) { values.push(value); value = ""; }
    else value += char;
  }
  values.push(value); return values;
}
const lines = csv.split(/\r?\n/); const header = parseCsvLine(lines.shift());
const nameIndex = header.indexOf("display_name"), heightIndex = header.indexOf("height"), weightIndex = header.indexOf("weight");
const players = new Map();
for (const line of lines) { const row = parseCsvLine(line); if (row[nameIndex]) players.set(row[nameIndex].toLowerCase(), row); }
for (const player of seed.filter((row) => !row.height || !row.weight)) {
  const nfl = players.get(player.name.toLowerCase());
  if (!nfl?.[heightIndex] || !nfl?.[weightIndex]) continue;
  const inches = Number(nfl[heightIndex]); const pounds = Number(nfl[weightIndex]);
  result.set(player.name, { name: player.name, height: `${Math.floor(inches / 12)}'${inches % 12}\"`, weight: pounds, item: "https://github.com/nflverse/nflverse-data/releases/tag/players" });
}
const output = seed.filter((row) => !row.height || !row.weight).map((row) => result.get(row.name) ?? { name: row.name, height: null, weight: null, item: null });
fs.writeFileSync("docs/legends/legend-biometric-backfill.json", `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ total: output.length, complete: output.filter((row) => row.height && row.weight).length, unresolved: output.filter((row) => !row.height || !row.weight).map((row) => row.name) }, null, 2));
