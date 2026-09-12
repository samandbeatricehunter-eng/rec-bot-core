# Post-Advance Experience

The league advance should feel like the opening of a new football week/stage.

Canonical sequence:

1. Media Day Gate
2. Previous-stage Rewards Recap
3. This Week's Media Posture
4. Weekly Challenge Reveal
5. Dev Opportunity Reveal, when eligible
6. Week/Stage Live → Enter League

## Act I — Media Day
Complete the required interview conversation first.
The gate remains active until all required questions are answered.

## Act II — Rewards Recap
After Media Day closes, fade the interview UI away until only the cinematic league background remains.

Then reveal what the user/subjects earned or lost from the completed prior stage.

### Non-RTI
Show:
- Coin balance before → delta → new balance
- Franchise XP earned/spent and current balance
- Franchise XP progress toward the next whole XP when DP remainder applies
- ordinary Player XP earned by rostered players, showing only players with activity
- any audited reversals/corrections as clearly labeled adjustments

If several roster players earned Player XP, use a short positional/player carousel rather than dumping the entire roster.

### RTI
Use phases:
1. Owner: Coins + Owner XP
2. Offensive Immortal: Player XP
3. Defensive Immortal: Player XP

Skip a phase with no change unless the player/owner needs an important status notice.

### Animation
Use broadcast odometer/reel digits:
- old balance visible;
- delta appears;
- digits roll to new value;
- positive and negative values animate in their appropriate status treatment.

This is a numeric reel/odometer effect, not casino imagery.

XP:
- meter starts at the prior stored state;
- fill animates to the new state;
- whole XP counter ticks when one or more whole points are crossed;
- if a remainder/progress value exists, preserve it visually rather than rounding it away.

Animation must be skippable after it has been viewed once. The underlying reward records are immutable and server-sourced.

## Act III — Media Posture Recap
Translate the just-completed Media Day semantic answers into a short public posture for the week.

Examples:
`CONFIDENT • PATIENT • DEFENSE-FIRST`
`AGGRESSIVE • WIN-NOW • ACCOUNTABLE`

Also render one plain-English sentence:
"Arizona expects to stay patient offensively, but the team is publicly setting a high standard for its defense."

Rules:
- describe the public position taken in Media Day;
- never label this as the user's private personality;
- use only semantic fields actually captured;
- if answers were mixed, say so rather than forcing a clean label;
- store the posture snapshot for social/media callbacks.

RTI posture is per subject:
- Owner posture
- Offensive player posture
- Defensive player posture

## Act IV — Challenge Reveal
The interview question bank may be selected because of the assigned challenge, but Media Day must not reveal the challenge title or Bronze/Silver/Gold thresholds early.

After the posture recap, reveal the assignment.

### Non-RTI
Show Bronze → Silver → Gold tiles with restrained metallic tier styling.

Each tile gives the requirement in plain English.
Add:
- why REC selected this assignment;
- matchup data that supports the choice;
- what football behavior the challenge is trying to test.

### RTI
Phase 1: Offensive Immortal
- headshot
- Bronze/Silver/Gold
- plain-English selection explanation

Phase 2: Defensive Immortal
- headshot
- Bronze/Silver/Gold
- plain-English selection explanation

## Act V — Dev Opportunity
For eligible non-RTI players, reveal after the ordinary weekly challenge.

Show:
- player headshot/card
- current Dev → possible elevated Dev
- recent performance that created eligibility
- why this specific elite challenge was selected
- exact goal in plain English
- opportunity active status

Never expose internal codes.

Eligibility remains limited to Normal through Superstar; X-Factor and hidden players are not eligible.

## Persistence
Create one frozen `advance_experience` snapshot.

It includes:
- Media Day phases/questions/reporters
- responses
- reward deltas
- posture summary
- weekly challenge assignment/version
- Dev opportunity/version
- reveal completion checkpoints

Refreshes may not reroll reporters, questions, rewards or challenges.
