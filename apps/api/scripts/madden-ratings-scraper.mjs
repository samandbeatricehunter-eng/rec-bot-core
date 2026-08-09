#!/usr/bin/env node
// Re-scrapes maddenratings.com player pages to repair the off-by-one attribute
// corruption in the committed M27 CSVs.
//
// Root cause of the corruption: maddenratings.com interleaves a *group-rating badge*
// (General/Passing/Receiving/Ball-carrier/Defense/Blocking/Kicking) between each block of
// individual attribute values, all sharing the `.attribute-box` class. The old scraper
// captured every `.attribute-box` in DOM order, so 7 group badges polluted 7 attribute
// columns and the last 6 attributes (Pass Block Power, Pass Block Finesse, Lead Block,
// Kick Power, Kick Accuracy, Kick Return) were dropped entirely.
//
// This scraper parses attributes from the *card-body* attribute rows only (label span +
// attribute-box value), skipping the group badges, and also parses the "Total Attributes"
// box and the abilities cards.
//
// It keeps every other CSV column (team, name, position, jersey, ovr, draft info, ...)
// from the existing CSVs untouched — those were scraped correctly and carry the
// Madden-style position codes the seed/apply pipeline depends on.
//
// Run: node scripts/madden-ratings-scraper.mjs [file.csv]
// Output: overwrites madden27_all_rosters.csv + madden27_free_agents.csv in place
// (originals were backed up to *.corrupt-bak). Resumable via a JSONL cache. Pass a CSV
// filename to scrape just that file (e.g. only the free-agent file).
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data", "madden27");
const CACHE_PATH = join(__dirname, ".cache", "madden27-scrape.jsonl");

const ATTR_ORDER = [
  "Speed", "Acceleration", "Strength", "Agility", "Awareness", "Jumping", "Injury", "Stamina", "Toughness",
  "Throw Power", "Throw Under Pressure", "Throw Accuracy Short", "Throw Accuracy Mid", "Throw Accuracy Deep",
  "Throw on the Run", "Play Action", "Catching", "Spectacular Catch", "Catch in Traffic", "Route Running Short",
  "Route Running Medium", "Route Running Deep", "Release", "Carrying", "Break Tackle", "Trucking", "Change of Direction",
  "BC Vision", "Stiff Arm", "Spin Move", "Juke Move", "Break Sack", "Tackle", "Power Moves", "Finesse Moves",
  "Block Shedding", "Pursuit", "Play Recognition", "Man Coverage", "Zone Coverage", "Hit Power", "Press",
  "Run Block", "Pass Block", "Impact Blocking", "Run Block Power", "Run Block Finesse", "Pass Block Power",
  "Pass Block Finesse", "Lead Block", "Kick Power", "Kick Accuracy", "Kick Return",
];

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows[0];
  return { header, rows: rows.slice(1).filter((r) => r.length > 1 || r[0]).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]))) };
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header, rows) {
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) lines.push(header.map((h) => csvEscape(r[h] ?? "")).join(","));
  return lines.join("\n") + "\n";
}

function parsePlayerAttributes(html) {
  // Isolate the attributes tab panel.
  const attrSection = (html.match(/id="nav-attributes"[\s\S]*?(?=id="nav-abilities"|Start Ratings Over the Years|Weekly Movement)/) || [""])[0];
  const attrs = {};
  const liRe = /<li class="mb-3">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(attrSection))) {
    const li = m[1];
    const label = (li.match(/<span>\s*([^<]+?)\s*<\/span>/) || [])[1];
    const val = (li.match(/attribute-box[^"]*">\s*(\d+)\s*<\/span>/) || [])[1];
    if (label && val) attrs[label.trim()] = val;
  }
  const totalM = html.match(/Total Attributes<\/h4>[\s\S]*?attribute-box[^"]*">\s*([\d,]+)\s*<\/span>/);
  const total = totalM ? Number(totalM[1].replace(/,/g, "")) : Object.values(attrs).reduce((a, b) => a + Number(b || 0), 0);
  return { attrs, total };
}

function parseAbilities(html) {
  const abiSection = (html.match(/id="nav-abilities"[\s\S]*?Start Ratings Over the Years/) || [""])[0];
  const abiRe = /<img class="ability-icon"[^>]*title="([^"]*)"[\s\S]*?abilities-body"><p>([\s\S]*?)<\/p>/g;
  const parts = [];
  let m;
  while ((m = abiRe.exec(abiSection))) {
    parts.push(
      `${decodeEntities(m[1].trim())} ${decodeEntities(m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())}`
    );
  }
  return parts.join(" ");
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) return { status: 404, html: "" };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (!html.includes("attribute-box") || !html.includes("<h1 class=\"header-title")) {
    throw new Error("response did not look like a player page");
  }
  return { status: 200, html };
}

