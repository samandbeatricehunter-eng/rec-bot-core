import { useEffect, useMemo, useState } from "react";
import { Dices } from "lucide-react";
import { CFB_27_TEAMS, MADDEN_ATTRIBUTE_SELECTION_GROUPS, REC_ARCHETYPE_IDENTITY_FLOORS, REC_DEV_TRAITS, evaluateRecCustomPlayerBuild, getRecAttributeDisplayName, getRecEditableAttributes, getRecNetDevelopmentCost, type RecGameFamily, type RecPackageTier } from "@rec/shared";
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
  const editableUpper = new Set(editable.map((c) => c.toUpperCase()));
  const groups = Object.values(MADDEN_ATTRIBUTE_SELECTION_GROUPS).map((group) => ({
    label: group.label,
    codes: group.codes.filter((code) => editableUpper.has(code)).map((code) => code.toLowerCase()),
  })).filter((group) => group.codes.length > 0);
  const grouped = new Set(groups.flatMap((g) => g.codes));
  const leftover = editable.filter((code) => !grouped.has(code));
  return leftover.length ? [...groups, { label: "Other", codes: leftover }] : groups;
}

// Short, auto-generated blurb of what an archetype actually affects: its primary/secondary
// attributes cost more creation points to raise (per REC_ARCHETYPE_COST_MULTIPLIERS), so
// naming them tells the user exactly what this pick will make expensive vs. cheap to build.
function archetypeDescription(entry: any): string {
  const primary = (entry.primaryAttributes ?? []).map((c: string) => getRecAttributeDisplayName(c)).join(", ");
  const secondary = (entry.secondaryAttributes ?? []).map((c: string) => getRecAttributeDisplayName(c)).join(", ");
  if (!primary && !secondary) return "";
  return `Prioritizes ${primary}${secondary ? ` (and, to a lesser extent, ${secondary})` : ""} — these attributes cost more creation points to raise under this archetype than under others.`;
}

// Picking an archetype starts the build from that archetype's own identity floor (the same
// REC_ARCHETYPE_IDENTITY_FLOORS number evaluateRecArchetypeIdentity requires primary
// attributes to average at) instead of 0 — primary attributes start there, secondary a step
// below. The CP cost of those starting points is charged the same way any other point is
// (evaluateRecCustomPlayerBuild computes cost from the final attribute values, not from how
// the user got there), so pre-filling this is the "baseline costs CP" behavior with no
// changes needed to the shared cost/validation engine itself.
function baselineAttributesFor(entry: any, tier: RecPackageTier): Record<string, number> {
  const floor = REC_ARCHETYPE_IDENTITY_FLOORS[tier] ?? 50;
  const secondaryFloor = Math.max(0, floor - 15);
  const result: Record<string, number> = {};
  for (const code of entry.primaryAttributes ?? []) result[code] = floor;
  for (const code of entry.secondaryAttributes ?? []) result[code] = secondaryFloor;
  return result;
}

// "Determine archetype from custom build": the player starts every attribute at 0 and the
// user free-builds; whichever archetype's primary attributes best match the current build
// (highest average) is treated as the real archetype for cost/validation/OVR purposes and is
// what actually gets submitted.
const CUSTOM_BUILD_ARCHETYPE_KEY = "__custom_build__";
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

const EMPTY_IDENTITY = { firstName: "", lastName: "", jerseyNumber: 0, handedness: "right", heightInches: 72, weightLbs: 200, hometownCity: "", hometownState: "", college: "", bodyType: "standard" };

// Mirrors apps/api/src/modules/custom-players/custom-players.service.ts (CFB_POSITION_HEIGHT /
// CFB_BODY_TYPE_WEIGHT) — the server is authoritative, these are just client-side hints/limits.
const CFB_POSITION_HEIGHT: Record<string, { max: number; avg: number }> = {
  QB: { max: 77, avg: 75 }, HB: { max: 73, avg: 71 }, FB: { max: 73, avg: 71 }, WR: { max: 76, avg: 73 }, TE: { max: 78, avg: 77 },
  LT: { max: 79, avg: 77 }, LG: { max: 79, avg: 77 }, C: { max: 79, avg: 77 }, RG: { max: 79, avg: 77 }, RT: { max: 79, avg: 77 },
  LE: { max: 78, avg: 76 }, RE: { max: 78, avg: 76 }, DT: { max: 78, avg: 76 },
  LOLB: { max: 76, avg: 74 }, MLB: { max: 76, avg: 74 }, ROLB: { max: 76, avg: 74 },
  CB: { max: 74, avg: 71 }, FS: { max: 75, avg: 72 }, SS: { max: 75, avg: 72 },
};
const CFB_BODY_TYPE_WEIGHT: Record<string, { min: number; max: number }> = {
  standard: { min: 175, max: 230 }, thin: { min: 180, max: 236 }, heavy: { min: 280, max: 400 }, lean: { min: 160, max: 215 }, muscular: { min: 210, max: 285 },
};
function formatFeetInches(inches: number) { return `${Math.floor(inches / 12)}'${inches % 12}"`; }

