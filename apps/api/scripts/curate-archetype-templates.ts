/**
 * Selects real Madden 27 players as base-attribute templates for the archetype-based custom
 * player wizard: for each REC position and package tier, buckets real players by OVR percentile
 * (tier 5 = top 20% at that position, tier 1 = bottom 20% — percentile-based so every position
 * gets viable candidates regardless of its real OVR distribution shape), then within each bucket
 * picks the best real exemplar of up to 3 of that position's existing MADDEN archetypes (by
 * primary-attribute average) for variety.
 *
 * No real player identity is kept in the output beyond a debug comment — only the archetype
 * label and the attribute set are meant to reach users.
 *
 * Usage: pnpm tsx apps/api/scripts/curate-archetype-templates.ts [position...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REC_ARCHETYPE_CATALOG, type RecOvrPosition, type RecPackageTier } from "@rec/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data", "madden27");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") continue;
      row.push(cur); cur = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const COLUMN_TO_CODE: Record<string, string> = {
  Speed: "spd", Acceleration: "acc", Strength: "str", Agility: "agi", Awareness: "awr",
  Jumping: "jmp", Injury: "inj", Stamina: "sta", Toughness: "tou",
  "Throw Power": "thp", "Throw Under Pressure": "tup", "Throw Accuracy Short": "sac",
  "Throw Accuracy Mid": "mac", "Throw Accuracy Deep": "dac", "Throw on the Run": "run",
  "Play Action": "pac", Catching: "cth", "Spectacular Catch": "spc", "Catch in Traffic": "cit",
  "Route Running Short": "srr", "Route Running Medium": "mrr", "Route Running Deep": "drr",
  Release: "rls", Carrying: "car", "Break Tackle": "btk", Trucking: "trk",
  "Change of Direction": "cod", "BC Vision": "bcv", "Stiff Arm": "sfa", "Spin Move": "spm",
  "Juke Move": "jkm", "Break Sack": "bsk", Tackle: "tak", "Power Moves": "pmv",
  "Finesse Moves": "fmv", "Block Shedding": "bsh", Pursuit: "pur", "Play Recognition": "prc",
  "Man Coverage": "mcv", "Zone Coverage": "zcv", "Hit Power": "pow", Press: "prs",
  "Run Block": "rbk", "Pass Block": "pbk", "Impact Blocking": "ibl", "Run Block Power": "rbp",
  "Run Block Finesse": "rbf", "Pass Block Power": "pbp", "Pass Block Finesse": "pbf",
  "Lead Block": "lbk", "Kick Power": "kpw", "Kick Accuracy": "kac", "Kick Return": "ret",
};

const POSITION_ALIASES: Record<string, RecOvrPosition> = {
  QB: "QB", HB: "HB", RB: "HB", FB: "FB", WR: "WR", TE: "TE",
  LT: "LT", OT: "LT", LG: "LG", OG: "LG", C: "C", RG: "RG", RT: "RT",
  LE: "LE", DE: "LE", LEDG: "LE", RE: "RE", REDG: "RE", DT: "DT",
  LOLB: "LOLB", OLB: "LOLB", SAM: "LOLB", MLB: "MLB", MIKE: "MLB",
  ROLB: "ROLB", WILL: "ROLB", CB: "CB", FS: "FS", SS: "SS", K: "K", P: "P",
};

type Player = { position: RecOvrPosition; ovr: number; name: string; attrs: Record<string, number> };

function loadPlayers(): Player[] {
  const files = ["madden27_all_rosters.csv", "madden27_free_agents.csv"];
  const players: Player[] = [];
  for (const file of files) {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) continue;
    const rows = parseCsv(fs.readFileSync(full, "utf8"));
    const header = rows[0]!;
    const posIdx = header.indexOf("position");
    const ovrIdx = header.indexOf("ovr");
    const nameIdx = header.indexOf("name");
    const colIdx: Record<string, number> = {};
    for (const [name, code] of Object.entries(COLUMN_TO_CODE)) {
      const idx = header.indexOf(name);
      if (idx >= 0) colIdx[code] = idx;
    }
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const rawPos = (row[posIdx] ?? "").trim().toUpperCase();
      const position = POSITION_ALIASES[rawPos];
      if (!position) continue;
      const ovr = Number(row[ovrIdx]);
      if (!Number.isFinite(ovr) || ovr <= 0) continue;
      const attrs: Record<string, number> = {};
      let valid = true;
      for (const [code, idx] of Object.entries(colIdx)) {
        const v = Number(row[idx]);
        if (!Number.isFinite(v)) { valid = false; break; }
        attrs[code] = v;
      }
      if (!valid) continue;
      players.push({ position, ovr, name: row[nameIdx] ?? "?", attrs });
    }
  }
  return players;
}

const TIERS: RecPackageTier[] = [1, 2, 3, 4, 5];

function bucketForTier(sortedDesc: Player[], tier: RecPackageTier): Player[] {
  // tier 5 = top 20% (best real players), tier 1 = bottom 20% (backups/replacement level).
  const n = sortedDesc.length;
  const bucketSize = n / 5;
  const startPct = 5 - tier; // tier5 -> 0, tier1 -> 4
  const start = Math.floor(startPct * bucketSize);
  const end = Math.ceil((startPct + 1) * bucketSize);
  return sortedDesc.slice(start, Math.max(end, start + 1));
}

function archetypeScore(player: Player, primaryAttributes: readonly string[]): number {
  return primaryAttributes.reduce((sum, code) => sum + (player.attrs[code] ?? 0), 0) / primaryAttributes.length;
}

function curatePosition(position: RecOvrPosition, players: Player[]) {
  const pool = players.filter((p) => p.position === position).sort((a, b) => b.ovr - a.ovr);
  const archetypes = REC_ARCHETYPE_CATALOG.MADDEN[position] ?? [];
  const results: Array<{
    tier: RecPackageTier;
    archetypeKey: string;
    archetypeLabel: string;
    ovr: number;
    sourceName: string;
    attrs: Record<string, number>;
  }> = [];

  for (const tier of TIERS) {
    const bucket = bucketForTier(pool, tier);
    if (bucket.length === 0) continue;
    const used = new Set<string>();
    const archetypeSlice = archetypes.slice(0, 3);
    for (const archetype of archetypeSlice) {
      let best: Player | null = null;
      let bestScore = -Infinity;
      for (const p of bucket) {
        if (used.has(p.name + p.ovr)) continue;
        const score = archetypeScore(p, archetype.primaryAttributes);
        if (score > bestScore) { bestScore = score; best = p; }
      }
      if (!best) continue;
      used.add(best.name + best.ovr);
      results.push({
        tier,
        archetypeKey: archetype.key,
        archetypeLabel: archetype.label,
        ovr: best.ovr,
        sourceName: best.name,
        attrs: best.attrs,
      });
    }
    // Positions with < 3 defined archetypes (K/P/FB) still need coverage — fall back to just
    // the top real player in the bucket if no archetype produced a pick.
    if (archetypeSlice.length === 0 && bucket.length) {
      const best = bucket[0]!;
      results.push({ tier, archetypeKey: "default", archetypeLabel: "Standard", ovr: best.ovr, sourceName: best.name, attrs: best.attrs });
    }
  }
  return results;
}

async function main() {
  const only = process.argv.slice(2).map((s) => s.toUpperCase());
  const players = loadPlayers();
  console.log(`Loaded ${players.length} real players from CSV.\n`);

  const positions = (Object.keys(REC_ARCHETYPE_CATALOG.MADDEN) as RecOvrPosition[]).filter(
    (p) => only.length === 0 || only.includes(p),
  );

  const output: Record<string, Array<{ tier: number; archetypeKey: string; archetypeLabel: string; ovr: number; attrs: Record<string, number> }>> = {};

  for (const position of positions) {
    const rows = curatePosition(position, players);
    output[position] = rows.map(({ tier, archetypeKey, archetypeLabel, ovr, attrs }) => ({ tier, archetypeKey, archetypeLabel, ovr, attrs }));
    console.log(`${position}:`);
    for (const r of rows) {
      console.log(`  tier ${r.tier}  ${r.archetypeLabel.padEnd(22)} ovr ${r.ovr}  (source: ${r.sourceName})`);
    }
  }

  const outPath = path.join(__dirname, "data", "madden27", "archetype-templates.generated.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
}

void main();
