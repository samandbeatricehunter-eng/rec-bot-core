# Legends, Persona and Pending Items

## Evidence-first catalog

Every Legend field is either:
- evidence-supported
- projection/canon-supported for fictional/crossover entries
- explicitly not applicable
- blocked for review

Real-player evidence should align to a defined peak season/era so ratings, archetype, abilities and Persona represent the same version of the player.

### Physical ratings
Use shared measurement ladders and film context.

Global speed ladder:
- <= 4.20: 99
- 4.21–4.29: 98
- 4.30–4.34: 97
- 4.35–4.39: 96
- 4.40–4.44: 94
- 4.45–4.49: 92
- 4.50–4.54: 90
- 4.55–4.59: 88
- 4.60–4.64: 86
- 4.65–4.69: 84
- 4.70–4.74: 82
- 4.75–4.79: 80
- 4.80–4.84: 78
- 4.85–4.89: 76
- 4.90–4.94: 74
- 4.95–4.99: 72
- 5.00–5.09: 68
- 5.10–5.19: 64
- 5.20+: roughly 58–61

Game-speed film adjustment should normally stay within about +/-2 of measurement-supported speed.

Acceleration:
- use 10-yard split/burst evidence
- do not derive as `SPD + x`

Agility/COD:
- use 3-cone/shuttle and movement film
- straight-line speed is not a substitute

Jump:
- vertical/broad first
- receiving/contest film is secondary

Strength:
- functional football strength plus measurements

Dev Trait/archetype never inflates raw physical ratings.

### Technical anchors
Use same-position peer anchors for calibration rather than target OVR.

Examples:
- QB arm: Marino / Elway / Favre
- QB accuracy: Brady / Manning / Montana / Brees
- QB mobility: Vick / Cunningham / Young
- HB elusiveness: Barry Sanders / Walter Payton / LaDainian Tomlinson
- HB power: Jim Brown / Bo Jackson / Earl Campbell / Bettis
- WR routes: Jerry Rice / Marvin Harrison / Fitzgerald
- WR vertical: Moss / Calvin Johnson / Bob Hayes
- TE receiving: Gonzalez / Gates / Witten
- TE physical/blocking: Gronk / Ditka
- OT pass protection: Muñoz / Walter Jones / Joe Thomas
- EDGE speed rush: Derrick Thomas / Von Miller / Kevin Greene
- ILB complete/run: Ray Lewis / Patrick Willis / Butkus
- CB man: Revis / Deion / Champ Bailey
- S range: Ed Reed / Earl Thomas
- K accuracy: Justin Tucker / Vinatieri
- K power: Janikowski
- P power: Ray Guy / Lechler

Negative anchors matter too: elite one-dimensional traits must not inflate unrelated ratings.

## Persona DNA
For real players, use public football-facing behavior only.

Store:
- evidence profile
- compatibility-resolved requested profile
- commissioner-applied profile
- history

Media behavior uses applied/effective Persona, not private-personality claims.

## Ability package
Validate:
- position
- Madden availability
- slot eligibility
- archetype fit
- no impossible duplicate/conflict

## Catalog readiness
A Legend is ready only when:
- required identity/biography complete
- 54 attributes complete
- Dev complete
- abilities complete or explicitly not applicable
- Persona/Mindset/Traits complete
- headshot policy satisfied
- evidence metadata has no blocking flag
- OVR/Head # capture state is known

A Legend may be sellable with OVR/Head # still uncaptured only because the first post-launch creation is the mechanism that captures them.

## OVR and Head # first capture
Keep separate nullable canonical fields with build version and audit source.

Current Pending Items at feature launch are grandfathered.

For new Pending Items:
- unknown OVR → required OVR field
- unknown Head # → required Head # field
- known field → read-only display, no editable input

First-write-wins:
- matching concurrent capture continues
- conflicting capture becomes catalog review
- never silently overwrite

## Replacement target
Always purchase-instance scoped.

Store on the purchase/application audit record only.

The next Legend purchase starts fresh.

## RTI Persona apply
Pending Item shows requested DNA as commissioner toggles.

Commissioner checks only what they actually applied in Madden.

Store requested/applied/unapplied lists and compatibility version.

Mismatch on later verification is explicit.
