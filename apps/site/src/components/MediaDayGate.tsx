import { useEffect, useState } from "react";
import { useHub } from "../lib/hub-context.js";
import { siteApi } from "../lib/site-api.js";

const POLL_MS = 20_000;

type GateStatus = Awaited<ReturnType<typeof siteApi.getMediaDayGateStatus>>;
type RecapResult = Awaited<ReturnType<typeof siteApi.getRewardsRecap>>;
type InterviewResult = Awaited<ReturnType<typeof siteApi.getMediaDayInterview>>;
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

function RtiOwnerInterviewScreen({ guildId, onDone }: { guildId: string; onDone: () => void }) {
  const [interview, setInterview] = useState<Awaited<ReturnType<typeof siteApi.getRtiOwnerInterview>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    void siteApi.getRtiOwnerInterview({ guildId }).then(setInterview).catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the owner interview."));
  }
  useEffect(load, [guildId]);
  useEffect(() => {
    if (interview?.complete) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview?.complete]);

  if (error) return <p className="media-day-gate-eyebrow">{error}</p>;
  if (!interview || interview.complete) return <p>Loading Media Day...</p>;
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

function RtiProspectInterviewScreen({ guildId, side, onDone }: { guildId: string; side: "offense" | "defense"; onDone: () => void }) {
  const [interview, setInterview] = useState<Awaited<ReturnType<typeof siteApi.getRtiWeeklyMatchupInterview>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    void siteApi.getRtiWeeklyMatchupInterview({ guildId, side }).then(setInterview).catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this prospect's Media Day."));
  }
  useEffect(load, [guildId, side]);
  const done = interview?.complete || interview?.windowClosed;
  useEffect(() => {
    if (done) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  if (error) return <p className="media-day-gate-eyebrow">{error}</p>;
  if (!interview || done) return <p>Loading Media Day...</p>;
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

function RtiInterviewFlow({ guildId, leagueId, subjectKeys, onComplete }: { guildId: string; leagueId: string; subjectKeys: string[]; onComplete: () => void }) {
  const [subjectIndex, setSubjectIndex] = useState(0);
  const [showReveal, setShowReveal] = useState(false);

  if (subjectIndex >= subjectKeys.length) {
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

  const subjectKey = subjectKeys[subjectIndex]!;
  const onSubjectDone = () => setSubjectIndex((i) => i + 1);
  if (subjectKey === "owner") return <RtiOwnerInterviewScreen key={subjectKey} guildId={guildId} onDone={onSubjectDone} />;
  const side = subjectKey.split(":")[1] as "offense" | "defense";
  return <RtiProspectInterviewScreen key={subjectKey} guildId={guildId} side={side} onDone={onSubjectDone} />;
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
          guildId={guildId} leagueId={status.leagueId} subjectKeys={status.missingSubjectKeys}
          onComplete={() => { setStage("hidden"); void refresh(status.leagueId); }}
        />
      )}
      {stage === "media_day" && status.leagueId && !status.isRti && (
        <MediaDayInterviewScreen leagueId={status.leagueId} onComplete={() => { setStage("hidden"); void refresh(status.leagueId); }} />
      )}
    </div>
  );
}
