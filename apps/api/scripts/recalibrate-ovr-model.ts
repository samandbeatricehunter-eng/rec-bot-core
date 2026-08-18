/**
 * Refits REC_POSITION_OVR_MODELS coefficients + gamma against real Madden 27 rosters
 * (apps/api/scripts/data/madden27/madden27_all_rosters.csv + madden27_free_agents.csv),
 * the same real-data recalibration already done for QB/HB/WR/TE, now for every other
 * position. Read-only against the CSVs; prints new TS coefficient blocks to paste into
 * packages/shared/src/player-builder/ovr-model.ts by hand (so each change gets reviewed,
 * not silently overwritten).
 *
 * Usage: pnpm tsx apps/api/scripts/recalibrate-ovr-model.ts [position...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REC_POSITION_OVR_MODELS, type RecOvrPosition } from "@rec/shared";

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
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
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

// CSV column name -> REC attribute code (packages/shared/src/madden/attributes.ts is authoritative).
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

type Player = { position: RecOvrPosition; ovr: number; attrs: Record<string, number> };

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
      players.push({ position, ovr, attrs });
    }
  }
  return players;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function predict(coefficients: Record<string, number>, gamma: number, attrs: Record<string, number>): number {
  let weightedSum = 0;
  let total = 0;
  for (const [code, coef] of Object.entries(coefficients)) {
    total += coef;
    weightedSum += coef * clamp(attrs[code] ?? 0, 0, 99);
  }
  const linearScore = weightedSum / total;
  const normalized = clamp(linearScore / 99, 0, 1);
  return 99 * Math.pow(normalized, gamma);
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function fitPosition(
  position: RecOvrPosition,
  players: Player[],
): { gamma: number; coefficients: Record<string, number>; trainN: number; testN: number; mae: number; rmse: number; r2: number; meanBiasBefore: number; maeBefore: number } {
  const original = REC_POSITION_OVR_MODELS[position];
  const codes = Object.keys(original.coefficients);
  const pool = shuffle(players.filter((p) => p.position === position), 42);
  const testSize = Math.max(1, Math.round(pool.length * 0.2));
  const test = pool.slice(0, testSize);
  const train = pool.slice(testSize);

  // Baseline (current live model) error on the test set, for the "before" comparison.
  let beforeErrSum = 0, beforeAbsSum = 0;
  for (const p of test) {
    const pred = predict(original.coefficients, original.gamma, p.attrs);
    beforeErrSum += pred - p.ovr;
    beforeAbsSum += Math.abs(pred - p.ovr);
  }
  const meanBiasBefore = test.length ? beforeErrSum / test.length : 0;
  const maeBefore = test.length ? beforeAbsSum / test.length : 0;

  // Params: coefficients (floor 0.02) + gamma (0.7-2.4). Adam optimizer, numeric gradient
  // (central differences) — small parameter count (<=20) makes this cheap even for the
  // largest position (CB, ~800+ train rows).
  const paramKeys = [...codes, "__gamma__"];
  let params: Record<string, number> = { ...original.coefficients, __gamma__: original.gamma };
  const lambda = 0.01; // light L2 pull toward the original weighting, same as the QB/HB/WR/TE refit
  const floor = 0.02;

  function loss(p: Record<string, number>): number {
    const coef: Record<string, number> = {};
    for (const c of codes) coef[c] = Math.max(floor, p[c]!);
    const gamma = clamp(p.__gamma__!, 0.7, 2.4);
    let sq = 0;
    for (const row of train) {
      const pred = predict(coef, gamma, row.attrs);
      sq += (pred - row.ovr) ** 2;
    }
    let reg = 0;
    for (const c of codes) reg += (coef[c]! - original.coefficients[c]!) ** 2;
    return sq / train.length + lambda * reg;
  }

  // Adam
  const m: Record<string, number> = {}, v: Record<string, number> = {};
  for (const k of paramKeys) { m[k] = 0; v[k] = 0; }
  const lr = 0.02, b1 = 0.9, b2 = 0.999, eps = 1e-8;
  const eps_fd = 1e-4;
  const iterations = train.length < 50 ? 250 : 400;

  for (let t = 1; t <= iterations; t++) {
    const grad: Record<string, number> = {};
    const base = loss(params);
    for (const k of paramKeys) {
      const trial = { ...params, [k]: params[k]! + eps_fd };
      grad[k] = (loss(trial) - base) / eps_fd;
    }
    for (const k of paramKeys) {
      m[k] = b1 * m[k]! + (1 - b1) * grad[k]!;
      v[k] = b2 * v[k]! + (1 - b2) * grad[k]! ** 2;
      const mHat = m[k]! / (1 - b1 ** t);
      const vHat = v[k]! / (1 - b2 ** t);
      params[k] = params[k]! - (lr * mHat) / (Math.sqrt(vHat) + eps);
    }
    for (const c of codes) params[c] = Math.max(floor, params[c]!);
    params.__gamma__ = clamp(params.__gamma__!, 0.7, 2.4);
  }

  const coefficients: Record<string, number> = {};
  for (const c of codes) coefficients[c] = Math.round(params[c]! * 1e6) / 1e6;
  const gamma = Math.round(clamp(params.__gamma__!, 0.7, 2.4) * 100) / 100;

  let errSum = 0, absSum = 0, sqSum = 0;
  const testOvrs = test.map((p) => p.ovr);
  const meanOvr = testOvrs.reduce((a, b) => a + b, 0) / (testOvrs.length || 1);
  let ssTot = 0, ssRes = 0;
  for (const p of test) {
    const pred = predict(coefficients, gamma, p.attrs);
    const err = pred - p.ovr;
    errSum += err; absSum += Math.abs(err); sqSum += err ** 2;
    ssTot += (p.ovr - meanOvr) ** 2;
    ssRes += err ** 2;
  }
  const mae = test.length ? absSum / test.length : 0;
  const rmse = test.length ? Math.sqrt(sqSum / test.length) : 0;
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;

  return { gamma, coefficients, trainN: train.length, testN: test.length, mae, rmse, r2, meanBiasBefore, maeBefore };
}

function formatCoefficients(coef: Record<string, number>): string {
  return Object.entries(coef)
    .map(([k, v]) => `${k}: ${Number.isInteger(v * 100) ? v : v}`)
    .join(", ");
}

async function main() {
  const only = process.argv.slice(2).map((s) => s.toUpperCase());
  const players = loadPlayers();
  console.log(`Loaded ${players.length} real players from CSV.`);

  const positions = (Object.keys(REC_POSITION_OVR_MODELS) as RecOvrPosition[]).filter(
    (p) => only.length === 0 || only.includes(p),
  );

  for (const position of positions) {
    const n = players.filter((p) => p.position === position).length;
    if (n < 10) {
      console.log(`\n${position}: only ${n} real players available — skipping (too small to refit reliably).`);
      continue;
    }
    const result = fitPosition(position, players);
    console.log(`\n// ${position}: refit against ${n} real Madden 27 players (train ${result.trainN} / test ${result.testN}).`);
    console.log(`// Before (current live model) on held-out test set: mean bias ${result.meanBiasBefore.toFixed(2)}, MAE ${result.maeBefore.toFixed(2)}.`);
    console.log(`// After: MAE ${result.mae.toFixed(3)}, RMSE ${result.rmse.toFixed(3)}, R2 ${result.r2.toFixed(4)}.`);
    console.log(`  ${position}: {`);
    console.log(`    gamma: ${result.gamma},`);
    console.log(`    coefficients: { ${formatCoefficients(result.coefficients)} },`);
    console.log(`    validation: { trainN: ${result.trainN}, testN: ${result.testN}, meanAbsoluteError: ${Math.round(result.mae * 1000) / 1000}, rootMeanSquaredError: ${Math.round(result.rmse * 1000) / 1000}, rSquared: ${Math.round(result.r2 * 10000) / 10000} },`);
    console.log(`  },`);
  }
}

void main();
