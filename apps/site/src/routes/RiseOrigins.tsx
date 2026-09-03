import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { CFB_27_TEAMS, cardBuildsForPosition, citiesForState, HEIGHT_OVERAGE_CP_COST_PER_INCH, IMMORTALITY_OWNER_HEADSHOTS, IMMORTALITY_POSITION_MAX_HEIGHT_INCHES, IQ_QUESTION_COUNT, MADDEN_ATTRIBUTE_DEFINITIONS, MAX_EQUIPPED_CHARACTERISTICS, REC_FIRST_NAMES, REC_LAST_NAMES, spendCreationPoints, THROWING_MOTIONS, US_STATES, immortalityPlayerHeadshots, type ImmortalityHeadshot } from "@rec/shared";
import { useHub } from "../lib/hub-context.js";
import { RiseContractSigning } from "../components/RiseContractSigning.js";
import { HEADSHOT_ALLOWED_TYPES, readImageAsResizedBase64 } from "../lib/image-resize.js";
import {
  siteApi,
  type ImmortalityBranchingPlaystyleGroup,
  type ImmortalityHubResponse,
  type ImmortalityIqState,
  type ImmortalityInterviewQuestion,
} from "../lib/site-api.js";

function randomFrom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

// Alphabetical CFB 27 school catalog for the College autocomplete -- excludes the schedule-only
// "FCS TEAM" placeholder, which isn't a real school.
const CFB_COLLEGE_OPTIONS = CFB_27_TEAMS.filter((t) => !t.isSchedulePlaceholder).map((t) => t.name).sort();

/** Small 🎲 button that fills a name field with a random pick from the same corpus custom
 * players already use (packages/shared/src/player-builder/name-corpus.ts). Purely client-side. */
function DiceButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="site-btn site-btn-ghost rise-dice-btn" title={label} aria-label={label} onClick={onClick}>🎲</button>
  );
}

type Side = "offense" | "defense";
type Stage = "identity" | "throwing_motion" | "iq" | "persona" | "playstyle" | "persona_dna" | "player_traits" | "characteristics" | "creation";
type TransitionPhase = "idle" | "out" | "in";

// Owner and Franchise aren't per-side stages -- there's one owner and one franchise pick for
// both prospects together, not one each. They live in the PresentationSequence below instead,
// which takes over the whole page once both sides have finished Creation Points.
const STAGES: { id: Stage; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "throwing_motion", label: "Throwing Motion" },
  { id: "iq", label: "IQ Test" },
  { id: "persona", label: "Persona" },
  { id: "playstyle", label: "Playstyle" },
  { id: "persona_dna", label: "Persona DNA" },
  { id: "player_traits", label: "Player Traits" },
  { id: "characteristics", label: "Traits" },
  { id: "creation", label: "Creation Points" },
];

function prospectFor(hub: ImmortalityHubResponse | null, side: Side) {
  return hub?.prospects.find((row) => String(row.side ?? "") === side) ?? null;
}

