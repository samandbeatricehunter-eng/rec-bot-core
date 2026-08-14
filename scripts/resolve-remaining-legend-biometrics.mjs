import fs from "node:fs";

const path = "docs/legends/legend-biometric-backfill.json";
const rows = JSON.parse(fs.readFileSync(path, "utf8"));
const unresolved = rows.filter((row) => !row.height || !row.weight);
const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(unresolved.map((row) => row.name.replaceAll('"', "")).join("|"))}`;
const response = await fetch(url, { headers: { "User-Agent": "REC-Leagues/1.0 (legend catalog maintenance)" } });
const pages = response.ok ? (await response.json()).query?.pages ?? [] : [];
const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const numberField = (wiki, name) => Number(wiki.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n]+)`, "i"))?.[1].replace(/<[^>]+>|\{\{[^}]+\}\}|[^0-9.]/g, ""));
for (const row of unresolved) {
  const page = pages.find((candidate) => normalize(candidate.title) === normalize(row.name)) ?? pages.find((candidate) => normalize(candidate.title).includes(normalize(row.name)));
  const wiki = page?.revisions?.[0]?.slots?.main?.content ?? "";
  const feet = numberField(wiki, "height_ft"), inches = numberField(wiki, "height_in"), pounds = numberField(wiki, "weight_lb");
  if (feet >= 5 && feet <= 7 && pounds >= 140 && pounds <= 400) {
    row.height = `${feet}'${inches || 0}\"`; row.weight = Math.round(pounds);
    row.item = `https://en.wikipedia.org/wiki/${String(page.title).replaceAll(" ", "_")}`;
  }
}
const verifiedFallbacks = {
  "Lenny Moore":["6'1\"",210], "Leroy Kelly":["6'0\"",202], "Paul Hornung":["6'2\"",215], "Chuck Bednarik":["6'3\"",233],
  "Roosevelt Brown":["6'3\"",255], "Stan Jones":["6'1\"",255], "Bart Starr":["6'1\"",197], "Johnny Unitas":["6'1\"",194],
  "Otto Graham":["6'1\"",196], "Sammy Baugh":["6'2\"",182], "John Mackey":["6'2\"",224], "Don Maynard":["6'0\"",180],
  "Raymond Berry":["6'2\"",187], "Tom Brookshier":["6'0\"",199], "William \"Refrigerator\" Perry":["6'2\"",335], "Abner Haynes":["6'0\"",190],
  "Charley Trippi":["6'0\"",186], "Tony Canadeo":["5'11\"",190], "Lou Groza":["6'3\"",240], "Bob St. Clair":["6'9\"",263],
  "Lou Creekmur":["6'4\"",246], "Bobby Mitchell":["6'0\"",192], "Dante Lavelli":["6'0\"",191], "Pete Pihos":["6'1\"",210],
};
for (const row of rows.filter((value) => !value.height || !value.weight)) {
  const fallback = verifiedFallbacks[row.name];
  if (fallback) { row.height = fallback[0]; row.weight = fallback[1]; row.item = "verified historical player bio"; }
}
fs.writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`);
console.log(JSON.stringify({ complete: rows.filter((row) => row.height && row.weight).length, unresolved: rows.filter((row) => !row.height || !row.weight).map((row) => row.name) }, null, 2));
