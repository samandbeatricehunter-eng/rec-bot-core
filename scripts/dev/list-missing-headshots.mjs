import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const input = JSON.parse(fs.readFileSync(path.join(root, "docs/legends/new-storefront-headshot-input.json"), "utf8"));
const images = path.join(root, "artifacts/new-storefront-headshots/images");
const missing = [];
const present = [];
for (const row of input) {
  const file = path.join(images, row.file);
  if (fs.existsSync(file) && fs.statSync(file).size > 4000) present.push(row);
  else missing.push(row);
}
console.log(JSON.stringify({ present: present.length, missing: missing.length, missingNames: missing.map((row) => `${row.name} ${row.position}`) }, null, 2));
fs.writeFileSync(path.join(root, "docs/legends/new-storefront-headshot-missing.json"), `${JSON.stringify(missing, null, 2)}\n`);
