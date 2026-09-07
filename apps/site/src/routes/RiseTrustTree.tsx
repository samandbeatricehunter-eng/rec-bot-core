// Rise to Immortality Pass 7: the Owner's Franchise Pillar tree. Functional first pass -- reuses
// the exact rise-tree-* CSS built for RiseProgression.tsx (QB/MIKE); Pass 10 gives this its own
// "Build Your Legacy" / Owner's Box visual treatment per the captured mockup.
import { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import { siteApi, type OwnerProgressionState, type ImmortalityProgressionNode } from "../lib/site-api.js";

export function RiseTrustTreePage() {
  const { leagueId = "" } = useParams();
  const hubCtx = useHub();
  const selected = hubCtx.selectedLeague;
  const isRise = selected?.rosterType === "rise_to_immortality";
  const guildId = selected?.guildId ?? "";
  const unlocked = selected?.riseHubUnlocked === true;

  const [state, setState] = useState<OwnerProgressionState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [investAmount, setInvestAmount] = useState("");

  const reload = useCallback(async () => {
    if (!guildId) return;
    try {
      const next = await siteApi.ownerProgression({ guildId });
      setState(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load the Franchise Pillar tree.";
      if (/owner profile not found/i.test(message)) { setState(null); return; }
      throw err;
    }
  }, [guildId]);

  useEffect(() => {
    if (leagueId) hubCtx.ensureLeagueScope(leagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    if (!guildId || !isRise) return;
    setError(null); setResult(null); setLoading(true);
    reload().catch((err) => setError(err instanceof Error ? err.message : "Could not load the Franchise Pillar tree.")).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, isRise]);

  if (selected && !isRise) return <Navigate replace to={`/l/${leagueId}/buzz`} />;
  if (selected && !unlocked) return <Navigate replace to={`/l/${leagueId}/rise`} />;
  if (!selected || !guildId) return <div className="site-page site-loading">Loading Franchise Pillar…</div>;

  const tiers = [2, 3, 4] as const;

  return (
    <div className="site-page rise-page">
      <header className="rise-hero">
        <p className="site-muted">Owner's Box</p>
        <h1>Franchise Pillar</h1>
        <p className="site-muted">
          Spend Owner XP (earned from wins and finished seasons) across three lanes -- Personnel
          Authority, Player Development, Organizational Influence -- converging on one shared
          capstone. Purchases apply immediately and your commissioner gets a record to confirm.
        </p>
      </header>

      {error ? <p className="site-auth-error">{error}</p> : null}

      {loading ? <p className="site-muted">Loading…</p> : !state ? (
        <p className="site-muted">No owner profile found for you in this league yet.</p>
      ) : (
        <>
          <section className="rise-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ margin: 0 }}>{state.name}</h2>
              <span style={{ fontSize: 24, fontWeight: 500 }}>{state.ownerXp} XP</span>
            </div>
            <p className="site-muted">
              Personnel Council: <strong>{state.personnelCouncilTier === 0 ? "Locked" : state.personnelCouncilTier === 1 ? "Tier 1 (restricted CPU trades)" : "Tier 2 (full CPU trades)"}</strong>
              {" · "}Release Authority: <strong>{state.releaseAuthorityUnlocked ? "Unlocked" : "Locked"}</strong>
            </p>
          </section>

          <section className="rise-card rise-tree-card">
            <h2>Franchise Pillar Tree</h2>
            <p className="site-muted">Tap a node to see what it does.</p>
            <div className="rise-tree">
              {tiers.map((tier) => {
                const nodes = state.nodes.filter((node) => node.tier === tier);
                if (!nodes.length) return null;
                const laneEntries = nodes.some((node) => node.branch)
                  ? Object.entries(nodes.reduce<Record<string, typeof nodes>>((acc, node) => {
                    const laneKey = node.branch ?? "Capstone";
                    (acc[laneKey] ??= []).push(node);
                    return acc;
                  }, {}))
                  : null;
                return (
                  <div key={tier} className="rise-tree-tier">
                    <div className="rise-tree-trunk-segment" />
                    <p className="rise-tree-tier-label">Tier {tier}</p>
                    {laneEntries ? (
                      <div className="rise-tree-lanes">
                        {laneEntries.map(([laneKey, laneNodes]) => (
                          <div key={laneKey} className="rise-tree-lane">
                            <p className="rise-tree-lane-label">{laneKey.replaceAll("_", " ")}</p>
                            <div className="rise-tree-row rise-tree-row-lane">
                              {laneNodes.map((node) => renderTreeNode(node))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rise-tree-row">{nodes.map((node) => renderTreeNode(node))}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {(() => {
              const detail = state.nodes.find((node) => node.key === selectedNodeKey) ?? null;
              if (!detail) return <p className="site-muted rise-tree-detail-hint">Select a node above for details.</p>;
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
            <h2>Franchise Investments</h2>
            {state.franchiseInvestmentsUnlocked ? (
              <>
                <p className="site-muted">
                  Invest Owner XP now; it matures one season later at a {Math.round((0.30 + state.investmentRoiBonus) * 100)}% return.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                  <input className="form-input" style={{ maxWidth: 140 }} type="number" min={1} value={investAmount}
                    onChange={(e) => setInvestAmount(e.target.value)} placeholder="Owner XP" />
                  <button type="button" className="site-btn site-btn-primary" disabled={busy !== null || !investAmount}
                    onClick={() => void invest()}>
                    {busy === "invest" ? "Investing…" : "Invest"}
                  </button>
                </div>
                {state.investments.length ? (
                  <ul className="site-muted" style={{ margin: 0, paddingLeft: 18 }}>
                    {state.investments.map((inv) => (
                      <li key={inv.id}>
                        {inv.xpInvested} XP invested in Season {inv.investedSeasonNumber} — {inv.status === "matured" ? "matured" : `matures Season ${inv.maturesSeasonNumber}`}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="site-muted">Buy Investment Office (Organizational Influence, Tier 2) to unlock Franchise Investments.</p>
            )}
          </section>
          {result ? <p className="site-muted">{result}</p> : null}
        </>
      )}
    </div>
  );

  function renderTreeNode(node: ImmortalityProgressionNode) {
    return (
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
    );
  }

  async function buyPerk(key: string, displayName: string, xpCost: number) {
    setBusy(key); setError(null); setResult(null);
    try {
      await siteApi.ownerPurchasePerk({ guildId, key });
      setResult(`Purchased ${displayName} for ${xpCost} Owner XP. Your commissioner has a pending record.`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not buy that perk.");
    } finally { setBusy(null); }
  }

  async function invest() {
    const amount = Math.floor(Number(investAmount));
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter a positive Owner XP amount."); return; }
    setBusy("invest"); setError(null); setResult(null);
    try {
      const response = await siteApi.ownerInvestFranchiseXp({ guildId, amount });
      setResult(`Invested ${response.invested} Owner XP — matures Season ${response.maturesSeasonNumber} at ${Math.round(response.roiRate * 100)}%.`);
      setInvestAmount("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not invest that amount.");
    } finally { setBusy(null); }
  }
}
