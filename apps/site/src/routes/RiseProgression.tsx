import { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import { siteApi, type ImmortalityProgressionState } from "../lib/site-api.js";

type Side = "offense" | "defense";
type SideState = ImmortalityProgressionState | null | undefined; // undefined = not loaded yet, null = no prospect on that side

export function RiseProgressionPage() {
  const { leagueId = "" } = useParams();
  const hubCtx = useHub();
  const selected = hubCtx.selectedLeague;
  const isRise = selected?.rosterType === "rise_to_immortality";
  const guildId = selected?.guildId ?? "";
  const unlocked = selected?.riseHubUnlocked === true;

  const [side, setSide] = useState<Side>("offense");
  const [states, setStates] = useState<Record<Side, SideState>>({ offense: undefined, defense: undefined });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [teammateId, setTeammateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);

  const reloadSide = useCallback(async (targetSide: Side) => {
    if (!guildId) return;
    try {
      const next = await siteApi.immortalityProgression({ guildId, side: targetSide });
      setStates((current) => ({ ...current, [targetSide]: next }));
      if (targetSide === side) {
        setTeammateId((current) => current && next.teammates.some((row) => row.playerId === current) ? current : (next.teammates[0]?.playerId ?? ""));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load the Progression Tree.";
      if (/prospect not found/i.test(message)) {
        setStates((current) => ({ ...current, [targetSide]: null }));
        return;
      }
      throw err;
    }
  }, [guildId, side]);

  useEffect(() => {
    if (leagueId) hubCtx.ensureLeagueScope(leagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    if (!guildId || !isRise) return;
    setError(null);
    setResult(null);
    setLoading(true);
    Promise.all([reloadSide("offense"), reloadSide("defense")])
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the Progression Tree."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, isRise]);

  if (selected && !isRise) return <Navigate replace to={`/l/${leagueId}/buzz`} />;
  if (selected && !unlocked) return <Navigate replace to={`/l/${leagueId}/rise`} />;
  if (!selected || !guildId) return <div className="site-page site-loading">Loading Progression Tree…</div>;

  const tiers = [2, 3] as const;
  const state = states[side];
  const teammate = state?.teammates.find((row) => row.playerId === teammateId) ?? null;
  const availableSides = (["offense", "defense"] as const).filter((value) => states[value]);

  return (
    <div className="site-page rise-page">
      <header className="rise-hero">
        <p className="site-muted">My Team</p>
        <h1>Progression Tree</h1>
        <p className="site-muted">
          Origins picks stay put. Spend Player XP here on later-career perks. Purchases apply immediately
          and your commissioner gets a record to confirm. Development-trait changes are recorded for Madden
          — EA imports overwrite in-game traits, so the commissioner still sets them in the save.
        </p>
      </header>

      {error ? <p className="site-auth-error">{error}</p> : null}

      {loading ? null : availableSides.length ? (
        <label className="form-field" style={{ maxWidth: 320 }}>
          <span className="form-label">Player</span>
          <select className="form-input" value={side} onChange={(event) => { setSide(event.target.value as Side); setSelectedNodeKey(null); }}>
            {availableSides.map((value) => (
              <option key={value} value={value}>{states[value]?.name} ({value === "offense" ? "Offense" : "Defense"})</option>
            ))}
          </select>
        </label>
      ) : null}

      {loading ? <p className="site-muted">Loading this player…</p> : !state ? <p className="site-muted">No prospect on this side yet. Finish Origins first.</p> : (
        <>
          <section className="rise-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ margin: 0 }}>{state.name}</h2>
              <span style={{ fontSize: 24, fontWeight: 500 }}>{state.playerXp} XP</span>
            </div>
            <p className="site-muted">
              Dev trait: <strong>{labelTrait(state.currentDevTrait)}</strong>
              {state.nextDevTrait ? ` → next ${labelTrait(state.nextDevTrait)}` : " (maxed)"}
              {state.tradeAccess ? " · Trade Center unlocked" : ""}
            </p>
            {state.origins.length ? (
              <p className="site-muted">Origins: {state.origins.map((row) => row.displayName).join(", ")}</p>
            ) : (
              <p className="site-muted">Finish Origins natural characteristics before the tree opens meaningful gates (Tier 2 needs two Tier 1 picks).</p>
            )}
          </section>

          <section className="rise-card">
            <h2>Season trend</h2>
            <p className="site-muted">
              A free, automatic path to your next Dev Trait ({labelTrait(state.currentDevTrait)}
              {state.nextDevTrait ? ` → ${labelTrait(state.nextDevTrait)}` : ""}) — no Player XP spent, separate from
              Self-Made/Development Staff above. It watches your recent weekly-challenge medals (not career
              milestones): gold is 3 points, silver 2, bronze 1. Get hot enough over a trailing stretch of
              recent weeks and the promotion fires on its own after the next advance. Only one automatic
              promotion can fire per season.
            </p>
            <p>
              {state.trend.medals.length
                ? state.trend.medals.map((medal, index) => (
                  <span key={`${medal}-${index}`} className={`rise-stock rise-stock-${medal === "gold" ? "rising" : medal === "none" ? "holding" : "new"}`} style={{ marginRight: 6 }}>
                    W{index + 1} {medal}
                  </span>
                ))
                : <span className="site-muted">No finished gameplay weeks yet this season.</span>}
            </p>
            <p className="site-muted">{state.trend.reason}</p>
          </section>

          <section className="rise-card rise-tree-card">
            <h2>Skill Tree</h2>
            <p className="site-muted">Tap a node to see what it does.</p>
            <div className="rise-tree">
              <div className="rise-tree-tier">
                <p className="rise-tree-tier-label">Tier 1 · Origins</p>
                <div className="rise-tree-row rise-tree-row-origins">
                  {state.origins.length ? state.origins.map((origin) => (
                    <div key={origin.key} className="rise-tree-node is-owned is-root" title={origin.effect}>
                      <span className="rise-tree-node-badge">{origin.displayName.slice(0, 1)}</span>
                      <span className="rise-tree-node-name">{origin.displayName}</span>
                    </div>
                  )) : (
                    <p className="site-muted">No Origins natural characteristics picked yet.</p>
                  )}
                </div>
              </div>

              {tiers.map((tier) => {
                const nodes = state.nodes.filter((node) => node.tier === tier);
                if (!nodes.length) return null;
                return (
                  <div key={tier} className="rise-tree-tier">
                    <div className="rise-tree-trunk-segment" />
                    <p className="rise-tree-tier-label">Tier {tier}</p>
                    <p className="rise-tree-tier-hint">
                      {tier === 2 ? "Requires two Origins (Tier 1) perks." : "Requires any Tier 2 perk."}
                    </p>
                    <div className="rise-tree-row">
                      {nodes.map((node) => (
                        <button
                          key={node.key}
                          type="button"
                          className={[
                            "rise-tree-node",
                            node.owned ? "is-owned" : node.canPurchase ? "is-available" : "is-locked",
                            selectedNodeKey === node.key ? "is-selected" : "",
                          ].filter(Boolean).join(" ")}
                          onClick={() => setSelectedNodeKey((current) => current === node.key ? null : node.key)}
                        >
                          <span className="rise-tree-node-badge">{node.displayName.slice(0, 1)}</span>
                          <span className="rise-tree-node-name">{node.displayName}</span>
                          <span className="rise-tree-node-cost">{node.owned ? "Owned" : `${node.xpCost} XP`}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {(() => {
              const detail = state.nodes.find((node) => node.key === selectedNodeKey) ?? null;
              if (!detail) return <p className="site-muted rise-tree-detail-hint">Select a Tier 2 or Tier 3 node above for details.</p>;
              return (
                <div className="rise-tree-detail">
                  <div className="rise-tree-detail-head">
                    <strong>{detail.displayName}</strong>
                    <span className={`rise-stock ${detail.owned ? "rise-stock-rising" : "rise-stock-holding"}`}>
                      {detail.owned ? "Owned" : `${detail.xpCost} XP`}
                    </span>
                  </div>
                  <p className="site-muted">{detail.effect}</p>
                  {detail.blockedReason ? <p className="site-muted">{detail.blockedReason}</p> : null}
                  {detail.owned ? null : (
                    <button type="button" className="site-btn site-btn-primary"
                      disabled={busy !== null || !detail.canPurchase}
                      onClick={() => void buyPerk(detail.key, detail.displayName, detail.xpCost)}>
                      {busy === detail.key ? "Buying…" : `Buy — ${detail.xpCost} XP`}
                    </button>
                  )}
                </div>
              );
            })()}
          </section>

          <section className="rise-card">
            <h2>Development trait</h2>
            {state.selfPurchaseUnlocked ? (
              <>
                <p className="site-muted">
                  Self-Made is owned. Force your next promotion for {state.selfPurchaseCost} Player XP
                  ({labelTrait(state.currentDevTrait)} → {state.nextDevTrait ? labelTrait(state.nextDevTrait) : "maxed"}).
                </p>
                <button type="button" className="site-btn site-btn-primary"
                  disabled={busy !== null || !state.nextDevTrait || state.playerXp < state.selfPurchaseCost}
                  onClick={() => void buyPromotion()}>
                  {busy === "self-promo" ? "Purchasing…" : `Promote yourself (${state.selfPurchaseCost} XP)`}
                </button>
              </>
            ) : (
              <p className="site-muted">Buy Self-Made (QB / MIKE, Tier 3) to purchase your own next development trait.</p>
            )}
            {state.teammatePurchaseUnlocked ? (
              <>
                <p className="site-muted" style={{ marginTop: 16 }}>
                  Development Staff is owned. Spend Player XP to promote a teammate one step. Same Madden-replication rule.
                </p>
                {state.teammates.length ? (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <select value={teammateId} onChange={(event) => setTeammateId(event.target.value)}>
                      {state.teammates.map((row) => (
                        <option key={row.playerId} value={row.playerId}>
                          {row.name} ({row.position}) · {labelTrait(row.currentDevTrait)}
                          {row.nextDevTrait ? ` → ${labelTrait(row.nextDevTrait)} (${row.cost} XP)` : " · maxed"}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="site-btn site-btn-primary"
                      disabled={busy !== null || !teammate?.nextDevTrait || !teammate || state.playerXp < teammate.cost}
                      onClick={() => void buyPromotion(teammateId)}>
                      {busy === "team-promo" ? "Purchasing…" : `Promote teammate${teammate ? ` (${teammate.cost} XP)` : ""}`}
                    </button>
                  </div>
                ) : (
                  <p className="site-muted">No teammates on this roster yet.</p>
                )}
              </>
            ) : (
              <p className="site-muted" style={{ marginTop: 12 }}>Buy Development Staff (HB / WR / TE / DB, Tier 3) to promote teammates.</p>
            )}
          </section>
          {result ? <p className="site-muted">{result}</p> : null}
        </>
      )}
    </div>
  );

  async function buyPerk(key: string, displayName: string, xpCost: number) {
    setBusy(key); setError(null); setResult(null);
    try {
      await siteApi.immortalityPurchasePerk({ guildId, side, key });
      setResult(`Purchased ${displayName} for ${xpCost} Player XP. Your commissioner has a pending record.`);
      await reloadSide(side);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not buy that perk.");
    } finally { setBusy(null); }
  }

  async function buyPromotion(teammatePlayerId?: string) {
    setBusy(teammatePlayerId ? "team-promo" : "self-promo"); setError(null); setResult(null);
    try {
      const response = await siteApi.immortalityPurchaseDevPromotion({ guildId, side, teammatePlayerId });
      setResult(`Recorded ${response.targetName}: ${response.fromTrait} → ${response.toTrait} for ${response.xpCost} Player XP. Set it in Madden, then mark Applied in game.`);
      await reloadSide(side);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not buy that promotion.");
    } finally { setBusy(null); }
  }
}

function labelTrait(value: string): string {
  if (value === "xfactor") return "X-Factor";
  if (value === "superstar") return "Superstar";
  if (value === "star") return "Star";
  return "Normal";
}
