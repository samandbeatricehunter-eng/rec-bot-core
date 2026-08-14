import fs from "node:fs";

const seed = JSON.parse(fs.readFileSync("docs/legends/shared-catalog-seed.json", "utf8"));
const biometricPath = "docs/legends/legend-biometric-backfill.json";
if (fs.existsSync(biometricPath)) {
  const biometrics = new Map(JSON.parse(fs.readFileSync(biometricPath, "utf8")).map((row) => [row.name, row]));
  for (const player of seed) {
    const value = biometrics.get(player.name);
    if (value?.height && value?.weight) {
      player.height = value.height;
      player.weight = value.weight;
    }
  }
}

const q = (value) => value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const rows = seed.map((player) => `  (${q(player.name)}, ${player.est_ovr}, ${q(player.height)}, ${player.weight ?? "null"}, '${JSON.stringify(player.attributes).replaceAll("'", "''")}'::jsonb, '${JSON.stringify(player.abilities).replaceAll("'", "''")}'::jsonb)`).join(",\n");
const sql = `-- Synchronize the canonical legend catalog, including calculated Immortal OVRs and biometrics.
update public.rec_legend_catalog as catalog
set est_ovr = source.est_ovr,
    height = coalesce(source.height, catalog.height),
    weight = coalesce(source.weight, catalog.weight),
    attributes = source.attributes,
    abilities = source.abilities
from (values
${rows}
) as source(name, est_ovr, height, weight, attributes, abilities)
where catalog.name = source.name;

-- Pending requests must use the corrected snapshot when the commissioner applies them.
update public.rec_purchases as purchase
set details = purchase.details || jsonb_build_object(
  'estOvr', catalog.est_ovr,
  'height', catalog.height,
  'weight', catalog.weight,
  'attributes', catalog.attributes,
  'abilities', catalog.abilities
), updated_at = now()
from public.rec_legend_catalog as catalog
where purchase.purchase_type = 'legend'
  and purchase.status = 'pending'
  and purchase.details->>'legendId' = catalog.id::text;

update public.rec_commissioners_inbox as inbox
set payload = inbox.payload || jsonb_build_object(
  'estOvr', catalog.est_ovr,
  'height', catalog.height,
  'weight', catalog.weight,
  'attributes', catalog.attributes,
  'abilities', catalog.abilities
), updated_at = now()
from public.rec_purchases as purchase
join public.rec_legend_catalog as catalog on purchase.details->>'legendId' = catalog.id::text
where inbox.source_table = 'rec_purchases'
  and inbox.source_id = purchase.id
  and purchase.purchase_type = 'legend'
  and purchase.status = 'pending';
`;

fs.writeFileSync("docs/legends/shared-catalog-seed.json", `${JSON.stringify(seed, null, 2)}\n`);
fs.writeFileSync("supabase/migrations/20260813205854_sync_immortal_ratings_and_legend_biometrics.sql", sql);
console.log(JSON.stringify({ catalogRows: seed.length, missingBiometrics: seed.filter((row) => !row.height || !row.weight).map((row) => row.name) }, null, 2));
