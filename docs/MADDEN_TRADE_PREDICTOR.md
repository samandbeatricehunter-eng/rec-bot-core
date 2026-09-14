# Madden CPU Trade Predictor

Version: `madden-cpu-trade-v1.0.0`

## Purpose

REC's Trade Center has two separate questions to answer:

1. **Is the trade reasonably balanced between two users?**
2. **If one side is CPU-controlled, how likely is Madden to accept the package?**

Those are not the same question. The existing `rec-trade-value-v1.0.0` model remains the user-to-user fairness model. `madden-cpu-trade-v1.0.0` is a separate predictor intended to estimate Madden CPU acceptance.

EA does not publish the exact trade-acceptance equation or its coefficients. The predictor therefore must never be presented as Madden's proprietary formula. It is an evidence-backed approximation built from documented Madden inputs, public trade-value work, and REC's live league data.

## Public evidence used

EA has publicly described the following as trade/player-value considerations across recent Franchise systems:

- player overall / quality;
- position and positional scarcity;
- position-specific age/value curves;
- development trait;
- team positional need and roster context;
- scheme / role context;
- contract status and financial investment;
- rookie/control value;
- competitive window (contending vs. rebuilding);
- draft-pick value and team draft philosophy;
- immediate impact of an incoming player;
- draft prospects available when deciding whether to move picks;
- a reciprocity effect for acquiring highly valued assets.

EA has also explained that the user-facing Trade Difficulty setting changes the value of the **human user's package** rather than CPU-to-CPU valuation. The exact numeric difficulty multipliers are not public.

Primary public references used during design:

- EA Madden NFL 27 Franchise Mode deep dive: https://www.ea.com/games/madden-nfl/madden-nfl-27/news/madden-27-franchise-mode
- EA Madden NFL 21 Franchise trade-value overhaul discussion: https://forums.ea.com/discussions/madden-nfl-franchise-discussion-en/madden-nfl-21-franchise-update-deep-dive-march-2021/9184712
- Madden 24 developer trade-difficulty discussion mirrored through Operation Sports: https://forums.operationsports.com/forums/forum/football/madden-nfl-football/937947-madden-nfl-24-franchise-mode-details-revealed/
- Operation Sports Madden Trade Calculator discussions: https://forums.operationsports.com/forums/madden-nfl-football/937634-madden-trade-calculator-v4-0-a.html

## Model architecture

For every player, the predictor calculates a base value from OVR and applies context multipliers:

```text
PlayerValue =
  BaseOVRValue
  × PositionValue
  × DevelopmentValue
  × PositionSpecificAgeValue
  × ContractValue
  × CPUPositionNeed
  × CompetitiveWindowValue
```

When the CPU is **giving up** a player, an additional retention premium can apply:

```text
CPURequiredPlayerValue = PlayerValue × RetentionPremium
```

Draft picks use:

```text
PickValue =
  DraftSlotValue
  × FutureYearDiscount
  × CompetitiveWindowPickPreference
```

The human side is then adjusted by Trade Difficulty:

```text
AdjustedHumanOffer = HumanOfferValue × TradeDifficultyMultiplier
```

The core acceptance ratio is:

```text
ValueRatio = AdjustedHumanOffer / CPURequiredValue
```

That ratio is converted to a probability with a logistic curve. A ratio near 1.0 is intentionally treated as uncertain rather than a guaranteed acceptance because Madden can apply hidden/contextual rules that are not publicly exposed.

## OVR curve

The model intentionally does not make OVR linear. Replacement-level players should have little value while elite players become disproportionately expensive.

Current base curve:

```text
aboveReplacement = max(0, OVR - 58)
BaseOVRValue = aboveReplacement ^ 1.82 × 0.108
```

This keeps the same general value currency used by REC's existing trade fairness model while allowing the CPU model to apply stronger context.

## Position multipliers

Current priors:

| Position | Multiplier |
| --- | ---: |
| QB | 2.55 |
| LE / RE | 2.02 |
| LOLB / ROLB | 1.92 |
| CB | 1.90 |
| WR | 1.78 |
| DT | 1.68 |
| LT | 1.62 |
| RT | 1.56 |
| FS / SS | 1.48 |
| MLB | 1.40 |
| TE | 1.32 |
| HB | 1.25 |
| LG / RG / C | 1.10 |
| FB | 0.70 |
| K / P | 0.50 |

These are priors, not EA-published coefficients.

## Development multipliers

Current priors:

| Development | Multiplier |
| --- | ---: |
| Normal | 1.00 |
| Star | 1.08 |
| Superstar | 1.18 |
| X-Factor | 1.30 |

The age curve naturally reduces the practical premium on older players. Young Superstar/X-Factor players can also receive a retention premium when the CPU would have to give them up.

## Age curves

The predictor uses `rec_players.age` whenever it exists. Only when exact age is missing does it fall back to `21 + years_pro`, and that fallback lowers confidence.

Age is position-specific. The current groups are:

- QB;
- HB / FB;
- WR / CB / FS / SS;
- TE;
- offensive line;
- defensive line / linebacker;
- K / P;
- generic fallback.

