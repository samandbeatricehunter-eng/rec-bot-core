import { useEffect, useState } from "react";
import { useHub } from "../lib/hub-context.js";
import { siteApi } from "../lib/site-api.js";

const POLL_MS = 20_000;

type GateStatus = Awaited<ReturnType<typeof siteApi.getMediaDayGateStatus>>;
type RecapResult = Awaited<ReturnType<typeof siteApi.getRewardsRecap>>;
type InterviewResult = Awaited<ReturnType<typeof siteApi.getMediaDayInterview>>;
type GateStage = "hidden" | "advanced" | "recap" | "week_transition" | "media_day" | "reveal";
const LINE_REVEAL_MS = 550;

const SP_ROLL_FILL_MS = 700;
const SP_PULSE_MS = 450;

/** "Lotto roll" SP progress: fills toward the next Skill Point, then -- once it actually crosses
 *  a whole SP -- pulses the SP counter to its new value and resets to 0, repeating once per SP
 *  earned this recap before settling on the final remainder. Starts only once `active` (the
 *  parent's per-subject reveal gate) flips true, mirroring the existing line-reveal pacing.
 *  A hook (not a component) so the count and the bar can render in two different places in the
 *  subject layout while sharing one animation timeline. */
function useAnimatedSp({ beforeSp, afterSp, beforeRemainder, afterRemainder, threshold, active }: {
  beforeSp: number; afterSp: number; beforeRemainder: number; afterRemainder: number; threshold: number; active: boolean;
}): { displaySp: number; pulsing: boolean; fillPct: number } {
  const spDelta = Math.max(0, afterSp - beforeSp);
  const [step, setStep] = useState(0);
  const [displaySp, setDisplaySp] = useState(beforeSp);
  const [pulsing, setPulsing] = useState(false);
  const [fillPct, setFillPct] = useState(threshold > 0 ? Math.max(0, Math.min(100, (beforeRemainder / threshold) * 100)) : 0);

  useEffect(() => {
    if (!active || step > spDelta) return;
    const crossing = step < spDelta;
    const targetPct = crossing ? 100 : (threshold > 0 ? Math.max(0, Math.min(100, (afterRemainder / threshold) * 100)) : 0);
    const fillTimer = window.setTimeout(() => setFillPct(targetPct), 50);
    const advanceTimer = window.setTimeout(() => {
      if (crossing) {
        setDisplaySp(beforeSp + step + 1);
        setPulsing(true);
        window.setTimeout(() => setPulsing(false), SP_PULSE_MS);
        setFillPct(0);
      }
      setStep((s) => s + 1);
    }, SP_ROLL_FILL_MS);
    return () => { window.clearTimeout(fillTimer); window.clearTimeout(advanceTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step, spDelta, threshold, afterRemainder, beforeSp]);

  return { displaySp, pulsing, fillPct };
}

function RewardsRecapSubjectCard({ subject, active, startIndex, visibleLines }: {
  subject: NonNullable<RecapResult>["subjects"][number]; active: boolean; startIndex: number; visibleLines: number;
}) {
  const beforeSp = subject.balanceSp - subject.spEarned;
  const beforeRemainder = subject.beforePoints - beforeSp * subject.nextSpCost;
  const { displaySp, pulsing, fillPct } = useAnimatedSp({
    beforeSp, afterSp: subject.balanceSp, beforeRemainder, afterRemainder: subject.remainderXp,
    threshold: subject.nextSpCost, active,
  });
  return (
    <div className="media-day-gate-recap-subject">
      <div className="media-day-gate-recap-subject-head">
        <span>{subject.name}</span>
        <span className={`media-day-gate-sp-count${pulsing ? " is-pulsing" : ""}`}>{displaySp.toLocaleString()} SP</span>
      </div>
      <div className="media-day-gate-recap-bar">
        <div className="media-day-gate-recap-bar-fill" style={{ width: `${fillPct}%` }} />
      </div>
      <ul className="media-day-gate-recap-lines">
        {subject.lines.map((line, i) => (
          startIndex + i < visibleLines ? <li key={i}>+{line.points.toLocaleString()} — {line.label}</li> : null
        ))}
      </ul>
    </div>
  );
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
      {subjectsWithCounts.map(({ subject, startIndex }) => (
        <RewardsRecapSubjectCard
          key={subject.subjectKey}
          subject={subject}
          active={visibleLines >= startIndex + subject.lines.length}
          startIndex={startIndex}
          visibleLines={visibleLines}
        />
      ))}
      {allRevealed && (
        <button type="button" className="site-btn site-btn-primary" onClick={onContinue}>Continue</button>
      )}
    </div>
  );
}

const TIER_TITLE: Record<"bronze" | "silver" | "gold", string> = { bronze: "Bronze", silver: "Silver", gold: "Gold" };

function ChallengeRevealScreen({ leagueId, onContinue }: { leagueId: string; onContinue: () => void }) {
  const [reveal, setReveal] = useState<Awaited<ReturnType<typeof siteApi.getMediaDayChallengeReveal>> | null>(null);

  useEffect(() => {
    void siteApi.getMediaDayChallengeReveal(leagueId).then(setReveal).catch(() => setReveal([]));
  }, [leagueId]);

  return (
    <div className="media-day-gate-recap">
      <p className="media-day-gate-eyebrow">This week's challenge</p>
      {!reveal && <p>Loading...</p>}
      {reveal?.map((entry) => (
        <div key={entry.side} className="media-day-gate-recap-subject">
          <div className="media-day-gate-recap-subject-head">
            <span>{entry.challengeName}</span>
            <span className="media-day-gate-eyebrow">{entry.side}</span>
          </div>
          {entry.tiers.map((tier) => (
            <div key={tier.tier}>
              <p className="media-day-gate-eyebrow">{TIER_TITLE[tier.tier]}</p>
              <ul className="media-day-gate-recap-lines">
                {tier.lines.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </div>
          ))}
        </div>
      ))}
      {reveal && <button type="button" className="site-btn site-btn-primary" onClick={onContinue}>Continue to league hub</button>}
    </div>
  );
}

function MediaDayInterviewScreen({ leagueId, onComplete }: { leagueId: string; onComplete: () => void }) {
  const [interview, setInterview] = useState<InterviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState(false);

  function load() {
    void siteApi.getMediaDayInterview(leagueId).then(setInterview).catch((err) => setError(err instanceof Error ? err.message : "Couldn't load Media Day."));
  }

  useEffect(load, [leagueId]);

  if (error) return <p className="media-day-gate-eyebrow">{error}</p>;
  if (!interview) return <p>Loading Media Day...</p>;
  if (interview.complete || !interview.questions.length) {
    if (!revealed) {
      return (
        <div className="media-day-gate-advanced">
          <h1>All Media Day statements have been recorded</h1>
          <button type="button" className="site-btn site-btn-primary" onClick={() => setRevealed(true)}>See this week's challenge</button>
        </div>
      );
    }
    return <ChallengeRevealScreen leagueId={leagueId} onContinue={onComplete} />;
  }

  const current = interview.questions.find((q) => !q.answered) ?? interview.questions[0]!;
  const answeredCount = interview.questions.filter((q) => q.answered).length;

  async function choose(answerKey: string) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await siteApi.submitMediaDayAnswer({ leagueId, side: current.side, questionId: current.questionId, answerKey });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit that answer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="media-day-gate-interview">
      <div className="media-day-gate-interview-head">
        <span>{interview.teamName} press conference</span>
        <span className="media-day-gate-eyebrow">{answeredCount + 1} of {interview.questions.length}</span>
      </div>
      <div className="media-day-gate-interview-progress">
        {interview.questions.map((q) => (
          <div key={q.questionId} className={q.answered ? "media-day-gate-interview-progress-seg is-done" : "media-day-gate-interview-progress-seg"} />
        ))}
      </div>
      <div className="media-day-gate-interview-question">
        <img className="media-day-gate-interview-avatar" src={current.reporterHeadshotUrl} alt={current.reporterName} />
        <div>
          <p className="media-day-gate-eyebrow">{current.reporterName}</p>
          <p>{current.questionText}</p>
        </div>
      </div>
      <div className="media-day-gate-interview-options">
        {current.options.map((option) => (
          <button key={option.key} type="button" disabled={submitting} onClick={() => void choose(option.key)}>
            {option.text}
          </button>
        ))}
      </div>
      {error && <p className="media-day-gate-eyebrow">{error}</p>}
    </div>
  );
}

function RtiSubjectAwaitingChallenge({ label, title, detail, onRetry }: { label: string; title: string; detail: string; onRetry: () => void }) {
  return (
    <div className="media-day-gate-advanced">
      <p className="media-day-gate-eyebrow">{label}</p>
      <h1>{title}</h1>
      <p>{detail}</p>
      <button type="button" className="site-btn site-btn-primary" onClick={onRetry}>Check again</button>
    </div>
  );
}

// status comes from the parent's server-authoritative session snapshot (media-day-session.service.ts),
// not from this screen's own interview.complete -- a subject only ever counts as done once the
// session status says so (interview answered AND that side's weekly challenge actually issued), so
// this never independently decides to advance the flow. onAnswered asks the parent to re-check.
function RtiOwnerInterviewScreen({ guildId, status, onAnswered }: { guildId: string; status: { required: boolean }; onAnswered: () => void }) {
  const [interview, setInterview] = useState<Awaited<ReturnType<typeof siteApi.getRtiOwnerInterview>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    void siteApi.getRtiOwnerInterview({ guildId }).then(setInterview).catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the owner interview."));
  }
  useEffect(load, [guildId]);
  useEffect(() => {
    if (interview?.complete) onAnswered();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview?.complete]);

  if (error) return <p className="media-day-gate-eyebrow">{error}</p>;
  if (!interview) return <p>Loading Media Day...</p>;
  if (interview.complete || !status.required) {
    return (
      <RtiSubjectAwaitingChallenge
        label="Owner interview" title="Answers recorded"
        detail="This week's owner challenge hasn't been assigned yet. Check again in a moment."
        onRetry={onAnswered}
      />
    );
  }
  const answeredCount = interview.answers.length;
  const current = interview.questions[answeredCount];
  if (!current) return <p>Loading...</p>;

  async function choose(optionIndex: number) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await siteApi.submitRtiOwnerInterview({ guildId, questionId: current!.id, optionIndex });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit that answer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="media-day-gate-interview">
      <div className="media-day-gate-interview-head">
        <span>Owner interview</span>
        <span className="media-day-gate-eyebrow">{answeredCount + 1} of {interview.questions.length}</span>
      </div>
      <div className="media-day-gate-interview-progress">
        {interview.questions.map((q, i) => (
          <div key={q.id} className={i < answeredCount ? "media-day-gate-interview-progress-seg is-done" : "media-day-gate-interview-progress-seg"} />
        ))}
      </div>
      <div className="media-day-gate-interview-question">
        {interview.headshotUrl && <img className="media-day-gate-interview-avatar" src={interview.headshotUrl} alt={interview.ownerName} />}
        <div>
          <p className="media-day-gate-eyebrow">{interview.ownerName}</p>
          <p>{current.question}</p>
        </div>
      </div>
      <div className="media-day-gate-interview-options">
        {current.options.map((option, i) => (
          <button key={i} type="button" disabled={submitting} onClick={() => void choose(i)}>{option.text}</button>
        ))}
      </div>
      {error && <p className="media-day-gate-eyebrow">{error}</p>}
    </div>
  );
}

