// One-off: rec_legend_catalog.abilities[].description held generic placeholder text
// ("X-Factor: blanketed coverage.") instead of what the ability actually does in-game.
// Applies original, hand-written functional descriptions (ability-descriptions.json) matched
// by ability name, leaving name/type untouched. Also patches rec_players.abilities for
// already-installed legends/custom players so existing cards pick up the fix without
// re-purchasing.
//
//   pnpm --filter @rec/api exec tsx scripts/apply-ability-descriptions.ts --apply
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../src/config/env.js";

const apply = process.argv.includes("--apply");

const descriptions = JSON.parse(readFileSync(resolve(process.cwd(), "scripts/ability-descriptions.json"), "utf8")) as Record<string, string>;

function patchAbilities(abilities: unknown): { next: unknown; changed: boolean } {
  if (!Array.isArray(abilities)) return { next: abilities, changed: false };
  let changed = false;
  const next = abilities.map((a: any) => {
    if (!a || typeof a !== "object" || typeof a.name !== "string") return a;
    const description = descriptions[a.name];
    if (!description || a.description === description) return a;
    changed = true;
    return { ...a, description };
  });
  return { next, changed };
}

const restUrl = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const headers = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function main() {
  const catalogResponse = await fetch(`${restUrl}/rec_legend_catalog?select=id,name,abilities`, { headers });
  if (!catalogResponse.ok) throw new Error(await catalogResponse.text());
  const catalog = await catalogResponse.json() as Array<{ id: string; name: string; abilities: unknown }>;

  let catalogUpdated = 0;
  const unmatchedNames = new Set<string>();
  for (const row of catalog) {
    if (Array.isArray(row.abilities)) {
      for (const a of row.abilities as any[]) {
        if (a?.name && !descriptions[a.name]) unmatchedNames.add(a.name);
      }
    }
    const { next, changed } = patchAbilities(row.abilities);
    if (!changed) continue;
    catalogUpdated += 1;
    if (apply) {
      const response = await fetch(`${restUrl}/rec_legend_catalog?id=eq.${row.id}`, {
        method: "PATCH", headers, body: JSON.stringify({ abilities: next }),
      });
      if (!response.ok) throw new Error(`legend ${row.name}: ${response.status} ${await response.text()}`);
    }
  }

  const playersResponse = await fetch(`${restUrl}/rec_players?select=id,abilities&abilities=not.is.null`, { headers });
  if (!playersResponse.ok) throw new Error(await playersResponse.text());
  const players = await playersResponse.json() as Array<{ id: string; abilities: unknown }>;

  let playersUpdated = 0;
  for (const row of players) {
    const { next, changed } = patchAbilities(row.abilities);
    if (!changed) continue;
    playersUpdated += 1;
    if (apply) {
      const response = await fetch(`${restUrl}/rec_players?id=eq.${row.id}`, {
        method: "PATCH", headers, body: JSON.stringify({ abilities: next }),
      });
      if (!response.ok) throw new Error(`player ${row.id}: ${response.status} ${await response.text()}`);
    }
  }

  console.log(JSON.stringify({
    apply, catalogRows: catalog.length, catalogUpdated, playerRows: players.length, playersUpdated,
    unmatchedNames: [...unmatchedNames],
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
