import { useEffect, useMemo, useState } from "react";
// Legend attributes are stored under full display names (e.g. "Throwing Power"), not the
// 3-letter Madden codes MADDEN_ATTRIBUTE_DEFINITIONS uses — so the detail modal groups them
// by keyword match against this list rather than reusing that lookup.
const LEGEND_ATTRIBUTE_CATEGORIES: Array<{ label: string; keywords: string[] }> = [
  { label: "Physical", keywords: ["Speed", "Acceleration", "Agility", "Change of Direction", "Strength", "Jumping", "Stamina", "Injury", "Awareness", "Toughness"] },
  { label: "Passing", keywords: ["Throwing Power", "Throw Power", "Accuracy", "Play Action", "Throw on the Run", "Throw Under Pressure", "Break Sack"] },
  { label: "Ball Carrier", keywords: ["Trucking", "BC Vision", "Ball Carrier Vision", "Stiff Arm", "Spin Move", "Juke Move", "Carrying", "Break Tackle"] },
  { label: "Receiving", keywords: ["Catching", "Catch in Traffic", "Spectacular Catch", "Release", "Route Running", "Kick Return"] },
  { label: "Blocking", keywords: ["Pass Block", "Run Block", "Lead Block", "Impact Blocking"] },
  { label: "Defense", keywords: ["Tackling", "Tackle", "Hit Power", "Power Moves", "Finesse Moves", "Block Shedding", "Pursuit", "Play Recognition", "Man Coverage", "Zone Coverage", "Press"] },
  { label: "Kicking", keywords: ["Kick Power", "Kick Accuracy"] },
];
function legendAttributeCategory(key: string): string {
  for (const category of LEGEND_ATTRIBUTE_CATEGORIES) {
    if (category.keywords.some((keyword) => key.toLowerCase().includes(keyword.toLowerCase()))) return category.label;
  }
  return "Other";
}
import { isCompatibleReplacementPosition, legendPositionGroupFor, legendTopAttributes } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useLeagueTheme } from "../../lib/league-theme-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { LegendAvailabilityEntry, LegendCatalogEntry, LegendReplacementPlayer } from "../../types/api.js";
import { Modal } from "../../components/ui/Modal.js";
import { Button } from "../../components/ui/Button.js";
import { CoinAmount } from "../../components/ui/CoinAmount.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { ErrorPopup } from "../../components/ui/ErrorPopup.js";

type LegendTier = "legend" | "immortal";

