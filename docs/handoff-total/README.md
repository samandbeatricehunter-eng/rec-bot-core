# REC Complete Master Handoff

This package is self-contained for the current REC Leagues product handoff.

It contains both:
1. the complete implementation/master-plan documents; and
2. the actual content payloads needed by the media, challenge, Persona, RTI and Tweets systems.

## Read order
1. `00_MASTER/MASTER_PLAN.md`
2. `00_MASTER/IMPLEMENTATION_HANDOFF.md`
3. `01_CONTENT_BANKS/README.md`
4. `02_TWEETS_MEDIA/TWEETS_SETUP.md`
5. `03_PERSONA_RTI/PERSONA_SYSTEM.md`
6. `08_AUDIT/CONTENT_VALIDATION.json`

## Content included
- 190 primary weekly challenge entries
- 10 Special Teams challenge entries
- 1,120 offseason/stage Media Day questions
- 950 weekly challenge-linked Media Day questions
- 160 RTI offense questions
- 160 RTI defense questions
- 160 RTI owner questions
- semantic answer families and deterministic answer bank
- clarifying-answer bank
- confidence / contract / Dev Media Day bank
- confidence / contract / Dev tweet hooks
- 984 contextual tweet blueprints
- 10 fixed commissioner/media identities
- random fan/hater account and angle banks
- current 60-trait Persona DNA catalog
- Mindset Focus catalog
- player-trait catalog and mapped questions
- RTI Persona / playstyle / IQ supporting configs
- media schema/data capability/accuracy rules
- final Legend catalog workbook

## Source-of-truth rule
Where an implementation detail conflicts with a bank's old embedded assumption, the clean master-plan documents and the dedicated selection/setup rules in this package control.

Before coding, re-audit current `main`; the repository has continued to change while the handoff was being assembled.

## Remaining product configuration
The only intentionally unresolved numeric progression configuration is the exact node-by-node Franchise XP cost map for the six-department non-RTI progression tree. Do not invent it.


## Media/social depth pass
This package includes the approved post-advance flow:
Media Day → Rewards Recap → Media Posture → Challenge Reveal → Dev Opportunity → Enter League.

Validated media/social contents:
- 950 unique weekly challenge-linked Media Day questions
- 1120 offseason/stage Media Day questions
- RTI Media Day: 160 offense / 160 defense / 160 owner
- conditional tone follow-up bank
- 8 deep fixed media/reporter profiles
- 1968 unique social generation blueprints
- 41 social event playbooks
- persistent fan/hater community pools
- reward recap and media-posture presentation specification
