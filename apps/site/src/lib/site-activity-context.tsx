import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./auth-context.js";
import { siteApi, type SiteActivityCounts } from "./site-api.js";

// One shared poller for the badge counts MessagesLink and NotificationsBell both need,
// instead of each component independently polling its own full dataset every 45s just to
// derive a count. Polls a lightweight counts-only endpoint every few minutes, skips ticks
// while the tab is hidden, and refreshes immediately when the tab regains focus — full lists
// still load on-demand when a panel is actually opened (unchanged).
const POLL_MS = 120_000;

const EMPTY_COUNTS: SiteActivityCounts = { unreadMessages: 0, unreadNotifications: 0, unreadCommissionerItems: 0 };

type SiteActivityContextValue = {
  counts: SiteActivityCounts;
  refresh: () => void;
};

const SiteActivityContext = createContext<SiteActivityContextValue | null>(null);

export function SiteActivityProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [counts, setCounts] = useState<SiteActivityCounts>(EMPTY_COUNTS);
  const inFlight = useRef(false);

  async function refresh() {
    if (auth.status !== "signed-in" || inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await siteApi.getActivityCounts();
      setCounts(next);
    } catch {
      /* keep showing the last known counts on a transient failure */
    } finally {
      inFlight.current = false;
    }
  }

  useEffect(() => {
    if (auth.status !== "signed-in") {
      setCounts(EMPTY_COUNTS);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    function onVisibilityChange() {
      if (!document.hidden) void refresh();
    }
    window.addEventListener("focus", onVisibilityChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisibilityChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status]);

  return <SiteActivityContext.Provider value={{ counts, refresh }}>{children}</SiteActivityContext.Provider>;
}

export function useSiteActivity(): SiteActivityContextValue {
  const ctx = useContext(SiteActivityContext);
  if (!ctx) throw new Error("useSiteActivity must be used within a SiteActivityProvider");
  return ctx;
}
