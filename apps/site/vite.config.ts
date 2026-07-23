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
    alias: {
      "@rec/hub-ui": hubUi,
      react: siteReact,
      "react-dom": siteReactDom,
      "react-dom/client": path.resolve(siteReactDom, "client.js"),
      "react/jsx-runtime": path.resolve(siteReact, "jsx-runtime.js"),
      "react/jsx-dev-runtime": path.resolve(siteReact, "jsx-dev-runtime.js"),
      "react-router": siteRouter,
      "react-router-dom": siteRouterDom,
    },
    dedupe: ["react", "react-dom", "react-router", "react-router-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom"],
  },
  server: {
    host: true,
    port: 5174,
    fs: {
      allow: [here, path.resolve(here, "../web"), path.resolve(here, "../../packages/hub-ui")],
    },
  },
});