import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Opened as a normal external browser tab (a link the bot generates), not a Discord
// iframe — plain localhost dev works fine here, no HTTPS tunnel needed.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@supabase") || id.includes("node_modules/@gotrue") || id.includes("node_modules/@realtime") || id.includes("node_modules/@postgrest")) return "supabase";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("node_modules/lucide-react")) return "icons";
        },
      },
    },
  },
  server: {
    host: true,
  },
});
