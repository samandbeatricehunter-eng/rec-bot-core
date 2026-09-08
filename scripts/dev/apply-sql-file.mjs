import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../apps/api/package.json"));
const pg = require("pg");

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
}

const file = process.argv[2];
if (!file) throw new Error("Usage: node apply-sql-file.mjs <sql-file>");
const sql = fs.readFileSync(path.resolve(file), "utf8");
const client = new pg.Client({ connectionString: process.env.REC_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(sql);
await client.end();
console.log(`applied ${file}`);
