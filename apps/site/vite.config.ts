import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Public site + auth app. Also mounts hub UI from apps/web in-process (no iframe).
export default defineConfig({
  plugins: [react()],
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
