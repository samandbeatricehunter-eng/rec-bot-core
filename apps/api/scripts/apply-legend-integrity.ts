import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../src/config/env.js";

type LegendSeed = { name: string; est_ovr: number; height: string; weight: number; attributes: Record<string, number>; abilities: unknown[] };
const seed = JSON.parse(readFileSync(resolve(process.cwd(), "../../docs/legends/shared-catalog-seed.json"), "utf8")) as LegendSeed[];
const endpoint = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rec_legend_catalog`;
const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" };
let updated = 0;
for (const player of seed) {
  const response = await fetch(`${endpoint}?name=eq.${encodeURIComponent(player.name)}`, {
    method: "PATCH", headers,
    body: JSON.stringify({ est_ovr: player.est_ovr, height: player.height, weight: player.weight, attributes: player.attributes, abilities: player.abilities }),
  });
  if (!response.ok) throw new Error(`${player.name}: ${response.status} ${await response.text()}`);
  updated += 1;
}
console.log(JSON.stringify({ updated }));
