// Rise to Immortality "Build Your Legacy" -- unified identity switcher (Pass 10) over the three
// Franchise Pillar / Progression Tree identities: Offense (QB), Defense (MIKE), and Owner
// (formerly its own /team/trust page -- see RiseTrustTree.tsx, now just a redirect here).
import { useCallback, useEffect, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import { siteApi, type ImmortalityProgressionState, type ImmortalityProgressionNode, type OwnerProgressionState } from "../lib/site-api.js";

type Side = "offense" | "defense";
type Identity = Side | "owner";
type SideState = ImmortalityProgressionState | null | undefined; // undefined = not loaded yet, null = no prospect on that side

export function RiseProgressionPage() {
  const { leagueId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const hubCtx = useHub();
  const selected = hubCtx.selectedLeague;
  const isRise = selected?.rosterType === "rise_to_immortality";
  const guildId = selected?.guildId ?? "";
  const unlocked = selected?.riseHubUnlocked === true;

  const rawIdentity = searchParams.get("identity");
  const identity: Identity = rawIdentity === "defense" || rawIdentity === "owner" ? rawIdentity : "offense";
  const setIdentity = (next: Identity) => setSearchParams(next === "offense" ? {} : { identity: next }, { replace: true });

  const [states, setStates] = useState<Record<Side, SideState>>({ offense: undefined, defense: undefined });
  const [ownerState, setOwnerState] = useState<OwnerProgressionState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadSide = useCallback(async (targetSide: Side) => {
    if (!guildId) return;
    try {
      const next = await siteApi.immortalityProgression({ guildId, side: targetSide });
      setStates((current) => ({ ...current, [targetSide]: next }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load the Progression Tree.";
      if (/prospect not found/i.test(message)) {
        setStates((current) => ({ ...current, [targetSide]: null }));
        return;
      }
      throw err;
    }
  }, [guildId]);

  const reloadOwner = useCallback(async () => {
    if (!guildId) return;
    try {
      const next = await siteApi.ownerProgression({ guildId });
      setOwnerState(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load the Franchise Pillar tree.";
      if (/owner profile not found/i.test(message)) { setOwnerState(null); return; }
      throw err;
    }
  }, [guildId]);

  useEffect(() => {
    if (leagueId) hubCtx.ensureLeagueScope(leagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    if (!guildId || !isRise) return;
    setError(null);
    setLoading(true);
    Promise.all([reloadSide("offense"), reloadSide("defense"), reloadOwner()])
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load Build Your Legacy."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, isRise]);

  if (selected && !isRise) return <Navigate replace to={`/l/${leagueId}/buzz`} />;
  if (selected && !unlocked) return <Navigate replace to={`/l/${leagueId}/rise`} />;
  if (!selected || !guildId) return <div className="site-page site-loading">Loading Build Your Legacy…</div>;

  const identityCards: Array<{ id: Identity; label: string; subtitle: string; state: SideState | OwnerProgressionState }> = [
    { id: "offense", label: states.offense ? states.offense.name : "Offense", subtitle: "The Signal Caller", state: states.offense },
    { id: "defense", label: states.defense ? states.defense.name : "Defense", subtitle: "The Backbone", state: states.defense },
    { id: "owner", label: ownerState ? ownerState.name : "Owner", subtitle: "The Owner's Box", state: ownerState },
  ];

  return (
    <div className="site-page rise-page">
      <header className="rise-hero">
        <p className="site-muted">My Team</p>
        <h1>Build Your Legacy</h1>
        <p className="site-muted">
          Three careers. One franchise. One legacy. Purchases apply immediately and your commissioner
          gets a record to confirm. Development-trait and ability changes are recorded for Madden --
          EA imports overwrite in-game state, so the commissioner still sets them in the save.
        </p>
      </header>

      {error ? <p className="site-auth-error">{error}</p> : null}

      {loading ? <p className="site-muted">Loading…</p> : (
        <div className="rise-identity-switcher">
          {identityCards.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`rise-identity-card ${identity === card.id ? "is-selected" : ""}`}
              disabled={card.state === null}
              onClick={() => setIdentity(card.id)}
            >
              <span className="rise-identity-card-label">{card.label}</span>
              <span className="site-muted">{card.subtitle}</span>
              {card.state === null ? <span className="site-muted">Not available yet</span> : null}
            </button>
          ))}
        </div>
      )}

      {loading ? null : identity === "owner" ? (
        ownerState === null ? <p className="site-muted">No owner profile found for you in this league yet.</p>
          : ownerState === undefined ? <p className="site-muted">Loading…</p>
            : <OwnerProgressionBody guildId={guildId} state={ownerState} reload={reloadOwner} />
      ) : (
        (() => {
          const state = states[identity];
          return state === null ? <p className="site-muted">No prospect on this side yet. Finish Origins first.</p>
            : state === undefined ? <p className="site-muted">Loading this player…</p>
              : <PlayerProgressionBody guildId={guildId} side={identity} state={state} reload={() => reloadSide(identity)} />;
        })()
      )}
    </div>
  );
}

function labelTrait(value: string): string {
  if (value === "xfactor") return "X-Factor";
  if (value === "superstar") return "Superstar";
  if (value === "star") return "Star";
  return "Normal";
}

function renderTreeNode(node: ImmortalityProgressionNode, onSelect: (key: string) => void) {
  return (
    <button
      key={node.key}
      type="button"
      className={["rise-tree-node", node.owned ? "is-owned" : node.canPurchase ? "is-available" : "is-locked"].filter(Boolean).join(" ")}
      onClick={() => onSelect(node.key)}
    >
      <span className="rise-tree-node-badge">{node.displayName.slice(0, 1)}</span>
      <span className="rise-tree-node-name">{node.displayName}</span>
      <span className="rise-tree-node-cost">{node.owned ? "Owned" : `${node.xpCost} XP`}</span>
    </button>
  );
}

// Node detail used to live inline below the tree (select a node, scroll down to see the detail
// panel and Buy button) -- on mobile, with a wide horizontally-scrolling tree, that meant a tap
// followed by a hunt for a panel that may not even be on screen. A modal keeps the breakdown,
// current XP balance, and purchase button right where the tap happened, on every viewport.
function TreeNodeModal({
  node, currentXp, busy, onBuy, onClose,
}: {
  node: ImmortalityProgressionNode;
  currentXp: number;
  busy: string | null;
  onBuy: (key: string, displayName: string, xpCost: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="site-modal" role="dialog" aria-modal="true" aria-labelledby="rise-tree-node-title">
      <div className="site-modal-panel rise-tree-node-modal">
        <button type="button" className="site-modal-close" aria-label="Close" onClick={onClose}>×</button>
        <h2 id="rise-tree-node-title">{node.displayName}</h2>
        <p className="site-muted">Tier {node.tier}{node.branch ? ` · ${node.branch.replaceAll("_", " ")}` : ""}</p>
        <p>{node.effect}</p>
        {node.blockedReason ? <p className="site-muted">{node.blockedReason}</p> : null}
        <div className="rise-tree-node-modal-balance">
          <span>Your balance</span>
          <strong>{currentXp} XP</strong>
        </div>
        <div className="site-modal-actions">
          {node.owned ? (
            <span className="rise-stock rise-stock-rising">Owned</span>
          ) : (
            <button type="button" className="site-btn site-btn-primary"
              disabled={busy !== null || !node.canPurchase}
              onClick={() => onBuy(node.key, node.displayName, node.xpCost)}>
              {busy === node.key ? "Buying…" : `Buy — ${node.xpCost} XP`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TreeGrid({
  nodes, tiers, currentXp, busy, onBuy,
}: {
  nodes: ImmortalityProgressionNode[];
  tiers: readonly number[];
  currentXp: number;
  busy: string | null;
  onBuy: (key: string, displayName: string, xpCost: number) => void;
}) {
  const [openNodeKey, setOpenNodeKey] = useState<string | null>(null);
  const openNode = nodes.find((node) => node.key === openNodeKey) ?? null;
  return (
    <>
      <div className="rise-tree">
        {tiers.map((tier) => {
          const tierNodes = nodes.filter((node) => node.tier === tier);
          if (!tierNodes.length) return null;
          const laneEntries = tierNodes.some((node) => node.branch)
            ? Object.entries(tierNodes.reduce<Record<string, typeof tierNodes>>((acc, node) => {
              const laneKey = node.branch ?? "General";
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
                        {laneNodes.map((node) => renderTreeNode(node, setOpenNodeKey))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rise-tree-row">{tierNodes.map((node) => renderTreeNode(node, setOpenNodeKey))}</div>
              )}
            </div>
          );
        })}
      </div>
      {openNode ? (
        <TreeNodeModal
          node={openNode}
          currentXp={currentXp}
          busy={busy}
          onBuy={(key, displayName, xpCost) => { onBuy(key, displayName, xpCost); setOpenNodeKey(null); }}
          onClose={() => setOpenNodeKey(null)}
        />
      ) : null}
    </>
  );
}

function PlayerProgressionBody({
  guildId, side, state, reload,
}: {
  guildId: string;
  side: Side;
  state: ImmortalityProgressionState;
  reload: () => Promise<void>;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [teammateId, setTeammateId] = useState(() => state.teammates[0]?.playerId ?? "");
  const teammate = state.teammates.find((row) => row.playerId === teammateId) ?? null;
  const tiers = [2, 3, 4] as const;

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

  return (
    <>
      {error ? <p className="site-auth-error">{error}</p> : null}
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
          A free path to your next Dev Trait ({labelTrait(state.currentDevTrait)}
          {state.nextDevTrait ? ` → ${labelTrait(state.nextDevTrait)}` : ""}) — no Player XP spent, separate from
          Self-Made/Development Staff below. It watches your recent weekly-challenge medals (not career
          milestones): gold is 3 points, silver 2, bronze 1. Get hot enough over a trailing stretch of recent
          weeks and you earn an <strong>opportunity</strong> — an elevated, much harder challenge assigned to
          your very next game. Beat that specific challenge and the promotion is earned; miss it and you keep
          your current trait, but can earn a fresh opportunity again later if you heat back up.
        </p>
        {state.promotionOpportunity ? (
          <p className="rise-stock rise-stock-rising" style={{ display: "inline-block" }}>
            Opportunity live — deliver in Week {state.promotionOpportunity.targetWeekNumber} to earn {labelTrait(state.promotionOpportunity.toTrait)}.
          </p>
        ) : null}
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
        <TreeGrid nodes={state.nodes} tiers={tiers} currentXp={state.playerXp} busy={busy} onBuy={buyPerk} />
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
  );
}

function OwnerProgressionBody({
  guildId, state, reload,
}: {
  guildId: string;
  state: OwnerProgressionState;
  reload: () => Promise<void>;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [investAmount, setInvestAmount] = useState("");
  const [coachTargetId, setCoachTargetId] = useState(() => state.eligibleAbilityCoachTargets[0]?.prospectId ?? "");
  const tiers = [2, 3, 4] as const;

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

  async function grantSlot() {
    if (!coachTargetId) return;
    setBusy("coach-grant"); setError(null); setResult(null);
    try {
      const response = await siteApi.ownerGrantAbilitySlot({ guildId, prospectId: coachTargetId });
      setResult(`Granted a bonus ability slot to ${response.prospectName}.`);
      setCoachTargetId("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not grant that slot.");
    } finally { setBusy(null); }
  }

  return (
    <>
      {error ? <p className="site-auth-error">{error}</p> : null}
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
        <p className="site-muted">Tap a node to see what it does. Three lanes -- Personnel Authority, Player Development, Organizational Influence -- converge on one shared capstone; four more mastery perks unlock past it.</p>
        <TreeGrid nodes={state.nodes} tiers={tiers} currentXp={state.ownerXp} busy={busy} onBuy={buyPerk} />
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

      {state.masterAbilityCoachUnlocked ? (
        <section className="rise-card">
          <h2>Master Ability Coach</h2>
          {state.abilityCoachUsedThisSeason ? (
            <p className="site-muted">Already used this season — a fresh grant is available again next season.</p>
          ) : state.eligibleAbilityCoachTargets.length ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select className="form-input" value={coachTargetId} onChange={(e) => setCoachTargetId(e.target.value)}>
                {state.eligibleAbilityCoachTargets.map((row) => (
                  <option key={row.prospectId} value={row.prospectId}>{row.name} ({row.devTrait === "xfactor" ? "X-Factor" : "Superstar"})</option>
                ))}
              </select>
              <button type="button" className="site-btn site-btn-primary" disabled={busy !== null || !coachTargetId}
                onClick={() => void grantSlot()}>
                {busy === "coach-grant" ? "Granting…" : "Grant Bonus Slot"}
              </button>
            </div>
          ) : (
            <p className="site-muted">No Superstar or X-Factor prospect on your team yet.</p>
          )}
        </section>
      ) : null}
      {result ? <p className="site-muted">{result}</p> : null}
    </>
  );
}