The curves model longer useful windows for QB and OL and much faster value loss for HB.

## Contract / cap model

Contract value includes:

- years of control remaining;
- cap hit relative to an estimated position/OVR market cost;
- rookie/young-player control premium;
- whether the receiving CPU has enough cap room when salary cap is enabled.

A cheap multi-year deal can raise value. An expiring or expensive deal can lower it. A player whose current cap hit exceeds the CPU's available room receives an additional penalty.

## Team need

REC derives position need from the CPU team's actual imported roster using `computeRecTeamPositionNeeds`.

The current CPU need multiplier ranges approximately from:

```text
0.88× (very little need)
...
1.22× (maximum need)
```

This means identical players can have different values to different CPU teams.

## Competitive window

After at least four games, standings data classifies the CPU as:

- `contend`;
- `neutral`;
- `rebuild`.

Before four games, the predictor stays neutral rather than overreacting to a tiny sample.

Contenders receive a modest premium for high-OVR immediate-impact players and slightly discount picks. Rebuilders value young players and picks more heavily and discount older veterans.

## Draft picks

Draft picks use an exponential curve shaped like traditional NFL/Madden draft-value charts:

```text
base = max(3, 150 × exp(-0.025 × (overallPick - 1)))
```

If the exact pick slot is unknown, the middle of the round is used and confidence is reduced.

Future-year priors:

| Years out | Multiplier |
| --- | ---: |
| Current | 1.00 |
| +1 | 0.88 |
| +2 | 0.78 |
| +3 or more | 0.70 |

Rebuilding teams value picks more; contenders value them somewhat less.

## CPU retention premium

CPU outgoing assets can require more than their neutral market value. Current retention triggers include:

- 88+ OVR players;
- 92+ and 95+ elite tiers;
- valuable quarterbacks;
- young Superstar/X-Factor players;
- players at a position of significant CPU need.

This is intended to approximate Madden's observed reciprocity/scarcity behavior rather than assuming that buying and selling values are perfectly symmetric.

## Trade Difficulty

Current priors:

| Setting | Human-package multiplier |
| --- | ---: |
| Very Easy | 1.22 |
| Easy | 1.10 |
| Normal | 1.00 |
| Hard | 0.90 |
| Very Hard | 0.82 |

EA has publicly described the direction of this mechanism, but not the exact numbers. Non-Normal settings therefore emit an explicit warning and should be among the first coefficients recalibrated from real results.

## Probability curve

After all valuation and retention modifiers:

```text
p = 1 / (1 + exp(-11 × (ValueRatio - 1.025)))
```

The displayed probability is clamped to 1–99%.

Bands:

| Probability | Label |
| --- | --- |
| < 15% | Very unlikely |
| 15–39% | Unlikely |
| 40–59% | Borderline |
| 60–84% | Likely |
| 85%+ | Very likely |

## Confidence

Version 1 intentionally never reports `high` confidence. EA's closed implementation has not been independently reproduced and the current coefficients are priors.

Confidence improves when:

- the CPU has at least four games of standings context;
- exact player ages are imported;
- exact draft slots are known;
- Normal trade difficulty is used.

Confidence falls when those inputs are estimated.

## Trade Center UX requirements

The calculator must show both models independently:

### REC Fairness

- Team A value;
- Team B value;
- percentage spread;
- balanced / favors A / favors B.

### Madden CPU Acceptance

When exactly one team is CPU-controlled:

- predicted acceptance percentage;
- probability band;
- model confidence;
- CPU contender/rebuild/neutral profile;
- trade difficulty;
- adjusted human offer value;
- modeled CPU requirement;
- offer/requirement ratio;
- estimated additional value needed;
- per-asset value and meaningful modifiers;
- plain-language reasons;
- explicit model limitations.

If both teams are user-controlled, CPU acceptance is not applicable but fairness still is. CPU-vs-CPU is also not presented as a user acceptance prediction.

## Calibration roadmap

The long-term goal is to replace priors with REC-observed coefficients without requiring a dedicated manual testing project.

For every attempted CPU trade, the eventual calibration dataset should store:

- league / season;
- Madden version / predictor version;
- CPU team and human team;
- week and standings state;
- trade difficulty;
- all player/pick/coin assets;
- full prediction snapshot;
- actual Madden accepted/rejected result;
- timestamp.

Once enough observations exist, measure:

- accuracy at the 50% threshold;
- Brier score;
- calibration by probability bucket;
- false-positive / false-negative rates;
- error by position;
- error by age band;
- error by development trait;
- error by contender/rebuild state;
- error by trade difficulty.

Do not blindly fit every coefficient to a small sample. Recommended progression:

1. 25–50 observations: inspect obvious systematic misses only.
2. 100+ observations: tune difficulty, retention and pick-year priors.
3. 250+ observations: tune position/dev/age interactions.
4. 500+ observations: consider a fitted logistic model with the current hand-authored model retained as a fallback and audit baseline.

Every coefficient change should increment the predictor version so historical predictions remain auditable.

## Important implementation rule

Do not overwrite the fairness model with the CPU model. They intentionally answer different questions and should remain independently versioned.