import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteReact = path.resolve(here, "node_modules/react");
const siteReactDom = path.resolve(here, "node_modules/react-dom");
const siteRouterDom = path.resolve(here, "node_modules/react-router-dom");
const siteRouter = path.resolve(realpathSync(siteRouterDom), "../react-router");
const hubUi = path.resolve(here, "src/lib/hub-ui.ts");

export default defineConfig({
  plugins: [react()],
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
          if (id.includes("/apps/site/src/components/") || id.includes("\\apps\\site\\src\\components\\") || id.includes("/apps/site/src/lib/") || id.includes("\\apps\\site\\src\\lib\\")) return "league-hub";
        },
      },
    },
  },
  server: {
    host: true,
    port: 5174,
    fs: {
      allow: [here],
    },
  },
});
