# Weekly Challenge Targeting Engine

## Frozen assignment record

Every issued challenge freezes:
- challenge ID and formula version
- scope TEAM|PLAYER
- target player ID/name/position if PLAYER
- game/team/opponent IDs
- Bronze/Silver/Gold grading rules
- optional Dev promotion rule
- targeting reason codes
- source context snapshot
- issue and lock timestamps

Refreshes cannot reroll it.

## TEAM default

TEAM is the normal scope when the storyline is team/unit wide or no player has a strong targeting reason. Target 75–85% of ordinary assignments.

## PLAYER target score

### Very high
- active Dev promotion opportunity
- verified record chase with current-game relevance

### High
- active stored Twitter/social beef with current opponent player
- active rivalry + clearly poor prior showing
- rivalry + same opposing star materially relevant
- strong prior Media Day commitment centered on player

### Medium-high
- 3+ game hot streak
- major cold streak/response storyline
- recent acquisition with meaningful role
- prior challenge/Media Day receipt

### Medium
- milestone proximity
- strong matchup edge/disadvantage
- recent breakout

### Low
- generic star spotlight

PLAYER challenge must not exist only because a player is famous/high-OVR.

## Twitter beef requirements

Eligible only with stored social evidence: root/reply/quote chain or explicit player-beef story object. Never infer beef from unrelated posts.

Story record tracks player/opponent IDs, thread ID, verified statements, heat, first/last interaction, and times used for targeting.

## Rivalry + poor prior showing

Strong trigger requires:
1. active rivalry/current rematch;
2. target played prior meeting;
3. prior performance clearly poor relative to role/baseline;
4. current matchup still relevant;
5. canonical data supports description.

Allowed: “Lamb was held to 42 yards in the previous meeting.”
Not automatically allowed: “CB Reed locked Lamb down.”
Direct attribution requires direct matchup/coverage evidence.

## Defensive revenge targeting

If opposing player dominated last time, a defender may be targeted, but challenge must use gradeable metrics. Without direct coverage attribution, avoid individual yards-allowed claims and use team/unit-supported outcomes.

## Target fatigue

Default:
- avoid same player in consecutive ordinary weeks;
- avoid >2 ordinary PLAYER assignments in rolling 6 weeks.

Override only for Dev opportunity, record chase, rivalry/beef rematch, or explicit unresolved storyline.

## PLAYER eligibility

Target must be currently rostered, active/eligible, canonically mapped, gradeable by position, have enough role/sample context, and reasonably expected to participate.

## Contextual threshold generation

Use season average, last 3/5, usage/share where derivable, opponent allowed production, league percentile, prior meeting, OVR/Dev context, rivalry/playoff context, and variance.

Bronze = meaningful/reachable.
Silver = clearly above expectation.
Gold = difficult/high-end.

Dev promotion rule is separately frozen and may align with Gold but does not have to.

## Dev promotion challenge

- always PLAYER scope;
- named player displayed;
- Bronze/Silver/Gold can reward PPP/FPP;
- Dev promotion only occurs if explicit promotion rule is satisfied;
- lower tier success does not promote Dev.

## Rewards

TEAM:
- Bronze/Silver/Gold → FPP only.

PLAYER:
- Bronze/Silver/Gold → FPP + target player's PPP.

Highest tier only.

## Availability changes

Before lock: if target traded/released/inactivated, invalidate and regenerate.
After lock but before game: if genuinely unavailable, VOID rather than substitute unfairly.
After game start: never regenerate.

VOID = no failure, no reward, no reroll after results.

## Corrections

Corrected import can change grade. Write reversal, re-grade, issue corrected reward. Never delete original ledger event.
