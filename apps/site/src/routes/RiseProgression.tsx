import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import { siteApi, type ImmortalityProgressionState } from "../lib/site-api.js";

type Side = "offense" | "defense";

export function RiseProgressionPage() {
  const { leagueId = "" } = useParams();
  const hubCtx = useHub();
  const selected = hubCtx.selectedLeague;
  const isRise = selected?.rosterType === "rise_to_immortality";
  const guildId = selected?.guildId ?? "";
  const unlocked = selected?.riseHubUnlocked === true;

  const [side, setSide] = useState<Side>("offense");
  const [state, setState] = useState<ImmortalityProgressionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [teammateId, setTeammateId] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!guildId) return;
    setLoading(true);
    try {
      const next = await siteApi.immortalityProgression({ guildId, side });
      setState(next);
      setTeammateId((current) => current && next.teammates.some((row) => row.playerId === current) ? current : (next.teammates[0]?.playerId ?? ""));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load the Progression Tree.";
      if (/prospect not found/i.test(message)) {
        setState(null);
        return;
      }
      throw err;
    } finally {
      setLoading(false);
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
    reload().catch((err) => setError(err instanceof Error ? err.message : "Could not load the Progression Tree."));
  }, [guildId, isRise, reload]);

  if (selected && !isRise) return <Navigate replace to={`/l/${leagueId}/buzz`} />;
  if (selected && !unlocked) return <Navigate replace to={`/l/${leagueId}/rise`} />;
  if (!selected || !guildId) return <div className="site-page site-loading">Loading Progression Tree…</div>;

  const tiers = [2, 3, 4] as const;
  const teammate = state?.teammates.find((row) => row.playerId === teammateId) ?? null;

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

      <p>
        <Link to={`/l/${leagueId}/team/upgrades`}>Upgrades</Link>
        {" · "}
        <Link to={`/l/${leagueId}/rise`}>Origins</Link>
      </p>

      <div className="rise-side-tabs">
        {(["offense", "defense"] as const).map((value) => (
          <button key={value} type="button"
            className={`wizard-game-card ${side === value ? "wizard-game-card-active" : ""}`}
            onClick={() => setSide(value)}>
            {value === "offense" ? "Offense" : "Defense"}
          </button>
        ))}
      </div>

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
              Automatic promotions watch weekly-challenge medals this season — not career milestones.
              Gold is 3 points, silver 2, bronze 1. One automatic promotion per season.
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

          {tiers.map((tier) => {
            const nodes = state.nodes.filter((node) => node.tier === tier);
            if (!nodes.length) return null;
            return (
              <section key={tier} className="rise-card">
                <h2>Tier {tier}</h2>
                <p className="site-muted">
                  {tier === 2 ? "Requires two Origins (Tier 1) perks." : tier === 3 ? "Requires any Tier 2 perk." : "Requires any Tier 3 perk."}
                </p>
                <ul className="rise-ability-list">
                  {nodes.map((node) => (
                    <li key={node.key} className="rise-ability-item">
                      <div>
                        <strong>{node.displayName}</strong>
                        {" "}
                        <span className={`rise-stock ${node.owned ? "rise-stock-rising" : "rise-stock-holding"}`}>
                          {node.owned ? "Owned" : `${node.xpCost} XP`}
                        </span>
                        <p className="site-muted">{node.effect}</p>
                        {node.blockedReason ? <p className="site-muted">{node.blockedReason}</p> : null}
                      </div>
                      {node.owned ? null : (
                        <button type="button" className="site-btn site-btn-primary"
                          disabled={busy !== null || !node.canPurchase}
                          onClick={() => void buyPerk(node.key, node.displayName, node.xpCost)}>
                          {busy === node.key ? "Buying…" : "Buy"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

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
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not buy that perk.");
    } finally { setBusy(null); }
  }

  async function buyPromotion(teammatePlayerId?: string) {
    setBusy(teammatePlayerId ? "team-promo" : "self-promo"); setError(null); setResult(null);
    try {
      const response = await siteApi.immortalityPurchaseDevPromotion({ guildId, side, teammatePlayerId });
      setResult(`Recorded ${response.targetName}: ${response.fromTrait} → ${response.toTrait} for ${response.xpCost} Player XP. Set it in Madden, then mark Applied in game.`);
      await reload();
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
