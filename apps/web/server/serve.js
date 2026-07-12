// Minimal production static server for the built SPA (Vite's own "preview" command is
// explicitly documented as not for production use). Serves apps/web/dist with SPA
// fallback to index.html so client-side routes resolve on a hard refresh.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sirv from "sirv";

const here = dirname(fileURLToPath(import.meta.url));
const serve = sirv(join(here, "..", "dist"), { single: true, etag: true });
const port = Number(process.env.PORT ?? 4000);

createServer((req, res) => serve(req, res)).listen(port, () => {
  console.log(`[web] serving apps/web/dist on port ${port}`);
});
