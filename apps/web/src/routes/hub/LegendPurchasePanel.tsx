import { useEffect, useMemo, useState } from "react";
import { REC_LEGEND_POSITION_GROUPS, REC_LEGEND_PRICE, legendPositionGroupFor, legendTopAttributes, type RecLegendPositionGroup } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { LegendAvailabilityEntry, LegendCatalogEntry } from "../../types/api.js";
import { Modal } from "../../components/ui/Modal.js";
import { Button } from "../../components/ui/Button.js";
import { CoinAmount } from "../../components/ui/CoinAmount.js";
import { ErrorState } from "../../components/ui/ErrorState.js";

// Replaces the old plain <select> legend picker with the position-grouped browsing
// experience: a group dropdown, a grid of small cards (name/height/weight + top 3
// position-relevant attributes), and a detail modal with the full attribute list, the
// 88 OVR normalization disclaimer, and the purchase/cancel action.
export function LegendPurchasePanel({ onPurchased }: { onPurchased: () => void }) {
  const { guildId, discordId } = useReadyAuth();
  const [legends, setLegends] = useState<LegendCatalogEntry[] | null>(null);
  const [sold, setSold] = useState<LegendAvailabilityEntry[] | null>(null);
  const [group, setGroup] = useState<RecLegendPositionGroup | "">("");
  const [activeLegend, setActiveLegend] = useState<LegendCatalogEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    Promise.all([recApi.listHubLegends(guildId), recApi.listHubLegendAvailability(guildId)])
      .then(([catalog, availability]) => {
        setLegends(catalog.legends);
        setSold(availability.sold);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load legends."));
  }

  useEffect(load, [guildId]);

  const soldByLegendId = useMemo(() => new Map((sold ?? []).map((entry) => [entry.legendId, entry])), [sold]);

  const groupCounts = useMemo(() => {
    const counts = new Map<RecLegendPositionGroup, number>();
    for (const legend of legends ?? []) {
      const g = legendPositionGroupFor(legend.position);
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return counts;
  }, [legends]);

  const visible = useMemo(() => {
    if (!group || !legends) return [];
    return legends.filter((legend) => legendPositionGroupFor(legend.position) === group);
  }, [legends, group]);

  async function purchase(legend: LegendCatalogEntry, replacePlayerRequest: string) {
    setBusy(true);
    setError(null);
    try {
      await recApi.purchaseHubLegend({ guildId, legendId: legend.id, replacePlayerRequest: replacePlayerRequest.trim() || null });
      setNotice(`${legend.name} purchased — a commissioner has been notified for approval.`);
      setActiveLegend(null);
      load();
      onPurchased();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase failed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(legend: LegendCatalogEntry) {
    setBusy(true);
    setError(null);
    try {
      const result = await recApi.cancelHubLegend({ guildId, legendId: legend.id });
      setNotice(`Purchase cancelled — ${result.refunded} coins refunded.`);
      setActiveLegend(null);
      load();
      onPurchased();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!legends || !sold) return <p className="hub-muted">Loading legends…</p>;

  return (
    <div className="legend-purchase-panel">
      {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}
      {error && <ErrorState message={error} />}

      <label className="form-field">
        <span className="form-label">Position</span>
        <select className="form-input" value={group} onChange={(event) => setGroup(event.target.value as RecLegendPositionGroup | "")}>
          <option value="">Select a position</option>
          {REC_LEGEND_POSITION_GROUPS.map((g) => (
            <option key={g} value={g}>{g} ({groupCounts.get(g) ?? 0})</option>
          ))}
        </select>
      </label>

      {group && (
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
                className={`legend-card${isTaken ? " is-taken" : ""}${isMine ? " is-mine" : ""}`}
                disabled={isTaken}
                onClick={() => setActiveLegend(legend)}
              >
                <strong className="legend-card-name">{legend.name}</strong>
                <span className="legend-card-meta">{legend.position} · {legend.height ?? "?"} · {legend.weight ?? "?"} lbs</span>
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
          {visible.length === 0 && <p className="hub-muted">No legends at this position.</p>}
        </div>
      )}

      {activeLegend && (
        <LegendDetailModal
          legend={activeLegend}
          soldEntry={soldByLegendId.get(activeLegend.id) ?? null}
          isMine={soldByLegendId.get(activeLegend.id)?.purchaserDiscordId === discordId}
          busy={busy}
          onClose={() => setActiveLegend(null)}
          onPurchase={(replacePlayerRequest) => void purchase(activeLegend, replacePlayerRequest)}
          onCancel={() => void cancel(activeLegend)}
        />
      )}
    </div>
  );
}

function LegendDetailModal({
  legend,
  soldEntry,
  isMine,
  busy,
  onClose,
  onPurchase,
  onCancel,
}: {
  legend: LegendCatalogEntry;
  soldEntry: LegendAvailabilityEntry | null;
  isMine: boolean;
  busy: boolean;
  onClose: () => void;
  onPurchase: (replacePlayerRequest: string) => void;
  onCancel: () => void;
}) {
  const [replacePlayerRequest, setReplacePlayerRequest] = useState("");
  const isTaken = Boolean(soldEntry) && !isMine;
  const canCancel = isMine && soldEntry?.status === "pending";

  return (
    <Modal title={legend.name} onClose={onClose}>
      <p className="hub-muted" style={{ marginTop: 0 }}>
        {legend.position} · {legend.height ?? "?"} · {legend.weight ?? "?"} lbs · {legend.hand ?? "?"}-handed · #{legend.jersey_number ?? "?"} · {legend.college ?? "College unknown"}
      </p>
      <p><strong>Dev Trait:</strong> {legend.dev_trait} · <strong>Est. OVR:</strong> {legend.est_ovr ?? "?"}</p>
      {legend.build_note && <p className="hub-muted">{legend.build_note}</p>}

      <div className="legend-attr-grid">
        {Object.entries(legend.attributes)
          .sort(([, a], [, b]) => b - a)
          .map(([key, value]) => (
            <span key={key} className="legend-attr-chip"><b>{value}</b> {key}</span>
          ))}
      </div>

      <p className="form-hint" style={{ marginTop: "var(--space-4)" }}>
        Purchasing this legend is applied to your roster immediately once a commissioner approves it, and will
        replace an active player on your roster — this is a one-time, permanent addition for this league. The
        final in-league OVR will be normalized to exactly 88 — some attributes above may be nudged up or down
        by the commissioner to hit that number.
      </p>

      {!isTaken && !isMine && (
        <>
          <label className="form-field">
            <span className="form-label">Player to replace (optional)</span>
            <input
              className="form-input"
              value={replacePlayerRequest}
              onChange={(event) => setReplacePlayerRequest(event.target.value)}
              placeholder="Leave blank to replace your lowest-OVR player at this position"
            />
          </label>
          <div className="hub-store-total">
            <span>Total: <strong><CoinAmount amount={REC_LEGEND_PRICE} /></strong></span>
            <Button variant="primary" disabled={busy} onClick={() => onPurchase(replacePlayerRequest)}>
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

      {isTaken && <p className="form-hint">This legend has already been purchased in this league.</p>}
      {isMine && soldEntry?.status !== "pending" && <p className="form-hint">Approved and applied — no longer cancellable.</p>}
    </Modal>
  );
}