// Returns a row with attribute columns + total + abilitiesRaw replaced from the page.
function mergeScraped(existing, html) {
  const merged = { ...existing };
  const { attrs, total } = parsePlayerAttributes(html);
  for (const k of ATTR_ORDER) {
    if (attrs[k] !== undefined && attrs[k] !== "") merged[k] = attrs[k];
  }
  if (total !== undefined && Number.isFinite(total)) merged["Total Attributes"] = String(total);
  const abilities = parseAbilities(html);
  if (abilities) merged.abilitiesRaw = abilities;
  return merged;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const only = process.argv[2];
  const files = ["madden27_all_rosters.csv", "madden27_free_agents.csv"].filter((f) => !only || f === only);
  const cache = new Map();
  if (existsSync(CACHE_PATH)) {
    for (const line of readFileSync(CACHE_PATH, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      cache.set(rec.url, rec.row);
    }
    console.log(`Loaded ${cache.size} cached scrapes from ${CACHE_PATH}`);
  }

  const headerCache = new Map();
  const allRows = [];
  for (const f of files) {
    const { header, rows } = parseCsv(readFileSync(join(DATA_DIR, f), "utf8"));
    headerCache.set(f, header);
    for (const r of rows) allRows.push({ file: f, row: r });
  }
  console.log(`Total rows to scrape: ${allRows.length}`);

  const pending = allRows.filter(({ row }) => row.url && row.url.trim() && !cache.has(row.url));
  const noUrl = allRows.length - pending.length - allRows.filter(({ row }) => cache.has(row.url)).length;
  if (noUrl) console.warn(`  ${noUrl} rows have no URL and will be kept as-is`);
  console.log(`Pending (not cached): ${pending.length}`);

  let done = 0, failures = 0;
  const CONCURRENCY = 6;
  let next = 0;
  const startTs = Date.now();
  const worker = async () => {
    while (next < pending.length) {
      const item = pending[next++];
      const { file, row } = item;
      try {
        await sleep(100 + Math.floor(Math.random() * 150)); // polite pacing
        const { status, html } = await fetchPage(row.url);
        let merged = row;
        if (status === 200) {
          merged = mergeScraped(row, html);
          if (!existsSync(CACHE_PATH)) mkdirSync(dirname(CACHE_PATH), { recursive: true });
          appendFileSync(CACHE_PATH, JSON.stringify({ url: row.url, row: merged }) + "\n");
        } else {
          failures++;
          console.warn(`  404 (kept existing): ${row.url}`);
        }
        cache.set(row.url, merged);
      } catch (err) {
        failures++;
        console.warn(`  FAILED ${row.url}: ${err.message}`);
      }
      done++;
      if (done % 200 === 0 || done === pending.length) {
        const rate = (done / ((Date.now() - startTs) / 1000)).toFixed(1);
        console.log(`  ${done}/${pending.length} processed (${failures} failures, ${rate}/s)`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nScrape complete: ${pending.length} processed, ${failures} failures.`);

  // Write CSVs back in original order.
  for (const f of files) {
    const header = headerCache.get(f);
    const rows = allRows.filter((x) => x.file === f).map((x) => (x.row.url && cache.get(x.row.url)) || x.row);
    writeFileSync(join(DATA_DIR, f), toCsv(header, rows), "utf8");
    console.log(`Wrote ${join(DATA_DIR, f)} (${rows.length} rows)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
