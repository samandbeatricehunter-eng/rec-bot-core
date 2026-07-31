# REC Wager System — Sportsbook Comparison Review

**Prepared:** 2026-07-31  
**Based on codebase state:** commit `b4d75f1` (main)  
**Scope:** Full wager system audit vs. real sportsbook mechanics

---

## Executive Summary

The REC wager system is a **deterministic, non-LLM, non-custodial sportsbook simulation** built on a fantasy football league platform. It offers 9 markets per H2H game (moneyline, spread, total_points, plus 6 box-score-gated team totals), peer-to-peer wagering with even-money odds, and a 3-leg parlay boost. All odds are derived from power rankings + season averages — no external odds feeds, no bookmaker risk model, no auto-settlement.

**Verdict:** It functions as a **social/simulation layer**, not a real sportsbook. The house edge is crude, inconsistent, and in places inverted (parlay boost makes parlays player-favorable). Peer market has **zero vig**. Settlement requires manual commissioner approval. No live lines, no cash-out, no risk limits.

---

## 1. Market Coverage vs. Real Sportsbook

| Market | REC Offering | Real Sportsbook Standard | Gap |
|---|---|---|---|
| Moneyline | ✅ (all H2H) | ✅ All games, incl. futures | — |
| Spread | ✅ (all H2H) | ✅ All games, alt lines, live | No alt lines, no live |
| Total Points | ✅ (all H2H) | ✅ All games, halves/quarters, alt | No halves/quarters, no alt |
| Team Totals (yards, TOs, RZ%) | ✅ 6 markets (box-score gated) | ✅ Player + team props | No player props, no live |
| Player Props | ❌ | ✅ Passing/rushing/receiving yards, TDs, receptions, etc. | **Complete gap** |
| Halves/Quarters | ❌ | ✅ 1H/2H, Q1-Q4 spreads/totals | **Complete gap** |
| Live/In-Game | ❌ | ✅ Real-time re-pricing | **Complete gap** |
| Futures/Season | ❌ | ✅ Champ, division, win totals, Heisman | **Complete gap** |
| Teasers/Round Robins | ❌ | ✅ Multi-leg with adjusted lines | Only 3-leg same-game total parlay |
| Cash-Out | ❌ | ✅ Early settlement | **Complete gap** |

**Key constraint:** All REC markets are **game-week static** — computed once from power rankings + season averages, then frozen until placement. No line movement from action, no injury/weather adjustments.

---

## 2. Odds Derivation & House Edge Analysis

### 2.1 Moneyline
- **Formula:** `odds = clamp(round((1/p) * (1 - 0.05), 2), 1.05, 15.00)`
- **Probability `p`:** `homeScore / (homeScore + awayScore)` from power rankings (no HFA on ML)
- **Overround:** Constant **5.26%** (1/0.95) where clamps don't bite
- **Clamp effects:** Extreme favorites (≥95% prob) price at 1.05 → implied 95.2%; dogs cap at 15.00 → 6.7%. **Vig compresses to ~1.9% at extremes**
- **Real book comparison:** Retail ML vig typically 2–4% near 50/50, widens to 5–10% at extremes. REC's flat 5.26% mid-range is reasonable; clamp compression is a flaw (house *gives up* edge on extreme games).

### 2.2 Spread
- **Line:** `clamp(round(((homeScore - awayScore) * 45 + 3) * 2) / 2, -24, 24)` → nearest 0.5
- **Odds:** **Flat 1.91 (−110) both sides, every game**
- **Overround:** 4.76% hold
- **Real book comparison:** Standard −110 base is correct. **Missing:** key-number pricing (3, 7, 10), line shading from action, hook values on 3/7. REC spreads are pure model output.

### 2.3 Totals (Points & Stat Props)
- **Line:** Matchup-aware expected values (own avg + opp allowed avg) / 2, summed for counting stats, averaged for RZ%
- **Odds:** **Flat 1.91 (−110) for ALL totals, all games**
- **Real book comparison:** Retail books shade totals based on distribution (e.g., 44.5 vs 45.5). Flat pricing is a simplification; no juice adjustment on key numbers.