export function RiseOriginsPage() {
  const { leagueId = "" } = useParams();
  const hubCtx = useHub();
  const selected = hubCtx.leagues.find((league) => league.id === leagueId) ?? (hubCtx.selectedLeague?.id === leagueId ? hubCtx.selectedLeague : null);
  const isRise = selected?.rosterType === "rise_to_immortality";
  const guildId = selected?.guildId ?? "";

  const [hub, setHub] = useState<ImmortalityHubResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<Side | null>(null);
  const [stage, setStage] = useState<Stage>("identity");
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>("idle");
  // Bumped whenever marking the video watched fails, forcing IntroVideoGate to remount --
  // otherwise a failed save leaves the gate showing an already-ended video with no way to
  // replay it (the gate stays up since hub.introVideo.watched never actually flipped).
  const [videoResetKey, setVideoResetKey] = useState(0);

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

  // Fades the whole page to black, marks the intro video watched (which flips the gate off
  // server-side and reloads the hub), then fades back in on the split prospect-side chooser.
  const finishIntroVideo = useCallback(() => {
    setTransitionPhase("out");
    window.setTimeout(() => {
      void (async () => {
        try {
          await siteApi.immortalityMarkIntroVideoWatched(guildId);
          await reload();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not record the video as watched. Please try again.");
          // hub.introVideo.watched is still false, so the gate stays up -- force a fresh
          // instance so its "play" state resets instead of showing an already-ended video.
          setVideoResetKey((key) => key + 1);
        }
        setTransitionPhase("in");
        window.setTimeout(() => setTransitionPhase("idle"), 400);
      })();
    }, 400);
  }, [guildId, reload]);

  if (selected && !isRise) {
    return <Navigate replace to={`/l/${leagueId}/buzz`} />;
  }

  if (!selected || !guildId) {
    return <div className="site-page site-loading">Loading Rise to Immortality…</div>;
  }

  const introVideoUrl = hub?.introVideo?.url ?? null;
  const showVideoGate = Boolean(introVideoUrl && !hub?.introVideo?.watched);
  // The split-card chooser is meant to be a one-time "which one first" moment right after the
  // video, not a splash a returning member has to click past every visit -- once either
  // prospect exists, skip straight back into the stage nav for that side.
  const effectiveSide: Side | null = side ?? (hub
    ? (prospectFor(hub, "offense") ? "offense" : prospectFor(hub, "defense") ? "defense" : null)
    : null);
  const position = effectiveSide === "offense" ? hub?.league.offensePosition : hub?.league.defensePosition;
  // Mirrors the same offense+defense-both-built check the server uses for franchiseOptions
  // eligibility -- once true, the per-side Identity/IQ/etc. tabs are done and the page hands off
  // to the owner -> team reveal -> contracts sequence instead.
  const offenseProspect = prospectFor(hub, "offense");
  const defenseProspect = prospectFor(hub, "defense");
  const builtProspectIds = new Set((hub?.builds ?? []).map((row) => String((row as Record<string, unknown>).prospect_id)));
  const bothBuilt = Boolean(offenseProspect && defenseProspect
    && builtProspectIds.has(String((offenseProspect as Record<string, unknown>).id))
    && builtProspectIds.has(String((defenseProspect as Record<string, unknown>).id)));

  return (
    <div className="site-page rise-page">
      <div className={`rise-fade-overlay ${transitionPhase === "out" ? "is-out" : ""}`} aria-hidden="true" />
      {error ? <p className="site-auth-error">{error}</p> : null}

      {showVideoGate ? (
        <div className="rise-origins-cinema">
          <h1 className="rise-origins-title">Rise to Immortality: Origins</h1>
          <IntroVideoGate key={videoResetKey} url={introVideoUrl!} onFinished={finishIntroVideo} />
        </div>
      ) : !hub ? (
        <p className="site-muted">Loading your class…</p>
      ) : bothBuilt ? (
        <PresentationSequence guildId={guildId} hub={hub} onSaved={reload} setError={setError} />
      ) : effectiveSide === null ? (
        <div className="rise-origins-cinema">
          <SideChooser
            offensePosition={hub.league.offensePosition ?? "Offense"}
            defensePosition={hub.league.defensePosition ?? "Defense"}
            onChoose={(value) => { setSide(value); setStage("identity"); }}
          />
        </div>
      ) : (
        <>
          <header className="rise-hero">
            <p className="site-muted">Rise to Immortality</p>
            <h1>{hub.league.chapter.replaceAll("_", " ")}</h1>
            <p className="site-muted">
              League positions: {hub.league.offensePosition ?? "—"} / {hub.league.defensePosition ?? "—"}.
              Store purchases are off — Player XP upgrades ratings. Coins pay 2 highlights/week at {hub.league.highlightPayout ?? 100}, GOTW, and interviews.
            </p>
          </header>

          <div className="rise-side-tabs">
            {(["offense", "defense"] as const).map((value) => (
              <button key={value} type="button"
                className={`wizard-game-card ${effectiveSide === value ? "wizard-game-card-active" : ""}`}
                onClick={() => { setSide(value); setStage("identity"); }}>
                {value === "offense" ? `Offense (${hub.league.offensePosition ?? "—"})` : `Defense (${hub.league.defensePosition ?? "—"})`}
              </button>
            ))}
          </div>

          <nav className="rise-stage-nav" aria-label="Origins steps">
            {STAGES.map((item) => (
              <button key={item.id} type="button" className={stage === item.id ? "is-active" : ""}
                onClick={() => setStage(item.id)}>{item.label}</button>
            ))}
          </nav>

          {stage === "identity" ? (
            <IdentityForm key={effectiveSide} guildId={guildId} side={effectiveSide} position={position ?? ""} prospect={prospectFor(hub, effectiveSide)}
              onSaved={reload} setError={setError} setBusy={setBusy} busy={busy} />
          ) : null}
          {stage === "throwing_motion" ? (
            position === "QB" ? (
              <ThrowingMotionPanel key={effectiveSide} guildId={guildId} side={effectiveSide}
                currentKey={(prospectFor(hub, effectiveSide)?.throwing_motion_key as string | null | undefined) ?? null}
                onSaved={reload} setError={setError} />
            ) : (
              <section className="rise-card">
                <h2>Throwing Motion</h2>
                <p className="site-muted">Throwing motion only applies to QB — not available for {position || "this position"}.</p>
              </section>
            )
          ) : null}
          {stage === "iq" ? (
            <IqPanel key={effectiveSide} guildId={guildId} side={effectiveSide} setError={setError} onSaved={reload} />
          ) : null}
          {stage === "persona" ? (
            <InterviewPanel key={`${effectiveSide}-persona`} title="Persona interview" questions={hub.catalogs.persona[effectiveSide]}
              onSubmit={async (answers) => {
                const result = await siteApi.immortalitySubmitPersona({ guildId, side: effectiveSide, answers });
                await reload();
                return `${result.label} (${result.primary} / ${result.secondary})`;
              }} setError={setError} />
          ) : null}
          {stage === "playstyle" ? (
            hub.catalogs.playstyleBranching[effectiveSide] ? (
              <BranchingPlaystylePanel key={`${effectiveSide}-playstyle-branching`} guildId={guildId} side={effectiveSide}
                group={hub.catalogs.playstyleBranching[effectiveSide]!} onSaved={reload} setError={setError} />
            ) : (
              <InterviewPanel key={`${effectiveSide}-playstyle`} title="Playstyle interview" questions={hub.catalogs.playstyle[effectiveSide]}
                onSubmit={async (answers) => {
                  const result = await siteApi.immortalitySubmitPlaystyle({ guildId, side: effectiveSide, answers });
                  await reload();
                  return `${result.primaryArchetype} / ${result.secondaryArchetype} (${result.blend.kind})`;
                }} setError={setError} />
            )
          ) : null}
          {stage === "persona_dna" ? (
            <InterviewPanel key={`${effectiveSide}-persona-dna`} title="Persona DNA" questions={hub.catalogs.personaDna.questions}
              onSubmit={async (answers) => {
                const result = await siteApi.immortalitySubmitPersonaDna({ guildId, side: effectiveSide, answers });
                await reload();
                return `Equipped: ${result.equippedTraitKeys.join(", ") || "none"}`;
              }} setError={setError} />
          ) : null}
          {stage === "player_traits" ? (
            hub.catalogs.playerTraits[effectiveSide] ? (
              <InterviewPanel key={`${effectiveSide}-player-traits`} title="Player Traits" questions={hub.catalogs.playerTraits[effectiveSide]!.questions}
                onSubmit={async (answers) => {
                  const result = await siteApi.immortalitySubmitPlayerTraits({ guildId, side: effectiveSide, answers });
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
            <CharacteristicsPanel key={effectiveSide} guildId={guildId} side={effectiveSide} catalog={hub.catalogs.characteristics[effectiveSide]}
              onSaved={reload} setError={setError} />
          ) : null}
          {stage === "creation" ? (
            <CreationPanel key={effectiveSide} guildId={guildId} side={effectiveSide}
              setError={setError} onSaved={reload} />
          ) : null}
        </>
      )}

      {!showVideoGate ? <p className="site-muted"><Link to={`/l/${leagueId}/buzz`}>Back to league overview</Link></p> : null}
    </div>
  );
}

function SideChooser({
  offensePosition, defensePosition, onChoose,
}: {
  offensePosition: string;
  defensePosition: string;
  onChoose: (side: Side) => void;
}) {
  return (
    <section className="rise-split-card">
      <button type="button" className="rise-split-half" onClick={() => onChoose("offense")}>
        <span className="rise-split-eyebrow">Offense</span>
        <strong>Create Offensive Prospect</strong>
        <span className="site-muted">{offensePosition}</span>
      </button>
      <div className="rise-split-divider" aria-hidden="true" />
      <button type="button" className="rise-split-half" onClick={() => onChoose("defense")}>
        <span className="rise-split-eyebrow">Defense</span>
        <strong>Create Defensive Prospect</strong>
        <span className="site-muted">{defensePosition}</span>
      </button>
    </section>
  );
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
  const [headshotUrl, setHeadshotUrl] = useState(String(prospect?.headshot_url ?? ""));
  const allowedBodyTypes = cardBuildsForPosition(position);
  const [bodyType, setBodyType] = useState(String(prospect?.body_type ?? allowedBodyTypes[0] ?? "standard"));

  useEffect(() => {
    setFirstName(String(prospect?.first_name ?? ""));
    setLastName(String(prospect?.last_name ?? ""));
    setHometown(String(prospect?.hometown ?? ""));
    setHometownState(String(prospect?.hometown_state ?? ""));
    setCollege(String(prospect?.college ?? ""));
    setJerseyNumber(Number(prospect?.jersey_number ?? 1));
    setHeightInches(Number(prospect?.height_inches ?? 74));
    setWeightLbs(Number(prospect?.weight_lbs ?? 220));
    setHeadshotUrl(String(prospect?.headshot_url ?? ""));
    setBodyType(String(prospect?.body_type ?? cardBuildsForPosition(position)[0] ?? "standard"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospect]);

  const maxHeight = IMMORTALITY_POSITION_MAX_HEIGHT_INCHES[position as keyof typeof IMMORTALITY_POSITION_MAX_HEIGHT_INCHES] ?? 76;
  const heightCost = Math.max(0, heightInches - maxHeight) * HEIGHT_OVERAGE_CP_COST_PER_INCH;

  return (
    <section className="rise-card">
      <h2>Identity — {position || side}</h2>
      <p className="site-muted">Age is fixed at 21 for every prospect. This is your created-player class, not Player Lock.</p>
      <div className="rise-grid">
        <label className="site-field"><span>First name</span>
          <div className="rise-input-with-dice">
            <input className="site-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <DiceButton label="Randomize first name" onClick={() => setFirstName(randomFrom(REC_FIRST_NAMES))} />
          </div>
        </label>
        <label className="site-field"><span>Last name</span>
          <div className="rise-input-with-dice">
            <input className="site-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            <DiceButton label="Randomize last name" onClick={() => setLastName(randomFrom(REC_LAST_NAMES))} />
          </div>
        </label>
        <label className="site-field"><span>Jersey</span><input className="site-input" type="number" min={0} max={99} value={jerseyNumber} onChange={(e) => setJerseyNumber(Number(e.target.value))} /></label>
        <label className="site-field"><span>State</span>
          <select className="site-select" value={hometownState} onChange={(e) => setHometownState(e.target.value)}>
            <option value="">Select a state</option>
            {US_STATES.map((state) => <option key={state.code} value={state.code}>{state.name} ({state.code})</option>)}
          </select>
        </label>
        <label className="site-field"><span>Hometown</span>
          <input className="site-input" list="rise-hometown-options" value={hometown} onChange={(e) => setHometown(e.target.value)}
            placeholder={hometownState ? "Start typing a city…" : "Pick a state first for suggestions"} />
          <datalist id="rise-hometown-options">
            {citiesForState(hometownState).map((city) => <option key={city} value={city} />)}
          </datalist>
        </label>
        <label className="site-field"><span>College</span>
          <input className="site-input" list="rise-college-options" value={college} onChange={(e) => setCollege(e.target.value)} placeholder="Start typing a school…" />
          <datalist id="rise-college-options">
            {CFB_COLLEGE_OPTIONS.map((name) => <option key={name} value={name} />)}
          </datalist>
        </label>
        <div className="site-field">
          <span>Height — {position || side} max is {Math.floor(maxHeight / 12)}'{maxHeight % 12}" before it costs Creation Points</span>
          <div className="rise-height-inputs">
            <input className="site-input" type="number" min={4} max={7} value={Math.floor(heightInches / 12)}
              onChange={(e) => setHeightInches(Math.max(60, Math.min(90, Number(e.target.value) * 12 + (heightInches % 12))))} />
            <span className="site-muted">ft</span>
            <input className="site-input" type="number" min={0} max={11} value={heightInches % 12}
              onChange={(e) => setHeightInches(Math.max(60, Math.min(90, Math.floor(heightInches / 12) * 12 + Number(e.target.value))))} />
            <span className="site-muted">in</span>
          </div>
        </div>
        <label className="site-field"><span>Weight (lbs)</span><input className="site-input" type="number" min={140} max={400} value={weightLbs} onChange={(e) => setWeightLbs(Number(e.target.value))} /></label>
        <label className="site-field"><span>Body type</span>
          <select className="site-select" value={bodyType} onChange={(e) => setBodyType(e.target.value)}>
            {allowedBodyTypes.map((build) => (
              <option key={build} value={build}>{build[0]!.toUpperCase() + build.slice(1)}</option>
            ))}
          </select>
        </label>
      </div>
      <HeadshotPicker
        label={`${position || side} headshot`}
        options={immortalityPlayerHeadshots(position)}
        value={headshotUrl}
        onChange={setHeadshotUrl}
        onUpload={async (file) => {
          const resized = await readImageAsResizedBase64(file);
          const result = await siteApi.immortalityUploadProspectHeadshot({ guildId, side, contentType: resized.contentType, imageBase64: resized.imageBase64 });
          return result.headshotUrl;
        }}
      />
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
                college: college.trim() || null, jerseyNumber, heightInches, weightLbs, bodyType,
                headshotUrl: headshotUrl || null,
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

function HeadshotPicker({ label, options, value, onChange, onUpload }: {
  label: string;
  options: readonly ImmortalityHeadshot[];
  value: string;
  onChange: (value: string) => void;
  /** Resolves the uploaded file to a hosted URL (Cloudflare Images) -- omit to disable custom uploads. */
  onUpload?: (file: File) => Promise<string>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const isCustomUpload = Boolean(value) && !options.some((option) => option.imageUrl === value);

  async function handleFile(file: File | undefined) {
    if (!file || !onUpload) return;
    setUploadBusy(true); setUploadError(null);
    try {
      if (!(HEADSHOT_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
        setUploadError("Headshot must be a JPEG, PNG, or WebP image.");
        return;
      }
      onChange(await onUpload(file));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to upload headshot.");
    } finally { setUploadBusy(false); }
  }

  return (
    <fieldset className="rise-headshot-picker">
      <legend>{label}</legend>
      <p className="site-muted">Choose a catalog portrait, upload your own, or keep the silhouette.</p>
      <div className="rise-headshot-grid">
        <button type="button" className={`rise-headshot-option${!value ? " is-selected" : ""}`} onClick={() => onChange("")}>
          <img src="/assets/player-cards/player-silhouette.svg" alt="Silhouette" />
          <span>Silhouette</span>
        </button>
        {options.map((option) => (
          <button type="button" key={option.id} className={`rise-headshot-option${value === option.imageUrl ? " is-selected" : ""}`}
            onClick={() => onChange(option.imageUrl)} aria-pressed={value === option.imageUrl}>
            <img src={option.imageUrl} alt={option.label} loading="lazy" />
            <span>{option.label}</span>
          </button>
        ))}
        {onUpload ? (
          <button type="button" className={`rise-headshot-option${isCustomUpload ? " is-selected" : ""}`}
            onClick={() => fileInputRef.current?.click()} disabled={uploadBusy}>
            <img src={isCustomUpload ? value : "/assets/player-cards/player-silhouette.svg"} alt="Custom upload" loading="lazy" />
            <span>{uploadBusy ? "Uploading…" : isCustomUpload ? "Custom (replace)" : "Upload photo"}</span>
          </button>
        ) : null}
      </div>
      {onUpload ? (
        <input ref={fileInputRef} type="file" accept={HEADSHOT_ALLOWED_TYPES.join(",")} style={{ display: "none" }}
          onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }} />
      ) : null}
      {uploadError ? <p className="site-muted" style={{ color: "var(--error, #c0392b)" }}>{uploadError}</p> : null}
    </fieldset>
  );
}

/** QB only. Pages through the league's catalogued throwing-motion clips (each a Cloudflare
 * Stream video, muted+looping so the passing animation replays while the user compares them)
 * and logs the chosen motion's key on Proceed. */
function ThrowingMotionPanel({
  guildId, side, currentKey, onSaved, setError,
}: {
  guildId: string; side: Side; currentKey: string | null;
  onSaved: () => Promise<void>; setError: (value: string | null) => void;
}) {
  const startIndex = Math.max(0, THROWING_MOTIONS.findIndex((motion) => motion.key === currentKey));
  const [index, setIndex] = useState(startIndex);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(currentKey);
  const motion = THROWING_MOTIONS[index];

  return (
    <section className="rise-card">
      <h2>Throwing Motion</h2>
      <p className="site-muted">Page through the motions below — each clip loops so you can watch the release more than once. Pick one, then Proceed.</p>
      {motion ? (
        <>
          <p><strong>{motion.name}</strong> ({index + 1} / {THROWING_MOTIONS.length})</p>
          <div className="rise-origins-video-frame">
            <iframe
              key={motion.key}
              src={`https://iframe.videodelivery.net/${motion.streamUid}?autoplay=true&muted=true&loop=true&controls=false`}
              title={motion.name}
              allow="autoplay"
              style={{ width: "100%", aspectRatio: "16 / 9", border: 0 }}
            />
          </div>
          <div className="rise-actions">
            <button type="button" className="site-btn site-btn-ghost" disabled={index === 0}
              onClick={() => setIndex((prev) => Math.max(0, prev - 1))}>◀ Previous</button>
            <button type="button" className="site-btn site-btn-ghost" disabled={index >= THROWING_MOTIONS.length - 1}
              onClick={() => setIndex((prev) => Math.min(THROWING_MOTIONS.length - 1, prev + 1))}>Next ▶</button>
            <button type="button" className="site-btn site-btn-primary" disabled={busy}
              onClick={async () => {
                setBusy(true); setError(null);
                try {
                  await siteApi.immortalitySubmitThrowingMotion({ guildId, side, motionKey: motion.key });
                  setSaved(motion.key);
                  await onSaved();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not save that throwing motion.");
                } finally { setBusy(false); }
              }}>{busy ? "Saving…" : "Proceed"}</button>
          </div>
          {saved === motion.key ? <p className="site-muted">Locked in: {motion.name}</p> : null}
        </>
      ) : (
        <p className="site-muted">No throwing motions are catalogued yet.</p>
      )}
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
        // Play recognition only ever lands on a defensive player's PRC rating (see
        // applyIqOverlay in baseline.ts) -- showing it for offense implies it does something it
        // never does for QB/HB/WR/TE.
        <p>IQ {state.iqScore}. Awareness {state.awareness}.{side === "offense" ? "" : ` Play recognition ${state.playRecognition}.`}</p>
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
  const selectedAttributeCodes = useMemo(
    () => new Set(catalog.filter((item) => keys.includes(item.key)).flatMap((item) => item.attributeCodes)),
    [catalog, keys],
  );

  return (
    <section className="rise-card">
      <h2>Natural characteristics</h2>
      <p className="site-muted">Pick before Creation Points. Max {MAX_EQUIPPED_CHARACTERISTICS} — traits that touch the same rating can't be combined.</p>
      <p>Used {keys.length} / {MAX_EQUIPPED_CHARACTERISTICS}</p>
      <div className="rise-trait-list">
        {catalog.map((item) => {
          const selected = keys.includes(item.key);
          const overlaps = !selected && item.attributeCodes.some((code) => selectedAttributeCodes.has(code));
          const atCap = !selected && keys.length >= MAX_EQUIPPED_CHARACTERISTICS;
          const disabled = overlaps || atCap;
          return (
            <label key={item.key} className={`rise-trait-option ${selected ? "rise-trait-option-active" : ""}`} aria-disabled={disabled} style={disabled ? { opacity: 0.45 } : undefined}>
              <input type="checkbox" checked={selected} disabled={disabled} onChange={() => {
                setKeys((prev) => selected ? prev.filter((key) => key !== item.key) : [...prev, item.key]);
              }} />
              <span className="rise-trait-option-body">
                <strong>{item.displayName}</strong>
                <span className="site-muted">{item.effect}{overlaps ? " — conflicts with an equipped trait" : ""}</span>
              </span>
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

/** Baseline is only computable once the rest of Origins (interviews + Natural Characteristics,
 * throwing motion for QB) is submitted -- see assertOriginsCompleteForCreation server-side.
 * Fetches on mount/side-change and shows a locked message instead of the build form until then. */
function CreationPanel({
  guildId, side, setError, onSaved,
}: {
  guildId: string; side: Side; setError: (value: string | null) => void; onSaved: () => Promise<void>;
}) {
  const [baseline, setBaseline] = useState<{ baseline: Record<string, number>; heightCost: number; totalBudget: number; effectiveBudget: number; discounts: Record<string, number> } | null>(null);
  const [lockedReason, setLockedReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [spent, setSpent] = useState<Record<string, number>>({});
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The real per-attribute CP cost escalates with the target value (and speed attributes carry a
  // surcharge) -- a naive sum of the raw "+N" inputs badly understates it. Run the exact same
  // pure function the server charges against (budget: Infinity so it always resolves a total
  // instead of short-circuiting on overage) so this preview can never drift from what actually
  // gets charged on submit.
  const preview = useMemo(() => {
    if (!baseline) return null;
    return spendCreationPoints({ baseline: baseline.baseline, spent, budget: Number.POSITIVE_INFINITY, discounts: baseline.discounts });
  }, [baseline, spent]);
  // ok:false here only ever means a target went over 99 (budget is infinite above) -- a genuine
  // build error, distinct from "over budget" below, which needs its own message and still wants
  // an accurate point count so the user knows how far over they are.
  const invalid = preview !== null && !preview.ok;
  const spentPoints = preview?.ok ? preview.spentPoints : 0;
  const overBudget = Boolean(baseline) && !invalid && spentPoints > baseline!.effectiveBudget;

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLockedReason(null); setBaseline(null);
    siteApi.immortalityCreationBaseline({ guildId, side }).then((next) => {
      if (!cancelled) setBaseline(next);
    }).catch((err) => {
      if (!cancelled) setLockedReason(err instanceof Error ? err.message : "Finish the rest of Origins first.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [guildId, side]);

  if (loading) {
    return (
      <section className="rise-card">
        <h2>Creation Points</h2>
        <p className="site-muted">Loading your baseline…</p>
      </section>
    );
  }

  if (!baseline) {
    return (
      <section className="rise-card">
        <h2>Creation Points</h2>
        <p className="site-muted">{lockedReason ?? "Finish the rest of Origins first."}</p>
      </section>
    );
  }

  return (
    <section className="rise-card">
      <h2>Creation Points</h2>
      <p className="site-muted">
        Budget is {baseline.effectiveBudget} points{baseline.heightCost > 0 ? ` (${baseline.heightCost} of your ${baseline.totalBudget} already went to your above-average height)` : ""}.
        Drag a rating up to spend points on it — it can't go below where it started.
      </p>
      <p style={overBudget || invalid ? { color: "var(--error, #c0392b)" } : undefined}>
        Used {spentPoints} / {baseline.effectiveBudget}
        {overBudget ? " — over budget, lower an attribute before evaluating" : ""}
        {invalid && preview && !preview.ok ? ` — ${preview.error}` : ""}
      </p>
      <div className="rise-attribute-list">
        {MADDEN_ATTRIBUTE_DEFINITIONS.slice(0, 24).map((def) => {
          const base = baseline.baseline[def.code] ?? 0;
          const add = spent[def.code] ?? 0;
          const total = base + add;
          const fillPct = Math.max(0, Math.min(100, (total / 99) * 100));
          return (
            <div key={def.code} className="rise-attr-row">
              <span className="rise-attr-label"><span className="rise-attr-code">{def.code}</span> {def.name}</span>
              <div className="rise-attr-slider-wrap">
                <div className="rise-attr-track-gradient" />
                <div className="rise-attr-track-mask" style={{ width: `${100 - fillPct}%` }} />
                <input
                  type="range" className="rise-attr-range"
                  min={base} max={99} step={1} value={total}
                  aria-label={`${def.name}, starting point ${base}, current ${total}`}
                  onChange={(e) => setSpent((prev) => ({ ...prev, [def.code]: Math.max(0, Number(e.target.value) - base) }))}
                />
              </div>
              <span className="rise-attr-value">{total}</span>
            </div>
          );
        })}
      </div>
      <button type="button" className="site-btn site-btn-primary" disabled={busy || overBudget || invalid}
        onClick={async () => {
          setBusy(true); setError(null);
          try {
            const cleaned = Object.fromEntries(Object.entries(spent).filter(([, value]) => value > 0));
            const next = await siteApi.immortalityEvaluateCreation({ guildId, side, spent: cleaned });
            setResult(`Build saved. Spent ${next.spentPoints ?? next.creationPointsSpent ?? next.creation_points_spent ?? spentPoints} CP. Your real OVR will come from the league's first game-data import.`);
            await onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not evaluate that build.");
          } finally { setBusy(false); }
        }}>Evaluate build</button>
      {result ? <p>{result}</p> : null}
    </section>
  );
}

/** Blocks Origins until the member watches the commissioner's intro video to the end. Native
 * controls are hidden and seeking past the furthest point actually reached is reverted, so
 * scrubbing ahead can't skip the requirement -- pausing and rewinding are still fine. */
function IntroVideoGate({ url, onFinished }: { url: string; onFinished: () => void }) {
  const [started, setStarted] = useState(false);
  const maxReached = useRef(0);

  return (
    <div className="rise-origins-video-frame">
      <video src={url} controls={false} playsInline
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          if (t > maxReached.current) maxReached.current = t;
        }}
        onSeeking={(e) => {
          if (e.currentTarget.currentTime > maxReached.current + 0.5) e.currentTarget.currentTime = maxReached.current;
        }}
        onEnded={onFinished}
        ref={(node) => {
          if (node && started) void node.play().catch(() => {});
        }} />
      {!started ? (
        <button type="button" className="site-btn site-btn-primary rise-origins-play"
          onClick={() => setStarted(true)}>▶ Play intro video</button>
      ) : null}
    </div>
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
        <label className="site-field"><span>First name</span>
          <div className="rise-input-with-dice">
            <input className="site-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <DiceButton label="Randomize first name" onClick={() => setFirstName(randomFrom(REC_FIRST_NAMES))} />
          </div>
        </label>
        <label className="site-field"><span>Last name</span>
          <div className="rise-input-with-dice">
            <input className="site-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            <DiceButton label="Randomize last name" onClick={() => setLastName(randomFrom(REC_LAST_NAMES))} />
          </div>
        </label>
      </div>
      <HeadshotPicker label="Owner headshot" options={IMMORTALITY_OWNER_HEADSHOTS} value={headshotUrl} onChange={setHeadshotUrl}
        onUpload={async (file) => {
          const resized = await readImageAsResizedBase64(file);
          const result = await siteApi.immortalityUploadOwnerHeadshot({ guildId, contentType: resized.contentType, imageBase64: resized.imageBase64 });
          return result.headshotUrl;
        }}
      />
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

/** Takes over the whole page once both prospects have finished Creation Points: owner creation,
 * then the franchise reveal (TeamRevealPanel), then contract signings -- none of which are
 * per-side, so they don't belong in the per-side stage tabs anymore. */
function PresentationSequence({
  guildId, hub, onSaved, setError,
}: {
  guildId: string;
  hub: ImmortalityHubResponse;
  onSaved: () => Promise<void>;
  setError: (value: string | null) => void;
}) {
  const owner = hub.owner ?? null;
  const franchiseOptions = hub.franchiseOptions ?? null;
  const contracts = hub.contracts ?? [];
  const ownerDone = Boolean(owner && owner.originsStep === "complete");
  const allContractsSigned = contracts.length > 0 && contracts.every((row) => row.status === "signed");
  // Music spans team selection through signing -- starts the moment the franchise reveal screen
  // is reachable (not during the owner step) and keeps playing across the reveal-to-contracts
  // transition, which is why it's hoisted here rather than into either branch below: those are
  // separate returns, so an <audio> placed inside either one would remount (and restart) when
  // the phase changes. This one position stays mounted for the whole ownerDone span instead.
  const playMusic = ownerDone;

  return (
    <div className="rise-presentation">
      {playMusic ? <CeremonyMusic fadeOut={allContractsSigned} /> : null}
      {!ownerDone ? (
        <>
          <header className="rise-presentation-header">
            <p className="site-muted">Both prospects are locked in.</p>
            <h1>Create Your Owner</h1>
          </header>
          <OwnerPanel guildId={guildId} owner={owner} personaQuestions={hub.catalogs.persona.owner}
            onSaved={onSaved} setError={setError} />
        </>
      ) : franchiseOptions?.chosenTeamId ? (
        (() => {
          const chosen = franchiseOptions.teams.find((team) => team.teamId === franchiseOptions.chosenTeamId);
          const label = chosen ? `${chosen.city ?? ""} ${chosen.name ?? chosen.abbreviation ?? ""}`.trim() : "your franchise";
          return (
            <>
              <header className="rise-presentation-header">
                <p className="site-muted">Welcome to the league.</p>
                <h1>{label}</h1>
              </header>
              {contracts.length ? (
                <RiseContractSigning guildId={guildId} contracts={contracts} onSigned={onSaved} setError={setError} />
              ) : (
                <p className="site-muted">Preparing your contracts…</p>
              )}
            </>
          );
        })()
      ) : !franchiseOptions?.eligible ? (
        <section className="rise-card">
          <h2>Choose Your Franchise</h2>
          <p className="site-muted">{franchiseOptions?.reason ?? "Almost there."}</p>
        </section>
      ) : (
        <>
          <header className="rise-presentation-header">
            <p className="site-muted">Owner set. Both players are ready.</p>
            <h1>Choose Your Franchise</h1>
          </header>
          <TeamRevealPanel guildId={guildId} franchiseOptions={franchiseOptions} onSaved={onSaved} setError={setError} />
        </>
      )}
    </div>
  );
}

/** Background music for the team-reveal-through-signing ceremony -- a single <audio> element
 * mounted once (see the stable position in PresentationSequence above) so it keeps playing
 * uninterrupted as the phase changes underneath it. Starts at 35% volume, plays once (no loop,
 * so it simply falls silent if it finishes before the ceremony does), and fades out over ~2s
 * instead of cutting off abruptly once every contract is signed. */
function CeremonyMusic({ fadeOut }: { fadeOut: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadingRef = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.35;
    // Autoplay-with-sound is blocked without prior user interaction on the page -- by the time
    // this mounts the user has already clicked Save/Confirm at least once, so this succeeds in
    // practice; the catch just avoids a console error on the rare browser that still blocks it.
    void audio.play().catch(() => {});
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !fadeOut || fadingRef.current) return;
    fadingRef.current = true;
    const startVolume = audio.volume;
    const steps = 20;
    const stepMs = 100;
    let step = 0;
    const id = window.setInterval(() => {
      step += 1;
      audio.volume = Math.max(0, startVolume * (1 - step / steps));
      if (step >= steps) {
        window.clearInterval(id);
        audio.pause();
      }
    }, stepMs);
    return () => window.clearInterval(id);
  }, [fadeOut]);

  return <audio ref={audioRef} src="/assets/audio/team-reveal-theme.mp3" preload="auto" />;
}

/** The franchise picker itself. Confirming a team doesn't reload immediately -- it first plays a
 * dissolve: every other team fades and shrinks away while the chosen one gets a spotlight glow,
 * then the hub reload (which flips franchiseOptions.chosenTeamId) hands off to the contracts
 * view in PresentationSequence above. */
function TeamRevealPanel({
  guildId, franchiseOptions, onSaved, setError,
}: {
  guildId: string;
  franchiseOptions: NonNullable<ImmortalityHubResponse["franchiseOptions"]>;
  onSaved: () => Promise<void>;
  setError: (value: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  const [revealedTeamId, setRevealedTeamId] = useState<string | null>(null);
  const dissolving = revealedTeamId != null;

  const pendingTeam = pendingTeamId ? franchiseOptions.teams.find((team) => team.teamId === pendingTeamId) ?? null : null;
  const groups = new Map<string, typeof franchiseOptions.teams>();
  for (const team of franchiseOptions.teams) {
    const key = team.division || team.conference || "Teams";
    const list = groups.get(key) ?? [];
    list.push(team);
    groups.set(key, list);
  }

  async function confirmChoice() {
    if (!pendingTeamId) return;
    setBusy(true); setError(null);
    try {
      await siteApi.immortalityChooseTeam({ guildId, teamId: pendingTeamId });
      setRevealedTeamId(pendingTeamId);
      window.setTimeout(() => { void onSaved(); }, 1100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not choose that franchise.");
      setBusy(false);
    }
  }

  return (
    <section className="rise-card">
      {!dissolving ? (
        <>
          <p className="site-muted">Pick any still-open franchise, grouped by division. This is final once confirmed.</p>
          {[...groups.entries()].map(([division, teams]) => (
            <div key={division} className="rise-question">
              <p><strong>{division}</strong></p>
              <div className="wizard-team-grid">
                {teams.map((team) => (
                  <button
                    key={team.teamId}
                    type="button"
                    className={`wizard-team-card${team.open ? "" : " wizard-team-card-taken"}`}
                    disabled={busy || !team.open}
                    aria-disabled={!team.open}
                    onClick={() => team.open && setPendingTeamId(team.teamId)}
                  >
                    {team.logoUrl ? <img src={team.logoUrl} alt="" className="wizard-team-card-logo" /> : null}
                    <strong>{team.city ?? ""} {team.name ?? team.abbreviation}</strong>
                    {team.abbreviation ? <span className="site-muted">{team.abbreviation}</span> : null}
                    {!team.open ? <span className="site-muted">Taken</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {pendingTeam ? (
            <div className="rise-split-card" style={{ marginTop: 8 }}>
              <div className="rise-split-half" style={{ cursor: "default" }}>
                <span className="rise-split-eyebrow">Confirm</span>
                <strong>{pendingTeam.city ?? ""} {pendingTeam.name ?? pendingTeam.abbreviation}</strong>
                <span className="site-muted">This choice is final — your owner and both prospects join this franchise.</span>
                <div className="rise-actions" style={{ marginTop: 8 }}>
                  <button type="button" className="site-btn site-btn-ghost" disabled={busy} onClick={() => setPendingTeamId(null)}>Cancel</button>
                  <button type="button" className="site-btn site-btn-primary" disabled={busy} onClick={() => void confirmChoice()}>
                    {busy ? "Confirming…" : "Confirm & Proceed"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rise-reveal-grid">
          {franchiseOptions.teams.map((team) => {
            const isChosen = team.teamId === revealedTeamId;
            return (
              <div key={team.teamId} className={`wizard-team-card rise-reveal-card${isChosen ? " rise-reveal-chosen" : " rise-reveal-dissolved"}`}>
                {team.logoUrl ? <img src={team.logoUrl} alt="" className="wizard-team-card-logo" /> : null}
                <strong>{team.city ?? ""} {team.name ?? team.abbreviation}</strong>
                {team.abbreviation ? <span className="site-muted">{team.abbreviation}</span> : null}
              </div>
            );
          })}
        </div>
      )}
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
