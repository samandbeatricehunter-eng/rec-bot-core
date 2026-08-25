import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ImpersonationBanner } from "./ImpersonationBanner.js";
import { SiteFooter } from "./SiteFooter.js";
import { SiteHeader } from "./SiteHeader.js";
import { SiteTicker } from "./SiteTicker.js";
import { GoingLiveModal } from "./GoingLiveModal.js";
import { useHub } from "../lib/hub-context.js";

// Which of the four background images (site.css's .site-shell[data-bg=...]) applies here.
// Tournaments is a cross-league site feature (not tied to hub.selectedLeague), so it's
// resolved from the route rather than league scope; everything else falls back to "general".
function resolveBackground(pathname: string, game: string | undefined): "madden" | "cfb" | "tournaments" | "general" {
  if (pathname.startsWith("/tournaments")) return "tournaments";
  if (game === "cfb_27") return "cfb";
  if (game?.startsWith("madden")) return "madden";
  return "general";
}

export function SiteShell({ children }: { children: ReactNode }) {
  const hub = useHub();
  const location = useLocation();
  const isLeague = hub.scope.kind === "league";
  const background = resolveBackground(location.pathname, hub.selectedLeague?.game);

  return (
    <div
      className={[
        "site-shell",
        isLeague ? "is-league-scope" : "is-main-scope",
      ].join(" ")}
      data-bg={background}
    >
      <ImpersonationBanner />
      <SiteHeader />

      <main className="site-shell-main">
        {children}
        {!isLeague ? <SiteFooter /> : null}
      </main>

      <SiteTicker />
      <GoingLiveModal />
    </div>
  );
}