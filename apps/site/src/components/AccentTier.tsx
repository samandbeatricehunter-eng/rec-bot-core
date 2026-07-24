import { useEffect } from "react";
import { useAuth } from "../lib/auth-context.js";
import { siteApi } from "../lib/site-api.js";

/** Sets data-accent-tier on <html> from the signed-in member's plan. */
export function AccentTier() {
  const auth = useAuth();

  useEffect(() => {
    const root = document.documentElement;
    if (auth.status !== "signed-in") {
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
        if (!cancelled) root.setAttribute("data-accent-tier", "none");
      });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  return null;
}
