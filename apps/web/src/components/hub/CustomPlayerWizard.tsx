import { useEffect, useMemo, useRef, useState } from "react";
import { Dices } from "lucide-react";
import { CFB_27_TEAMS, REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR, REC_DEV_TRAITS, canonicalReplacementPosition, cardBuildsForPosition, evaluateRecCustomPlayerBuild, getRecAttributeDisplayName, getRecEditableAttributes, getRecNetDevelopmentCost, listCustomPlayerRendersFor, sortRecAttributeCodes, type RecGameFamily, type RecPackageTier } from "@rec/shared";
import { recApi } from "../../lib/rec-api-client.js";
import { Button } from "../ui/Button.js";
import { CoinAmount } from "../ui/CoinAmount.js";
import { Modal } from "../ui/Modal.js";
import { ErrorPopup } from "../ui/ErrorPopup.js";

const CFB_COLLEGE_OPTIONS = [...CFB_27_TEAMS].map((t) => t.name).sort();

// Groups editable attribute codes by the same 5 categories the in-game roster viewer uses
// (physical, passing/ball-carrier, receiving, blocking, defensive/kicking), preserving each
// group's in-game order, instead of whatever order getRecEditableAttributes happens to return.
function groupEditableAttributes(editable: readonly string[]): Array<{ label: string; codes: string[] }> {
  return [{ label: "Attributes", codes: sortRecAttributeCodes(editable) }];
}

// There's no archetype picker any more — every editable attribute on every build starts at
// REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR and can't be lowered below it. The CP cost of those
// starting points is charged the same way any other point is (evaluateRecCustomPlayerBuild
// computes cost from the final attribute values, not from how the user got there), so
// pre-filling this already "spends" that CP with no changes needed to the shared
// cost/validation engine itself.
function baselineAttributes(game: RecGameFamily, position: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const code of getRecEditableAttributes(game, position, "")) result[code] = REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR;
  return result;
}

// The archetype concept still exists under the hood (it drives per-attribute cost
// multipliers and identity validation server-side) — it's just never user-selected any
// more. Whichever archetype's primary attributes best match the current build (highest
// average) is auto-detected and is what actually gets submitted.
function detectBestArchetypeKey(archetypes: any[], attributes: Record<string, number>): string {
  let best = archetypes[0]?.key ?? "";
  let bestAvg = -1;
  for (const entry of archetypes) {
    const codes: string[] = entry.primaryAttributes ?? [];
    const avg = codes.length ? codes.reduce((sum, c) => sum + (attributes[c] ?? 0), 0) / codes.length : 0;
    if (avg > bestAvg) { bestAvg = avg; best = entry.key; }
  }
  return best;
}

const EMPTY_IDENTITY = { firstName: "", lastName: "", jerseyNumber: 0, handedness: "right", heightInches: 72, weightLbs: 200, hometownCity: "", hometownState: "", college: "", bodyType: "standard", cardRenderId: "" };
const WIZARD_STEPS = 6;

