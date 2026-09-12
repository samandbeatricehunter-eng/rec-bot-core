# Tweets / Social Media Handoff

## Two user-facing paths

### League Tweets channel
The configured Tweets channel is commandless.

1. A human types a message in the Tweets channel.
2. REC captures the text and removes the original public message.
3. REC shows a temporary public Yes/No confirmation that only the source user can answer.
4. No or timeout purges the candidate.
5. Yes:
   - ordinary league: publish as the user's team/organization;
   - RTI: open an ephemeral identity choice for Offensive Prospect / Owner / Defensive Prospect.
6. The confirmed post becomes a canonical social root eligible for replies, quotes, receipts and future callbacks.

Do not register a member `/twitter` command.

### Commissioner `/tweets`
Commissioner-only publishing remains.

The identity choices come from `tweet_personalities.json`, not a hardcoded command file.
The command supports:
- root post
- reply
- quote
- image
- generated or commissioner-written text
- team/player/owner focus
- controlled custom handle for full commissioners

## Canonical fixed media identities
The bank contains exactly ten slots:
- Marcus Vale
- Vaughn Price
- Elliot Mercer
- Darius King
- REC Insider
- NFL Front Office
- Gridiron Gospel
- TMZ
- Random Hater
- Random Fan

Random Fan/Hater also use their dedicated account and angle banks.

## Story graph
Every post stores root/parent/quote relationships. Replies must never exist without a root.
User-authored confirmed tweets may later receive:
- reporter reaction
- player/team reaction
- fan/hater reaction
- rivalry callback
- receipt resurfacing

## Fact discipline
Writers use verified context only.
Never invent:
- trades
- private conflict
- injuries/injury intent
- off-field misconduct
- roster membership
- scores/stats not present in context

Templates/blueprints are idea structures, not permission to fabricate facts.

## Repetition control
Use event + subject + claim-type + stance fingerprints plus account/story fatigue.

The social system is event-driven. A weekly 300-post ceiling is a hard maximum, never a target.
