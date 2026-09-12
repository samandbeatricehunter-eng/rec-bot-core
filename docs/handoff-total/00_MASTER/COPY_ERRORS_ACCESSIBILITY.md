# User-Facing Copy, Errors and Accessibility

## Language standard
Member-facing copy should sound like a competent sports-league product.

Use:
- plain English
- short sentences
- direct football terms
- neutral tone
- specific next step

Avoid:
- raw enum names
- database/API vocabulary
- robotic permission language
- accusatory phrasing
- stack traces
- unexplained abbreviations

Canonical terms:
- Commissioner
- Team
- Player
- Game / Matchup
- Coins
- Savings
- Franchise XP
- Player XP
- Pending Items
- Applied in Madden
- Waiting for EA verification
- Availability
- Game Time
- League Advance
- Practice Squad
- Injured Reserve (IR)
- Overall (OVR)

## Status messages
Answer:
1. what happened
2. whether the user needs to act
3. what happens next

Example:
`Upgrades submitted. A commissioner will apply them in Madden. REC will verify the changes after the next EA sync.`

## Recoverable errors
Say:
- what could not be completed
- whether anything changed
- next action

Example:
`We couldn't save the game time. Nothing changed. Try again, or contact a commissioner if it keeps happening.`

## Permissions
Prefer:
`This action is only available to league commissioners.`

Avoid:
`Unauthorized.`

## Copy inventory
Audit:
- slash replies
- Discord buttons/modals
- site toasts
- form hints
- empty states
- Pending Items
- imports/sync
- store/purchases
- scheduling
- rules
- progression
- roster/player cards
- media/highlights
- league management

## Accessibility
- sentence case for normal labels
- actions begin with verbs where practical
- do not rely on color alone
- define uncommon abbreviations
- maintain readable mobile text
- keyboard/focus support for modals and sliders
- highlight trim timeline must also support keyboard-adjustable start position and exact timestamp input as an accessibility fallback
