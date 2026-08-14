import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const seedPath = path.join(root, "docs/legends/shared-catalog-seed.json");
const outputPath = path.join(root, "docs/legends/legend-biometric-backfill.json");
const rows = JSON.parse(await fs.readFile(seedPath, "utf8"));
const missing = rows.filter((row) => !row.height || !row.weight);

const api = "https://en.wikipedia.org/w/api.php";
async function fetchJson(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": "REC-Leagues/1.0 (legend catalog maintenance)" } });
    const text = await response.text();
    if (response.ok && text.startsWith("{")) return JSON.parse(text);
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`Wikipedia request failed: ${url}`);
}
const cleanNumber = (value) => Number(String(value ?? "").replace(/<[^>]+>|\{\{[^}]+\}\}|[^0-9.]/g, ""));
const field = (wiki, names) => {
  for (const name of names) {
    const match = wiki.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n]+)`, "i"));
    if (match) return match[1].trim();
  }
  return null;
};

const values = missing.map((player) => `\"${player.name.replaceAll('"', '\\"')}\"@en`).join(" ");
const query = `SELECT ?name ?item ?height ?mass WHERE {
  VALUES ?name { ${values} }
  ?item rdfs:label ?name.
  OPTIONAL { ?item wdt:P2048 ?height }
  OPTIONAL { ?item wdt:P2067 ?mass }
}`;
const response = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`, {
  headers: { "User-Agent": "REC-Leagues/1.0 (legend catalog maintenance)", Accept: "application/sparql-results+json" },
});
if (!response.ok) throw new Error(`Wikidata query failed: ${response.status}`);
const bindings = (await response.json()).results.bindings;
const results = missing.map((player) => {
  const candidates = bindings.filter((row) => row.name?.value === player.name).map((row) => ({
    item: row.item?.value,
    height: Number(row.height?.value) < 3 ? Number(row.height?.value) * 39.3701 : Number(row.height?.value),
    weight: Number(row.mass?.value) < 180 ? Number(row.mass?.value) * 2.20462 : Number(row.mass?.value),
  }));
  const candidate = candidates.find((row) => row.height >= 60 && row.height <= 90 && row.weight >= 140 && row.weight <= 400);
  const totalInches = candidate?.height ? Math.round(candidate.height) : 0;
  return { name: player.name, item: candidate?.item ?? null, height: totalInches ? `${Math.floor(totalInches / 12)}'${totalInches % 12}\"` : null, weight: candidate?.weight ? Math.round(candidate.weight) : null };
});

for (const result of []) {
  const base = result.name.replaceAll(" ", "_").replaceAll('"', "");
  const titles = [base, `${base}_(American_football)`, `${base}_(American_football_player)`];
  for (const title of titles) {
    let page;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      page = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`, { headers: { "User-Agent": "REC-Leagues/1.0 (legend catalog maintenance)" } });
      if (page.status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    if (!page.ok) continue;
    const html = await page.text();
    const feet = Number(html.match(/height_ft.{0,80}?"wt":"(\d+)"/i)?.[1]);
    const inches = Number(html.match(/height_in.{0,80}?"wt":"(\d+)"/i)?.[1]);
    const pounds = Number(html.match(/weight_lb.{0,80}?"wt":"(\d+)"/i)?.[1]);
    if (feet && pounds) {
      result.height = `${feet}'${inches || 0}\"`;
      result.weight = pounds;
      result.item = `https://en.wikipedia.org/wiki/${title}`;
      break;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

// The REST endpoint is aggressively rate-limited. Resolve any remainder through the
// MediaWiki action API, requesting all likely titles in one call and reading infobox wikitext.
for (const result of results.filter((row) => !row.height || !row.weight)) {
  const base = result.name.replaceAll('"', "");
  const titles = [base, `${base} (American football)`, `${base} (American football player)`];
  try {
    const data = await fetchJson(`${api}?action=query&format=json&formatversion=2&redirects=1&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(titles.join("|"))}`);
    for (const page of data.query?.pages ?? []) {
      const wiki = page.revisions?.[0]?.slots?.main?.content ?? "";
      const heightRaw = field(wiki, ["height_ft"]);
      const inchesRaw = field(wiki, ["height_in"]);
      const weightRaw = field(wiki, ["weight_lb"]);
      const feet = cleanNumber(heightRaw);
      const inches = cleanNumber(inchesRaw);
      const pounds = cleanNumber(weightRaw);
      if (feet >= 5 && feet <= 7 && pounds >= 140 && pounds <= 400) {
        result.height = `${feet}'${inches || 0}\"`;
        result.weight = Math.round(pounds);
        result.item = `https://en.wikipedia.org/wiki/${String(page.title).replaceAll(" ", "_")}`;
        break;
      }
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 175));
}

await fs.writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify({ total: results.length, complete: results.filter((row) => row.height && row.weight).length, unresolved: results.filter((row) => !row.height || !row.weight) }, null, 2));
