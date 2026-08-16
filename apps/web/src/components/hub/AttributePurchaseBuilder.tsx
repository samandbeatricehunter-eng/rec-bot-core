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
  onSubmit: (allocations: Array<{ code: string; points: number }>, playerName: string, playerId: string) => void;
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

  function individualCapFor(code: string): number {
    if (!storeContext) return 0;
    if (isCore(code)) {
      return storeContext.coreAttributeCapOverrides[code] ?? storeContext.coreAttributeDefaultCap;
    }
    if (storeContext.nonCoreAttributeCapMode === "individual") {
      return storeContext.nonCoreAttributeCapOverrides[code] ?? 0;
    }
    return storeContext.nonCoreAttributeCapOverrides[code] ?? 0;
  }

  function usedFor(code: string): number {
    if (!storeContext) return 0;
    return isCore(code)
      ? storeContext.usedCoreByCode[code] ?? 0
      : storeContext.usedNonCoreByCode[code] ?? 0;
  }

  // Every cap is additive, not either/or — an attribute's own individual cap (override, or
  // the group default for Core) AND its group's pooled total both apply at once, so the
  // remaining allowance is whichever constraint is tighter.
  function remainingForCode(code: string): number | null {
    if (!storeContext) return null;
    const pending = points[code] ?? 0;
    const core = isCore(code);
    const individualCap = individualCapFor(code);
    const individualRemaining = individualCap > 0
      ? individualCap - usedFor(code) - pending
      : null;

    const groupCap = core ? storeContext.coreAttributeGroupCap : storeContext.nonCoreAttributeCap;
    const otherGroupSelected = Object.entries(points).reduce((sum, [c, p]) => (c !== code && isCore(c) === core ? sum + p : sum), 0);
    const groupRemaining = groupCap > 0
      ? groupCap - (core ? storeContext.usedCore : storeContext.usedNonCore) - otherGroupSelected - pending
      : null;

    if (individualRemaining == null) return groupRemaining;
    if (groupRemaining == null) return individualRemaining;
    return Math.min(individualRemaining, groupRemaining);
  }

  function currentValueFor(code: string): number | null {
    return rosterAttributeValueForCode(player?.attributes ?? null, code);
  }

  function increment(code: string) {
    setWarning(null);
    if (totalPrice + unitPrice(code) > wallet) {
      setWarning(`You can't afford another point of ${code} — that would put this purchase at ${formatCoins(totalPrice + unitPrice(code))}, more than your ${formatCoins(wallet)} wallet.`);
      return;
    }
    const remaining = remainingForCode(code);
    if (remaining != null && remaining <= 0) {
      setWarning(`${code} is capped for the rest of this season.`);
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

  const corePoolCap = storeContext?.coreAttributeGroupCap ?? 0;
  const nonCorePoolCap = storeContext?.nonCoreAttributeCap ?? 0;
  const nonCoreMode = storeContext?.nonCoreAttributeCapMode ?? "group";
  const pendingCore = Object.entries(points).reduce((sum, [c, p]) => (isCore(c) ? sum + p : sum), 0);
  const pendingNonCore = Object.entries(points).reduce((sum, [c, p]) => (!isCore(c) ? sum + p : sum), 0);

  return (
    <div className="attr-builder">
      <label className="form-field"><span className="form-label">Player</span><RosterPlayerSelect guildId={guildId} value={player} onChange={setPlayer} excludeDefault={excludeDefault} /></label>

      {storeContext && (
        <div className="attr-builder-caps">
          <p className="attr-builder-caps-title">Season attribute caps</p>
          <div className="attr-builder-caps-grid">
            <article>
              <span>Core (per attribute)</span>
              <strong>
                {storeContext.coreAttributeDefaultCap > 0
                  ? `up to ${storeContext.coreAttributeDefaultCap} pts each`
                  : "Unlimited"}
              </strong>
              <small>Overrides may differ per attribute below</small>
            </article>
            {corePoolCap > 0 && (
              <article>
                <span>Core pool (all core attrs)</span>
                <strong>{storeContext.usedCore + pendingCore}/{corePoolCap}</strong>
                <small>points this season</small>
              </article>
            )}
            {nonCoreMode === "group" && nonCorePoolCap > 0 && (
              <article>
                <span>Non-core pool</span>
                <strong>{storeContext.usedNonCore + pendingNonCore}/{nonCorePoolCap}</strong>
                <small>points this season</small>
              </article>
            )}
            {nonCoreMode === "individual" && (
              <article>
                <span>Non-core</span>
                <strong>Per-attribute caps</strong>
                <small>Shown on each attribute row</small>
              </article>
            )}
          </div>
        </div>
      )}

      {(Object.entries(MADDEN_ATTRIBUTE_DROPDOWN_GROUPS) as Array<[string, typeof MADDEN_ATTRIBUTE_DROPDOWN_GROUPS[keyof typeof MADDEN_ATTRIBUTE_DROPDOWN_GROUPS]]>).map(([groupKey, group]) => (
        <details key={groupKey} className="attr-builder-group">
          <summary>{group.label}<span className="attr-builder-group-count">{group.codes.filter((code) => (points[code] ?? 0) > 0).length ? `${group.codes.filter((code) => (points[code] ?? 0) > 0).length} selected` : ""}</span></summary>
          <div className="attr-builder-rows">
            {group.codes.map((code) => {
              const def = MADDEN_ATTRIBUTE_BY_CODE.get(code);
              const pts = points[code] ?? 0;
              const remaining = remainingForCode(code);
              const atCap = remaining != null && remaining <= 0;
              const individualCap = individualCapFor(code);
              const used = usedFor(code);
              const showIndividualUsage = individualCap > 0;
              return (
                <div key={code} className={`attr-builder-row${isCore(code) ? " core" : ""}`}>
                  <div className="attr-builder-name"><strong>{code}</strong><span>{def?.name ?? code}</span></div>
                  <span className="attr-builder-tag">{isCore(code) ? "Core" : "Non-core"} · {formatCoins(unitPrice(code))}/pt</span>
                  <div className="attr-builder-counter">
                    <button type="button" disabled={pts === 0} onClick={() => decrement(code)}>−</button>
                    <span>{pts}</span>
                    <button type="button" disabled={atCap} onClick={() => increment(code)}>+</button>
                  </div>
                  {showIndividualUsage ? (
                    <small className={atCap ? "attr-builder-capped" : ""}>
                      {used + pts}/{individualCap} this season
                    </small>
                  ) : remaining != null ? (
                    <small className={atCap ? "attr-builder-capped" : ""}>
                      {remaining} left in pool
                    </small>
                  ) : null}
                </div>
              );
            })}
          </div>
        </details>
      ))}

      {warning && <p className="form-hint attr-builder-warning">{warning}</p>}

      <div className="attr-builder-total">
        <span>Total: <strong><CoinAmount amount={totalPrice} /></strong> of <CoinAmount amount={wallet} /> available</span>
        <Button variant="primary" disabled={!canSubmit} onClick={() => onSubmit(allocations, player!.fullName, player!.id)}>
          {busy ? "Submitting…" : `Submit (${allocations.reduce((sum, a) => sum + a.points, 0)} pts)`}
        </Button>
      </div>
    </div>
  );
}
