# REC Media Day Answer Bank — Design Specification

## Core principle
Do not treat an answer as text only. Every selectable answer has two layers:

1. **Visible answer** — what the owner says publicly.
2. **Semantic payload** — structured facts REC can safely act on later.

This lets REC identify intent on the user's behalf without trying to reverse-engineer every statement later.

## What the answer system should identify
The semantic payload can identify:
- confidence and certainty
- season expectation
- team/position priority
- roster posture
- transaction preference
- free-agency aggression
- draft strategy
- risk tolerance
- player commitment
- named target or player being discussed
- accountability/blame posture
- challenge confidence
- intended tactical emphasis
- stated goal / promise
- time horizon
- whether a later result fulfilled, partially fulfilled, pivoted from, or missed the earlier promise

## Answer construction
Each question should map to an `answer_family`. The UI shows 4–6 context-appropriate answers chosen from that family.

Every answer option contains:
```json
{
  "answer_id": "free_agency_posture.targeted",
  "visible_text": "We have a short list...",
  "semantic": {
    "aggression": "measured",
    "risk_tolerance": "medium",
    "roster_posture": "targeted_upgrade",
    "transaction_preference": "free_agency"
  }
}
```

Placeholders are resolved before display.

## Named entities
When an answer includes a player/team/position:
- store both display text and canonical IDs;
- never store only a name string;
- reject a template if the placeholder cannot resolve;
- do not infer a player who is not on the relevant roster.

## Promise ledger
Certain semantic fields create a durable `media_promise` record:
- `team_need`
- `pre_fa_priority`
- `named_target`
- `draft_priority`
- `player_commitment`
- `expectation`
- `challenge_confidence`
- `transaction_preference`

Later stages can compare actual roster/game outcomes against these statements.

Example:
- Pre-FA answer → `{ team_need: "CB", aggression: "aggressive" }`
- Post-FA roster import → signed CB
- Result → `promise_status = fulfilled`

Or:
- Pre-FA answer → `{ team_need: "CB" }`
- No CB acquired
- Result → `promise_status = missed` or `pivoted`, based on follow-up answer.

## Freeform answers
Users may optionally type their own answer. Freeform text should be passed through an extraction layer that outputs the same semantic schema.

The extractor should return:
- detected values
- confidence per field
- evidence span
- whether confirmation is needed

Low-confidence or consequential fields such as `named_target`, `player_commitment=shopping`, or `guarantee` should not be silently asserted. Ask the user to confirm or store them as `unconfirmed`.

## Confidence thresholds
Suggested:
- >= 0.90: auto-store
- 0.75–0.89: auto-store non-consequential fields, mark inferred
- < 0.75: do not use for future accountability

## Generated wording
The system may personalize wording to owner/team/player context, but semantic meaning must remain locked to the selected answer option. Generated prose should never change the underlying intent.
