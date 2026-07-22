// Minimal production static server for the Discord hub SPA.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sirv from "sirv";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const indexPath = join(dist, "index.html");
const port = Number(process.env.PORT ?? 4000);

const runtimeConfig = {
  VITE_REC_CORE_API_URL:
    process.env.VITE_REC_CORE_API_URL || "https://recapi-production.up.railway.app",
  VITE_SITE_PUBLIC_URL: process.env.VITE_SITE_PUBLIC_URL || "https://rec-leagues.com",
};

const configScript = `<script>window.__REC_WEB_CONFIG__=${JSON.stringify(runtimeConfig)};</script>`;

function sendIndex(res) {
  if (!existsSync(indexPath)) {
    res.statusCode = 500;
    res.end("Web build missing (apps/web/dist).");
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
  console.log(`[web] serving apps/web/dist on port ${port}`);
});
