import { useEffect } from "react";
import { useAuth } from "../lib/auth-context.js";
import { siteApi } from "../lib/site-api.js";

/** Sets data-accent-tier on <html> from the signed-in member's plan. */
export function AccentTier() {
  const auth = useAuth();

  useEffect(() => {
    const root = document.documentElement;
    // Keep the synchronously restored cached tier while Supabase rehydrates the
    // session. Clearing it during "loading" caused a visible gold frame before
    // the platinum entitlement request completed.
    if (auth.status === "loading") return;
    if (auth.status === "signed-out") {
      root.setAttribute("data-accent-tier", "none");
      localStorage.removeItem("rec-accent-tier");
      return;
    }
    let cancelled = false;
    siteApi
      .getLinkProfile()
      .then((profile) => {
        if (cancelled) return;
        const tier = profile.entitlements?.tier ?? "none";
        const accentTier = tier === "platinum" || tier === "gold" ? tier : "none";
        root.setAttribute("data-accent-tier", accentTier);
        if (accentTier === "none") localStorage.removeItem("rec-accent-tier");
        else localStorage.setItem("rec-accent-tier", accentTier);
      })
      .catch(() => {
        // A transient profile request must not repaint a known member tier.
        if (!cancelled && !localStorage.getItem("rec-accent-tier")) {
          root.setAttribute("data-accent-tier", "none");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  return null;
}
