# Persona / RTI Content Handoff

## Current Persona DNA catalog
`persona_dna.json` contains:
- 60 selectable Persona DNA traits
- 4 Mindset Focus options
- questions 11–20 with direct answer-to-trait mapping
- maximum equipped Persona DNA count: 10

Hard Persona incompatibilities are not inferred from English-language opposites.
Compatibility state is:
- Known Compatible
- Known Incompatible
- Unknown

Only verified Madden behavior or authoritative data promotes a pair to Known Incompatible.

## Player Traits
`player_traits.json` contains:
- shared Madden player traits
- QB-specific traits
- MIKE-specific traits
- position-specific questions that map answers to actual traits

## Origins supporting banks
The package also includes:
- `persona_interview.json`
- `playstyle_interview.json`
- `iq_tests.json`
- archetype/characteristic config
- contract/milestone support config

These files provide the concrete questionnaire/config content needed for RTI Origins.

## Applied vs requested Persona
Store:
- requested Persona DNA
- commissioner-applied Persona DNA
- unapplied/blocked traits
- compatibility observation/version

Media should use the effective/applied Persona where Madden application matters.

## Mindset Focus
Available values:
- Financial
- Personal Accolades
- Love Of The Game
- Winning

## Real players / Legends
Persona DNA for real people is a REC football-simulation profile based only on public football-facing evidence. It is not a claim about private psychology.