export function LegendPurchasePanel({
  onPurchased,
  legendPrice,
  immortalPrice,
}: {
  onPurchased: () => void;
  legendPrice: number;
  immortalPrice: number;
}) {
  const { guildId, discordId } = useReadyAuth();
  const { game } = useLeagueTheme();
  const isCfb = game === "cfb_27";
  const [legends, setLegends] = useState<LegendCatalogEntry[] | null>(null);
  const [sold, setSold] = useState<LegendAvailabilityEntry[] | null>(null);
  const [tier, setTier] = useState<LegendTier | null>(null);
  const [position, setPosition] = useState<string>("ALL");
  const [activeLegend, setActiveLegend] = useState<LegendCatalogEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replacementConfig, setReplacementConfig] = useState<{ replacementPlayers: LegendReplacementPlayer[]; blockedNoEligibleReplacement: boolean } | null>(null);

  function load() {
    Promise.all([
      recApi.listHubLegends(guildId),
      recApi.listHubLegendAvailability(guildId),
      recApi.getLegendReplacementConfig(guildId).catch(() => ({ replacementPlayers: [], blockedNoEligibleReplacement: false })),
    ])
      .then(([catalog, availability, config]) => {
        setLegends(catalog.legends);
        setSold(availability.sold);
        setReplacementConfig({ replacementPlayers: config.replacementPlayers ?? [], blockedNoEligibleReplacement: Boolean(config.blockedNoEligibleReplacement) });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load legends."));
  }

  useEffect(load, [guildId]);

  const soldByLegendId = useMemo(() => new Map((sold ?? []).map((entry) => [entry.legendId, entry])), [sold]);

  const tierLegends = useMemo(() => {
    if (!tier || !legends) return [];
    return legends.filter((legend) => (legend.legend_tier ?? "legend") === tier);
  }, [legends, tier]);

  const positions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const legend of tierLegends) {
      counts.set(legend.position, (counts.get(legend.position) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tierLegends]);

  const visible = useMemo(() => {
    if (position === "ALL") return tierLegends;
    return tierLegends.filter((legend) => legend.position === position);
  }, [tierLegends, position]);

  const activePrice = tier === "immortal" ? immortalPrice : legendPrice;

  async function purchase(legend: LegendCatalogEntry, replacementPlayerId: string | null) {
    setBusy(true);
    setActionError(null);
    try {
      await recApi.purchaseHubLegend({ guildId, legendId: legend.id, replacementPlayerId });
      setNotice(`${legend.name} purchased — a commissioner has been notified for approval.`);
      setActiveLegend(null);
      load();
      onPurchased();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Purchase failed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(legend: LegendCatalogEntry) {
    setBusy(true);
    setActionError(null);
    try {
      const result = await recApi.cancelHubLegend({ guildId, legendId: legend.id });
      setNotice(`Purchase cancelled — ${result.refunded} coins refunded.`);
      setActiveLegend(null);
      load();
      onPurchased();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Cancel failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!legends || !sold) return <p className="hub-muted">Loading legends…</p>;

  return (
    <div className="legend-purchase-panel">
      {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <ErrorState message={error} />}

      {!tier && (
        <div className="legend-tier-picker">
          <p className="form-hint">Choose a catalog tier. Immortals are X-Factor builds; Legends are Superstar builds.</p>
          <p className="form-hint">Every Legend and Immortal comes on a 7-year contract at the lowest possible contract value, renewed perpetually — you will never lose your purchase to negotiations.</p>
          <div className="legend-tier-grid">
            <button type="button" className="legend-tier-card" onClick={() => { setTier("immortal"); setPosition("ALL"); }}>
              <strong>Immortals</strong>
              <span className="legend-tier-price"><CoinAmount amount={immortalPrice} /></span>
              <span className="hub-muted">X-Factor · elite icons</span>
              <span className="hub-muted">{legends.filter((l) => l.legend_tier === "immortal").length} players</span>
            </button>
            <button type="button" className="legend-tier-card" onClick={() => { setTier("legend"); setPosition("ALL"); }}>
              <strong>Legends</strong>
              <span className="legend-tier-price"><CoinAmount amount={legendPrice} /></span>
              <span className="hub-muted">Superstar · deep catalog</span>
              <span className="hub-muted">{legends.filter((l) => (l.legend_tier ?? "legend") === "legend").length} players</span>
            </button>
          </div>
        </div>
      )}

      {tier && (
        <>
          <div className="legend-tier-toolbar">
            <button type="button" className="legend-tier-back" onClick={() => { setTier(null); setPosition("ALL"); setActiveLegend(null); }}>
              ← All tiers
            </button>
            <strong>{tier === "immortal" ? "Immortals" : "Legends"}</strong>
            <span className="hub-muted"><CoinAmount amount={activePrice} /> each</span>
          </div>

          <p className="form-hint">This player inherits the in-game appearance of whoever they replace — only height, weight, and body type can be changed afterward.</p>
          <p className="form-hint">All Legends and Immortals arrive on a 7-year contract at the lowest possible contract value. Contracts renew perpetually — you will never lose a purchased player to negotiations.</p>

          <nav className="legend-position-filters" aria-label="Filter by position">
            <button
              type="button"
              className={`legend-position-link${position === "ALL" ? " is-active" : ""}`}
              onClick={() => setPosition("ALL")}
            >
              All ({tierLegends.length})
            </button>
            {positions.map(([pos, count]) => (
              <button
                key={pos}
                type="button"
                className={`legend-position-link${position === pos ? " is-active" : ""}`}
                onClick={() => setPosition(pos)}
              >
                {pos} ({count})
              </button>
            ))}
          </nav>

          <div className="legend-card-grid">
            {visible.map((legend) => {
              const soldEntry = soldByLegendId.get(legend.id);
              const isMine = soldEntry?.purchaserDiscordId === discordId;
              const isTaken = Boolean(soldEntry) && !isMine;
              const top3 = legendTopAttributes(legend.attributes, legendPositionGroupFor(legend.position));
              return (
                <button
                  key={legend.id}
                  type="button"
                  className={`legend-card${isTaken ? " is-taken" : ""}${isMine ? " is-mine" : ""}${tier === "immortal" ? " is-immortal" : ""}`}
                  disabled={isTaken}
                  onClick={() => setActiveLegend(legend)}
                >
                  {legend.photo_url ? <img className="legend-card-photo" src={legend.photo_url} alt="" loading="lazy" /> : <div className="legend-card-photo legend-card-photo-empty">{legend.position}</div>}
                  <strong className="legend-card-name">{legend.name}</strong>
                  <span className="legend-card-meta">{legend.position} · {legend.height ?? "?"} · {legend.weight ?? "?"} lbs · {legend.est_ovr ?? "?"} OVR</span>
                  <div className="legend-card-attrs">
                    {top3.map((attr) => (
                      <span key={attr.key}>{attr.key} {attr.value}</span>
                    ))}
                  </div>
                  {isMine && <span className="legend-card-status">Your pending purchase</span>}
                  {isTaken && <span className="legend-card-status">Already purchased</span>}
                </button>
              );
            })}
            {visible.length === 0 && <p className="hub-muted">No players at this position.</p>}
          </div>
        </>
      )}

      {activeLegend && (
        <LegendDetailModal
          legend={activeLegend}
          soldEntry={soldByLegendId.get(activeLegend.id) ?? null}
          isMine={soldByLegendId.get(activeLegend.id)?.purchaserDiscordId === discordId}
          busy={busy}
          isCfb={isCfb}
          replacementPlayers={replacementConfig?.replacementPlayers ?? []}
          blockedNoEligibleReplacement={replacementConfig?.blockedNoEligibleReplacement ?? false}
          legendPrice={activeLegend.legend_tier === "immortal" ? immortalPrice : legendPrice}
          onClose={() => setActiveLegend(null)}
          onPurchase={(replacementPlayerId) => void purchase(activeLegend, replacementPlayerId)}
          onCancel={() => void cancel(activeLegend)}
        />
      )}

      {actionError && <ErrorPopup title="Purchase Failed" message={actionError} onClose={() => setActionError(null)} />}

      <p className="legend-photo-disclaimer">
        Player photos are used for informational and identification purposes only and remain the property of their respective owners/rights holders.
      </p>
    </div>
  );
}

function LegendDetailModal({
  legend,
  soldEntry,
  isMine,
  busy,
  isCfb,
  replacementPlayers,
  blockedNoEligibleReplacement,
  legendPrice,
  onClose,
  onPurchase,
  onCancel,
}: {
  legend: LegendCatalogEntry;
  soldEntry: LegendAvailabilityEntry | null;
  isMine: boolean;
  busy: boolean;
  isCfb: boolean;
  replacementPlayers: LegendReplacementPlayer[];
  blockedNoEligibleReplacement: boolean;
  legendPrice: number;
  onClose: () => void;
  onPurchase: (replacementPlayerId: string | null) => void;
  onCancel: () => void;
}) {
  const [designateReplacement, setDesignateReplacement] = useState(isCfb);
  const [replacementPlayerId, setReplacementPlayerId] = useState("");
  const isTaken = Boolean(soldEntry) && !isMine;
  const canCancel = isMine && soldEntry?.status === "pending";
  const canSubmitReplacement = isCfb ? Boolean(replacementPlayerId) : !designateReplacement || Boolean(replacementPlayerId);
  const abilities = !isCfb ? (legend.abilities ?? []) : [];

  return (
    <Modal title={legend.name} onClose={onClose}>
      <div className="legend-detail-header">
        {legend.photo_url ? <img className="legend-detail-photo" src={legend.photo_url} alt="" /> : <div className="legend-detail-photo legend-card-photo-empty">{legend.position}</div>}
        <p className="hub-muted" style={{ marginTop: 0 }}>
          {legend.legend_tier === "immortal" ? "Immortal" : "Legend"} · {legend.position} · {legend.height ?? "?"} · {legend.weight ?? "?"} lbs · {legend.hand ?? "?"}-handed · #{legend.jersey_number ?? "?"}{legend.college ? ` · ${legend.college}` : ""}{legend.body_type ? ` · ${legend.body_type[0].toUpperCase() + legend.body_type.slice(1)} build` : ""}
        </p>
      </div>
      <p>{!isCfb && <><strong>Dev Trait:</strong> {legend.dev_trait} · </>}<strong>Est. OVR:</strong> {legend.est_ovr ?? "?"}</p>
      {isCfb && <p className="form-hint">This legend uses the selected replacement player's in-game development trait. REC does not change or track that trait for CFB legends.</p>}
      {legend.build_note && <p className="hub-muted">{legend.build_note}</p>}

      {abilities.length > 0 && (
        <div className="legend-attr-category">
          <h4>Abilities</h4>
          <div className="legend-attr-grid">
            {abilities.map((ability) => (
              <span key={`${ability.type}-${ability.name}`} className="legend-attr-chip">
                <b>{ability.type ?? "ability"}</b> {ability.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {Object.entries(
        Object.entries(legend.attributes).reduce<Record<string, Array<[string, number]>>>((groups, [key, value]) => {
          const category = legendAttributeCategory(key);
          (groups[category] ??= []).push([key, value]);
          return groups;
        }, {}),
      )
        .sort(([a], [b]) => LEGEND_ATTRIBUTE_CATEGORIES.findIndex((c) => c.label === a) - LEGEND_ATTRIBUTE_CATEGORIES.findIndex((c) => c.label === b))
        .map(([category, entries]) => (
          <div key={category} className="legend-attr-category">
            <h4>{category}</h4>
            <div className="legend-attr-grid">
              {entries.sort(([, a], [, b]) => b - a).map(([key, value]) => (
                <span key={key} className="legend-attr-chip"><b>{value}</b> {key}</span>
              ))}
            </div>
          </div>
        ))}

      <p className="form-hint" style={{ marginTop: "var(--space-4)" }}>
        Purchasing this player is applied to your roster once a commissioner approves it, and will replace an active
        roster player — a one-time permanent addition for this league. They come on a 7-year contract at the lowest
        possible value, renewed perpetually so you never lose the purchase to negotiations.
      </p>

      {!isTaken && !isMine && blockedNoEligibleReplacement && (
        <p className="form-hint">
          {isCfb
            ? "Your roster has no recruits or manually-added players to replace yet. Add one via the Recruiting Board or the \"Edit Roster\" quick action on My Team before purchasing."
            : "Your roster has no active players yet — assign or seed your roster before purchasing."}
        </p>
      )}
      {!isTaken && !isMine && !blockedNoEligibleReplacement && (
        <>
          {(() => {
            const eligiblePlayers = [...(isCfb ? replacementPlayers.filter((player) => isCompatibleReplacementPosition(legend.position, player.position)) : replacementPlayers)]
              .sort((a, b) => (a.overall_rating ?? Infinity) - (b.overall_rating ?? Infinity));
            if (isCfb) {
              if (eligiblePlayers.length === 0) {
                return <p className="form-hint">You have no added/recruited {legend.position} on your roster to replace — add one via the Recruiting Board or "Edit Roster" before buying.</p>;
              }
              return (
                <label className="form-field">
                  <span className="form-label">Replace ({legend.position})</span>
                  <select className="form-input" value={replacementPlayerId} onChange={(event) => setReplacementPlayerId(event.target.value)}>
                    <option value="">Select player to replace</option>
                    {eligiblePlayers.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.full_name ?? `${player.first_name} ${player.last_name}`} · {player.position} · {player.overall_rating ?? "—"} OVR
                      </option>
                    ))}
                  </select>
                </label>
              );
            }
            return eligiblePlayers.length > 0 && (
            <>
              <label className="form-field" style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-2)" }}>
                <input type="checkbox" checked={designateReplacement} onChange={(event) => setDesignateReplacement(event.target.checked)} />
                <span className="form-label" style={{ margin: 0 }}>Pick which roster player this replaces</span>
              </label>
              {designateReplacement ? (
                <label className="form-field">
                  <span className="form-label">Replace (any position)</span>
                  <select className="form-input" value={replacementPlayerId} onChange={(event) => setReplacementPlayerId(event.target.value)}>
                    <option value="">Select player</option>
                    {eligiblePlayers.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.full_name ?? `${player.first_name} ${player.last_name}`} · {player.position} · {player.overall_rating ?? "—"} OVR
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="form-hint">Leave unchecked to let your commissioner choose which player this replaces.</p>
              )}
            </>
            );
          })()}
          <div className="hub-store-total">
            <span>Total: <strong><CoinAmount amount={legendPrice} /></strong></span>
            <Button
              variant="primary"
              disabled={busy || !canSubmitReplacement}
              onClick={() => onPurchase(isCfb || designateReplacement ? replacementPlayerId || null : null)}
            >
              {busy ? "Submitting…" : "Purchase"}
            </Button>
          </div>
        </>
      )}

      {canCancel && (
        <div className="hub-store-total">
          <Button variant="danger" disabled={busy} onClick={onCancel}>
            {busy ? "Working…" : "Cancel & Refund"}
          </Button>
        </div>
      )}

      {isTaken && <p className="form-hint">This player has already been purchased in this league.</p>}
      {isMine && soldEntry?.status !== "pending" && <p className="form-hint">Approved and applied — no longer cancellable.</p>}
    </Modal>
  );
}
