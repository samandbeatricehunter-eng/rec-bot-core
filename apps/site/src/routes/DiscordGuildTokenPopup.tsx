import { useEffect } from "react";
import { supabase } from "../lib/supabase-client.js";

/**
 * Tiny popup page opened by the league-creation wizard (see auth.discordGuildOAuthUrl). Completes
 * a "guilds"-scoped Discord OAuth round-trip, then posts the short-lived provider_token back to the
 * opener (which renders the server dropdown inline) and closes. If opened directly there is nothing
 * to do — the wizard sets the expected uid beforehand so a popup that lands on a different account
 * (Discord identity attached elsewhere) is reported back rather than silently acting on it.
 */
export function DiscordGuildTokenPopup() {
  useEffect(() => {
    let cancelled = false;
    const origin = window.location.origin;
    const post = (payload: Record<string, unknown>) => {
      if (window.opener) window.opener.postMessage({ type: "rec:discord-guild-token", ...payload }, origin);
    };

    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }
        // Supabase's Discord OAuth redirects back with the session in the URL fragment
        // (#access_token=…), not a ?code — supabase-js picks that up during initialization.
        // Poll briefly for the resulting session (covers both flows).
        let session = null;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (data.session) {
            session = data.session;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!session) throw new Error("Discord didn't return a permission grant — try again.");

        const expectedUid = sessionStorage.getItem("rec_guild_picker_expected_uid");
        sessionStorage.removeItem("rec_guild_picker_expected_uid");
        if (expectedUid && session.user.id !== expectedUid) {
          throw new Error(
            "This Discord account is linked to a different REC account. Sign back into your original account and try again.",
          );
        }
        const providerToken = session.provider_token;
        if (!providerToken) {
          throw new Error("Discord didn't return a fresh permission grant — try again.");
        }
        if (!cancelled) post({ ok: true, providerToken });
      } catch (err) {
        if (!cancelled) post({ ok: false, error: err instanceof Error ? err.message : "Could not connect your Discord account." });
      } finally {
        window.close();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="site-page site-auth-page">
      <div className="site-auth-card">
        <h1>Connecting Discord…</h1>
        <p className="site-muted">
          This window will close automatically. If it doesn't, you can close it and try again.
        </p>
      </div>
    </div>
  );
}
