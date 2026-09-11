# UI, Roster and Player Cards

## Surface system
Create one reusable broadcast surface primitive.

Properties:
- dark navy/charcoal
- safe-scale texture layer
- dark contrast overlay
- restrained 1px metallic edge
- optional thin REC red state edge
- no primary-card blur
- no generic glow except selected/critical state

Converge generic card and football-panel treatments rather than maintaining two parallel design systems.

## Centered layout
Full bleed:
- navigation
- cinematic background
- intentional hero

Normal content:
- centered max-width shell
- visible desktop margins

Recommended:
- 1380–1440 px max desktop shell
- 24–48 px desktop gutter minimum
- 12 px mobile gutter minimum

Simple settings must not occupy giant horizontal slabs.

## Texture QA
The supplied texture reference is low enough resolution that it must not be stretched across giant cards.

Create appropriate derivatives.

Development warning when:
- rendered raster > about 1.5× effective source
- aspect ratio distorted
- texture stretched to panel dimensions
- card empty-space ratio excessive
- typography/art is too small for container

Test:
- 390×844
- 768×1024
- 1366×768
- 1920×1080
- 2560×1440

## Roster mini cards
Position groups:
- QB
- HB/FB
- WR
- TE
- OL
- EDGE
- DL
- LB
- CB
- S
- K/P

Mini card:
- headshot
- name
- position
- OVR
- Dev
- source badge
- XP
- next-upgrade state
- top 3 meaningful ratings

Use position-aware key pools so "top 3" is football-relevant, not a blind sort.

## Expanded player pages

### Overview
- header
- top physicals
- position-aware top 7
- archetype / Dev
- abilities
- headline season stats
- contract summary
- XP state

### Attributes
Grouped:
- Athleticism
- Ball Carrier
- Receiving
- Passing
- Blocking
- Defense/Tackling
- Pass Rush
- Coverage
- Kicking
- Durability

`+` opens Spend Player XP modal.

### Player Profile
- age
- college
- height/weight
- hand
- jersey
- archetype
- relevant personal/build details

Head # remains commissioner/catalog tooling unless intentionally exposed.

### Persona & Traits
- Persona DNA
- Mindset
- Player Traits
- applied/effective distinction where relevant

Do not expose internal psychology-dimension scores.

### Abilities
- X-Factor
- Superstar abilities/slots
- locks
- eligibility
- REC progression state
- pending application state

### Contract
- years
- salary
- bonus
- restructure/extension state

### Season Stats
Current REC league season.

### Career in REC
Only production since REC tracking start for that league.

## Spend Player XP modal
Header:
- player
- position
- OVR
- Dev
- available XP

Rows:
- readable attribute label
- current
- after
- XP cost
- +1 control
- disabled reason

Queue legal changes.
Reprice sequentially.
Never show projected OVR.

Submit:
- one atomic server transaction
- closes on success
- creates Pending Item
- card enters waiting-for-Madden-verification state

Mobile:
- one-column attributes
- sticky remaining-XP / submit footer