export function CustomPlayerWizard({ guildId, onPurchased }: { guildId: string; onPurchased: () => void }) {
  const [config, setConfig] = useState<any>(null); const [step, setStep] = useState(1); const [tier, setTier] = useState<RecPackageTier>(1);
  const [position, setPosition] = useState("QB"); const [archetype, setArchetype] = useState(""); const [devTrait, setDevTrait] = useState("normal");
  const [identity, setIdentity] = useState<any>(EMPTY_IDENTITY); const [attributes, setAttributes] = useState<Record<string, number>>({}); const [replacementPlayerId, setReplacementPlayerId] = useState("");
  const [notice, setNotice] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [hydrated, setHydrated] = useState(false);
  const [ceilingBlock, setCeilingBlock] = useState<{ attribute: string; message: string; deficientAttributes: Array<{ attribute: string; current: number; required: number }> } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  useEffect(() => { let active = true; Promise.all([recApi.getCustomPlayerConfig(guildId), recApi.getCustomPlayerDraft(guildId)]).then(([value, saved]) => {
    if (!active) return;
    setConfig(value); const draft = saved.draft;
    if (draft) {
      const savedIdentity = draft.identity ?? {};
      setStep(Math.max(1, Math.min(5, Number(String(draft.current_step ?? "1").replace("step_", "")) || 1)));
      setTier((draft.package_tier ?? 1) as RecPackageTier); setPosition(draft.position ?? "QB");
      setArchetype(draft.archetype_key ?? value.archetypes?.[draft.position ?? "QB"]?.[0]?.key ?? ""); setDevTrait(draft.development_trait ?? "normal");
      setIdentity({ ...EMPTY_IDENTITY, ...savedIdentity, replacementPlayerId: undefined }); setReplacementPlayerId(savedIdentity.replacementPlayerId ?? ""); setAttributes(draft.attributes ?? {});
      setNotice("Your saved custom-player draft was restored.");
    } else {
      const entry = value.archetypes?.QB?.[0];
      setArchetype(entry?.key ?? "");
      if (entry) setAttributes(baselineAttributesFor(entry, 1));
    }
    setHydrated(true);
  }).catch((error) => setNotice(error instanceof Error ? error.message : String(error))); return () => { active = false; }; }, [guildId]);
  useEffect(() => { if (!hydrated || !config) return; const timer = window.setTimeout(() => {
    void recApi.saveCustomPlayerDraft({ guildId, currentStep: `step_${step}`, packageTier: tier, position, archetypeKey: archetype, developmentTrait: devTrait, identity, attributes, replacementPlayerId }).catch(() => undefined);
  }, 600); return () => window.clearTimeout(timer); }, [hydrated, config, guildId, step, tier, position, archetype, devTrait, identity, attributes, replacementPlayerId]);
  const game = (config?.game ?? "CFB") as RecGameFamily; const pkg = config?.packages?.find((entry: any) => entry.tier === tier);
  const isCustomBuildMode = archetype === CUSTOM_BUILD_ARCHETYPE_KEY;
  const detectedArchetypeKey = useMemo(
    () => isCustomBuildMode && config ? detectBestArchetypeKey(config.archetypes[position] ?? [], attributes) : "",
    [isCustomBuildMode, config, position, attributes],
  );
  const effectiveArchetypeKey = isCustomBuildMode ? detectedArchetypeKey : archetype;
  const editable = useMemo(() => effectiveArchetypeKey ? getRecEditableAttributes(game, position, effectiveArchetypeKey) : [], [game, position, effectiveArchetypeKey]);
  // CFB dev trait is inherited from the replaced player, not purchased — no CP cost for it.
  const netDev = useMemo(() => { if (game === "CFB") return 0; try { return getRecNetDevelopmentCost(game, tier, devTrait); } catch { return 0; } }, [game, tier, devTrait]);
  const evaluation = useMemo(() => { try { return effectiveArchetypeKey ? evaluateRecCustomPlayerBuild({ game, position, archetypeKey: effectiveArchetypeKey, packageTier: tier, attributes, netDevelopmentCost: netDev, mode: "preview" }) : null; } catch { return null; } }, [game, position, effectiveArchetypeKey, tier, attributes, netDev]);
  function setPositionAndReset(value: string) {
    setPosition(value);
    const entry = config.archetypes[value]?.[0];
    setArchetype(entry?.key ?? "");
    setAttributes(entry ? baselineAttributesFor(entry, tier) : {});
  }
  function selectArchetype(value: string) {
    setArchetype(value);
    if (value === CUSTOM_BUILD_ARCHETYPE_KEY) { setAttributes({}); return; }
    const entry = config.archetypes[position]?.find((e: any) => e.key === value);
    setAttributes(entry ? baselineAttributesFor(entry, tier) : {});
  }
  function mutate(code: string, delta: number) {
    const current = attributes;
    const candidate = { ...current, [code]: Math.max(0, Math.min(99, (current[code] ?? 0) + delta)) };
    if (delta > 0) {
      try {
        const key = isCustomBuildMode ? detectBestArchetypeKey(config.archetypes[position] ?? [], candidate) : effectiveArchetypeKey;
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
      if (!identity.hometownCity?.trim()) return "Hometown is required.";
      if (!identity.hometownState?.trim()) return "State is required.";
      const heightRule = CFB_POSITION_HEIGHT[position.toUpperCase()];
      const heightMax = heightRule?.max ?? 84;
      if (!Number.isInteger(identity.heightInches) || identity.heightInches < 65 || identity.heightInches > heightMax) return `Height for ${position} must be between 5'5" and ${formatFeetInches(heightMax)}.`;
      const weightRule = CFB_BODY_TYPE_WEIGHT[identity.bodyType] ?? CFB_BODY_TYPE_WEIGHT.standard;
      if (!Number.isInteger(identity.weightLbs) || identity.weightLbs < weightRule.min || identity.weightLbs > weightRule.max) return `Weight for the ${identity.bodyType} body type must be between ${weightRule.min} and ${weightRule.max} pounds.`;
    } else {
      if (!identity.college?.trim()) return "College is required.";
      if (!Number.isInteger(identity.heightInches) || identity.heightInches < 60 || identity.heightInches > 84) return "Height must be between 5'0\" and 7'0\".";
      if (!Number.isInteger(identity.weightLbs) || identity.weightLbs < 140 || identity.weightLbs > 400) return "Weight must be between 140 and 400 pounds.";
    }
    return null;
  }
  async function generateName() { const result = await recApi.generateCustomPlayerName(guildId, `${Date.now()}:${Math.random()}`); setIdentity((value: any) => ({ ...value, firstName: result.firstName, lastName: result.lastName })); }
  async function submit() { if (!evaluation || !effectiveArchetypeKey) return; setBusy(true); setNotice(null); try { const result = await recApi.submitCustomPlayer({ guildId, idempotencyKey: crypto.randomUUID(), packageTier: tier, position, archetypeKey: effectiveArchetypeKey, developmentTrait: devTrait, attributes, replacementPlayerId: replacementPlayerId || null, identity: game === "CFB" ? { ...identity, college: undefined } : { ...identity, hometownCity: undefined, hometownState: undefined } }); setHydrated(false); setNotice(`Submitted. ${result.build.unused_cp_refund_coins} coins will be refunded after approval and application.`); onPurchased(); } catch (error) { setSubmitError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  if (!config) return <p className="hub-empty">{notice ?? "Loading custom-player builder…"}</p>;
  if (!config.enabled) return <p className="hub-empty">Custom-player purchases are disabled.</p>;
  if (config.blockedNoEligibleReplacement) return <p className="hub-empty">Your roster has no recruits or manually-added players to replace yet. Add one via the Recruiting Board or the "Edit Roster" quick action on My Team first.</p>;
  return <div className="custom-player-wizard"><p className="hub-eyebrow">Step {step} of 5</p>
    {config.devTraitInherited && <p className="form-hint">CFB recruits don't get a purchased development trait — whichever trait the player you replace already has carries over to this one. With no replacement (an unseeded roster), the new player starts at Normal.</p>}
    {step === 1 && <><h4>Select Package</h4><div className="custom-player-package-grid">{config.packages.map((entry: any) => <button type="button" key={entry.key} className={tier === entry.tier ? "active" : ""} onClick={() => { setTier(entry.tier); setDevTrait(entry.tier >= 3 ? (game === "CFB" ? "impact" : "star") : "normal"); if (!isCustomBuildMode) { const archEntry = config.archetypes[position]?.find((e: any) => e.key === archetype); if (archEntry) setAttributes(baselineAttributesFor(archEntry, entry.tier)); } }}><strong>{entry.displayName}</strong><span><CoinAmount amount={entry.coinPrice}/> · {entry.creationPoints.toLocaleString()} CP</span><small>Target {entry.targetOvrMin}-{entry.targetOvrMax}; cap {entry.rawOvrCap}</small></button>)}</div><p>Wallet: <CoinAmount amount={config.walletBalance}/> · Used {config.seasonUsed}{config.seasonCap ? `/${config.seasonCap}` : ""}</p></>}
    {step === 2 && (() => {
      const heightRule = game === "CFB" ? (CFB_POSITION_HEIGHT[position.toUpperCase()] ?? { max: 84, avg: 72 }) : null;
      const weightRule = game === "CFB" ? (CFB_BODY_TYPE_WEIGHT[identity.bodyType] ?? CFB_BODY_TYPE_WEIGHT.standard) : null;
      const overageInches = heightRule ? Math.max(0, identity.heightInches - heightRule.avg) : 0;
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
        {game === "CFB" && <label>Body Type<select className="form-input" value={identity.bodyType} onChange={(e) => setIdentity({ ...identity, bodyType: e.target.value })}>{Object.keys(CFB_BODY_TYPE_WEIGHT).map((key) => <option key={key} value={key}>{key[0].toUpperCase() + key.slice(1)}</option>)}</select></label>}
        <label>Weight (lb){weightRule ? ` — ${weightRule.min}-${weightRule.max}` : ""}<input className="form-input" type="number" min={weightRule?.min} max={weightRule?.max} value={identity.weightLbs} onChange={(e) => setIdentity({ ...identity, weightLbs: Number(e.target.value) })}/></label>
        {game === "CFB" ? <><label>Hometown<input className="form-input" value={identity.hometownCity} onChange={(e) => setIdentity({ ...identity, hometownCity: e.target.value })}/></label><label>State<input className="form-input" value={identity.hometownState} onChange={(e) => setIdentity({ ...identity, hometownState: e.target.value })}/></label></> : <label>College<select className="form-input" value={identity.college} onChange={(e) => setIdentity({ ...identity, college: e.target.value })}><option value="">Select college</option>{CFB_COLLEGE_OPTIONS.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}</div>
        {overageInches > 0 && <p className="form-hint">Height is {overageInches}" over the {position} average — costs {overageInches * 100} creation points.</p>}
        <p className="form-hint">{config.contractNotice}</p></>;
    })()}
    {step === 3 && (() => {
      const selectedArchetype = config.archetypes[position].find((entry: any) => entry.key === archetype);
      const detectedArchetype = isCustomBuildMode ? config.archetypes[position].find((entry: any) => entry.key === detectedArchetypeKey) : null;
      return <><h4>Position, Archetype &amp; Development</h4><label>Position<select className="form-input" value={position} onChange={(e) => setPositionAndReset(e.target.value)}>{config.positions.map((value: string) => <option key={value}>{value}</option>)}</select></label><label>Archetype<select className="form-input" value={archetype} onChange={(e) => selectArchetype(e.target.value)}>{config.archetypes[position].map((entry: any) => <option key={entry.key} value={entry.key}>{entry.name ?? entry.label ?? entry.key.replaceAll("_", " ")}</option>)}<option value={CUSTOM_BUILD_ARCHETYPE_KEY}>Determine archetype from custom build</option></select></label>
      {selectedArchetype && <p className="form-hint">Starts every primary/secondary attribute at this archetype's baseline (a {REC_ARCHETYPE_IDENTITY_FLOORS[tier] ?? 50} average is required) — that baseline is deducted from your CP budget. {archetypeDescription(selectedArchetype)}</p>}
      {isCustomBuildMode && <p className="form-hint">Every attribute starts at 0 — build freely, and the archetype that best matches your build (currently <strong>{detectedArchetype?.name ?? detectedArchetype?.label ?? detectedArchetypeKey.replaceAll("_", " ") ?? "none yet"}</strong>) is what actually gets submitted.</p>}
      {config.devTraitInherited ? (
        <p className="form-hint">Development trait: inherited from the player this replaces (choose your replacement in the next step).</p>
      ) : (
        <label>Development<select className="form-input" value={devTrait} onChange={(e) => setDevTrait(e.target.value)}>{(REC_DEV_TRAITS[game] as readonly any[]).map((entry) => <option key={entry.key} value={entry.key}>{entry.label} · {Math.max(0, entry.absoluteCost - pkg.includedDevCredit)} CP</option>)}</select></label>
      )}</>;
    })()}
    {step === 4 && <><h4>Attribute Builder</h4>{groupEditableAttributes(editable).map((group) => <div key={group.label} className="custom-player-attribute-group"><h5>{group.label}</h5><div className="custom-player-attribute-list">{group.codes.map((code) => <div key={code}><span><strong>{getRecAttributeDisplayName(code)}</strong><small>{code.toUpperCase()}</small></span><button onClick={() => mutate(code,-1)}>−</button><input className="custom-player-attribute-input" type="number" min={0} max={99} value={attributes[code] ?? 0} onChange={(e) => mutate(code, Math.max(0, Math.min(99, Number(e.target.value) || 0)) - (attributes[code] ?? 0))}/><button onClick={() => mutate(code,1)}>+</button></div>)}</div></div>)}</>}
    {step === 5 && <><h4>Review</h4><p><strong>{identity.firstName} {identity.lastName}</strong> · {position} · {effectiveArchetypeKey.replaceAll("_"," ")}{isCustomBuildMode ? " (detected)" : ""}</p><p>{pkg.displayName} · <CoinAmount amount={pkg.coinPrice}/> · {evaluation?.displayOverall} OVR ({evaluation?.rawOverall} raw)</p><p className="form-hint"><strong>88 OVR maximum:</strong> if the applied player evaluates above 88 OVR, the commissioner must reduce ratings to reach the cap. Identity or rating edits are logged and sent to you; position, archetype, and development trait remain locked to this purchase.</p><p>{evaluation?.totalCost}/{evaluation?.creationPoints} CP · {evaluation?.pointsRemaining} unspent · <strong>{Math.ceil(((evaluation?.pointsRemaining ?? 0) * .5) / 15)} coin refund after application</strong></p>{config.replacementRequired ? <label>Replace active player ({position})<select className="form-input" value={replacementPlayerId} onChange={(e) => setReplacementPlayerId(e.target.value)}><option value="">Select player</option>{config.replacementPlayers.filter((player: any) => player.position === position).map((player: any) => <option key={player.id} value={player.id}>{player.full_name ?? `${player.first_name} ${player.last_name}`} · {player.position} · {player.overall_rating ?? "—"} OVR</option>)}</select></label> : <p className="form-hint">Your team has no active players yet (unseeded league) — this custom player will be added to the roster as a brand-new player instead of replacing anyone.</p>}</>}
    <div className="custom-player-sticky"><span>OVR <b>{evaluation?.displayOverall ?? 0}</b> · CP <b>{evaluation?.pointsRemaining ?? pkg.creationPoints}</b></span><div>{step > 1 && <Button variant="secondary" onClick={() => setStep(step - 1)}>Back</Button>}{step < 5 ? <Button variant="primary" onClick={() => { if (step === 2) { const problem = validatePlayerDetails(); if (problem) { setNotice(problem); return; } } setNotice(null); setStep(step + 1); }}>Continue</Button> : <Button variant="primary" disabled={busy || !evaluation?.valid || (config.replacementRequired && !replacementPlayerId)} onClick={() => void submit()}>{busy ? "Submitting…" : `Purchase · ${pkg.coinPrice}`}</Button>}</div></div>{notice && <p>{notice}</p>}
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
