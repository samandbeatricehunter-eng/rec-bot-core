import { useMemo, useState } from "react";
import { MADDEN_ATTRIBUTE_BY_CODE, MADDEN_ATTRIBUTE_DROPDOWN_GROUPS, REC_ATTRIBUTE_POINT_PRICE } from "@rec/shared";
import type { StorePurchaseContext } from "../../types/api.js";
import { Button } from "../ui/Button.js";

// Multi-attribute purchase builder: every one of the 53 Madden attributes gets its own
// +/- counter starting at 0, priced live from the league's configured core-attribute set
// (core = $100/pt, non-core = $50/pt — REC_ATTRIBUTE_POINT_PRICE). Caps and the final
// core/non-core split are re-derived authoritatively server-side on submit; this is a
// best-effort preview so the coach never submits something they can't afford or that's
// already capped out.
export function AttributePurchaseBuilder({
  storeContext,
  wallet,
  busy,
  onSubmit,
}: {
  storeContext: StorePurchaseContext | null;
  wallet: number;
  busy: boolean;
  onSubmit: (allocations: Array<{ code: string; points: number }>, playerName: string) => void;
}) {
  const [points, setPoints] = useState<Record<string, number>>({});
  const [playerName, setPlayerName] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  const isCore = (code: string) => storeContext?.coreAttributes.includes(code) ?? false;
  const unitPrice = (code: string) => (isCore(code) ? REC_ATTRIBUTE_POINT_PRICE.core : REC_ATTRIBUTE_POINT_PRICE.non_core);

  const totalPrice = useMemo(
    () => Object.entries(points).reduce((sum, [code, pts]) => sum + pts * unitPrice(code), 0),
    [points, storeContext],
  );

  function remainingForCode(code: string): number | null {
    if (!storeContext) return null;
    if (isCore(code)) {
      const cap = storeContext.coreAttributeCapOverrides[code] ?? storeContext.coreAttributeDefaultCap;
      if (!cap) return null;
      return cap - (storeContext.usedCoreByCode[code] ?? 0) - (points[code] ?? 0);
    }
    if (!storeContext.nonCoreAttributeCap) return null;
    const otherNonCoreSelected = Object.entries(points).reduce((sum, [c, p]) => (c !== code && !isCore(c) ? sum + p : sum), 0);
    return storeContext.nonCoreAttributeCap - storeContext.usedNonCore - otherNonCoreSelected - (points[code] ?? 0);
  }

  function increment(code: string) {
    setWarning(null);
    if (totalPrice + unitPrice(code) > wallet) {
      setWarning(`You can't afford another point of ${code} — that would put this purchase at $${totalPrice + unitPrice(code)}, more than your $${wallet} wallet.`);
      return;
    }
    const remaining = remainingForCode(code);
    if (remaining != null && remaining <= 0) {
      setWarning(`${code} is capped for the rest of this season.`);
      return;
    }
    setPoints((prev) => ({ ...prev, [code]: (prev[code] ?? 0) + 1 }));
  }

  function decrement(code: string) {
    setWarning(null);
    setPoints((prev) => ({ ...prev, [code]: Math.max(0, (prev[code] ?? 0) - 1) }));
  }

  const allocations = Object.entries(points).filter(([, pts]) => pts > 0).map(([code, pts]) => ({ code, points: pts }));
  const canSubmit = allocations.length > 0 && playerName.trim().length > 0 && totalPrice <= wallet && !busy;

  return (
    <div className="attr-builder">
      <label className="form-field"><span className="form-label">Player name</span><input className="form-input" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Which player is this for?" /></label>

      {(Object.entries(MADDEN_ATTRIBUTE_DROPDOWN_GROUPS) as Array<[string, typeof MADDEN_ATTRIBUTE_DROPDOWN_GROUPS[keyof typeof MADDEN_ATTRIBUTE_DROPDOWN_GROUPS]]>).map(([groupKey, group]) => (
        <details key={groupKey} className="attr-builder-group">
          <summary>{group.label}<span className="attr-builder-group-count">{group.codes.filter((code) => (points[code] ?? 0) > 0).length ? `${group.codes.filter((code) => (points[code] ?? 0) > 0).length} selected` : ""}</span></summary>
          <div className="attr-builder-rows">
            {group.codes.map((code) => {
              const def = MADDEN_ATTRIBUTE_BY_CODE.get(code);
              const pts = points[code] ?? 0;
              const remaining = remainingForCode(code);
              const atCap = remaining != null && remaining <= 0;
              return (
                <div key={code} className={`attr-builder-row${isCore(code) ? " core" : ""}`}>
                  <div className="attr-builder-name"><strong>{code}</strong><span>{def?.name ?? code}</span></div>
                  <span className="attr-builder-tag">{isCore(code) ? "Core" : "Non-core"} · ${unitPrice(code)}/pt</span>
                  <div className="attr-builder-counter">
                    <button type="button" disabled={pts === 0} onClick={() => decrement(code)}>−</button>
                    <span>{pts}</span>
                    <button type="button" disabled={atCap} onClick={() => increment(code)}>+</button>
                  </div>
                  {remaining != null && <small className={atCap ? "attr-builder-capped" : ""}>{remaining} left this season</small>}
                </div>
              );
            })}
          </div>
        </details>
      ))}

      {warning && <p className="form-hint attr-builder-warning">{warning}</p>}

      <div className="attr-builder-total">
        <span>Total: <strong>${totalPrice}</strong> of ${wallet} available</span>
        <Button variant="primary" disabled={!canSubmit} onClick={() => onSubmit(allocations, playerName)}>
          {busy ? "Submitting…" : `Submit (${allocations.reduce((sum, a) => sum + a.points, 0)} pts)`}
        </Button>
      </div>
    </div>
  );
}
