import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Opened as a normal external browser tab (a link the bot generates), not a Discord
// iframe — plain localhost dev works fine here, no HTTPS tunnel needed.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
  },
});
