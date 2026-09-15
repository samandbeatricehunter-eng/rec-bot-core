import { useEffect, useState, type ReactNode } from "react";
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

// Every subject's SP bar finishes its own roll-and-pulse animation shortly after its last line
// reveals (useAnimatedSp's SP_ROLL_FILL_MS/SP_PULSE_MS) -- Continue waits this long past the last
// line so the final balance visibly settles instead of the button appearing mid-animation.
const RECAP_SETTLE_MS = 800;

function RewardsRecapScreen({ leagueId, onContinue }: { leagueId: string; onContinue: () => void }) {
  const [recap, setRecap] = useState<RecapResult | null>(null);
  const [visibleLines, setVisibleLines] = useState(0);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    void siteApi.getRewardsRecap(leagueId).then(setRecap).catch(() => setRecap({ seasonNumber: 0, weekNumber: 0, subjects: [] }));
  }, [leagueId]);

  const totalLines = recap?.subjects.reduce((sum, s) => sum + s.lines.length, 0) ?? 0;

  useEffect(() => {
    if (!recap || visibleLines >= totalLines) return;
    const timer = window.setTimeout(() => setVisibleLines((count) => count + 1), LINE_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [recap, visibleLines, totalLines]);

  const allRevealed = totalLines > 0 && visibleLines >= totalLines;
  useEffect(() => {
    if (!allRevealed) return;
    const timer = window.setTimeout(() => setSettled(true), RECAP_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [allRevealed]);

  if (!recap) return <p>Loading last week's recap...</p>;
  if (!recap.subjects.length) {
    return (
      <div className="media-day-gate-recap">
        <p>No new XP to report from last week.</p>
        <button type="button" className="site-btn site-btn-primary" onClick={onContinue}>Continue</button>
      </div>
    );
  }

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
      {settled && (
        <button type="button" className="site-btn site-btn-primary media-day-reveal-fade-in" onClick={onContinue}>Continue</button>
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

  const turns: ConversationTurn[] = interview.questions
    .filter((q) => q.answered || q.questionId === current.questionId)
    .map((q) => ({
      key: q.questionId, reporterName: q.reporterName, reporterRole: q.reporterRole, reporterHeadshotUrl: q.reporterHeadshotUrl,
      questionText: q.questionText,
      answerText: q.answered ? (q.options.find((o) => o.key === q.answerKey)?.text ?? null) : null,
    }));

  return (
    <>
      <InterviewConversation
        heading={<span>{interview.teamName} press conference</span>}
        progress={{ total: interview.questions.length, done: answeredCount }}
        turns={turns}
        currentOptions={current.options}
        onChoose={(key) => void choose(String(key))}
        submitting={submitting}
        youLabel={interview.teamName}
      />
      {error && <p className="media-day-gate-eyebrow">{error}</p>}
    </>
  );
}

type ConversationTurn = {
  key: string | number;
  reporterName: string;
  reporterRole: string;
  reporterHeadshotUrl: string;
  questionText: string;
  /** null = this is the live turn -- not yet answered, options render below it instead of a reply bubble. */
  answerText: string | null;
};

// The REC Media Day conversation stage: every question/answer pair this session stays visible as
// the interview goes, instead of each new question replacing the last one on screen. Reporter
// questions render as a bubble on the left (their real identity -- see immortality.service.ts's
// withReporter), the user's own answer as a contrasting bubble on the right once chosen. Shared by
// all three interview screens (non-RTI team, RTI prospect, RTI owner) so the redesigned layout only
// needs to be built and tuned once.
function InterviewConversation({ heading, progress, turns, currentOptions, onChoose, submitting, youLabel }: {
  heading: ReactNode;
  progress: { total: number; done: number };
  turns: ConversationTurn[];
  currentOptions: Array<{ key: string | number; text: string }>;
  onChoose: (key: string | number) => void;
  submitting: boolean;
  youLabel: string;
}) {
  return (
    <div className="media-day-conversation">
      <div className="media-day-gate-interview-head">
        {heading}
        <span className="media-day-gate-eyebrow">{progress.done + 1} of {progress.total}</span>
      </div>
      <div className="media-day-gate-interview-progress">
        {Array.from({ length: progress.total }).map((_, i) => (
          <div key={i} className={i < progress.done ? "media-day-gate-interview-progress-seg is-done" : "media-day-gate-interview-progress-seg"} />
        ))}
      </div>
      <div className="media-day-conversation-log">
        {turns.map((turn) => (
          <div className="media-day-conversation-turn" key={turn.key}>
            <div className="media-day-conversation-bubble media-day-conversation-bubble-reporter">
              <img className="media-day-conversation-avatar" src={turn.reporterHeadshotUrl} alt={turn.reporterName} />
              <div className="media-day-conversation-bubble-body">
                <p className="media-day-conversation-byline">{turn.reporterName} <span>{turn.reporterRole}</span></p>
                <p>{turn.questionText}</p>
              </div>
            </div>
            {turn.answerText != null && (
              <div className="media-day-conversation-bubble media-day-conversation-bubble-you">
                <div className="media-day-conversation-bubble-body">
                  <p className="media-day-conversation-byline">{youLabel}</p>
                  <p>{turn.answerText}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {currentOptions.length > 0 && (
        <div className="media-day-gate-interview-options">
          {currentOptions.map((option) => (
            <button key={option.key} type="button" disabled={submitting} onClick={() => onChoose(option.key)}>{option.text}</button>
          ))}
        </div>
      )}
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

  const turns: ConversationTurn[] = interview.questions.slice(0, answeredCount + 1).map((q, i) => {
    const answer = interview.answers[i];
    return {
      key: q.id, reporterName: q.reporterName, reporterRole: q.reporterRole, reporterHeadshotUrl: q.reporterHeadshotUrl,
      questionText: q.question,
      answerText: answer ? (q.options[Number(answer.option_index)]?.text ?? null) : null,
    };
  });

  return (
    <>
      <InterviewConversation
        heading={<span>Owner interview — {interview.ownerName}</span>}
        progress={{ total: interview.questions.length, done: answeredCount }}
        turns={turns}
        currentOptions={current.options.map((option, i) => ({ key: i, text: option.text }))}
        onChoose={(key) => void choose(Number(key))}
        submitting={submitting}
        youLabel={interview.ownerName}
      />
      {error && <p className="media-day-gate-eyebrow">{error}</p>}
    </>
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

  const turns: ConversationTurn[] = interview.questions.slice(0, answeredCount + 1).map((q, i) => {
    const answer = interview.answers[i];
    return {
      key: q.id, reporterName: q.reporterName, reporterRole: q.reporterRole, reporterHeadshotUrl: q.reporterHeadshotUrl,
      questionText: q.question,
      answerText: answer ? (q.options[Number(answer.option_index)]?.text ?? null) : null,
    };
  });

  return (
    <>
      <InterviewConversation
        heading={<span>{interview.prospectName} ({side})</span>}
        progress={{ total: interview.questions.length, done: answeredCount }}
        turns={turns}
        currentOptions={current.options.map((option, i) => ({ key: i, text: option.text }))}
        onChoose={(key) => void choose(Number(key))}
        submitting={submitting}
        youLabel={interview.prospectName}
      />
      {error && <p className="media-day-gate-eyebrow">{error}</p>}
    </>
  );
}

const RTI_TIER_TITLE: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold" };

const REVEAL_CARD_STAGGER_MS = 450;
const REVEAL_TIER_STAGGER_MS = 220;

type RevealCard = {
  key: string;
  category: string;
  identity: string;
  tiers: Array<{ tier: "bronze" | "silver" | "gold"; lines: string[] }>;
};

// Each of the (up to) three RTI Media Day challenges -- Offensive Prospect, Defensive Prospect,
// Owner/Team -- reads as an assignment being handed out rather than a database row appearing:
// the category label shows first, then the subject's identity, then Bronze/Silver/Gold animate in
// one at a time (staggered via animation-delay, computed from the tier's index), Gold getting the
// strongest visual treatment. Cards themselves also stagger in sequence.
function RevealCardView({ card, cardIndex }: { card: RevealCard; cardIndex: number }) {
  return (
    <div
      className="media-day-reveal-card"
      style={{ animationDelay: `${cardIndex * REVEAL_CARD_STAGGER_MS}ms` }}
    >
      <p className="media-day-reveal-card-category">{card.category}</p>
      <p className="media-day-reveal-card-identity">{card.identity}</p>
      <div className="media-day-reveal-card-tiers">
        {card.tiers.map((tier, tierIndex) => (
          <div
            key={tier.tier}
            className={`media-day-reveal-tier media-day-reveal-tier-${tier.tier}`}
            style={{ animationDelay: `${cardIndex * REVEAL_CARD_STAGGER_MS + 300 + tierIndex * REVEAL_TIER_STAGGER_MS}ms` }}
          >
            <p className="media-day-reveal-tier-title">{RTI_TIER_TITLE[tier.tier] ?? tier.tier}</p>
            <ul className="media-day-gate-recap-lines">{tier.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function RtiChallengeRevealScreen({ leagueId, onContinue }: { leagueId: string; onContinue: () => void }) {
  const [ownerReveal, setOwnerReveal] = useState<Awaited<ReturnType<typeof siteApi.getMediaDayChallengeReveal>> | null>(null);
  const [prospectReveal, setProspectReveal] = useState<Awaited<ReturnType<typeof siteApi.getRtiProspectChallengeReveal>> | null>(null);

  useEffect(() => {
    void siteApi.getMediaDayChallengeReveal(leagueId).then(setOwnerReveal).catch(() => setOwnerReveal([]));
    void siteApi.getRtiProspectChallengeReveal(leagueId).then(setProspectReveal).catch(() => setProspectReveal([]));
  }, [leagueId]);

  const loaded = ownerReveal !== null && prospectReveal !== null;
  if (!loaded) return <div className="media-day-gate-recap"><p className="media-day-gate-eyebrow">This week's challenges</p><p>Loading...</p></div>;

  // Fixed order -- offense, then defense, then owner/team -- regardless of what order the API
  // happened to return each half in, so the sequence always reads the same way.
  const cards: RevealCard[] = [
    ...prospectReveal.filter((p) => p.side === "offense").map((p): RevealCard => ({
      key: p.prospectId, category: "Offensive Prospect", identity: p.name,
      tiers: p.tiers.map((t) => ({ tier: t.tier as "bronze" | "silver" | "gold", lines: [t.label] })),
    })),
    ...prospectReveal.filter((p) => p.side === "defense").map((p): RevealCard => ({
      key: p.prospectId, category: "Defensive Prospect", identity: p.name,
      tiers: p.tiers.map((t) => ({ tier: t.tier as "bronze" | "silver" | "gold", lines: [t.label] })),
    })),
    ...ownerReveal.map((entry): RevealCard => ({
      key: entry.side, category: `Owner Challenge — Team (${entry.side})`, identity: entry.challengeName,
      tiers: entry.tiers,
    })),
  ];

  return (
    <div className="media-day-gate-recap media-day-reveal">
      <p className="media-day-gate-eyebrow">This week's challenges</p>
      {cards.map((card, i) => <RevealCardView key={card.key} card={card} cardIndex={i} />)}
      {!cards.length && <p>No challenges assigned yet this week.</p>}
      <button
        type="button" className="site-btn site-btn-primary media-day-reveal-fade-in"
        style={{ animationDelay: `${cards.length * REVEAL_CARD_STAGGER_MS + 300}ms` }}
        onClick={onContinue}
      >
        Continue to league hub
      </button>
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
