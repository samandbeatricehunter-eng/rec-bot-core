# Semantic Extraction Schema

Recommended normalized output for every Media Day answer:

```json
{
  "answer_id": "uuid",
  "question_id": "string",
  "owner_user_id": "uuid",
  "league_id": "uuid",
  "season": 2,
  "stage": "free_agency_open",
  "visible_text": "...",
  "source": "bank|freeform|generated_variant",
  "semantic": {
    "confidence": null,
    "certainty": null,
    "tone": null,
    "expectation": null,
    "team_need": null,
    "secondary_need": null,
    "named_target_player_id": null,
    "named_target_team_id": null,
    "player_commitment": null,
    "transaction_preference": null,
    "roster_posture": null,
    "aggression": null,
    "risk_tolerance": null,
    "time_horizon": null,
    "accountability": null,
    "draft_priority": null,
    "challenge_confidence": null,
    "game_expectation": null,
    "tactical_focus": null,
    "promise_status": null
  },
  "promises": [],
  "entity_refs": [],
  "extraction_confidence": {}
}
```

## Important derived identifiers

### Team need
Possible values should resolve to normalized positions/groups, for example:
`QB`, `HB`, `WR`, `TE`, `OL`, `EDGE`, `IDL`, `LB`, `CB`, `S`, `K`, `P`, `multiple`, `none_urgent`.

### Player commitment
`untouchable`, `core`, `valued`, `competition`, `replaceable`, `shopping`.

### Aggression
`conservative`, `measured`, `aggressive`, `all_in`.

### Transaction preference
`re_sign`, `free_agency`, `trade`, `draft`, `development`, `open`.

### Promise status
`pending`, `fulfilled`, `partial`, `pivoted`, `missed`, `superseded`.

### Accountability
`self`, `staff`, `players`, `shared`, `circumstance`, `none`.

## Promise types
- `SEASON_EXPECTATION`
- `POSITION_PRIORITY`
- `PLAYER_COMMITMENT`
- `FREE_AGENCY_PRIORITY`
- `FREE_AGENCY_AGGRESSION`
- `DRAFT_PRIORITY`
- `NAMED_TARGET`
- `WEEKLY_CHALLENGE_CONFIDENCE`
- `GAME_EXPECTATION`
- `TACTICAL_COMMITMENT`

Every promise should include:
- originating question/answer
- stage/week
- canonical entities
- semantic value
- expiration stage
- resolution source
- final status
