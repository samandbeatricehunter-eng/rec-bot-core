import { useEffect, useState } from "react";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function currentBuildId(): string {
  return window.__REC_SITE_CONFIG__?.VITE_BUILD_ID?.trim() || import.meta.env.VITE_BUILD_ID?.trim() || "";
}

export function SiteUpdateNotice() {
  const [availableBuildId, setAvailableBuildId] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let waitingWorker: ServiceWorker | null = null;
    const offerUpdate = (buildId: string) => {
      if (stopped || sessionStorage.getItem("rec-dismissed-build") === buildId) return;
      setAvailableBuildId(buildId);
    };
    const checkBuild = async () => {
      const loadedBuildId = currentBuildId();
      if (!loadedBuildId) return;
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const deployedBuildId = String((await response.json()).buildId ?? "").trim();
        if (deployedBuildId && deployedBuildId !== loadedBuildId) offerUpdate(deployedBuildId);
      } catch {
        // A temporary network failure should not interrupt the user.
      }
    };
    const inspectRegistration = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting) {
        waitingWorker = registration.waiting;
        offerUpdate(`service-worker-${registration.waiting.scriptURL}`);
      }
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            waitingWorker = registration.waiting ?? installing;
            offerUpdate(`service-worker-${Date.now()}`);
          }
        });
      });
    };
    void checkBuild();
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistration().then((registration) => {
        if (registration) inspectRegistration(registration);
      });
    }
    const interval = window.setInterval(checkBuild, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkBuild();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", checkBuild);
    const refresh = () => {
      if (waitingWorker) waitingWorker.postMessage({ type: "SKIP_WAITING" });
      window.location.reload();
    };
    window.addEventListener("rec-refresh-site", refresh);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", checkBuild);
      window.removeEventListener("rec-refresh-site", refresh);
    };
  }, []);

  if (!availableBuildId) return null;
  return (
    <aside className="site-update-notice" role="status" aria-live="polite">
      <strong>A new version is available</strong>
      <span>Refresh to get the latest REC Leagues updates.</span>
      <div>
        <button className="site-btn site-btn-primary" onClick={() => window.dispatchEvent(new Event("rec-refresh-site"))}>Refresh</button>
        <button className="site-btn site-btn-ghost" onClick={() => {
          sessionStorage.setItem("rec-dismissed-build", availableBuildId);
          setAvailableBuildId(null);
        }}>Later</button>
      </div>
    </aside>
  );
}
