import { useEffect, useState } from "react";
import { useHub } from "../lib/hub-context.js";
import { siteApi } from "../lib/site-api.js";

const POLL_MS = 20_000;

type GateStatus = Awaited<ReturnType<typeof siteApi.getMediaDayGateStatus>>;
type GateStage = "hidden" | "advanced" | "recap" | "media_day" | "reveal";

/** Post-advance gate: blocks the league page until the user has answered Media Day for the
 * current week/stage. Mounted globally in SiteShell (a sibling of the routed page, never a route
 * itself) so closing it never unmounts whatever the user was doing underneath -- a half-built
 * trade or custom player stays exactly as they left it.
 *
 * Completely inert right now: getMediaDayGateStatus always reports `required: false` until
 * MEDIA_DAY_GATE_ENABLED is flipped on server-side (media-day-gate.service.ts), once the Rewards
 * Recap, question content, and answer-driven challenge targeting all exist. Safe to ship ahead of
 * that -- it just never renders anything for real users yet. */
export function MediaDayGate() {
  const hub = useHub();
  const leagueId = hub.scope.kind === "league" ? hub.scope.leagueId : null;
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [stage, setStage] = useState<GateStage>("hidden");

  async function refresh(currentLeagueId: string) {
    if (document.hidden) return;
    try {
      const next = await siteApi.getMediaDayGateStatus(currentLeagueId);
      setStatus(next);
      setStage((current) => {
        if (!next.required) return "hidden";
        return current === "hidden" ? "advanced" : current;
      });
    } catch {
      /* keep the last known status on a transient failure */
    }
  }

  useEffect(() => {
    if (!leagueId) {
      setStage("hidden");
      setStatus(null);
      return;
    }
    const currentLeagueId: string = leagueId;
    void refresh(currentLeagueId);
    const timer = window.setInterval(() => void refresh(currentLeagueId), POLL_MS);
    function onVisible() {
      if (!document.hidden) void refresh(currentLeagueId);
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [leagueId]);

  if (stage === "hidden" || !status) return null;

  return (
    <div className="media-day-gate" role="dialog" aria-modal="true" aria-labelledby="media-day-gate-title">
      {stage === "advanced" && (
        <div className="media-day-gate-advanced">
          <p className="media-day-gate-eyebrow">League has advanced to</p>
          <h1 id="media-day-gate-title">{status.weekLabel}</h1>
          <button type="button" className="site-btn site-btn-primary" onClick={() => setStage("recap")}>
            Continue
          </button>
        </div>
      )}
      {stage === "recap" && (
        <div className="media-day-gate-advanced">
          <p>Rewards recap coming soon.</p>
          <button type="button" className="site-btn site-btn-primary" onClick={() => setStage("media_day")}>
            Continue
          </button>
        </div>
      )}
      {stage === "media_day" && (
        <div className="media-day-gate-advanced">
          <p>Media Day coming soon.</p>
          <button type="button" className="site-btn site-btn-primary" onClick={() => setStage("hidden")}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
