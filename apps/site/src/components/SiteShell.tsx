import type { ReactNode } from "react";
import { ImpersonationBanner } from "./ImpersonationBanner.js";
import { SiteFooter } from "./SiteFooter.js";
import { SiteHeader } from "./SiteHeader.js";
import { SiteTicker } from "./SiteTicker.js";
import { GoingLiveModal } from "./GoingLiveModal.js";
import { useHub } from "../lib/hub-context.js";

export function SiteShell({ children }: { children: ReactNode }) {
  const hub = useHub();
  // Must match SiteHeader's condition for rendering LeagueRow3 exactly (scope alone isn't
  // enough -- scope can be stuck at "league" for a stale/no-longer-resolvable id, e.g. right
  // after sign-out, in which case SiteHeader already falls back to HomeRow3 and this needs to
  // agree, or the footer gets hidden and .is-league-scope gets applied on what's really the
  // main-chrome home page).
  const isLeague = hub.scope.kind === "league" && Boolean(hub.selectedLeague);

  return (
    <div
      className={[
        "site-shell",
        isLeague ? "is-league-scope" : "is-main-scope",
      ].join(" ")}
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
