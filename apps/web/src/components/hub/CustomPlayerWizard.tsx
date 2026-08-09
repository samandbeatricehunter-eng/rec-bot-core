import { useEffect, useMemo, useState } from "react";
import { Dices } from "lucide-react";
import { CFB_27_TEAMS, MADDEN_ATTRIBUTE_SELECTION_GROUPS, REC_DEV_TRAITS, evaluateRecCustomPlayerBuild, getRecAttributeDisplayName, getRecEditableAttributes, getRecNetDevelopmentCost, type RecGameFamily, type RecPackageTier } from "@rec/shared";
import { recApi } from "../../lib/rec-api-client.js";
import { Button } from "../ui/Button.js";
import { CoinAmount } from "../ui/CoinAmount.js";

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
    } else setArchetype(value.archetypes?.QB?.[0]?.key ?? "");
    setHydrated(true);
  }).catch((error) => setNotice(error instanceof Error ? error.message : String(error))); return () => { active = false; }; }, [guildId]);
  useEffect(() => { if (!hydrated || !config) return; const timer = window.setTimeout(() => {
    void recApi.saveCustomPlayerDraft({ guildId, currentStep: `step_${step}`, packageTier: tier, position, archetypeKey: archetype, developmentTrait: devTrait, identity, attributes, replacementPlayerId }).catch(() => undefined);
  }, 600); return () => window.clearTimeout(timer); }, [hydrated, config, guildId, step, tier, position, archetype, devTrait, identity, attributes, replacementPlayerId]);
  const game = (config?.game ?? "CFB") as RecGameFamily; const pkg = config?.packages?.find((entry: any) => entry.tier === tier);
  const editable = useMemo(() => archetype ? getRecEditableAttributes(game, position, archetype) : [], [game, position, archetype]);
  const netDev = useMemo(() => { try { return getRecNetDevelopmentCost(game, tier, devTrait); } catch { return 0; } }, [game, tier, devTrait]);
  const evaluation = useMemo(() => { try { return archetype ? evaluateRecCustomPlayerBuild({ game, position, archetypeKey: archetype, packageTier: tier, attributes, netDevelopmentCost: netDev, mode: "preview" }) : null; } catch { return null; } }, [game, position, archetype, tier, attributes, netDev]);
  function setPositionAndReset(value: string) { setPosition(value); setAttributes({}); setArchetype(config.archetypes[value]?.[0]?.key ?? ""); }
  function mutate(code: string, delta: number) { setAttributes((current) => { const candidate = { ...current, [code]: Math.max(0, Math.min(99, (current[code] ?? 0) + delta)) }; try { const result = evaluateRecCustomPlayerBuild({ game, position, archetypeKey: archetype, packageTier: tier, attributes: candidate, netDevelopmentCost: netDev, mode: "preview" }); const blocking = result.violations.find((v) => v.code !== "ARCHETYPE_IDENTITY"); if (delta > 0 && blocking) { setNotice(blocking.message); return current; } } catch { return current; } setNotice(null); return candidate; }); }
  async function generateName() { const result = await recApi.generateCustomPlayerName(guildId, `${Date.now()}:${Math.random()}`); setIdentity((value: any) => ({ ...value, firstName: result.firstName, lastName: result.lastName })); }
  async function submit() { if (!evaluation) return; setBusy(true); setNotice(null); try { const result = await recApi.submitCustomPlayer({ guildId, idempotencyKey: crypto.randomUUID(), packageTier: tier, position, archetypeKey: archetype, developmentTrait: devTrait, attributes, replacementPlayerId: replacementPlayerId || null, identity: game === "CFB" ? { ...identity, college: undefined } : { ...identity, hometownCity: undefined, hometownState: undefined } }); setHydrated(false); setNotice(`Submitted. ${result.build.unused_cp_refund_coins} coins will be refunded after approval and application.`); onPurchased(); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  if (!config) return <p className="hub-empty">{notice ?? "Loading custom-player builder…"}</p>;
  if (!config.enabled) return <p className="hub-empty">Custom-player purchases are disabled.</p>;
  if (config.blockedNoEligibleReplacement) return <p className="hub-empty">Your roster has no recruits or manually-added players to replace yet. Add one via the Recruiting Board or the "Edit Roster" quick action on My Team first.</p>;
  return <div className="custom-player-wizard"><p className="hub-eyebrow">Step {step} of 5</p>
    {step === 1 && <><h4>Select Package</h4><div className="custom-player-package-grid">{config.packages.map((entry: any) => <button type="button" key={entry.key} className={tier === entry.tier ? "active" : ""} onClick={() => { setTier(entry.tier); setDevTrait(entry.tier >= 3 ? (game === "CFB" ? "impact" : "star") : "normal"); }}><strong>{entry.displayName}</strong><span><CoinAmount amount={entry.coinPrice}/> · {entry.creationPoints.toLocaleString()} CP</span><small>Target {entry.targetOvrMin}-{entry.targetOvrMax}; cap {entry.rawOvrCap}</small></button>)}</div><p>Wallet: <CoinAmount amount={config.walletBalance}/> · Used {config.seasonUsed}{config.seasonCap ? `/${config.seasonCap}` : ""}</p></>}
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
      return <><h4>Position, Archetype &amp; Development</h4><label>Position<select className="form-input" value={position} onChange={(e) => setPositionAndReset(e.target.value)}>{config.positions.map((value: string) => <option key={value}>{value}</option>)}</select></label><label>Archetype<select className="form-input" value={archetype} onChange={(e) => { setArchetype(e.target.value); setAttributes({}); }}>{config.archetypes[position].map((entry: any) => <option key={entry.key} value={entry.key}>{entry.name ?? entry.label ?? entry.key.replaceAll("_", " ")}</option>)}</select></label>
      {selectedArchetype && <p className="form-hint">{archetypeDescription(selectedArchetype)}</p>}
      <label>Development<select className="form-input" value={devTrait} onChange={(e) => setDevTrait(e.target.value)}>{(REC_DEV_TRAITS[game] as readonly any[]).map((entry) => <option key={entry.key} value={entry.key}>{entry.label} · {Math.max(0, entry.absoluteCost - pkg.includedDevCredit)} CP</option>)}</select></label></>;
    })()}
    {step === 4 && <><h4>Attribute Builder</h4>{groupEditableAttributes(editable).map((group) => <div key={group.label} className="custom-player-attribute-group"><h5>{group.label}</h5><div className="custom-player-attribute-list">{group.codes.map((code) => <div key={code}><span><strong>{getRecAttributeDisplayName(code)}</strong><small>{code.toUpperCase()}</small></span><button onClick={() => mutate(code,-1)}>−</button><input className="custom-player-attribute-input" type="number" min={0} max={99} value={attributes[code] ?? 0} onChange={(e) => mutate(code, Math.max(0, Math.min(99, Number(e.target.value) || 0)) - (attributes[code] ?? 0))}/><button onClick={() => mutate(code,1)}>+</button></div>)}</div></div>)}</>}
    {step === 5 && <><h4>Review</h4><p><strong>{identity.firstName} {identity.lastName}</strong> · {position} · {archetype.replaceAll("_"," ")}</p><p>{pkg.displayName} · <CoinAmount amount={pkg.coinPrice}/> · {evaluation?.displayOverall} OVR ({evaluation?.rawOverall} raw)</p><p className="form-hint"><strong>88 OVR maximum:</strong> if the applied player evaluates above 88 OVR, the commissioner must reduce ratings to reach the cap. Identity or rating edits are logged and sent to you; position, archetype, and development trait remain locked to this purchase.</p><p>{evaluation?.totalCost}/{evaluation?.creationPoints} CP · {evaluation?.pointsRemaining} unspent · <strong>{Math.ceil(((evaluation?.pointsRemaining ?? 0) * .5) / 15)} coin refund after application</strong></p>{config.replacementRequired ? <label>Replace active player<select className="form-input" value={replacementPlayerId} onChange={(e) => setReplacementPlayerId(e.target.value)}><option value="">Select player</option>{config.replacementPlayers.map((player: any) => <option key={player.id} value={player.id}>{player.full_name ?? `${player.first_name} ${player.last_name}`} · {player.position} · {player.overall_rating ?? "—"} OVR</option>)}</select></label> : <p className="form-hint">Your team has no active players yet (unseeded league) — this custom player will be added to the roster as a brand-new player instead of replacing anyone.</p>}</>}
    <div className="custom-player-sticky"><span>OVR <b>{evaluation?.displayOverall ?? 0}</b> · CP <b>{evaluation?.pointsRemaining ?? pkg.creationPoints}</b></span><div>{step > 1 && <Button variant="secondary" onClick={() => setStep(step - 1)}>Back</Button>}{step < 5 ? <Button variant="primary" onClick={() => setStep(step + 1)}>Continue</Button> : <Button variant="primary" disabled={busy || !evaluation?.valid || (config.replacementRequired && !replacementPlayerId)} onClick={() => void submit()}>{busy ? "Submitting…" : `Purchase · ${pkg.coinPrice}`}</Button>}</div></div>{notice && <p>{notice}</p>}
  </div>;
}