// Mirrors apps/api/src/modules/custom-players/custom-players.service.ts (CFB_POSITION_HEIGHT /
// CFB_BODY_TYPE_WEIGHT) — the server is authoritative, these are just client-side hints/limits.
const CFB_POSITION_HEIGHT: Record<string, { max: number; avg: number }> = {
  QB: { max: 77, avg: 75 }, HB: { max: 73, avg: 71 }, FB: { max: 73, avg: 71 }, WR: { max: 76, avg: 73 }, TE: { max: 78, avg: 77 },
  LT: { max: 79, avg: 77 }, LG: { max: 79, avg: 77 }, C: { max: 79, avg: 77 }, RG: { max: 79, avg: 77 }, RT: { max: 79, avg: 77 },
  LE: { max: 78, avg: 76 }, RE: { max: 78, avg: 76 }, DT: { max: 78, avg: 76 },
  LOLB: { max: 76, avg: 74 }, MLB: { max: 76, avg: 74 }, ROLB: { max: 76, avg: 74 },
  CB: { max: 74, avg: 71 }, FS: { max: 75, avg: 72 }, SS: { max: 75, avg: 72 },
};
// Mirrors apps/api/src/modules/custom-players/custom-players.service.ts's
// MADDEN_POSITION_HEIGHT — server is authoritative, this is the client-side hint/limit.
const MADDEN_POSITION_HEIGHT: Record<string, { max: number }> = {
  QB: { max: 77 }, HB: { max: 73 }, FB: { max: 75 }, WR: { max: 76 }, TE: { max: 79 },
  LT: { max: 80 }, LG: { max: 80 }, C: { max: 80 }, RG: { max: 80 }, RT: { max: 80 },
  LE: { max: 79 }, RE: { max: 79 }, DT: { max: 79 },
  LOLB: { max: 76 }, MLB: { max: 76 }, ROLB: { max: 76 },
  CB: { max: 75 }, FS: { max: 76 }, SS: { max: 76 },
};
const CFB_BODY_TYPE_WEIGHT: Record<string, { min: number; max: number }> = {
  standard: { min: 175, max: 230 }, thin: { min: 180, max: 236 }, heavy: { min: 280, max: 400 }, lean: { min: 160, max: 215 }, muscular: { min: 210, max: 285 },
};
function formatFeetInches(inches: number) { return `${Math.floor(inches / 12)}'${inches % 12}"`; }

