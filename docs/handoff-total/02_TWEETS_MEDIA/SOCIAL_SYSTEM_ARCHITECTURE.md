# REC Social Universe — Canonical Architecture

## Goal
The social system should feel like a persistent sports-media ecosystem, not a random tweet generator.

Every public post is produced from four layers:
1. verified league event/fact;
2. a story/relationship state;
3. a specific account's stable personality and beat;
4. a discourse move that adds something new to the conversation.

## Claim-first generation
Do not ask an LLM to "write a tweet about this game" from raw context.

Build a `social_claim_plan` first:
- event ID
- verified fact IDs
- subject IDs
- stance: report / praise / criticize / question / compare / project / receipt
- certainty: confirmed / observed / projection / opinion
- story arc ID
- parent/quoted post if applicable
- prohibited claims
- persona
- intended conversational move

Only after that plan passes validation should wording be generated.

## Persistent account memory
For each fixed account store:
- recent subjects
- recent stances
- recent signature phrases
- open predictions
- prior receipts used
- active relationships/story arcs
- last interaction with each team/player
- phrase fingerprints

This prevents accounts from contradicting themselves or repeating the same gimmick every week.

## Thread behavior
Replies must address the actual claim they reply to.
Each reply chooses one move:
- agree + add context
- qualify
- challenge
- add a new verified fact
- ask a specific question
- surface a stored receipt

Do not generate a reply that merely restates the root post.
Default thread depth: 0–4 turns. Exceptional rivalry/story arcs may reach 6.

## Story arcs
A story can persist across advances:
- rivalry
- trade evaluation
- player breakout
- player slump
- contract watch
- playoff push
- prior Media Day promise
- RTI player beef
- scheme/usage concern
- Dev opportunity

Each arc stores:
- subjects
- first event
- current state
- evidence
- heat
- fatigue
- unresolved questions
- last post time
- eligible future triggers

## Posting rhythm
The 300-post weekly/stage league limit is a hard ceiling, not a target.

Queue timing should form natural bursts:
- some posts back-to-back;
- some 3–5-post bursts;
- some 5–60 minute gaps;
- major breaking events can front-load reactions;
- low-interest advances should create far fewer posts.

Do not fill unused capacity.

## Reporter roles
The eight fixed accounts in `media_personality_profiles.json` are the primary REC Universe voices.
Random fan/hater accounts are supporting texture only.

## Player voices
Player social behavior may draw from:
- RTI Persona DNA / Mindset
- applied player traits
- public performance
- contract/public transaction state
- rivalry/story state

For ordinary real-world roster players, generated voice is a REC simulation persona. Never present it as a claim about private real-world psychology.

## Fact discipline
Never fabricate:
- a transaction
- an offer
- a roster membership
- a score/stat
- an injury
- private conflict
- off-field conduct
- a quote
- a contract preference
- a scheme preference

`playerBestOvr - playerSchemeOvr` may support a usage/fit question, not a factual claim that the player dislikes the scheme.

## Authenticity controls
- repeated phrase fingerprint penalty
- same-subject fatigue
- same-stance fatigue
- minimum new-information requirement for replies
- account beat eligibility
- event importance score
- story-arc continuity bonus
- contradiction check against account memory
- numeric claim verifier
- entity membership verifier
- quote/receipt exact-source verifier
