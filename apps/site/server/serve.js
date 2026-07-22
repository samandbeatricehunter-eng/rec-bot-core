// Minimal production static server for the built SPA — injects runtime config so
// Railway env vars can override baked Vite values without a rebuild.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sirv from "sirv";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const indexPath = join(dist, "index.html");
const port = Number(process.env.PORT ?? 4001);

const runtimeConfig = {
  VITE_SUPABASE_URL:
    process.env.VITE_SUPABASE_URL || "https://kyooxpjsxvsatrariafq.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5b294cGpzeHZzYXRyYXJpYWZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTkyMjksImV4cCI6MjA5NDg3NTIyOX0.AruGcjXxJlaRyPynMtzeCgsKkqfDJwQ2Ili-cZiSkuI",
  VITE_REC_CORE_API_URL:
    process.env.VITE_REC_CORE_API_URL || "https://recapi-production.up.railway.app",
  VITE_SITE_URL: process.env.VITE_SITE_URL || "https://rec-leagues.com",
};

const configScript = `<script>window.__REC_SITE_CONFIG__=${JSON.stringify(runtimeConfig)};</script>`;

function sendIndex(res) {
  if (!existsSync(indexPath)) {
    res.statusCode = 500;
    res.end("Site build missing (apps/site/dist).");
    return;
  }
  const html = readFileSync(indexPath, "utf8").replace("<head>", `<head>${configScript}`);
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(html);
}

const assets = sirv(dist, { single: false, etag: true });

createServer((req, res) => {
  const url = req.url?.split("?")[0] ?? "/";
  if (url === "/" || url === "/index.html" || !url.includes(".")) {
    sendIndex(res);
    return;
  }
  assets(req, res, () => sendIndex(res));
}).listen(port, () => {
  console.log(`[site] serving apps/site/dist on port ${port}`);
});
