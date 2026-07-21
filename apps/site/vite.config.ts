import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// New, isolated public site + auth app. Runs on its own port, has no dependency on
// @rec/web or the Discord-JWT flow — safe to build and test without touching the live
// league hub. See docs/site-auth-migration.md for the plan.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
  },
});
