import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webPublic = path.resolve(here, "../web/public");
const sitePublic = path.resolve(here, "public");

/** Copy hub badge/chassis assets from apps/web so /assets/... URLs resolve in site builds. */
function copyWebPublicAssets(): Plugin {
  const sync = () => {
    for (const folder of ["assets", "fonts"]) {
      const from = path.join(webPublic, folder);
      const to = path.join(sitePublic, folder);
      if (!existsSync(from)) continue;
      mkdirSync(path.dirname(to), { recursive: true });
      cpSync(from, to, { recursive: true, force: true });
    }
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

// Public site + auth app. Also mounts hub UI from apps/web in-process (no iframe).
export default defineConfig({
  plugins: [react(), copyWebPublicAssets()],
  resolve: {
    alias: {
      react: path.resolve(here, "node_modules/react"),
      "react-dom": path.resolve(here, "node_modules/react-dom"),
      "react-router-dom": path.resolve(here, "node_modules/react-router-dom"),
    },
    dedupe: ["react", "react-dom", "react-router-dom"],
  },
  server: {
    host: true,
    port: 5174,
    fs: {
      allow: [here, path.resolve(here, "../web")],
    },
  },
});
