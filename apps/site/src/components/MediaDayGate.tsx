import { useEffect, useState } from "react";
import { useHub } from "../lib/hub-context.js";
import { siteApi } from "../lib/site-api.js";

const POLL_MS = 20_000;

type GateStatus = Awaited<ReturnType<typeof siteApi.getMediaDayGateStatus>>;
type RecapResult = Awaited<ReturnType<typeof siteApi.getRewardsRecap>>;
type GateStage = "hidden" | "advanced" | "recap" | "week_transition" | "media_day" | "reveal";
const LINE_REVEAL_MS = 550;

function fractionalPct(xp: number): number {
  return Math.round((xp - Math.floor(xp)) * 100);
}

function RewardsRecapScreen({ leagueId, onContinue }: { leagueId: string; onContinue: () => void }) {
  const [recap, setRecap] = useState<RecapResult | null>(null);
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    void siteApi.getRewardsRecap(leagueId).then(setRecap).catch(() => setRecap({ seasonNumber: 0, weekNumber: 0, subjects: [] }));
  }, [leagueId]);

  const totalLines = recap?.subjects.reduce((sum, s) => sum + s.lines.length, 0) ?? 0;

  useEffect(() => {
    if (!recap || visibleLines >= totalLines) return;
    const timer = window.setTimeout(() => setVisibleLines((count) => count + 1), LINE_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [recap, visibleLines, totalLines]);

  if (!recap) return <p>Loading last week's recap...</p>;
  if (!recap.subjects.length) {
    return (
      <div className="media-day-gate-recap">
        <p>No new XP to report from last week.</p>
        <button type="button" className="site-btn site-btn-primary" onClick={onContinue}>Continue</button>
      </div>
    );
  }

  const allRevealed = totalLines > 0 && visibleLines >= totalLines;
  let seenLines = 0;
  const subjectsWithCounts = recap.subjects.map((subject) => {
    const startIndex = seenLines;
    seenLines += subject.lines.length;
    return { subject, startIndex };
  });

  return (
    <div className="media-day-gate-recap">
      <p className="media-day-gate-eyebrow">Last week's recap</p>
      {subjectsWithCounts.map(({ subject, startIndex }) => {
        const subjectFullyRevealed = visibleLines >= startIndex + subject.lines.length;
        return (
          <div key={subject.subjectKey} className="media-day-gate-recap-subject">
            <div className="media-day-gate-recap-subject-head">
              <span>{subject.name}</span>
              <span className="media-day-gate-eyebrow">Level {Math.floor(subject.afterXp)}</span>
            </div>
            <div className="media-day-gate-recap-bar">
              <div
                className="media-day-gate-recap-bar-fill"
                style={{ width: `${subjectFullyRevealed ? fractionalPct(subject.afterXp) : fractionalPct(subject.beforeXp)}%` }}
              />
            </div>
            <ul className="media-day-gate-recap-lines">
              {subject.lines.map((line, i) => (
                startIndex + i < visibleLines ? <li key={i}>+{line.points.toLocaleString()} — {line.label}</li> : null
              ))}
            </ul>
          </div>
        );
      })}
      {allRevealed && (
        <button type="button" className="site-btn site-btn-primary" onClick={onContinue}>Continue</button>
      )}
    </div>
  );
}

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
      {stage === "recap" && status.leagueId && (
        <RewardsRecapScreen leagueId={status.leagueId} onContinue={() => setStage("week_transition")} />
      )}
      {stage === "week_transition" && (
        <div className="media-day-gate-advanced media-day-gate-week-title">
          <h1>{status.weekLabel}</h1>
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
