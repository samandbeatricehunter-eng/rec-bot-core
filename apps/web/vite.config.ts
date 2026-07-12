import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Discord Activities load this app inside an iframe served through Discord's URL Mappings
// proxy, not a raw browser tab — local dev therefore needs an HTTPS tunnel (ngrok/cloudflared)
// mapped in the Developer Portal rather than plain localhost. See apps/web/README.md.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
  },
});
