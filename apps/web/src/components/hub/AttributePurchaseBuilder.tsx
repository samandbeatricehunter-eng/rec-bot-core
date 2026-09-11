import { useMemo, useState } from "react";
import { MADDEN_ATTRIBUTE_BY_CODE, MADDEN_ATTRIBUTE_DROPDOWN_GROUPS, REC_ATTRIBUTE_POINT_PRICE, formatCoins, rosterAttributeValueForCode } from "@rec/shared";

const MADDEN_ATTRIBUTE_MAX = 99;
import type { RosterPlayer, StorePurchaseContext } from "../../types/api.js";
import { Button } from "../ui/Button.js";
import { CoinAmount } from "../ui/CoinAmount.js";
import { RosterPlayerSelect } from "./RosterPlayerSelect.js";

// Multi-attribute purchase builder: every one of the 53 Madden attributes gets its own
// +/- counter starting at 0, priced live from the league's configured core-attribute set
// (core = 200/pt, non-core = 100/pt — REC_ATTRIBUTE_POINT_PRICE). Caps and the final
// core/non-core split are re-derived authoritatively server-side on submit; this is a
// best-effort preview so the coach never submits something they can't afford or that's
// already capped out.
export function AttributePurchaseBuilder({
  guildId,
  storeContext,
  wallet,
  busy,
  excludeDefault = false,
  corePointPrice = REC_ATTRIBUTE_POINT_PRICE.core,
  nonCorePointPrice = REC_ATTRIBUTE_POINT_PRICE.non_core,
  onSubmit,
}: {
  guildId: string;
  storeContext: StorePurchaseContext | null;
  wallet: number;
  busy: boolean;
  excludeDefault?: boolean;
  corePointPrice?: number;
  nonCorePointPrice?: number;
  onSubmit: (allocations: Array<{ code: string; points: number }>, playerName: string, playerId: string) => Promise<boolean>;
}) {
  const [points, setPoints] = useState<Record<string, number>>({});
  const [player, setPlayer] = useState<RosterPlayer | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const isCore = (code: string) => storeContext?.coreAttributes.includes(code) ?? false;
  const unitPrice = (code: string) => (isCore(code) ? corePointPrice : nonCorePointPrice);

  const totalPrice = useMemo(
    () => Object.entries(points).reduce((sum, [code, pts]) => sum + pts * unitPrice(code), 0),
    [points, storeContext, corePointPrice, nonCorePointPrice],
  );

  function currentValueFor(code: string): number | null {
    return rosterAttributeValueForCode(player?.attributes ?? null, code);
  }

  function increment(code: string) {
    setWarning(null);
    if (totalPrice + unitPrice(code) > wallet) {
      setWarning(`You can't afford another point of ${code} — that would put this purchase at ${formatCoins(totalPrice + unitPrice(code))}, more than your ${formatCoins(wallet)} wallet.`);
      return;
    }
    const current = currentValueFor(code);
    if (current != null && current + (points[code] ?? 0) >= MADDEN_ATTRIBUTE_MAX) {
      setWarning(`${code} is already at the ${MADDEN_ATTRIBUTE_MAX} rating cap.`);
      return;
    }
    setPoints((prev) => ({ ...prev, [code]: (prev[code] ?? 0) + 1 }));
  }

  function decrement(code: string) {
    setWarning(null);
    setPoints((prev) => ({ ...prev, [code]: Math.max(0, (prev[code] ?? 0) - 1) }));
  }

  const allocations = Object.entries(points).filter(([, pts]) => pts > 0).map(([code, pts]) => ({ code, points: pts }));
  const canSubmit = allocations.length > 0 && Boolean(player) && totalPrice <= wallet && !busy;

  // storeContext.used*/usedByCode refresh from the server after a successful submit, but
  // this component doesn't unmount between purchases -- without this, the just-submitted
  // allocation stayed in `points` and got double-counted against the freshly-refreshed
  // server totals (e.g. spending an entire pool showed as "-<pool size> left").
  async function handleSubmit() {
    if (!player) return;
    const succeeded = await onSubmit(allocations, player.fullName, player.id);
    if (succeeded) {
      setPoints({});
      setPlayer(null);
    }
  }

  return (
    <div className="attr-builder">
      <label className="form-field"><span className="form-label">Player</span><RosterPlayerSelect guildId={guildId} value={player} onChange={setPlayer} excludeDefault={excludeDefault} /></label>

      {(Object.entries(MADDEN_ATTRIBUTE_DROPDOWN_GROUPS) as Array<[string, typeof MADDEN_ATTRIBUTE_DROPDOWN_GROUPS[keyof typeof MADDEN_ATTRIBUTE_DROPDOWN_GROUPS]]>).map(([groupKey, group]) => (
        <details key={groupKey} className="attr-builder-group">
          <summary>{group.label}<span className="attr-builder-group-count">{group.codes.filter((code) => (points[code] ?? 0) > 0).length ? `${group.codes.filter((code) => (points[code] ?? 0) > 0).length} selected` : ""}</span></summary>
          <div className="attr-builder-rows">
            {group.codes.map((code) => {
              const def = MADDEN_ATTRIBUTE_BY_CODE.get(code);
              const pts = points[code] ?? 0;
              const current = currentValueFor(code);
              const projected = current != null ? Math.min(MADDEN_ATTRIBUTE_MAX, current + pts) : null;
              return (
                <div key={code} className={`attr-builder-row${isCore(code) ? " core" : ""}`}>
                  <div className="attr-builder-name"><strong>{code}</strong><span>{def?.name ?? code}</span></div>
                  <span className="attr-builder-tag">{isCore(code) ? "Core" : "Non-core"} · {formatCoins(unitPrice(code))}/pt</span>
                  {current != null && (
                    <span className="attr-builder-value">
                      {pts > 0 ? <>{current} <b>→</b> {projected}</> : current}
                    </span>
                  )}
                  <div className="attr-builder-counter">
                    <button type="button" disabled={pts === 0} onClick={() => decrement(code)}>−</button>
                    <span>{pts}</span>
                    <button type="button" onClick={() => increment(code)}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      ))}

      {warning && <p className="form-hint attr-builder-warning">{warning}</p>}

      <div className="attr-builder-total">
        <span>Total: <strong><CoinAmount amount={totalPrice} /></strong> of <CoinAmount amount={wallet} /> available</span>
        <Button variant="primary" disabled={!canSubmit} onClick={() => void handleSubmit()}>
          {busy ? "Submitting…" : `Submit (${allocations.reduce((sum, a) => sum + a.points, 0)} pts)`}
        </Button>
      </div>
    </div>
  );
}
