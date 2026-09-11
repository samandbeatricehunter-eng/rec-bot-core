import type { ReactNode } from "react";
import { ImpersonationBanner } from "./ImpersonationBanner.js";
import { SiteFooter } from "./SiteFooter.js";
import { SiteHeader } from "./SiteHeader.js";
import { SiteTicker } from "./SiteTicker.js";
import { GoingLiveModal } from "./GoingLiveModal.js";
import { HomeFooterNav, LeagueFooterNav } from "./LeagueFooterNav.js";
import { useHub } from "../lib/hub-context.js";

export function SiteShell({ children }: { children: ReactNode }) {
  const hub = useHub();
  // Must match when we show league footer chrome (scope alone isn't enough — scope can be stuck
  // at "league" for a stale id after sign-out).
  const isLeague = hub.scope.kind === "league" && Boolean(hub.selectedLeague);
  const league = hub.selectedLeague;

  return (
    <div
      className={[
        "site-shell",
        isLeague ? "is-league-scope" : "is-main-scope",
        "has-site-footer-nav",
      ].join(" ")}
    >
      <ImpersonationBanner />
      <SiteHeader />

      <main className="site-shell-main">
        {children}
        {!isLeague ? <SiteFooter /> : null}
      </main>

      <div className="site-chrome-stack" aria-hidden={false}>
        {isLeague && league ? (
          <LeagueFooterNav
            leagueId={league.id}
            isCommissioner={league.isCommissioner}
            rosterType={league.rosterType}
            riseHubUnlocked={league.riseHubUnlocked}
            rtiOriginsComplete={league.rtiOriginsComplete}
          />
        ) : (
          <HomeFooterNav />
        )}
      </div>
      <SiteTicker />
      <GoingLiveModal />
    </div>
  );
}
