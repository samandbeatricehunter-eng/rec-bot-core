# Media, Social Feed and Weekly Highlights

## Social event graph
Persist verified events and storylines.

Account participation is probabilistic and role-aware.

Avoid a fixed mechanical cadence.

Immediate breaking posts, fan/player reaction, later analyst response and long-tail receipts should occur on different timing distributions.

Minor events may produce no post.

## Player beef
Separate player beef from franchise rivalry.

Inputs:
- Persona DNA
- prior interaction
- scheduled matchup proximity
- prior close/upset/playoff game
- Rivalry Heat
- receipts

Pregame intensity can increase over the one-to-three weeks before the matchup.

Game-week direct interaction becomes more likely for highly competitive/outspoken players.

## Repetition control
Semantic fingerprint:
`event + subject + claim type + stance`

Add account topic fatigue and storyline cooldown.

## User Tweets channel
Confirmed user-authored content becomes a canonical social root and may receive:
- replies
- quote posts
- fan reaction
- rivalry callbacks
- later receipts

## Highlight viewer
Dedicated league page:
- current reel parts
- weekly archive
- full source clips
- selected 10-second cut
- matchup/final score metadata
- part number

## Highlight approval
Commissioner uses video player + draggable fixed 10-second timeline region.

Default region = last 10 seconds.

Preview plays only selected region and stops at its end.

Persist exact start/end timestamps.

## Weekly reel manifest
Freeze after successful Advance:
- correct league/week
- submitted before cutoff
- approved/visible
- media asset alive
- linked final game/result available

Reel rendering is asynchronous and non-blocking.

Deterministic ordering:
1. commissioner featured
2. GOTW
3. exceptional significance
4. team/matchup variety
5. remainder

Split into 10-clip parts.

## Video pipeline
Per clip:
- trim 10 seconds
- normalize
- overlay scoreboard header
- render segment

Per part:
- short crossfades
- short REC/week slate
- H.264/AAC output
- target 9.5 MB
- verify <=10 MB
- adaptive quality fallback
- upload web master + Discord derivative

## Discord delivery
Configured Highlights channel.

Part 1:
- `@everyone`
- video/reel
- viewer link

Later parts:
- no repeated mass ping
- post directly after Part 1

Check bot permission for mass mention.

If missing permission:
- post normally
- create commissioner-visible warning

No eligible clips:
- no empty reel
- no ping

Regeneration:
- new artifact version
- update/replace Discord message when possible
- no second mass ping unless commissioner explicitly chooses it
