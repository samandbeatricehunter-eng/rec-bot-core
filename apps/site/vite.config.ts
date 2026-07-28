import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webPublic = path.resolve(here, "../web/public");
const sitePublic = path.resolve(here, "public");
const siteReact = path.resolve(here, "node_modules/react");
const siteReactDom = path.resolve(here, "node_modules/react-dom");
const siteRouterDom = path.resolve(here, "node_modules/react-router-dom");
const siteRouter = path.resolve(realpathSync(siteRouterDom), "../react-router");
const hubUi = path.resolve(here, "../../packages/hub-ui/src/index.ts");

/** Copy hub badge/chassis assets from apps/web so /assets/... URLs resolve in site builds. */
function copyWebPublicAssets(): Plugin {
  const sync = () => {
    const from = path.join(webPublic, "assets");
    const to = path.join(sitePublic, "assets");
    if (!existsSync(from)) return;
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true, force: true });
  };
  return {
    name: "copy-web-public-assets",
    buildStart() {
      sync();
    },
    configureServer() {
      sync();
    },
  };
}

// Public site + auth app. Also mounts hub UI via @rec/hub-ui (apps/web source, peer React).
export default defineConfig({
  plugins: [react(), copyWebPublicAssets()],
  resolve: {
    alias: [
      { find: "@rec/hub-ui", replacement: hubUi },
      { find: /^react$/, replacement: siteReact },
      { find: /^react-dom$/, replacement: siteReactDom },
      { find: "react-dom/client", replacement: path.resolve(siteReactDom, "client.js") },
      { find: "react/jsx-runtime", replacement: path.resolve(siteReact, "jsx-runtime.js") },
      { find: "react/jsx-dev-runtime", replacement: path.resolve(siteReact, "jsx-dev-runtime.js") },
      // Exact-match aliases are important: a prefix alias for `react-router` also rewrites
      // `react-router/dom` to a nonexistent filesystem path and bypasses package exports.
      { find: /^react-router$/, replacement: siteRouter },
      { find: /^react-router\/dom$/, replacement: path.resolve(siteRouter, "dist/development/dom-export.mjs") },
      { find: /^react-router-dom$/, replacement: siteRouterDom },
    ],
    dedupe: ["react", "react-dom", "react-router", "react-router-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@supabase") || id.includes("node_modules/@gotrue") || id.includes("node_modules/@realtime") || id.includes("node_modules/@postgrest")) return "supabase";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("/apps/web/") || id.includes("\\apps\\web\\") || id.includes("/packages/hub-ui/") || id.includes("\\packages\\hub-ui\\")) return "league-hub";
        },
      },
    },
  },
  server: {
    host: true,
    port: 5174,
    fs: {
      allow: [here, path.resolve(here, "../web"), path.resolve(here, "../../packages/hub-ui")],
    },
  },
});
