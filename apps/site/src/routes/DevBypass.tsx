import { useEffect, useState } from "react";
import { supabase, siteApiBaseUrl } from "../lib/supabase-client.js";

// Local-dev-only: mints a real Supabase session via the API's double-gated
// /v1/dev/auth-bypass endpoint (see apps/api/src/modules/dev/dev-auth.routes.ts) and installs
// it into the same supabase client the rest of the app uses, so every other route/context
// picks it up exactly as if a normal login had happened. Never bundled into a production
// build's reachable UI in a meaningful way — the route registration in App.tsx is itself
// gated behind import.meta.env.DEV, and even if someone hit this URL against a production
// API, the server-side route wouldn't exist and this would just show its own error state.
export function DevBypass() {
  const [status, setStatus] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("Requesting a dev session…");

  useEffect(() => {
    let cancelled = false;
    const secret = (import.meta.env.VITE_DEV_BYPASS_SECRET as string | undefined) ?? "";
    if (!secret) {
      setStatus("error");
      setMessage("VITE_DEV_BYPASS_SECRET is not set in apps/site/.env — set it to match the API's DEV_AUTH_BYPASS_SECRET.");
      return;
    }
    fetch(`${siteApiBaseUrl()}/v1/dev/auth-bypass`, {
      method: "POST",
      headers: { "x-dev-bypass-secret": secret },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<{ accessToken: string; refreshToken: string; email: string }>;
      })
      .then(async (data) => {
        const { error } = await supabase.auth.setSession({ access_token: data.accessToken, refresh_token: data.refreshToken });
        if (error) throw error;
        if (cancelled) return;
        setStatus("done");
        setMessage(`Signed in as ${data.email}. Redirecting…`);
        setTimeout(() => { window.location.href = "/home"; }, 600);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Dev bypass failed.");
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ padding: "2rem", fontFamily: "monospace" }}>
      <h1>Dev auth bypass</h1>
      <p>{message}</p>
      {status === "error" && (
        <p style={{ color: "#f88" }}>
          Check that the API has DEV_AUTH_BYPASS_ENABLED=true, DEV_AUTH_BYPASS_SECRET, and
          DEV_AUTH_BYPASS_EMAIL set in its local .env, and that apps/site/.env has a matching
          VITE_DEV_BYPASS_SECRET.
        </p>
      )}
    </div>
  );
}