export function CustomPlayerWizard({ guildId, onPurchased }: { guildId: string; onPurchased: () => void }) {
  const [config, setConfig] = useState<any>(null); const [step, setStep] = useState(1); const [tier, setTier] = useState<RecPackageTier>(1);
  const [position, setPosition] = useState("QB"); const [devTrait, setDevTrait] = useState("normal");
  const [identity, setIdentity] = useState<any>(EMPTY_IDENTITY); const [attributes, setAttributes] = useState<Record<string, number>>({}); const [replacementPlayerId, setReplacementPlayerId] = useState("");
  const [notice, setNotice] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [hydrated, setHydrated] = useState(false);
  const [ceilingBlock, setCeilingBlock] = useState<{ attribute: string; message: string; deficientAttributes: Array<{ attribute: string; current: number; required: number }> } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // A double-click/double-tap on Purchase can fire submit() twice before React re-renders the
  // disabled prop (setBusy(true) is async) — a synchronous ref check closes that race, and
  // reusing one idempotency key for the whole wizard session means even a slipped-through
  // second call hits the backend's own duplicate-key short-circuit instead of minting a second
  // build row (crypto.randomUUID() used to be called fresh inside submit() every time,
  // defeating that dedup entirely).
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  useEffect(() => { let active = true; Promise.all([recApi.getCustomPlayerConfig(guildId), recApi.getCustomPlayerDraft(guildId)]).then(([value, saved]) => {
    if (!active) return;
    setConfig(value); const draft = saved.draft;
    if (draft) {
      const savedIdentity = draft.identity ?? {};
      setStep(Math.max(1, Math.min(WIZARD_STEPS, Number(String(draft.current_step ?? "1").replace("step_", "")) || 1)));
      setTier((draft.package_tier ?? 1) as RecPackageTier); setPosition(draft.position ?? "QB");
      setDevTrait(draft.development_trait ?? "normal");
      setIdentity({ ...EMPTY_IDENTITY, ...savedIdentity, replacementPlayerId: undefined }); setReplacementPlayerId(savedIdentity.replacementPlayerId ?? ""); setAttributes(draft.attributes ?? {});
      setNotice("Your saved custom-player draft was restored.");
    } else {
      setAttributes(baselineAttributes((value.game ?? "CFB") as RecGameFamily, "QB"));
    }
    setHydrated(true);
  }).catch((error) => setNotice(error instanceof Error ? error.message : String(error))); return () => { active = false; }; }, [guildId]);
  const game = (config?.game ?? "CFB") as RecGameFamily; const pkg = config?.packages?.find((entry: any) => entry.tier === tier);
  // CFB recruits inherit the replaced player's position — no free position pick, and a
  // replacement must be chosen before continuing past Step 3. Madden isn't locked this way.
  const positionLocked = game === "CFB" && Boolean(config?.replacementRequired);
  // Madden picks position first, then player details — height/weight caps are per-position
  // (MADDEN_POSITION_HEIGHT), so choosing position afterward left the details step validating
  // against whatever position was still selected before the user got there (the "QB" default,
  // in practice). CFB keeps its existing order: position is inherited from the replaced player
  // (or freely chosen when unseeded), and was never the source of that staleness.
  const detailsStep = game === "CFB" ? 2 : 3;
  const positionStep = game === "CFB" ? 3 : 2;
  const effectiveArchetypeKey = useMemo(
    () => config ? detectBestArchetypeKey(config.archetypes[position] ?? [], attributes) : "",
    [config, position, attributes],
  );
  const editable = useMemo(() => effectiveArchetypeKey ? getRecEditableAttributes(game, position, effectiveArchetypeKey) : [], [game, position, effectiveArchetypeKey]);
  useEffect(() => { if (!hydrated || !config) return; const timer = window.setTimeout(() => {
    void recApi.saveCustomPlayerDraft({ guildId, currentStep: `step_${step}`, packageTier: tier, position, archetypeKey: effectiveArchetypeKey, developmentTrait: devTrait, identity, attributes, replacementPlayerId }).catch(() => undefined);
  }, 600); return () => window.clearTimeout(timer); }, [hydrated, config, guildId, step, tier, position, effectiveArchetypeKey, devTrait, identity, attributes, replacementPlayerId]);
  // CFB dev trait is inherited from the replaced player, not purchased — no CP cost for it.
  const netDev = useMemo(() => { if (game === "CFB") return 0; try { return getRecNetDevelopmentCost(game, tier, devTrait); } catch { return 0; } }, [game, tier, devTrait]);
  const evaluation = useMemo(() => { try { return effectiveArchetypeKey ? evaluateRecCustomPlayerBuild({ game, position, archetypeKey: effectiveArchetypeKey, packageTier: tier, attributes, netDevelopmentCost: netDev, mode: "preview" }) : null; } catch { return null; } }, [game, position, effectiveArchetypeKey, tier, attributes, netDev]);
  function setPositionAndReset(value: string) {
    setPosition(value);
    setAttributes(baselineAttributes(game, value));
    // Height is picked at step 2, before position is chosen at step 3 — a height valid for
    // the position selected when step 2 was filled out (or the "QB" default) can be over
    // the new position's cap (e.g. a QB-height pick that becomes a 6'5" LB). Re-clamp here
    // so an over-cap height can't silently ride through to submission unnoticed.
    const heightMax = (game === "CFB" ? CFB_POSITION_HEIGHT[value.toUpperCase()] : MADDEN_POSITION_HEIGHT[value.toUpperCase()])?.max ?? 84;
    setIdentity((current: any) => ({
      ...current,
      cardRenderId: "",
      heightInches: Math.min(current.heightInches, heightMax),
    }));
  }
  function setBodyType(value: string) {
    setIdentity((current: any) => ({ ...current, bodyType: value, cardRenderId: "" }));
  }
  const appearanceOptions = useMemo(
    () => listCustomPlayerRendersFor({ bodyBuild: identity.bodyType, position }),
    [identity.bodyType, position],
  );
  const bodyBuildAllowed = useMemo(
    () => (cardBuildsForPosition(position) as readonly string[]).includes(String(identity.bodyType ?? "")),
    [position, identity.bodyType],
  );
  // CFB position is inherited from the replaced player — the in-game roster editor can't
  // change a player's position. Choosing a replacement locks position to that player's
  // position (which re-baselines archetype + attributes for the new position).
  function onReplacementChange(playerId: string) {
    setReplacementPlayerId(playerId);
    if (playerId) {
      const player = config.replacementPlayers.find((entry: any) => entry.id === playerId);
      // player.position is the roster's raw code, which for CFB edge/LB slots (SAM/WILL/MIKE/
      // LEDGE/REDGE) isn't one of the canonical codes the position picker, archetype catalog,
      // and attribute editor are keyed by (LOLB/MLB/ROLB/LE/RE) — canonicalize before using it
      // as `position`, or config.archetypes[position] comes back undefined and crashes.
      if (player) setPositionAndReset(canonicalReplacementPosition(player.position));
    }
  }
  function mutate(code: string, delta: number) {
    const current = attributes;
    const candidate = { ...current, [code]: Math.max(REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR, Math.min(99, (current[code] ?? REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR) + delta)) };
    if (delta > 0) {
      try {
        const key = detectBestArchetypeKey(config.archetypes[position] ?? [], candidate);
        const result = evaluateRecCustomPlayerBuild({ game, position, archetypeKey: key, packageTier: tier, attributes: candidate, netDevelopmentCost: netDev, mode: "preview" });
        const blocking = result.violations.find((v) => v.code !== "ARCHETYPE_IDENTITY");
        if (blocking) {
          setNotice(null);
          setCeilingBlock({
            attribute: code,
            message: blocking.message,
            deficientAttributes: blocking.deficientAttributes ?? [],
          });
          return;
        }
      } catch {
        return;
      }
    }
    setNotice(null);
    setAttributes(candidate);
  }
  function validatePlayerDetails(): string | null {
    if (!identity.firstName?.trim()) return "First name is required.";
    if (!identity.lastName?.trim()) return "Last name is required.";
    if (!Number.isInteger(identity.jerseyNumber) || identity.jerseyNumber < 0 || identity.jerseyNumber > 99) return "Jersey number must be a whole number from 0 to 99.";
    if (game === "CFB") {
      const heightRule = CFB_POSITION_HEIGHT[position.toUpperCase()];
      const heightMax = heightRule?.max ?? 84;
      if (!Number.isInteger(identity.heightInches) || identity.heightInches < 65 || identity.heightInches > heightMax) return `Height for ${position} must be between 5'5" and ${formatFeetInches(heightMax)}.`;
      const weightRule = CFB_BODY_TYPE_WEIGHT[identity.bodyType] ?? CFB_BODY_TYPE_WEIGHT.standard;
      if (!Number.isInteger(identity.weightLbs) || identity.weightLbs < weightRule.min || identity.weightLbs > weightRule.max) return `Weight for the ${identity.bodyType} body type must be between ${weightRule.min} and ${weightRule.max} pounds.`;
    } else {
      if (!identity.hometownCity?.trim()) return "Hometown is required.";
      if (!identity.hometownState?.trim()) return "State is required.";
      if (!identity.college?.trim()) return "College is required.";
      if (!identity.bodyType || !CFB_BODY_TYPE_WEIGHT[identity.bodyType]) return "Body type is required.";
      const heightMax = MADDEN_POSITION_HEIGHT[position.toUpperCase()]?.max ?? 84;
      if (!Number.isInteger(identity.heightInches) || identity.heightInches < 65 || identity.heightInches > heightMax) return `Height for ${position} must be between 5'5" and ${formatFeetInches(heightMax)}.`;
      if (!Number.isInteger(identity.weightLbs) || identity.weightLbs < 140 || identity.weightLbs > 400) return "Weight must be between 140 and 400 pounds.";
    }
    return null;
  }
  async function generateName() { const result = await recApi.generateCustomPlayerName(guildId, `${Date.now()}:${Math.random()}`); setIdentity((value: any) => ({ ...value, firstName: result.firstName, lastName: result.lastName })); }
  async function submit() { if (!evaluation || !effectiveArchetypeKey || submittingRef.current) return; submittingRef.current = true; setBusy(true); setNotice(null); try { const result = await recApi.submitCustomPlayer({ guildId, idempotencyKey: idempotencyKeyRef.current, packageTier: tier, position, archetypeKey: effectiveArchetypeKey, developmentTrait: devTrait, attributes, replacementPlayerId: replacementPlayerId || null, identity: game === "CFB" ? { ...identity, college: undefined } : identity }); setHydrated(false); setNotice(result.build.unused_cp_refund_coins > 0 ? "Submitted. You earned a 500-coin unspent CP reward, credited after approval and application." : "Submitted for commissioner approval and application."); onPurchased(); } catch (error) { setSubmitError(error instanceof Error ? error.message : String(error)); submittingRef.current = false; } finally { setBusy(false); } }
  if (!config) return <p className="hub-empty">{notice ?? "Loading custom-player builder…"}</p>;
  if (!config.enabled) return <p className="hub-empty">Custom-player purchases are disabled.</p>;
  if (config.blockedNoEligibleReplacement) return <p className="hub-empty">{game === "MADDEN"
    ? "Your Madden team has no active roster players available to replace. Ask a commissioner to import or assign the team roster first."
    : "Your roster has no recruits or manually-added players to replace yet. Add one via the Recruiting Board or the \"Edit Roster\" quick action on My Team first."}</p>;
  return <div className="custom-player-wizard"><p className="hub-eyebrow">Step {step} of {WIZARD_STEPS}</p>
    {config.devTraitInherited && <p className="form-hint">CFB recruits don't get a purchased development trait — whichever trait the player you replace already has carries over to this one. With no replacement (an unseeded roster), the new player starts at Normal.</p>}
    {config.appearanceNotice && (step === detailsStep || step === 4) && <p className="form-hint">{config.appearanceNotice}</p>}
    {step === 1 && <><h4>Select Package</h4><div className="custom-player-package-grid">{config.packages.map((entry: any) => <button type="button" key={entry.key} className={tier === entry.tier ? "active" : ""} onClick={() => { setTier(entry.tier); setDevTrait(entry.tier >= 5 ? (game === "CFB" ? "elite" : "superstar") : entry.tier >= 3 ? (game === "CFB" ? "impact" : "star") : "normal"); }}><strong>{entry.displayName}</strong><span><CoinAmount amount={entry.coinPrice}/> · {entry.creationPoints.toLocaleString()} CP</span><small>{entry.description}</small></button>)}</div><p>Wallet: <CoinAmount amount={config.walletBalance}/> · Used {config.seasonUsed}{config.seasonCap ? `/${config.seasonCap}` : ""}</p></>}
    {step === detailsStep && (() => {
      const heightRule = game === "CFB"
        ? (CFB_POSITION_HEIGHT[position.toUpperCase()] ?? { max: 84, avg: 72 })
        : (MADDEN_POSITION_HEIGHT[position.toUpperCase()] ?? { max: 84 });
      const weightRule = game === "CFB" ? (CFB_BODY_TYPE_WEIGHT[identity.bodyType] ?? CFB_BODY_TYPE_WEIGHT.standard) : null;
      // Madden's height rule has no "avg" (no per-inch overage surcharge for Madden), only a cap.
      const overageInches = game === "CFB" && heightRule && "avg" in heightRule ? Math.max(0, identity.heightInches - (heightRule as { avg: number }).avg) : 0;
      return <><h4>Player Details</h4><div className="custom-player-fields"><label>First name<input className="form-input" value={identity.firstName} onChange={(e) => setIdentity({ ...identity, firstName: e.target.value })}/></label><label>Last name<input className="form-input" value={identity.lastName} onChange={(e) => setIdentity({ ...identity, lastName: e.target.value })}/></label><Button variant="secondary" onClick={() => void generateName()}><Dices size={16}/> Generate</Button><label>Jersey #<input className="form-input" type="number" min="0" max="99" value={identity.jerseyNumber} onChange={(e) => setIdentity({ ...identity, jerseyNumber: Number(e.target.value) })}/></label><label>Hand<select className="form-input" value={identity.handedness} onChange={(e) => setIdentity({ ...identity, handedness: e.target.value })}><option value="right">Right</option><option value="left">Left</option></select></label>
        <label>Height{heightRule ? ` — 5'5" to ${formatFeetInches(heightRule.max)}` : ""}
          <span className="custom-player-height-picker">
            <select className="form-input" value={Math.floor(identity.heightInches / 12)} onChange={(e) => setIdentity({ ...identity, heightInches: Number(e.target.value) * 12 + (identity.heightInches % 12) })}>
              {Array.from({ length: 4 }, (_, i) => i + 4).map((feet) => <option key={feet} value={feet}>{feet}'</option>)}
            </select>
            <select className="form-input" value={identity.heightInches % 12} onChange={(e) => setIdentity({ ...identity, heightInches: Math.floor(identity.heightInches / 12) * 12 + Number(e.target.value) })}>
              {Array.from({ length: 12 }, (_, i) => i).map((inch) => <option key={inch} value={inch}>{inch}"</option>)}
            </select>
          </span>
        </label>
        <label>Body Type<select className="form-input" value={identity.bodyType} onChange={(e) => setBodyType(e.target.value)}>{Object.keys(CFB_BODY_TYPE_WEIGHT).map((key) => <option key={key} value={key}>{key[0].toUpperCase() + key.slice(1)}</option>)}</select></label>
        <label>Weight (lb){weightRule ? ` — ${weightRule.min}-${weightRule.max}` : ""}<input className="form-input" type="number" min={weightRule?.min} max={weightRule?.max} value={identity.weightLbs} onChange={(e) => setIdentity({ ...identity, weightLbs: Number(e.target.value) })}/></label>
        {game !== "CFB" && <><label>Hometown<input className="form-input" value={identity.hometownCity} onChange={(e) => setIdentity({ ...identity, hometownCity: e.target.value })}/></label><label>State<input className="form-input" value={identity.hometownState} onChange={(e) => setIdentity({ ...identity, hometownState: e.target.value })}/></label><label>College<select className="form-input" value={identity.college} onChange={(e) => setIdentity({ ...identity, college: e.target.value })}><option value="">Select college</option>{CFB_COLLEGE_OPTIONS.map((name) => <option key={name} value={name}>{name}</option>)}</select></label></>}</div>
        {overageInches > 0 && <p className="form-hint">Height is {overageInches}" over the {position} average — costs {overageInches * 100} creation points.</p>}
        <p className="form-hint">{config.contractNotice}</p></>;
    })()}
    {step === positionStep && (() => {
      const selectedReplacement = positionLocked ? config.replacementPlayers.find((player: any) => player.id === replacementPlayerId) : null;
      const showBuildOptions = !positionLocked || Boolean(selectedReplacement);
      return <><h4>{positionLocked ? "Replacement &amp; Development" : "Position &amp; Development"}</h4>
        {positionLocked ? <label>Replace active player<select className="form-input" value={replacementPlayerId} onChange={(e) => onReplacementChange(e.target.value)}><option value="">Select player to replace</option>{config.replacementPlayers.map((player: any) => <option key={player.id} value={player.id}>{player.full_name ?? `${player.first_name} ${player.last_name}`} · {player.position} · {player.overall_rating ?? "—"} OVR</option>)}</select></label> : <label>Position<select className="form-input" value={position} onChange={(e) => setPositionAndReset(e.target.value)}>{config.positions.map((value: string) => <option key={value}>{value}</option>)}</select></label>}
        {selectedReplacement && <p className="form-hint">This recruit inherits the replaced player's position (<strong>{selectedReplacement.position}</strong>) — the in-game roster editor can't change a player's position.</p>}
        {showBuildOptions && <p className="form-hint">Every attribute starts at a {REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR} baseline and can't be lowered — that baseline is deducted from your CP budget. Build freely and the ratings will determine the player's in-game style.</p>}
        {config.devTraitInherited ? (
          <p className="form-hint">Development trait: inherited from the player this replaces — the in-game editor can't change it.</p>
        ) : (
          <label>Development<select className="form-input" value={devTrait} onChange={(e) => setDevTrait(e.target.value)}>{(REC_DEV_TRAITS[game] as readonly any[]).map((entry) => <option key={entry.key} value={entry.key}>{entry.label} · {Math.max(0, entry.absoluteCost - pkg.includedDevCredit)} CP</option>)}</select></label>
        )}
        {positionLocked && !selectedReplacement && <p className="form-hint">Select the active player this recruit replaces first — its position decides the attributes you can build.</p>}
      </>;
    })()}
    {step === 4 && <>
      <h4>Card Appearance</h4>
      <p className="form-hint">
        {game === "MADDEN"
          ? <>Pick one of the {appearanceOptions.length || 150} headshot renders for this player&apos;s card and site roster photo. Filtered by <strong>{identity.bodyType}</strong> body type{position ? <> and <strong>{position}</strong></> : null}.</>
          : <>Choose a face for this player&apos;s card. Options are filtered by <strong>{identity.bodyType}</strong> body type{position ? <> and <strong>{position}</strong> position</> : null}.</>}
      </p>
      {!bodyBuildAllowed && (
        <p className="form-hint">
          The {identity.bodyType} body type isn&apos;t available for {position}. Go back and pick a compatible body type
          ({cardBuildsForPosition(position).join(", ")}).
        </p>
      )}
      {bodyBuildAllowed && appearanceOptions.length === 0 && (
        <p className="form-hint">No card faces are available for this combination yet.</p>
      )}
      <div className="custom-player-render-grid" role="listbox" aria-label="Card appearance">
        {appearanceOptions.map((render) => (
          <button
            type="button"
            key={render.id}
            role="option"
            aria-selected={identity.cardRenderId === render.id}
            className={identity.cardRenderId === render.id ? "active" : ""}
            onClick={() => setIdentity({ ...identity, cardRenderId: render.id })}
          >
            <img src={render.imagePath} alt="" loading="lazy" />
            <span>{render.hairstyle} · {render.skinTone}</span>
          </button>
        ))}
      </div>
    </>}
    {step === 5 && <><h4>Attribute Builder</h4>{groupEditableAttributes(editable).map((group) => <div key={group.label} className="custom-player-attribute-group"><h5>{group.label}</h5><div className="custom-player-attribute-list">{group.codes.map((code) => <div key={code}><span><strong>{getRecAttributeDisplayName(code)}</strong><small>{code.toUpperCase()}</small></span><button onClick={() => mutate(code,-1)}>−</button><input className="custom-player-attribute-input" type="number" min={REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR} max={99} value={attributes[code] ?? REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR} onChange={(e) => mutate(code, Math.max(REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR, Math.min(99, Number(e.target.value) || REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR)) - (attributes[code] ?? REC_CUSTOM_PLAYER_ATTRIBUTE_FLOOR))}/><button onClick={() => mutate(code,1)}>+</button></div>)}</div></div>)}</>}
    {step === 6 && <><h4>Review</h4><p><strong>{identity.firstName} {identity.lastName}</strong> · {position}</p>
      {identity.cardRenderId && (
        <div className="custom-player-review-face">
          <img src={appearanceOptions.find((row) => row.id === identity.cardRenderId)?.imagePath
            ?? listCustomPlayerRendersFor({ bodyBuild: identity.bodyType, position: null }).find((row) => row.id === identity.cardRenderId)?.imagePath
            ?? "/assets/player-cards/player-silhouette.svg"} alt="" />
          <span>Card face selected</span>
        </div>
      )}
      <p>{pkg.displayName} · <CoinAmount amount={pkg.coinPrice}/></p><p className="form-hint">Identity or rating edits are logged and sent to you; {game === "CFB" ? "position remains locked to this purchase" : "position and development trait remain locked to this purchase"}.</p><p>{evaluation?.totalCost}/{evaluation?.creationPoints} CP · {evaluation?.pointsRemaining} unspent · <strong>{(evaluation?.pointsRemaining ?? 0) * 10 >= (evaluation?.creationPoints ?? 0) ? "500-coin reward after application" : "Spend no more than 90% to earn a 500-coin reward"}</strong></p>{positionLocked ? <p className="form-hint">Replacing: <strong>{(() => { const p = config.replacementPlayers.find((player: any) => player.id === replacementPlayerId); return p ? (p.full_name ?? `${p.first_name} ${p.last_name}`) : "selected player"; })()}</strong> ({position}) — chosen in Step 3, locked to this purchase.</p> : config.replacementRequired ? <label>Replace active player{game === "CFB" ? ` (must be ${position} — CFB recruits inherit that player's position)` : " (any position)"}<select className="form-input" value={replacementPlayerId} onChange={(e) => {
      const nextId = e.target.value;
      if (game === "CFB" && nextId) {
        const player = config.replacementPlayers.find((entry: any) => entry.id === nextId);
        const nextPos = player ? canonicalReplacementPosition(player.position) : "";
        if (nextPos && nextPos !== position) {
          setNotice(`That player is a ${player.position}. CFB recruits inherit the replaced player's position — pick a ${position}, or go back and rebuild as ${nextPos}.`);
          return;
        }
      }
      setReplacementPlayerId(nextId);
      setNotice(null);
    }}><option value="">Select player</option>{[...config.replacementPlayers]
      .sort((a: any, b: any) => Number(a.overall_rating ?? 999) - Number(b.overall_rating ?? 999) || String(a.full_name ?? "").localeCompare(String(b.full_name ?? "")))
      .filter((player: any) => game !== "CFB" || canonicalReplacementPosition(player.position) === position)
      .map((player: any) => <option key={player.id} value={player.id}>{player.full_name ?? `${player.first_name} ${player.last_name}`} · {player.position} · {player.overall_rating ?? "—"} OVR</option>)}</select></label> : <p className="form-hint">Your team has no active players yet (unseeded league) — this custom player will be added to the roster as a brand-new player instead of replacing anyone.</p>}</>}
    <div className="custom-player-sticky"><span>CP remaining <b>{evaluation?.pointsRemaining ?? pkg.creationPoints}</b></span><div>{step > 1 && <Button variant="secondary" onClick={() => setStep(step - 1)}>Back</Button>}{step < WIZARD_STEPS ? <Button variant="primary" onClick={() => { if (step === detailsStep) { const problem = validatePlayerDetails(); if (problem) { setNotice(problem); return; } } if (step === positionStep && positionLocked && !replacementPlayerId) { setNotice("Select the active player this recruit replaces before continuing."); return; } if (step === 4) { if (!bodyBuildAllowed) { setNotice(`The ${identity.bodyType} build isn't available for ${position}.`); return; } if (!identity.cardRenderId) { setNotice("Select a card appearance before continuing."); return; } } setNotice(null); setStep(step + 1); }}>Continue</Button> :<Button variant="primary" disabled={busy || !evaluation?.valid || (config.replacementRequired && !replacementPlayerId) || !identity.cardRenderId} onClick={() => void submit()}>{busy ? "Submitting…" : `Purchase · ${pkg.coinPrice}`}</Button>}</div></div>{notice && <p>{notice}</p>}
    {ceilingBlock && (
      <Modal title={`${getRecAttributeDisplayName(ceilingBlock.attribute)} Ceiling Reached`} onClose={() => setCeilingBlock(null)}>
        <p>{ceilingBlock.message}</p>
        {ceilingBlock.deficientAttributes.length > 0 && (
          <table className="custom-player-ceiling-table">
            <thead><tr><th>Attribute</th><th>Current</th><th>Needs</th></tr></thead>
            <tbody>
              {ceilingBlock.deficientAttributes.map((entry) => (
                <tr key={entry.attribute}>
                  <td>{getRecAttributeDisplayName(entry.attribute)}</td>
                  <td>{entry.current}</td>
                  <td>{entry.required}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="form-hint">Raise those attributes first, then come back to push {getRecAttributeDisplayName(ceilingBlock.attribute)} higher.</p>
        <Button variant="primary" onClick={() => setCeilingBlock(null)}>Got it</Button>
      </Modal>
    )}
    {submitError && <ErrorPopup title="Purchase Failed" message={submitError} onClose={() => setSubmitError(null)} />}
  </div>;
}
