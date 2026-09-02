import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { HEIGHT_OVERAGE_CP_COST_PER_INCH, IMMORTALITY_POSITION_MAX_HEIGHT_INCHES, IQ_QUESTION_COUNT, MADDEN_ATTRIBUTE_DEFINITIONS } from "@rec/shared";
import { useHub } from "../lib/hub-context.js";
import {
  siteApi,
  type ImmortalityBranchingPlaystyleGroup,
  type ImmortalityHubResponse,
  type ImmortalityIqState,
  type ImmortalityInterviewQuestion,
} from "../lib/site-api.js";

type Side = "offense" | "defense";
type Stage = "identity" | "iq" | "persona" | "playstyle" | "persona_dna" | "player_traits" | "characteristics" | "creation" | "owner" | "franchise";

const STAGES: { id: Stage; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "iq", label: "IQ Test" },
  { id: "persona", label: "Persona" },
  { id: "playstyle", label: "Playstyle" },
  { id: "persona_dna", label: "Persona DNA" },
  { id: "player_traits", label: "Player Traits" },
  { id: "characteristics", label: "Traits" },
  { id: "creation", label: "Creation Points" },
  { id: "owner", label: "Owner" },
  { id: "franchise", label: "Franchise" },
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

  useEffect(() => {
    if (!guildId || !isRise || hub?.league.riseHubUnlocked) return;
    const id = window.setInterval(() => { void reload(); }, 20000);
    return () => window.clearInterval(id);
  }, [guildId, isRise, hub?.league.riseHubUnlocked, reload]);

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
          Store purchases are off — Player XP upgrades ratings. Coins pay 2 highlights/week at 150, GOTW, and interviews.
          {hub?.league.riseHubUnlocked
            ? " Franchises are assigned — the usual league hub is unlocked."
            : ` You are in the registration pool${hub?.pool ? ` (${hub.pool.registeredCount} registered)` : ""}. Once your players and owner are finished, your owner picks a franchise and your players join that team directly — there's no draft in Rise to Immortality.`}
        </p>
      </header>

      {error ? <p className="site-auth-error">{error}</p> : null}

      {isCommissioner && hub ? (
        <section className="rise-card">
          <h2>Commissioner</h2>
          <p className="site-muted">
            There's no draft in Rise to Immortality — each member's owner is offered 4 random franchises to choose
            from once their players and owner are finished, and their players join that team directly.
          </p>
          <div className="rise-actions">
            {nextStates.map((state) => (
              <button key={state} type="button" className="site-btn site-btn-primary" disabled={busy}
                onClick={async () => {
                  setBusy(true); setError(null);
                  try { await siteApi.immortalityTransitionState({ guildId, toState: state }); await reload(); await hubCtx.refreshLeagues(); }
                  catch (err) { setError(err instanceof Error ? err.message : "Could not advance."); }
                  finally { setBusy(false); }
                }}>Open {state.replaceAll("_", " ")}</button>
            ))}
          </div>
          <IntroVideoSetting guildId={guildId} currentUrl={hub.introVideo?.url ?? null} onSaved={reload} setError={setError} />
        </section>
      ) : null}

      {hub && hub.introVideo?.url && !hub.introVideo.watched ? (
        <IntroVideoGate guildId={guildId} url={hub.introVideo.url} onWatched={reload} />
      ) : (
        <>
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
            <IdentityForm key={side} guildId={guildId} side={side} position={position ?? ""} prospect={prospectFor(hub, side)}
              onSaved={reload} setError={setError} setBusy={setBusy} busy={busy} />
          ) : null}
          {stage === "iq" ? (
            <IqPanel key={side} guildId={guildId} side={side} setError={setError} onSaved={reload} />
          ) : null}
          {stage === "persona" ? (
            <InterviewPanel key={`${side}-persona`} title="Persona interview" questions={hub.catalogs.persona[side]}
              onSubmit={async (answers) => {
                const result = await siteApi.immortalitySubmitPersona({ guildId, side, answers });
                await reload();
                return `${result.label} (${result.primary} / ${result.secondary})`;
              }} setError={setError} />
          ) : null}
          {stage === "playstyle" ? (
            hub.catalogs.playstyleBranching[side] ? (
              <BranchingPlaystylePanel key={`${side}-playstyle-branching`} guildId={guildId} side={side}
                group={hub.catalogs.playstyleBranching[side]!} onSaved={reload} setError={setError} />
            ) : (
              <InterviewPanel key={`${side}-playstyle`} title="Playstyle interview" questions={hub.catalogs.playstyle[side]}
                onSubmit={async (answers) => {
                  const result = await siteApi.immortalitySubmitPlaystyle({ guildId, side, answers });
                  await reload();
                  return `${result.primaryArchetype} / ${result.secondaryArchetype} (${result.blend.kind})`;
                }} setError={setError} />
            )
          ) : null}
          {stage === "persona_dna" ? (
            <InterviewPanel key={`${side}-persona-dna`} title="Persona DNA" questions={hub.catalogs.personaDna.questions}
              onSubmit={async (answers) => {
                const result = await siteApi.immortalitySubmitPersonaDna({ guildId, side, answers });
                await reload();
                return `Equipped: ${result.equippedTraitKeys.join(", ") || "none"}`;
              }} setError={setError} />
          ) : null}
          {stage === "player_traits" ? (
            hub.catalogs.playerTraits[side] ? (
              <InterviewPanel key={`${side}-player-traits`} title="Player Traits" questions={hub.catalogs.playerTraits[side]!.questions}
                onSubmit={async (answers) => {
                  const result = await siteApi.immortalitySubmitPlayerTraits({ guildId, side, answers });
                  await reload();
                  return `Equipped: ${result.equippedTraitKeys.join(", ") || "none"}`;
                }} setError={setError} />
            ) : (
              <section className="rise-card">
                <h2>Player Traits</h2>
                <p className="site-muted">Player Traits are only catalogued for QB and MIKE right now — not available for {position || "this position"}.</p>
              </section>
            )
          ) : null}
          {stage === "characteristics" ? (
            <CharacteristicsPanel key={side} guildId={guildId} side={side} catalog={hub.catalogs.characteristics[side]}
              onSaved={reload} setError={setError} />
          ) : null}
          {stage === "creation" ? (
            <CreationPanel key={side} guildId={guildId} side={side} budget={hub.league.creationPointBudget}
              setError={setError} onSaved={reload} />
          ) : null}
          {stage === "owner" ? (
            <OwnerPanel guildId={guildId} owner={hub.owner ?? null} personaQuestions={hub.catalogs.persona.owner}
              onSaved={reload} setError={setError} />
          ) : null}
          {stage === "franchise" ? (
            <FranchisePanel guildId={guildId} teamOffer={hub.teamOffer ?? null} onSaved={reload} setError={setError} />
          ) : null}
        </>
      )}
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
  const [hometown, setHometown] = useState(String(prospect?.hometown ?? ""));
  const [hometownState, setHometownState] = useState(String(prospect?.hometown_state ?? ""));
  const [college, setCollege] = useState(String(prospect?.college ?? ""));
  const [jerseyNumber, setJerseyNumber] = useState(Number(prospect?.jersey_number ?? 1));
  const [heightInches, setHeightInches] = useState(Number(prospect?.height_inches ?? 74));
  const [weightLbs, setWeightLbs] = useState(Number(prospect?.weight_lbs ?? 220));

  useEffect(() => {
    setFirstName(String(prospect?.first_name ?? ""));
    setLastName(String(prospect?.last_name ?? ""));
    setHometown(String(prospect?.hometown ?? ""));
    setHometownState(String(prospect?.hometown_state ?? ""));
    setCollege(String(prospect?.college ?? ""));
    setJerseyNumber(Number(prospect?.jersey_number ?? 1));
    setHeightInches(Number(prospect?.height_inches ?? 74));
    setWeightLbs(Number(prospect?.weight_lbs ?? 220));
  }, [prospect]);

  const maxHeight = IMMORTALITY_POSITION_MAX_HEIGHT_INCHES[position as keyof typeof IMMORTALITY_POSITION_MAX_HEIGHT_INCHES] ?? 76;
  const heightCost = Math.max(0, heightInches - maxHeight) * HEIGHT_OVERAGE_CP_COST_PER_INCH;

  return (
    <section className="rise-card">
      <h2>Identity — {position || side}</h2>
      <p className="site-muted">Age is fixed at 21 for every prospect. This is your created-player class, not Player Lock.</p>
      <div className="rise-grid">
        <label className="site-field"><span>First name</span><input className="site-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
        <label className="site-field"><span>Last name</span><input className="site-input" value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
        <label className="site-field"><span>Jersey</span><input className="site-input" type="number" min={0} max={99} value={jerseyNumber} onChange={(e) => setJerseyNumber(Number(e.target.value))} /></label>
        <label className="site-field"><span>Hometown</span><input className="site-input" value={hometown} onChange={(e) => setHometown(e.target.value)} /></label>
        <label className="site-field"><span>State</span><input className="site-input" value={hometownState} onChange={(e) => setHometownState(e.target.value)} /></label>
        <label className="site-field"><span>College</span><input className="site-input" value={college} onChange={(e) => setCollege(e.target.value)} /></label>
        <label className="site-field"><span>Height (inches) — {position || side} max is {maxHeight}" before it costs Creation Points</span>
          <input className="site-input" type="number" min={60} max={90} value={heightInches} onChange={(e) => setHeightInches(Number(e.target.value))} /></label>
        <label className="site-field"><span>Weight (lbs)</span><input className="site-input" type="number" min={140} max={400} value={weightLbs} onChange={(e) => setWeightLbs(Number(e.target.value))} /></label>
      </div>
      {heightCost > 0 ? (
        <p className="site-muted">{heightInches - maxHeight}" over the {position || side} max will cost <strong>{heightCost} Creation Points</strong> out of your budget.</p>
      ) : null}
      <button type="button" className="site-btn site-btn-primary" disabled={busy || !firstName.trim() || !lastName.trim()}
        onClick={async () => {
          setBusy(true); setError(null);
          try {
            await siteApi.immortalitySaveIdentity({
              guildId, side,
              identity: {
                firstName: firstName.trim(), lastName: lastName.trim(), hometown, hometownState,
                college: college.trim() || null, jerseyNumber, heightInches, weightLbs,
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

function IqPanel({
  guildId, side, setError, onSaved,
}: {
  guildId: string; side: Side; setError: (value: string | null) => void; onSaved: () => Promise<void>;
}) {
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

  useEffect(() => {
    if (!state?.completed) return;
    void onSaved();
  }, [state?.completed, onSaved]);

  return (
    <section className="rise-card">
      <h2>IQ test</h2>
      <p className="site-muted">{IQ_QUESTION_COUNT} questions. No back navigation. Timed per question. Answers never include the key.</p>
      {!state ? (
        <button type="button" className="site-btn site-btn-primary" disabled={busy} onClick={() => void start()}>Start IQ test</button>
      ) : state.completed ? (
        <p>IQ {state.iqScore}. Awareness {state.awareness}. Play recognition {state.playRecognition}.</p>
      ) : (
        <>
          <p>Question {state.currentQuestion} of {IQ_QUESTION_COUNT} · {Math.max(0, Math.ceil(remainingMs / 1000))}s left</p>
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

/** QB/MIKE only. Q1 locks the primary archetype, Q2 optionally locks a secondary (blend),
 * then Q3-5 (drawn from that primary archetype's own bank) each nudge specific attributes'
 * floor/ceiling on top of the fixed baseline -- so Q3-5 can't render until Q1 is answered. */
function BranchingPlaystylePanel({
  guildId, side, group, onSaved, setError,
}: {
  guildId: string;
  side: Side;
  group: ImmortalityBranchingPlaystyleGroup;
  onSaved: () => Promise<void>;
  setError: (value: string | null) => void;
}) {
  const [q1, setQ1] = useState<number | null>(null);
  const [q2, setQ2] = useState<number | null>(null);
  const [skipQ2, setSkipQ2] = useState(false);
  const [q3, setQ3] = useState<number | null>(null);
  const [q4, setQ4] = useState<number | null>(null);
  const [q5, setQ5] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const primaryArchetype = q1 != null ? group.q1.options[q1]?.archetype : null;
  const remainingArchetypes = group.archetypes.filter((a) => a !== primaryArchetype);
  const bank = primaryArchetype ? group.banks[primaryArchetype] : null;
  const ready = q1 != null && (skipQ2 || q2 != null) && bank && q3 != null && q4 != null && q5 != null;

  return (
    <section className="rise-card">
      <h2>Playstyle</h2>
      <div className="rise-question">
        <p>1. {group.q1.question}</p>
        <div className="rise-options">
          {group.q1.options.map((option, index) => (
            <button key={option.text} type="button" className={`site-btn ${q1 === index ? "site-btn-primary" : "site-btn-ghost"}`}
              onClick={() => { setQ1(index); setQ2(null); setSkipQ2(false); setQ3(null); setQ4(null); setQ5(null); }}>{option.text}</button>
          ))}
        </div>
      </div>
      {q1 != null ? (
        <div className="rise-question">
          <p>2. {group.q2Question}</p>
          <div className="rise-options">
            {remainingArchetypes.map((archetype, index) => (
              <button key={archetype} type="button" className={`site-btn ${!skipQ2 && q2 === index ? "site-btn-primary" : "site-btn-ghost"}`}
                onClick={() => { setQ2(index); setSkipQ2(false); }}>{archetype}</button>
            ))}
            <button type="button" className={`site-btn ${skipQ2 ? "site-btn-primary" : "site-btn-ghost"}`}
              onClick={() => { setSkipQ2(true); setQ2(null); }}>Pure {primaryArchetype} — no secondary</button>
          </div>
        </div>
      ) : null}
      {bank ? (
        <>
          {([["3", bank.q3, q3, setQ3], ["4", bank.q4, q4, setQ4], ["5", bank.q5, q5, setQ5]] as const).map(([label, drill, picked, setPicked]) => (
            <div key={label} className="rise-question">
              <p>{label}. {drill.question}</p>
              <div className="rise-options">
                {drill.options.map((option, index) => (
                  <button key={option.text} type="button" className={`site-btn ${picked === index ? "site-btn-primary" : "site-btn-ghost"}`}
                    onClick={() => setPicked(index)}>{option.text}</button>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}
      <button type="button" className="site-btn site-btn-primary" disabled={!ready || busy}
        onClick={async () => {
          setBusy(true); setError(null);
          try {
            const result = await siteApi.immortalitySubmitBranchingPlaystyle({
              guildId, side,
              answers: { q1ArchetypeIndex: q1!, q2ArchetypeIndex: skipQ2 ? null : q2, q3OptionIndex: q3!, q4OptionIndex: q4!, q5OptionIndex: q5! },
            });
            await onSaved();
            setResult(`${result.primaryArchetype}${result.secondaryArchetype ? ` / ${result.secondaryArchetype}` : ""} (${result.blend.kind})`);
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
  guildId, side, budget, setError, onSaved,
}: {
  guildId: string; side: Side; budget: number; setError: (value: string | null) => void; onSaved: () => Promise<void>;
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
            setResult(`Build saved. Spent ${next.spentPoints ?? next.creationPointsSpent ?? next.creation_points_spent ?? used} CP. Your real OVR will come from the league's first game-data import.`);
            await onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not evaluate that build.");
          } finally { setBusy(false); }
        }}>Evaluate build</button>
      {result ? <p>{result}</p> : null}
    </section>
  );
}

function IntroVideoSetting({
  guildId, currentUrl, onSaved, setError,
}: {
  guildId: string;
  currentUrl: string | null;
  onSaved: () => Promise<void>;
  setError: (value: string | null) => void;
}) {
  const [url, setUrl] = useState(currentUrl ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setUrl(currentUrl ?? ""); }, [currentUrl]);

  return (
    <div className="rise-field-row" style={{ marginTop: 12 }}>
      <label className="site-field"><span>Intro video URL (members must watch before Origins unlocks; blank disables the gate)</span>
        <input className="site-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label>
      <button type="button" className="site-btn site-btn-secondary" disabled={busy}
        onClick={async () => {
          setBusy(true); setError(null);
          try { await siteApi.immortalitySetIntroVideo({ guildId, url: url.trim() || null }); await onSaved(); }
          catch (err) { setError(err instanceof Error ? err.message : "Could not save the intro video."); }
          finally { setBusy(false); }
        }}>Save intro video</button>
    </div>
  );
}

/** Blocks Origins until the member watches the commissioner's intro video to the end. Native
 * controls are hidden and seeking past the furthest point actually reached is reverted, so
 * scrubbing ahead can't skip the requirement -- pausing and rewinding are still fine. */
function IntroVideoGate({ guildId, url, onWatched }: { guildId: string; url: string; onWatched: () => Promise<void> }) {
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxReached = useRef(0);

  return (
    <section className="rise-card">
      <h2>Welcome to Rise to Immortality</h2>
      <p className="site-muted">Watch this before you begin — you can't create your players until it finishes.</p>
      {error ? <p className="site-auth-error">{error}</p> : null}
      <div style={{ position: "relative", maxWidth: 720 }}>
        <video src={url} controls={false} playsInline style={{ width: "100%", borderRadius: 10, background: "#000" }}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            if (t > maxReached.current) maxReached.current = t;
          }}
          onSeeking={(e) => {
            if (e.currentTarget.currentTime > maxReached.current + 0.5) e.currentTarget.currentTime = maxReached.current;
          }}
          onEnded={async () => {
            setBusy(true); setError(null);
            try { await siteApi.immortalityMarkIntroVideoWatched(guildId); await onWatched(); }
            catch (err) { setError(err instanceof Error ? err.message : "Could not record the video as watched."); }
            finally { setBusy(false); }
          }}
          ref={(node) => {
            if (node && started) void node.play().catch(() => {});
          }} />
        {!started ? (
          <button type="button" className="site-btn site-btn-primary"
            style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
            onClick={() => setStarted(true)}>▶ Play intro video</button>
        ) : null}
      </div>
      {busy ? <p className="site-muted">Saving…</p> : null}
    </section>
  );
}

function OwnerPanel({
  guildId, owner, personaQuestions, onSaved, setError,
}: {
  guildId: string;
  owner: ImmortalityHubResponse["owner"];
  personaQuestions: ImmortalityInterviewQuestion[];
  onSaved: () => Promise<void>;
  setError: (value: string | null) => void;
}) {
  const [firstName, setFirstName] = useState(owner?.firstName ?? "");
  const [lastName, setLastName] = useState(owner?.lastName ?? "");
  const [headshotUrl, setHeadshotUrl] = useState(owner?.headshotUrl ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFirstName(owner?.firstName ?? "");
    setLastName(owner?.lastName ?? "");
    setHeadshotUrl(owner?.headshotUrl ?? "");
  }, [owner]);

  return (
    <section className="rise-card">
      <h2>Franchise Owner</h2>
      <p className="site-muted">
        Created after your players. This owner purchases one of your four offered franchises and
        brings your two Origins players aboard.
      </p>
      <div className="rise-grid">
        <img src={headshotUrl.trim() || "/assets/player-cards/player-silhouette.svg"} alt=""
          style={{ width: 96, height: 96, objectFit: "cover", borderRadius: "50%", background: "#222" }} />
        <label className="site-field"><span>First name</span><input className="site-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
        <label className="site-field"><span>Last name</span><input className="site-input" value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
        <label className="site-field"><span>Headshot URL (optional)</span>
          <input className="site-input" value={headshotUrl} onChange={(e) => setHeadshotUrl(e.target.value)} placeholder="Leave blank for a generic silhouette" /></label>
      </div>
      <button type="button" className="site-btn site-btn-primary" disabled={busy || !firstName.trim() || !lastName.trim()}
        onClick={async () => {
          setBusy(true); setError(null);
          try {
            await siteApi.immortalitySaveOwnerIdentity({
              guildId, identity: { firstName: firstName.trim(), lastName: lastName.trim(), headshotUrl: headshotUrl.trim() || null },
            });
            await onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save your owner.");
          } finally { setBusy(false); }
        }}>Save owner</button>

      {owner ? (
        owner.originsStep === "complete" ? (
          <p>Personality: <strong>{owner.personaLabel}</strong> ({owner.personaPrimary} / {owner.personaSecondary})</p>
        ) : (
          <InterviewPanel title="Owner personality interview" questions={personaQuestions}
            onSubmit={async (answers) => {
              const result = await siteApi.immortalitySubmitOwnerPersona({ guildId, answers });
              await onSaved();
              return `${result.label} (${result.primary} / ${result.secondary})`;
            }} setError={setError} />
        )
      ) : null}
    </section>
  );
}

function FranchisePanel({
  guildId, teamOffer, onSaved, setError,
}: {
  guildId: string;
  teamOffer: ImmortalityHubResponse["teamOffer"];
  onSaved: () => Promise<void>;
  setError: (value: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  async function requestOffers() {
    setLoading(true); setError(null);
    try { await siteApi.immortalityGetTeamOffers(guildId); await onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not generate franchise offers."); }
    finally { setLoading(false); }
  }

  if (!teamOffer) {
    return (
      <section className="rise-card">
        <h2>Choose Your Franchise</h2>
        <p className="site-muted">
          Once both players and your owner are finished, your owner is offered 4 random
          still-available franchises to purchase.
        </p>
        <button type="button" className="site-btn site-btn-primary" disabled={loading} onClick={() => void requestOffers()}>
          {loading ? "Checking…" : "See my franchise offers"}
        </button>
      </section>
    );
  }

  if (teamOffer.chosenTeamId) {
    const chosen = teamOffer.offered.find((team) => team.teamId === teamOffer.chosenTeamId);
    const label = chosen ? `${chosen.city ?? ""} ${chosen.name ?? chosen.abbreviation ?? ""}`.trim() : "your franchise";
    return (
      <section className="rise-card">
        <h2>Your Franchise</h2>
        <p>Your owner purchased the <strong>{label}</strong>. Your two Origins players are on the roster.</p>
      </section>
    );
  }

  return (
    <section className="rise-card">
      <h2>Choose Your Franchise</h2>
      <p className="site-muted">Your owner is deciding between these four franchises. Pick one — this is final.</p>
      <div className="wizard-team-grid">
        {teamOffer.offered.map((team) => (
          <button key={team.teamId} type="button" className="wizard-team-card" disabled={busy}
            onClick={async () => {
              setBusy(true); setError(null);
              try { await siteApi.immortalityChooseTeam({ guildId, teamId: team.teamId }); await onSaved(); }
              catch (err) { setError(err instanceof Error ? err.message : "Could not choose that franchise."); }
              finally { setBusy(false); }
            }}>
            <strong>{team.city ?? ""} {team.name ?? team.abbreviation}</strong>
            {team.abbreviation ? <span className="site-muted">{team.abbreviation}</span> : null}
          </button>
        ))}
      </div>
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