function RtiProspectInterviewScreen({ guildId, side, status, onAnswered }: { guildId: string; side: "offense" | "defense"; status: { required: boolean }; onAnswered: () => void }) {
  const [interview, setInterview] = useState<Awaited<ReturnType<typeof siteApi.getRtiWeeklyMatchupInterview>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    void siteApi.getRtiWeeklyMatchupInterview({ guildId, side }).then(setInterview).catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this prospect's Media Day."));
  }
  useEffect(load, [guildId, side]);
  const done = interview?.complete || interview?.windowClosed;
  useEffect(() => {
    if (done) onAnswered();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  if (error) return <p className="media-day-gate-eyebrow">{error}</p>;
  if (!interview) return <p>Loading Media Day...</p>;
  if (done || !status.required) {
    const windowClosedEarly = interview.windowClosed && !interview.complete;
    return (
      <RtiSubjectAwaitingChallenge
        label={`${interview.prospectName} (${side})`}
        title={windowClosedEarly ? "This week's interview window closed" : "Answers recorded"}
        detail={windowClosedEarly
          ? `The window to answer this week closed before every question was answered. Checking whether ${interview.prospectName}'s challenge is ready.`
          : `This week's challenge for ${interview.prospectName} hasn't been assigned yet. Check again in a moment.`}
        onRetry={onAnswered}
      />
    );
  }
  const answeredCount = interview.answers.length;
  const current = interview.questions[answeredCount];
  if (!current) return <p>Loading...</p>;

  async function choose(optionIndex: number) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await siteApi.submitRtiWeeklyMatchupInterview({ guildId, side, questionId: current!.id, optionIndex });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit that answer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="media-day-gate-interview">
      <div className="media-day-gate-interview-head">
        <span>{interview.prospectName} ({side})</span>
        <span className="media-day-gate-eyebrow">{answeredCount + 1} of {interview.questions.length}</span>
      </div>
      <div className="media-day-gate-interview-progress">
        {interview.questions.map((q, i) => (
          <div key={q.id} className={i < answeredCount ? "media-day-gate-interview-progress-seg is-done" : "media-day-gate-interview-progress-seg"} />
        ))}
      </div>
      <div className="media-day-gate-interview-question">
        {interview.headshotUrl && <img className="media-day-gate-interview-avatar" src={interview.headshotUrl} alt={interview.prospectName} />}
        <p>{current.question}</p>
      </div>
      <div className="media-day-gate-interview-options">
        {current.options.map((option, i) => (
          <button key={i} type="button" disabled={submitting} onClick={() => void choose(i)}>{option.text}</button>
        ))}
      </div>
      {error && <p className="media-day-gate-eyebrow">{error}</p>}
    </div>
  );
}

