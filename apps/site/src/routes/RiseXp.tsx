import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { MADDEN_ATTRIBUTE_DEFINITIONS, xpCostForPlusOne } from "@rec/shared";
import { useHub } from "../lib/hub-context.js";
import { siteApi, type ImmortalityAbilityCard, type ImmortalityAbilityState, type ImmortalityHubResponse } from "../lib/site-api.js";

type Side = "offense" | "defense";

/** Client-side preview only (undiscounted ramp) -- equipped-characteristic discounts and the
 * dev-trait OVR ceiling are re-checked server-side at submit time, which is authoritative on the
 * real amount charged. Close enough for a live running total while dragging. */
function previewCost(current: number, target: number): number {
  let cost = 0;
  let value = current;
  while (value < target) { cost += xpCostForPlusOne(value); value += 1; }
  return cost;
}

export function RiseXpPage() {
  const { leagueId = "" } = useParams();
  const hubCtx = useHub();
  const selected = hubCtx.selectedLeague;
  const isRise = selected?.rosterType === "rise_to_immortality";
  const guildId = selected?.guildId ?? "";
  const unlocked = selected?.riseHubUnlocked === true;

  const [hub, setHub] = useState<ImmortalityHubResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<Side>("offense");
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [result, setResult] = useState<string | null>(null);

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
    setError(null);
    reload().catch((err) => setError(err instanceof Error ? err.message : "Could not load Upgrades."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, isRise]);

  const prospect = hub?.prospects.find((row) => String(row.side ?? "") === side) ?? null;
  const prospectId = prospect ? String(prospect.id ?? "") : "";
  const xp = prospectId && hub?.xp ? hub.xp[prospectId] : { playerXp: 0, teamXp: 0 };
  const build = hub?.builds?.find((row) => String(row.prospect_id ?? "") === prospectId) ?? null;
  const attributes = (build?.final_attributes ?? {}) as Record<string, number>;
  const position = side === "offense" ? hub?.league.offensePosition : hub?.league.defensePosition;
  const sideCategory = side === "offense" ? "offensive" : "defensive";

  useEffect(() => { setTargets({}); setResult(null); }, [side, prospectId]);

  const availableAttributes = useMemo(
    () => MADDEN_ATTRIBUTE_DEFINITIONS.filter((def) => def.category === "physical" || def.category === sideCategory),
    [sideCategory],
  );

  const rows = availableAttributes.map((def) => {
    const base = attributes[def.code] ?? 0;
    const target = targets[def.code] ?? base;
    const cost = previewCost(base, target);
    return { def, base, target, cost };
  });
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  const playerXp = xp?.playerXp ?? 0;
  const overBudget = totalCost > playerXp;
  const changedCount = rows.filter((row) => row.target > row.base).length;

  if (selected && !isRise) return <Navigate replace to={`/l/${leagueId}/buzz`} />;
  if (selected && !unlocked) return <Navigate replace to={`/l/${leagueId}/rise`} />;
  if (!selected || !guildId) return <div className="site-page site-loading">Loading Upgrades…</div>;

  return (
    <div className="site-page rise-page">
      <header className="rise-hero">
        <p className="site-muted">My Team</p>
        <h1>Upgrades</h1>
        <p className="site-muted">
          Store purchases stay off. Drag a rating up to spend Player XP on your {position ?? "cornerstone"}, then submit
          the whole batch at once — it applies right away and your commissioner gets a record to confirm.
          Madden 27 abilities are a performance bonus — Gold weeks, season milestones, and awards grant slots.
        </p>
      </header>

      {error ? <p className="site-auth-error">{error}</p> : null}

      <p>
        <Link to={`/l/${leagueId}/rise`}>Back to Origins</Link> · <Link to={`/l/${leagueId}/team/rivals`}>Rivals</Link> · <Link to={`/l/${leagueId}/team/progression`}>Progression Tree</Link>
      </p>

      <div className="rise-side-tabs">
        {(["offense", "defense"] as const).map((value) => (
          <button key={value} type="button"
            className={`wizard-game-card ${side === value ? "wizard-game-card-active" : ""}`}
            onClick={() => setSide(value)}>
            {value === "offense" ? `Offense (${hub?.league.offensePosition ?? "—"})` : `Defense (${hub?.league.defensePosition ?? "—"})`}
          </button>
        ))}
      </div>

      <section className="rise-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{prospect ? `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Prospect" : "No prospect yet"}</h2>
          <span style={{ fontSize: 24, fontWeight: 500 }}>{playerXp} XP</span>
        </div>
        <p className="site-muted">Team XP: <strong>{xp?.teamXp ?? 0}</strong> · Estimated OVR: <strong>{String(build?.estimated_ovr ?? "—")}</strong></p>
        {!prospect ? (
          <p className="site-muted">Finish Origins before spending Player XP.</p>
        ) : (
          <>
            <div className="rise-attribute-list">
              {rows.map(({ def, base, target, cost }) => {
                const fillPct = Math.max(0, Math.min(100, (target / 99) * 100));
                return (
                  <div key={def.code} className="rise-attr-row">
                    <span className="rise-attr-label"><span className="rise-attr-code">{def.code}</span> {def.name}</span>
                    <div className="rise-attr-slider-wrap">
                      <div className="rise-attr-track-gradient" />
                      <div className="rise-attr-track-mask" style={{ width: `${100 - fillPct}%` }} />
                      <input
                        type="range" className="rise-attr-range"
                        min={base} max={99} step={1} value={target}
                        aria-label={`${def.name}, currently ${base}, target ${target}`}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setTargets((prev) => next === base
                            ? Object.fromEntries(Object.entries(prev).filter(([code]) => code !== def.code))
                            : { ...prev, [def.code]: next });
                        }}
                      />
                    </div>
                    <span className="rise-attr-value">{target > base ? `${base} → ${target}` : base}</span>
                    <span className="site-muted" style={{ fontSize: 12, minWidth: 48, textAlign: "right" }}>{cost > 0 ? `~${cost} XP` : "—"}</span>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "0.5px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
              <span className="site-muted" style={{ color: overBudget ? "var(--error, #c0392b)" : undefined }}>
                ~{totalCost} XP of {playerXp} available{overBudget ? " — over budget, lower a rating first" : ""}
              </span>
              <button type="button" className="site-btn site-btn-primary" disabled={busy || !changedCount || overBudget}
                onClick={async () => {
                  setBusy(true); setError(null); setResult(null);
                  try {
                    const cleaned = Object.fromEntries(rows.filter((row) => row.target > row.base).map((row) => [row.def.code, row.target]));
                    const response = await siteApi.immortalitySubmitUpgrades({ guildId, side, targets: cleaned });
                    setResult(`Applied ${response.upgrades.length} upgrade${response.upgrades.length === 1 ? "" : "s"} for ${response.totalXpCost} Player XP. Your commissioner has a pending record to confirm it's in Madden.`);
                    setTargets({});
                    await reload();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not submit those upgrades.");
                  } finally { setBusy(false); }
                }}>
                {busy ? "Submitting…" : `Submit upgrades${changedCount ? ` (${changedCount})` : ""}`}
              </button>
            </div>
            {result ? <p className="site-muted">{result}</p> : null}
          </>
        )}
      </section>

      {prospectId ? (
        <AbilityPanel
          guildId={guildId}
          side={side}
          state={hub?.abilities?.[prospectId] ?? null}
          setError={setError}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

function AbilityPanel({
  guildId, side, state, setError, onSaved,
}: {
  guildId: string;
  side: Side;
  state: ImmortalityAbilityState | null;
  setError: (value: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const equipped = state?.equipped ?? [];
  const eligible = state?.eligible ?? [];
  const ready = eligible.filter((row) => row.selectable);
  const locked = eligible.filter((row) => !row.selectable && !equipped.some((item) => item.id === row.id));
  const ovr = state?.estimatedOvr ?? 0;
  const archetype = state?.archetype ?? "your playstyle";

  async function select(row: ImmortalityAbilityCard) {
    setBusy(row.id); setError(null);
    try {
      await siteApi.immortalitySelectAbility({ guildId, side, abilityId: row.id });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not equip that ability.");
    } finally { setBusy(null); }
  }

  async function remove(row: ImmortalityAbilityCard) {
    setBusy(row.id); setError(null);
    try {
      await siteApi.immortalityRemoveAbility({ guildId, side, abilityId: row.id });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that ability.");
    } finally { setBusy(null); }
  }

  return (
    <section className="rise-card">
      <h2>Abilities</h2>
      <p className="site-muted">
        Assign up to {state?.maxEquipped ?? 4} Madden 27 abilities once this player's OVR and playstyle meet the franchise floor.
        REC only chooses which ability is on the card — Madden still sets Bronze/Silver/Gold from in-game ratings.
        Current build: {ovr || "—"} OVR · {archetype}.
      </p>
      <h3>Assigned</h3>
      {!equipped.length ? <p className="site-muted">None yet. Raise OVR with Player XP or pick abilities that match this playstyle.</p> : (
        <ul className="rise-ability-list">
          {equipped.map((row) => (
            <li key={row.id} className="rise-ability-item">
              <div>
                <strong>{row.name}</strong> <span className={`rise-stock rise-stock-${row.kind === "xfactor" ? "rising" : "holding"}`}>{row.kind}</span>
                <p className="site-muted">{row.description}</p>
                <p className="site-muted">
                  {row.ovrMin ? `${row.ovrMin}+ OVR` : "OVR floor"}
                  {row.maddenArchetype ? ` · ${row.maddenArchetype}` : ""}
                  {row.upgradesWith?.primary ? ` · Madden upgrades with ${row.upgradesWith.primary}` : ""}
                </p>
              </div>
              <button type="button" className="site-btn site-btn-ghost" disabled={busy === row.id} onClick={() => void remove(row)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <h3>Ready to assign</h3>
      {!ready.length ? <p className="site-muted">No abilities currently meet this player's OVR and playstyle.</p> : (
        <ul className="rise-ability-list">
          {ready.map((row) => (
            <li key={row.id} className="rise-ability-item">
              <div>
                <strong>{row.name}</strong> <span className="rise-stock rise-stock-new">{row.ovrMin ? `${row.ovrMin}+ OVR` : "ready"}</span>
                <p className="site-muted">{row.description}</p>
                {row.maddenArchetype ? <p className="site-muted">{row.maddenArchetype}{row.upgradesWith?.primary ? ` · upgrades with ${row.upgradesWith.primary}` : ""}</p> : null}
              </div>
              <button type="button" className="site-btn site-btn-primary" disabled={busy === row.id} onClick={() => void select(row)}>Assign</button>
            </li>
          ))}
        </ul>
      )}
      <h3>Locked</h3>
      <ul className="rise-ability-list rise-ability-locked">
        {locked.slice(0, 12).map((row) => (
          <li key={row.id} className="rise-ability-item">
            <div>
              <strong>{row.name}</strong>
              <p className="site-muted">{row.blockedReason ?? "Not available yet."}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
