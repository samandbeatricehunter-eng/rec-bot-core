import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { MADDEN_ATTRIBUTE_DEFINITIONS } from "@rec/shared";
import { useHub } from "../lib/hub-context.js";
import {
  siteApi,
  type ImmortalityHubResponse,
  type ImmortalityIqState,
  type ImmortalityInterviewQuestion,
} from "../lib/site-api.js";

type Side = "offense" | "defense";
type Stage = "identity" | "iq" | "persona" | "playstyle" | "characteristics" | "creation";

const STAGES: { id: Stage; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "iq", label: "IQ Test" },
  { id: "persona", label: "Persona" },
  { id: "playstyle", label: "Playstyle" },
  { id: "characteristics", label: "Traits" },
  { id: "creation", label: "Creation Points" },
];

function prospectFor(hub: ImmortalityHubResponse | null, side: Side) {
  return hub?.prospects.find((row) => String(row.side ?? "") === side) ?? null;
}

export function RiseOriginsPage() {
  const { leagueId = "" } = useParams();
  const hubCtx = useHub();
  const selected = hubCtx.selectedLeague;
  const isRise = selected?.rosterType === "rise_to_immortality";
  const guildId = selected?.guildId ?? "";
  const isCommissioner = Boolean(selected?.isCommissioner);

  const [hub, setHub] = useState<ImmortalityHubResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<Side>("offense");
  const [stage, setStage] = useState<Stage>("identity");

  const reload = useCallback(async () => {
    if (!guildId) return;
    const next = await siteApi.immortalityHub(guildId);
    setHub(next);
  }, [guildId]);

  useEffect(() => {
    if (leagueId) hubCtx.ensureLeagueScope(leagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    if (!guildId || !isRise) return;
    let cancelled = false;
    setError(null);
    siteApi.immortalityHub(guildId).then((next) => {
      if (!cancelled) setHub(next);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not load Rise to Immortality.");
    });
    return () => { cancelled = true; };
  }, [guildId, isRise]);

  if (selected && !isRise) {
    return <Navigate replace to={`/l/${leagueId}/buzz`} />;
  }

  if (!selected || !guildId) {
    return <div className="site-page site-loading">Loading Rise to Immortality…</div>;
  }

  const position = side === "offense" ? hub?.league.offensePosition : hub?.league.defensePosition;
  const nextStates = hub ? nextCommissionerStates(hub.league.chapterState) : [];

  return (
    <div className="site-page rise-page">
      <header className="rise-hero">
        <p className="site-muted">Rise to Immortality</p>
        <h1>{hub?.league.chapter.replaceAll("_", " ") ?? "Origins"}</h1>
        <p className="site-muted">
          Chapter state: {hub?.league.chapterState ?? "…"}. League positions: {hub?.league.offensePosition ?? "—"} / {hub?.league.defensePosition ?? "—"}.
          Store purchases are off — Player XP upgrades ratings. Coins are annual contracts only.
        </p>
      </header>

      {error ? <p className="site-auth-error">{error}</p> : null}

      {isCommissioner && hub ? (
        <section className="rise-card">
          <h2>Commissioner</h2>
          <p className="site-muted">Advance the chapter or run the virtual rookie draft. Origins stays website-only.</p>
          <div className="rise-actions">
            {nextStates.map((state) => (
              <button key={state} type="button" className="site-btn site-btn-primary" disabled={busy}
                onClick={async () => {
                  setBusy(true); setError(null);
                  try { await siteApi.immortalityTransitionState({ guildId, toState: state }); await reload(); }
                  catch (err) { setError(err instanceof Error ? err.message : "Could not advance."); }
                  finally { setBusy(false); }
                }}>Open {state.replaceAll("_", " ")}</button>
            ))}
            {hub.league.chapterState === "ROOKIE_DRAFT_LIVE" ? (
              <button type="button" className="site-btn site-btn-primary" disabled={busy}
                onClick={async () => {
                  setBusy(true); setError(null);
                  try { await siteApi.immortalitySolveDraft(guildId); await reload(); }
                  catch (err) { setError(err instanceof Error ? err.message : "Could not solve the draft."); }
                  finally { setBusy(false); }
                }}>Solve rookie draft</button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="rise-side-tabs">
        {(["offense", "defense"] as const).map((value) => (
          <button key={value} type="button"
            className={`wizard-game-card ${side === value ? "wizard-game-card-active" : ""}`}
            onClick={() => { setSide(value); setStage("identity"); }}>
            {value === "offense" ? `Offense (${hub?.league.offensePosition ?? "—"})` : `Defense (${hub?.league.defensePosition ?? "—"})`}
          </button>
        ))}
      </div>

      <nav className="rise-stage-nav" aria-label="Origins steps">
        {STAGES.map((item) => (
          <button key={item.id} type="button" className={stage === item.id ? "is-active" : ""}
            onClick={() => setStage(item.id)}>{item.label}</button>
        ))}
      </nav>

      {!hub ? <p className="site-muted">Loading your class…</p> : (
        <>
          {stage === "identity" ? (
            <IdentityForm guildId={guildId} side={side} position={position ?? ""} prospect={prospectFor(hub, side)}
              onSaved={reload} setError={setError} setBusy={setBusy} busy={busy} />
          ) : null}
          {stage === "iq" ? (
            <IqPanel guildId={guildId} side={side} setError={setError} />
          ) : null}
          {stage === "persona" ? (
            <InterviewPanel title="Persona interview" questions={hub.catalogs.persona[side]}
              onSubmit={async (answers) => {
                const result = await siteApi.immortalitySubmitPersona({ guildId, side, answers });
                await reload();
                return `${result.label} (${result.primary} / ${result.secondary})`;
              }} setError={setError} />
          ) : null}
          {stage === "playstyle" ? (
            <InterviewPanel title="Playstyle interview" questions={hub.catalogs.playstyle[side]}
              onSubmit={async (answers) => {
                const result = await siteApi.immortalitySubmitPlaystyle({ guildId, side, answers });
                await reload();
                return `${result.primaryArchetype} / ${result.secondaryArchetype} (${result.blend.kind})`;
              }} setError={setError} />
          ) : null}
          {stage === "characteristics" ? (
            <CharacteristicsPanel guildId={guildId} side={side} catalog={hub.catalogs.characteristics[side]}
              onSaved={reload} setError={setError} />
          ) : null}
          {stage === "creation" ? (
            <CreationPanel guildId={guildId} side={side} budget={hub.league.creationPointBudget}
              setError={setError} />
          ) : null}
        </>
      )}

      <p className="site-muted"><Link to={`/l/${leagueId}/buzz`}>Back to league overview</Link></p>
    </div>
  );
}

function nextCommissionerStates(from: string): string[] {
  const map: Record<string, string[]> = {
    SETUP: ["REGISTRATION"],
    REGISTRATION: ["ORIGINS"],
    ORIGINS: ["ORIGINS_COMPLETE"],
    ORIGINS_COMPLETE: ["ROOKIE_DRAFT_PREP"],
    ROOKIE_DRAFT_PREP: ["ROOKIE_DRAFT_LIVE"],
    ROOKIE_DRAFT_LIVE: ["ROOKIE_DRAFT_COMPLETE"],
    ROOKIE_DRAFT_COMPLETE: ["TEAM_DRAFT"],
    TEAM_DRAFT: ["FRANCHISE_ACTIVE"],
  };
  return map[from] ?? [];
}

function IdentityForm({
  guildId, side, position, prospect, onSaved, setError, setBusy, busy,
}: {
  guildId: string; side: Side; position: string; prospect: Record<string, unknown> | null;
  onSaved: () => Promise<void>; setError: (value: string | null) => void; setBusy: (value: boolean) => void; busy: boolean;
}) {
  const [firstName, setFirstName] = useState(String(prospect?.first_name ?? ""));
  const [lastName, setLastName] = useState(String(prospect?.last_name ?? ""));
  const [age, setAge] = useState(Number(prospect?.age ?? 21));
  const [hometown, setHometown] = useState(String(prospect?.hometown ?? ""));
  const [hometownState, setHometownState] = useState(String(prospect?.hometown_state ?? ""));
  const [college, setCollege] = useState(String(prospect?.college ?? ""));
  const [jerseyNumber, setJerseyNumber] = useState(Number(prospect?.jersey_number ?? 1));
  const [heightInches, setHeightInches] = useState(Number(prospect?.height_inches ?? 74));
  const [weightLbs, setWeightLbs] = useState(Number(prospect?.weight_lbs ?? 220));

  useEffect(() => {
    setFirstName(String(prospect?.first_name ?? ""));
    setLastName(String(prospect?.last_name ?? ""));
    setAge(Number(prospect?.age ?? 21));
    setHometown(String(prospect?.hometown ?? ""));
    setHometownState(String(prospect?.hometown_state ?? ""));
    setCollege(String(prospect?.college ?? ""));
    setJerseyNumber(Number(prospect?.jersey_number ?? 1));
    setHeightInches(Number(prospect?.height_inches ?? 74));
    setWeightLbs(Number(prospect?.weight_lbs ?? 220));
  }, [prospect]);

  return (
    <section className="rise-card">
      <h2>Identity — {position || side}</h2>
      <p className="site-muted">Age 18–22. Age 18 cannot list a college. This is your created-player class, not Player Lock.</p>
      <div className="rise-grid">
        <label className="site-field"><span>First name</span><input className="site-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
        <label className="site-field"><span>Last name</span><input className="site-input" value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
        <label className="site-field"><span>Age</span><input className="site-input" type="number" min={18} max={22} value={age} onChange={(e) => setAge(Number(e.target.value))} /></label>
        <label className="site-field"><span>Jersey</span><input className="site-input" type="number" min={0} max={99} value={jerseyNumber} onChange={(e) => setJerseyNumber(Number(e.target.value))} /></label>
        <label className="site-field"><span>Hometown</span><input className="site-input" value={hometown} onChange={(e) => setHometown(e.target.value)} /></label>
        <label className="site-field"><span>State</span><input className="site-input" value={hometownState} onChange={(e) => setHometownState(e.target.value)} /></label>
        <label className="site-field"><span>College {age === 18 ? "(locked at 18)" : ""}</span>
          <input className="site-input" value={age === 18 ? "" : college} disabled={age === 18} onChange={(e) => setCollege(e.target.value)} /></label>
        <label className="site-field"><span>Height (inches)</span><input className="site-input" type="number" min={60} max={84} value={heightInches} onChange={(e) => setHeightInches(Number(e.target.value))} /></label>
        <label className="site-field"><span>Weight (lbs)</span><input className="site-input" type="number" min={140} max={400} value={weightLbs} onChange={(e) => setWeightLbs(Number(e.target.value))} /></label>
      </div>
      <button type="button" className="site-btn site-btn-primary" disabled={busy || !firstName.trim() || !lastName.trim()}
        onClick={async () => {
          setBusy(true); setError(null);
          try {
            await siteApi.immortalitySaveIdentity({
              guildId, side,
              identity: {
                firstName: firstName.trim(), lastName: lastName.trim(), age, hometown, hometownState,
                college: age === 18 ? null : college, jerseyNumber, heightInches, weightLbs,
              },
            });
            await onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save identity.");
          } finally { setBusy(false); }
        }}>Save identity</button>
    </section>
  );
}

function IqPanel({ guildId, side, setError }: { guildId: string; side: Side; setError: (value: string | null) => void }) {
  const [state, setState] = useState<ImmortalityIqState | null>(null);
  const [busy, setBusy] = useState(false);
  const remainingMs = useCountdown(state?.questionExpiresAt ?? null, Boolean(state && !state.completed));

  async function start() {
    setBusy(true); setError(null);
    try { setState(await siteApi.immortalityStartIq({ guildId, side })); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not start the IQ test."); }
    finally { setBusy(false); }
  }

  async function answer(index: number | null) {
    if (!state || state.completed || !state.question) return;
    setBusy(true); setError(null);
    try {
      setState(await siteApi.immortalityAnswerIq({
        guildId, side, questionNumber: state.currentQuestion, selectedPresentedIndex: index,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit that answer.");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!state || state.completed || remainingMs > 0) return;
    void answer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, state?.completed, state?.currentQuestion]);

  return (
    <section className="rise-card">
      <h2>IQ test</h2>
      <p className="site-muted">12 questions. No back navigation. Timed per question. Answers never include the key.</p>
      {!state ? (
        <button type="button" className="site-btn site-btn-primary" disabled={busy} onClick={() => void start()}>Start IQ test</button>
      ) : state.completed ? (
        <p>IQ {state.iqScore}. Awareness {state.awareness}. Play recognition {state.playRecognition}.</p>
      ) : (
        <>
          <p>Question {state.currentQuestion} of 12 · {Math.max(0, Math.ceil(remainingMs / 1000))}s left</p>
          <p>{state.question?.question}</p>
          <div className="rise-options">
            {(state.question?.options ?? []).map((option, index) => (
              <button key={option} type="button" className="site-btn site-btn-ghost" disabled={busy} onClick={() => void answer(index)}>{option}</button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function InterviewPanel({
  title, questions, onSubmit, setError,
}: {
  title: string;
  questions: ImmortalityInterviewQuestion[];
  onSubmit: (answers: Array<{ questionNumber: number; optionIndex: number }>) => Promise<string>;
  setError: (value: string | null) => void;
}) {
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = questions.length > 0 && questions.every((question) => picks[question.number] != null);

  return (
    <section className="rise-card">
      <h2>{title}</h2>
      {questions.map((question) => (
        <div key={question.number} className="rise-question">
          <p>{question.number}. {question.question}</p>
          <div className="rise-options">
            {question.options.map((option, index) => (
              <button key={option.text} type="button"
                className={`site-btn ${picks[question.number] === index ? "site-btn-primary" : "site-btn-ghost"}`}
                onClick={() => setPicks((prev) => ({ ...prev, [question.number]: index }))}>{option.text}</button>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="site-btn site-btn-primary" disabled={!ready || busy}
        onClick={async () => {
          setBusy(true); setError(null);
          try {
            const answers = questions.map((question) => ({ questionNumber: question.number, optionIndex: picks[question.number]! }));
            setResult(await onSubmit(answers));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save the interview.");
          } finally { setBusy(false); }
        }}>Save interview</button>
      {result ? <p>{result}</p> : null}
    </section>
  );
}

function CharacteristicsPanel({
  guildId, side, catalog, onSaved, setError,
}: {
  guildId: string; side: Side; catalog: ImmortalityHubResponse["catalogs"]["characteristics"]["offense"];
  onSaved: () => Promise<void>; setError: (value: string | null) => void;
}) {
  const [keys, setKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const slotCost = useMemo(
    () => catalog.filter((item) => keys.includes(item.key)).reduce((sum, item) => sum + item.slotCost, 0),
    [catalog, keys],
  );

  return (
    <section className="rise-card">
      <h2>Natural characteristics</h2>
      <p className="site-muted">Pick before Creation Points. 6 slots max. Known Commodity then Negotiator for the 30% discount cap.</p>
      <p>Used {slotCost} / 6</p>
      <div className="rise-trait-list">
        {catalog.map((item) => {
          const selected = keys.includes(item.key);
          return (
            <label key={item.key} className={`wizard-option-card ${selected ? "wizard-option-card-active" : ""}`}>
              <input type="checkbox" checked={selected} onChange={() => {
                setKeys((prev) => selected ? prev.filter((key) => key !== item.key) : [...prev, item.key]);
              }} />
              <strong>{item.displayName}</strong> <span className="site-muted">({item.slotCost} slot{item.slotCost === 1 ? "" : "s"})</span>
              <span className="site-muted">{item.effect}</span>
            </label>
          );
        })}
      </div>
      <button type="button" className="site-btn site-btn-primary" disabled={busy}
        onClick={async () => {
          setBusy(true); setError(null);
          try { await siteApi.immortalitySelectCharacteristics({ guildId, side, keys }); await onSaved(); }
          catch (err) { setError(err instanceof Error ? err.message : "Could not save traits."); }
          finally { setBusy(false); }
        }}>Save traits</button>
    </section>
  );
}

function CreationPanel({
  guildId, side, budget, setError,
}: {
  guildId: string; side: Side; budget: number; setError: (value: string | null) => void;
}) {
  const [spent, setSpent] = useState<Record<string, number>>({});
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const used = Object.values(spent).reduce((sum, value) => sum + value, 0);

  return (
    <section className="rise-card">
      <h2>Creation Points</h2>
      <p className="site-muted">Test budget is {budget} points. Values are rating increases on top of the generated 68–72 baseline, not absolute ratings.</p>
      <p>Used {used} / {budget}</p>
      <div className="rise-grid">
        {MADDEN_ATTRIBUTE_DEFINITIONS.slice(0, 24).map((def) => (
          <label key={def.code} className="site-field">
            <span>{def.code} — {def.name}</span>
            <input className="site-input" type="number" min={0} max={20} value={spent[def.code] ?? 0}
              onChange={(e) => setSpent((prev) => ({ ...prev, [def.code]: Number(e.target.value) }))} />
          </label>
        ))}
      </div>
      <button type="button" className="site-btn site-btn-primary" disabled={busy}
        onClick={async () => {
          setBusy(true); setError(null);
          try {
            const cleaned = Object.fromEntries(Object.entries(spent).filter(([, value]) => value > 0));
            const next = await siteApi.immortalityEvaluateCreation({ guildId, side, spent: cleaned });
            setResult(`Estimated OVR ${next.estimatedOvr ?? next.estimated_ovr ?? "—"}. Spent ${next.spentPoints ?? next.creationPointsSpent ?? next.creation_points_spent ?? used} CP.`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not evaluate that build.");
          } finally { setBusy(false); }
        }}>Evaluate build</button>
      {result ? <p>{result}</p> : null}
    </section>
  );
}

function useCountdown(expiresAt: string | null, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !expiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active, expiresAt]);
  if (!expiresAt) return 0;
  return Date.parse(expiresAt) - now;
}