const RTI_TIER_TITLE: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold" };

function RtiChallengeRevealScreen({ leagueId, onContinue }: { leagueId: string; onContinue: () => void }) {
  const [ownerReveal, setOwnerReveal] = useState<Awaited<ReturnType<typeof siteApi.getMediaDayChallengeReveal>> | null>(null);
  const [prospectReveal, setProspectReveal] = useState<Awaited<ReturnType<typeof siteApi.getRtiProspectChallengeReveal>> | null>(null);

  useEffect(() => {
    void siteApi.getMediaDayChallengeReveal(leagueId).then(setOwnerReveal).catch(() => setOwnerReveal([]));
    void siteApi.getRtiProspectChallengeReveal(leagueId).then(setProspectReveal).catch(() => setProspectReveal([]));
  }, [leagueId]);

  const loaded = ownerReveal !== null && prospectReveal !== null;
  return (
    <div className="media-day-gate-recap">
      <p className="media-day-gate-eyebrow">This week's challenges</p>
      {!loaded && <p>Loading...</p>}
      {prospectReveal?.map((prospect) => (
        <div key={prospect.prospectId} className="media-day-gate-recap-subject">
          <div className="media-day-gate-recap-subject-head"><span>{prospect.name}</span><span className="media-day-gate-eyebrow">{prospect.side}</span></div>
          <ul className="media-day-gate-recap-lines">
            {prospect.tiers.map((tier) => <li key={tier.tier}>{RTI_TIER_TITLE[tier.tier] ?? tier.tier}: {tier.label}</li>)}
          </ul>
        </div>
      ))}
      {ownerReveal?.map((entry) => (
        <div key={entry.side} className="media-day-gate-recap-subject">
          <div className="media-day-gate-recap-subject-head"><span>{entry.challengeName}</span><span className="media-day-gate-eyebrow">Team ({entry.side})</span></div>
          {entry.tiers.map((tier) => (
            <div key={tier.tier}>
              <p className="media-day-gate-eyebrow">{RTI_TIER_TITLE[tier.tier]}</p>
              <ul className="media-day-gate-recap-lines">{tier.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
            </div>
          ))}
        </div>
      ))}
      {loaded && <button type="button" className="site-btn site-btn-primary" onClick={onContinue}>Continue to league hub</button>}
    </div>
  );
}

// Drives the whole RTI flow off one server-authoritative snapshot (media-day-session.service.ts)
// instead of a fixed subjectKeys array the old version stepped through locally -- every subject
// screen calls onAnswered (never a local "I'm done" signal) to ask the parent to re-check, and
// only session.mediaDayComplete (set entirely server-side) is allowed to end the flow. This is the
// fix for the exact failure mode from the 2026-09-15 acceptance-test recording: a subject can no
// longer silently drop out of the sequence because one screen misread its own local state.
function RtiInterviewFlow({ guildId, leagueId, onComplete }: { guildId: string; leagueId: string; onComplete: () => void }) {
  const [session, setSession] = useState<Awaited<ReturnType<typeof siteApi.getMediaDaySessionStatus>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReveal, setShowReveal] = useState(false);

  function refreshSession() {
    void siteApi.getMediaDaySessionStatus(leagueId).then(setSession).catch((err) => setError(err instanceof Error ? err.message : "Couldn't load Media Day."));
  }
  useEffect(refreshSession, [guildId, leagueId]);

  if (error) return <p className="media-day-gate-eyebrow">{error}</p>;
  if (!session) return <p>Loading Media Day...</p>;

  if (session.mediaDayComplete) {
    if (!showReveal) {
      return (
        <div className="media-day-gate-advanced">
          <h1>All Media Day statements have been recorded</h1>
          <button type="button" className="site-btn site-btn-primary" onClick={() => setShowReveal(true)}>See this week's challenges</button>
        </div>
      );
    }
    return <RtiChallengeRevealScreen leagueId={leagueId} onContinue={onComplete} />;
  }

  const needsAttention = (subject: typeof session.offense) => Boolean(subject?.required && !subject.satisfied);
  if (needsAttention(session.offense)) {
    return <RtiProspectInterviewScreen key="offense" guildId={guildId} side="offense" status={session.offense!} onAnswered={refreshSession} />;
  }
  if (needsAttention(session.defense)) {
    return <RtiProspectInterviewScreen key="defense" guildId={guildId} side="defense" status={session.defense!} onAnswered={refreshSession} />;
  }
  if (needsAttention(session.owner)) {
    return <RtiOwnerInterviewScreen key="owner" guildId={guildId} status={session.owner!} onAnswered={refreshSession} />;
  }
  // Every subject satisfied but the server hasn't caught up to mediaDayComplete yet (a rare race
  // right after the last answer) -- re-check rather than render a dead end.
  return (
    <div className="media-day-gate-advanced">
      <h1>Checking Media Day status...</h1>
      <button type="button" className="site-btn site-btn-primary" onClick={refreshSession}>Refresh</button>
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
  const guildId = hub.selectedLeague?.guildId ?? null;
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
      {stage === "media_day" && status.leagueId && status.isRti && guildId && (
        <RtiInterviewFlow
          guildId={guildId} leagueId={status.leagueId}
          onComplete={() => { setStage("hidden"); void refresh(status.leagueId); }}
        />
      )}
      {stage === "media_day" && status.leagueId && !status.isRti && (
        <MediaDayInterviewScreen leagueId={status.leagueId} onComplete={() => { setStage("hidden"); void refresh(status.leagueId); }} />
      )}
    </div>
  );
}