### 2.4 Parlay
- **Formula:** `Π legOdds * boost` where `boost = 1.25 (≥3 legs), 1.10 (2 legs), 1.0 (1 leg)`
- **Cap:** `clamp(round(product, 2), 1.05, 15)`
- **Real book comparison:** Standard parlay = pure product (no boost). A 3-leg −110 parlay pays **6.97 (+597)**; REC pays **8.71 (+771)** — **25% more**. The boost is intentionally player-favorable ("3-pick reward"). **House edge is inverted on parlays.**

### 2.5 Peer Wagers
- **Odds:** Fixed **2.0 (even money)** both sides
- **Vig:** **Zero**. No commission, no rake, no fee.
- **Real book comparison:** Exchanges charge 2–5% commission on winnings. REC peer market is purely social — the "house" earns nothing.

---

## 3. Risk Model & Capitalization

| Dimension | REC | Real Sportsbook |
|---|---|---|
| House bankroll | None — losses burn coins, wins mint coins | Capitalized, regulated |
| Exposure limits | None (5,000/wk house cap only) | Per-event, per-customer, aggregate |
| Line movement | None (static model output) | Continuous from action, news, injuries |
| Market making | Algorithmic, no inventory management | Professional traders + automation |
| Net win tracking | None | Core P&L metric |
| Max payout | 15.00 decimal (14:1) | Varies by sport/market, often 100:1+ |

**Conclusion:** The "house" is a **static pricing function**, not a risk-taking entity. It cannot be "beaten" in the traditional sense because it doesn't manage risk — it just mints/burns tokens per a formula.

---

## 4. Settlement Mechanics

| Aspect | REC | Real Sportsbook |
|---|---|---|
| **Auto-settlement** | ❌ Manual commissioner approval required | ✅ Instant on official result |
| **Settlement trigger** | Box score / weekly scores / advance + commissioner click | Official league result feed |
| **Grace window** | 1 week behind → reminder; 2+ weeks → auto-refund | N/A (instant) |
| **Cancelled game** | No immediate void; sits until advance grace refund | Void/no-contest, instant refund |
| **Tie (ML)** | **House loses, peer pushes** | Push (both) |
| **Push (spread/total)** | Both kinds push → refund | Push → refund |
| **Parlay push leg** | Leg drops out, payout recomputed from survivors | Same (typically) |
| **Result source** | `rec_game_results` (manual/commissioner-entered) | Official league data feeds |

**Critical gap:** Settlement is **human-gated**. If commissioners are slow/absent, payouts stall. No SLA, no fallback auto-settle.

---

## 5. Peer & Parlay Mechanics

### Peer Wagers
- **Open challenge:** Anyone in league can accept
- **Direct challenge:** Specific coach targeted
- **Counter-offer:** New terms on same game; original stays open; DM-delivered accept/deny
- **Escrow:** Both sides stake locked at placement/acceptance
- **No decline button** for open challenges (only accept/counter)
- **Visibility:** Public board for open/accepted; direct/counter visible only to parties

### Parlay (House Only)
- **API requires:** Exactly 3 legs, same game, all stat totals (no ML/spread/total_points)
- **Bot UI allows:** 2–3 legs, any market — **rejected by service**
- **Leg results stored** in `rec_wager_legs.leg_result`
- **Push leg drops out** — payout from survivors only

---

## 6. Wallet / Economy Integration

- **Escrow:** `add_to_wallet(-stake, 'wager_hold')` — balance debited immediately, hold ledger ID stored
- **Payout:** `creditOrBacklog('wager_payout')` — if economy floor (< 8 linked users) not met, queued in `rec_economy_payout_backlog`
- **Refunds:** Bypass backlog (never backlogged)
- **Idempotency:** `add_to_wallet` dedups on `(user, type, source, reference)`
- **Limits:** 5,000 coins/week combined house stake; no peer cap; no affordability check

---

## 7. UI Surfaces

| Surface | Features |
|---|---|
| **Web (HubHome)** | Week-lines inline (ML/spread/total), "Build Wager" modal with House/Parlay/Peer modes; peer board + my wagers; commissioner close-game + settle modal |
| **Bot (Discord)** | Richer: AFC/NFC coach pickers, custom spread input, counter-offer DMs, challenge embeds in announcements, pending-payout embeds with Approve/Cancel buttons, maintenance hooks |

