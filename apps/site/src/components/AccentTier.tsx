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
      return;
    }
    let cancelled = false;
    siteApi
      .getLinkProfile()
      .then((profile) => {
        if (cancelled) return;
        const tier = profile.entitlements?.tier ?? "none";
        root.setAttribute("data-accent-tier", tier === "platinum" || tier === "gold" ? tier : "none");
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