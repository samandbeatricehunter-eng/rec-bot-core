import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../src/config/env.js";

const apply = process.argv.includes("--apply");
const writeMigration = process.argv.includes("--write-migration");
if (!apply && !writeMigration) throw new Error("Pass --apply and/or --write-migration.");

const sql = readFileSync(resolve(process.cwd(), "../../docs/legends/_abilities_update.sql"), "utf8");
const reviewed = new Map<string, unknown>();
const tuple = /\('((?:[^']|'')*)',\s*'((?:[^']|'')*)'::jsonb\)/g;
for (const match of sql.matchAll(tuple)) {
  const name = match[1].replaceAll("''", "'");
  const json = match[2].replaceAll("''", "'");
  reviewed.set(name, JSON.parse(json));
}
if (!reviewed.size) throw new Error("No reviewed ability mappings were parsed.");

if (writeMigration) {
  const values = [...reviewed.entries()].map(([name, abilities]) =>
    `  ('${name.replaceAll("'", "''")}', $abilities$${JSON.stringify(abilities)}$abilities$::jsonb)`,
  );
  writeFileSync(
    resolve(process.cwd(), "../../supabase/migrations/20260813190500_apply_reviewed_legend_abilities.sql"),
    [
      "-- Reviewed real-life playstyle and APF 2K8 cross-reference mappings.",
      "update public.rec_legend_catalog as catalog",
      "set abilities = reviewed.abilities",
      "from (values",
      values.join(",\n"),
      ") as reviewed(name, abilities)",
      "where catalog.name = reviewed.name;",
      "",
    ].join("\n"),
  );
}

if (!apply) {
  console.log(JSON.stringify({ reviewed: reviewed.size, migrationWritten: true }, null, 2));
  process.exit(0);
}

const restUrl = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const headers = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};
const catalogResponse = await fetch(`${restUrl}/rec_legend_catalog?select=name`, { headers });
if (!catalogResponse.ok) throw new Error(await catalogResponse.text());
const catalog = await catalogResponse.json() as Array<{ name: string }>;

let updated = 0;
const missingFromReview: string[] = [];
for (const row of catalog) {
  const abilities = reviewed.get(row.name);
  if (!abilities) {
    missingFromReview.push(row.name);
    continue;
  }
  const response = await fetch(`${restUrl}/rec_legend_catalog?name=eq.${encodeURIComponent(row.name)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ abilities }),
  });
  if (!response.ok) throw new Error(`${row.name}: ${response.status} ${await response.text()}`);
  updated += 1;
}

console.log(JSON.stringify({ catalog: catalog.length, reviewed: reviewed.size, updated, missingFromReview }, null, 2));
if (missingFromReview.length) process.exitCode = 1;