**Web gaps:** No custom spread input, no counter-offers, no DM counter flow, no commissioner payout embed (uses `ResolveNotificationModal`).

---

## 8. Stale / Dead Code Indicating Scope Drift

| Code | Status |
|---|---|
| `marketsForGame(humanInvolved)` non-human branch | Dead — all wagerable games are H2H |
| "One CPU game per week" cap in `placeHouseWager` | Unreachable (all wagerable = H2H) |
| Route allows 2-leg parlay, service requires 3 | Mismatch — 2-leg submissions rejected |
| Bot parlay builder allows ML/spread legs | Rejected by service (totals only) |
| `WAGER_MARKETS` includes `total_points` but 3-leg rule excludes it | Confusing |

---

## 9. Sportsbook Compliance Gaps (Regulatory Perspective)

If this were a real-money product, it would fail on:

1. **No KYC/AML** — Supabase Auth only, no identity verification
2. **No responsible gaming** — no limits, self-exclusion, cooling-off
3. **No audit trail** for odds/line changes (lines are recomputed on request)
4. **No segregation of funds** — coins are ledger entries, not custodial
5. **No official data license** — results from commissioner entry
6. **No settlement SLA** — human-gated, unbounded delay
7. **No geo-fencing** — accessible globally
8. **No tax reporting** (W-2G equivalents)

---

## 10. Prioritized Recommendations

### Quick Wins (Low Effort)
1. **Align parlay API/bot** — either allow 2-leg in service or restrict bot to 3
2. **Fix custom spread without price adjustment** — either add price scaling or remove custom spread
3. **Add push rules for ML ties** — house should push like peer (or document intentionally)
4. **Expose cancellation/no-contest endpoint** for commissioners
5. **Add line-freeze-at-display** — store displayed odds in wager row (already done) but add UI confirmation

### Medium Effort
6. **Auto-settlement opt-in** — commissioner can enable instant settle on official result
7. **Peer market commission** — 2–5% on winnings to fund house operations
8. **Key-number spread pricing** — adjust −110 near 3/7
9. **Alternate lines** — ±1, ±2, ±3 with adjusted odds
10. **Halves/quarters markets** for spread/total_points

### High Effort / Architecture
11. **Live odds feed integration** — replace static model with external odds API + model blending
12. **Risk engine** — exposure tracking, max liability, line movement from action
13. **Player props** — requires box-score stat normalization per player
14. **Cash-out** — fair-value calc from current live odds
15. **Futures/season markets** — champion, win totals, awards

---

## 11. Conclusion

The REC wager system is a **well-engineered simulation layer** for a fantasy football league — deterministic, auditable, and integrated with the league economy. It is **not a sportsbook** and should not be marketed or operated as one. Its strengths: zero external dependency, full determinism, tight economy integration, peer social layer. Its weaknesses as a sportsbook: no risk model, crude vig, manual settlement, static lines, limited markets.

**If the product goal is "league-integrated betting simulation":** current state is solid; address quick wins.

**If the product goal is "real sportsbook":** requires ground-up rebuild with external odds feeds, risk engine, auto-settlement, compliance framework, and capitalization.

---

## Appendix: Source Files Audited

- `C:\Users\josh_\rec bot\rec-bot-core\apps\api\src\modules\wagers\odds.service.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\apps\api\src\modules\wagers\wagers.service.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\apps\api\src\modules\wagers\wagers.routes.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\packages\shared\src\wagers.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\packages\shared\src\economy.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\apps\api\src\modules\schedule\power-rankings.service.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\apps\api\src\modules\economy\economy-gate.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\apps\api\src\modules\economy\economy-backlog.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\apps\api\src\modules\league-week\advance-results.service.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\apps\bot\src\flows\wagers.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\apps\web\src\routes\hub\HubHome.tsx`
- `C:\Users\josh_\rec bot\rec-bot-core\apps\web\src\types\api.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\apps\web\src\lib\rec-api-client.ts`
- `C:\Users\josh_\rec bot\rec-bot-core\supabase\migrations\202607010001_wagers.sql`
- `C:\Users\josh_\rec bot\rec-bot-core\supabase\migrations\202607010002_wager_source_type.sql`
- `C:\Users\josh_\rec bot\rec-bot-core\supabase\migrations\202607010003_wager_counter_link.sql`