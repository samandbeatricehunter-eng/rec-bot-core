import fs from "node:fs";

const seedPath = new URL("../docs/legends/shared-catalog-seed.json", import.meta.url);
const migrationPath = new URL("../supabase/migrations/20260813202000_normalize_legend_positions_to_madden_labels.sql", import.meta.url);
const catalog = JSON.parse(fs.readFileSync(seedPath, "utf8"));

function normalizedPosition(player) {
  const playerOverrides = {
    "Hugh Green": "LOLB",
    "Mike Munchak": "LG",
    "Randy Cross": "C",
  };
  if (playerOverrides[player.name]) return playerOverrides[player.name];
  const position = String(player.position ?? "").toUpperCase();
  const source = String(player.source_2k8_pos ?? "").toUpperCase();

  if (position === "RB") return "HB";
  if (["LT", "RT", "LG", "RG"].includes(position)) return position;
  const rightTackles = new Set(["Bob Brown", "Rayfield Wright", "Ron Mix", "Ron Yary", "Bob St. Clair", "Korey Stringer", "Lou Creekmur"]);
  const rightGuards = new Set(["Joe DeLamielleure", "Larry Little", "Bill Fralic"]);
  const rightEnds = new Set(["Chris Doleman", "Elvin Bethea", "Jack Youngblood", "Lee Roy Selmon", "Clyde Simmons", "Harvey Martin", "Jim Marshall", "Leslie O'Neal"]);
  const rightBackers = new Set(["Bryce Paup", "John Anderson", "Robert Brazile"]);
  if (position === "OT") return rightTackles.has(player.name) ? "RT" : "LT";
  if (position === "OG") return rightGuards.has(player.name) ? "RG" : "LG";
  if (position === "OL") {
    if (source === "C") return "C";
    if (source === "OG") return rightGuards.has(player.name) ? "RG" : "LG";
    return rightTackles.has(player.name) ? "RT" : "LT";
  }
  if (["LE", "RE"].includes(position)) return position;
  if (position === "DE") return rightEnds.has(player.name) ? "RE" : "LE";
  if (position === "DL") return source === "DT" ? "DT" : (rightEnds.has(player.name) ? "RE" : "LE");
  if (["LOLB", "ROLB"].includes(position)) return position;
  if (position === "OLB") return rightBackers.has(player.name) ? "ROLB" : "LOLB";
  if (position === "LB") return source === "ILB" ? "MLB" : (rightBackers.has(player.name) ? "ROLB" : "LOLB");
  if (position === "DB" && ["CB", "FS", "SS"].includes(source)) return source;
  return position;
}

for (const player of catalog) player.position = normalizedPosition(player);

fs.writeFileSync(seedPath, `${JSON.stringify(catalog, null, 2)}\n`);

const values = catalog
  .map((player) => `  ('${player.name.replaceAll("'", "''")}', '${player.position}')`)
  .join(",\n");
fs.writeFileSync(
  migrationPath,
  `-- Normalize the shared legend catalog to real-life primary position families.
-- Side-neutral positions remain compatible with either in-game side through @rec/shared.
update public.rec_legend_catalog as catalog
set position = normalized.position
from (values
${values}
) as normalized(name, position)
where lower(catalog.name) = lower(normalized.name)
  and catalog.position is distinct from normalized.position;
`,
);
