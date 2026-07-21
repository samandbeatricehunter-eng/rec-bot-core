// Minimal production static server for the built SPA — same pattern as apps/web/server/serve.js.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sirv from "sirv";

const here = dirname(fileURLToPath(import.meta.url));
const serve = sirv(join(here, "..", "dist"), { single: true, etag: true });
const port = Number(process.env.PORT ?? 4001);

createServer((req, res) => serve(req, res)).listen(port, () => {
  console.log(`[site] serving apps/site/dist on port ${port}`);
});
