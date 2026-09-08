import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "docs/legends/new-storefront-additions.json"), "utf8"));
const slug = (value) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const rows = catalog.players.map((player) => ({
  name: player.name,
  search_name: player.store_subgroup === "screen_star" && player.performer && !/^self\b/i.test(player.performer) ? player.performer : player.name,
  search_context: player.store_subgroup === "screen_star" ? "actor portrait" : player.store_subgroup === "couldve_been" ? "athlete portrait" : "American football player",
  subject_type: player.store_subgroup === "screen_star" ? "performer" : player.store_subgroup === "couldve_been" ? "athlete" : "nfl",
  position: player.position,
  tier: player.legend_tier,
  subgroup: player.store_subgroup,
  file: `${slug(player.name)}-${player.position.toLowerCase()}.png`,
  cloudflare_id: `legend-${slug(player.name)}-${player.position.toLowerCase()}`,
}));
const output = path.join(root, "docs/legends/new-storefront-headshot-input.json");
fs.writeFileSync(output, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`${rows.length} headshot requests -> ${output}`);
