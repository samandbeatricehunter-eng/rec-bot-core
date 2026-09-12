# Raw Player Payload Utilization — ## Use now ### confRating
High-value dynamic Player Confidence. Normalize and snapshot. ### signatureSlotList
High-value ability data for ability-eligible players. Current live dataset has 404 players with non-empty ability-slot data. The raw slot object can contain:
- locked / empty state
- OVR threshold
- ability rank
- ability title
- ability description
- activation/deactivation descriptions
- activation state/config
- logo ID Use this as an authoritative observed source for the player's Madden-side ability slot structure where present. ### Ability Lab enhancement
For any player displayed in Ability Lab:
1. load current imported `signatureSlotList`;
2. normalize each slot into: - slot index - OVR threshold - locked/empty - current ability title - current ability rank - description - activation/deactivation text
3. cross-check REC unlock/node eligibility;
4. only offer changes that both REC rules and Madden-side slot eligibility support;
5. after next roster import, compare slot state to confirm the in-game assignment actually changed;
6. emit `ABILITY_LOADOUT_CHANGED` media event when a meaningful user-requested change is confirmed. Public media wording should describe role/skill-set adjustment, not "slot 3 changed from X to Y." ### teamSchemeOvr
4,134 reviewed rows have a positive value; 1,880 differ from playerBestOvr, with observed difference as low as -22.
This can be a useful **scheme-fit signal** after the enum/meaning is validated in the current Madden build. Use initially as internal context:
- player appears less effective in current team scheme than his best OVR;
- potential fit mismatch;
- trade-target analysis. Do not overstate it publicly until the precise semantics are confirmed. ### productionGrade / physicalGrade / intangibleGrade / sizeGrade
These are populated to varying degrees and can enrich internal scouting/context.
Use cautiously because their exact current Madden calculation is not yet decoded.
Good for ranking/filtering and question eligibility; avoid presenting them as official public "grades" until validated. ### runStyle
This is genuinely populated (16 observed values), but its enum meanings are not decoded in the current implementation.
Store/monitor; do not translate to media language until mapped. ## Do not use
- Madden `experiencePoints`
- Madden `skillPoints`
REC's own XP/progression system is authoritative.
- rosterGoalList: present but empty across all 5,222 reviewed rows
- desiredBonus: currently 0 across reviewed rows
- reSignStatus: currently constant 24
- most legacy trait fields: structurally present but currently all 0
- durabilityGrade: currently 0
- injuryType: currently constant 98 and therefore not useful by itself
- draftRound / draftPick / legacyScore: intentionally excluded by product decision ## Legacy trait-field review
The following reviewed raw fields are present but currently all `0`:
bigHitTrait, clutchTrait, coverBallTrait, decisionMakerTrait, dLBullRushTrait,
dLSpinTrait, dLSwimTrait, dropOpenPassTrait, feetInBoundsTrait,
fightForYardsTrait, highMotorTrait, hPCatchTrait, lBStyleTrait,
penaltyTrait, playBallTrait, posCatchTrait, predictTrait, qBStyleTrait,
sensePressureTrait, stripBallTrait, throwAwayTrait, tightSpiralTrait,
yACCatchTrait. Do not tie these fields into REC's custom trait system yet. There is no useful current data behind them. REC's authored Natural Characteristics / player-trait system remains independent.
