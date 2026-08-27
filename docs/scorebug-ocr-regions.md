# Madden Scorebug OCR — Region Reference

Calibration notes for reading the live in-game scorebug (score, clock, quarter, down &
distance, yard line, possession) out of Madden 27 broadcast footage. This is prep work for an
automated live-game tracker / highlight clipper — see the cost/architecture discussion that
preceded this doc for the broader system design (local OCR + FFmpeg, not cloud vision APIs).

## How the calibration samples were gathered

No new footage needed to be captured. REC already has real Madden 27 gameplay clips uploaded
as league highlights, and (per `apps/api/src/modules/media/media.service.ts`'s
`migrateMirroredHighlightsToStream`) nearly all of them end up as genuine Cloudflare Stream
assets. Stream videos in this account are created with `requireSignedURLs: false`
(`apps/api/src/lib/cloudflare-stream.ts:79,109`), which means **any stream UID's frames are
publicly fetchable with no auth** via Cloudflare's thumbnail endpoint:

```
https://videodelivery.net/<uid>/thumbnails/thumbnail.jpg?time=<Ns>&width=1920&height=1080
```

`time` accepts a plain seconds offset (`2s`, `8s`, ...); `width`/`height` request whatever
resolution you want — the underlying source is full 1080p even though the *default* thumbnail
size (no width/height given) is a downscaled 640×360. Pulling several timestamps across many
existing highlights gave a free, zero-setup, zero-infrastructure way to survey real scorebug
variety without asking anyone to record anything new.

## Findings

### One scorebug layout, multiple broadcast-package skins

The assumption going in was "3-4 different scoreboards, different locations and designs."
What's actually true, from ~20 sampled frames across 17 highlights in the M27 league: **the
scorebug's layout and pixel position is identical** regardless of the game's broadcast
package — only a small logo in the bottom-left corner changes (plain Madden shield, `SNF`,
`MNF` all observed). The crop regions below should hold for every package skin.

### Possession is a glyph-shape swap, not a per-team dot

The separator glyph *between* the two scores normally renders as a neutral `x`. When one team
has the ball, it renders as a directional triangle (`◀`/`▶`) pointing toward the possessing
team's score instead. This is the actual possession signal — it lives in the same crop region
as the score separator, not a separate marker beside each team name.

### Not every frame is the live scorebug

Madden's pre-snap "play call" screen (shown between plays) uses a **completely different
HUD layout** — score and down/distance appear in different positions alongside "Subs / Preplay"
UI chrome. Any real-time tracker needs to positively detect "is this the live-gameplay
scorebug" before trusting these crop regions, not just always sample them.

### Down & distance sometimes isn't down & distance

On kickoffs, that field reads literally `"KICKOFF"` instead of a down/distance string. Treat
that as a valid non-error state, not a parse failure.

## Crop regions (fractions of frame width/height)

Expressed as fractions so they scale to whatever resolution the live capture actually runs at.
Measured against 1920×1080 reference frames; **these are a first-pass estimate from visual
inspection, not pixel-measured** — expect to tighten them once real detection runs against a
larger sample.

| Field | x0 | x1 | y0 | y1 |
|---|---|---|---|---|
| Away score digits | 0.341 | 0.380 | 0.898 | 0.954 |
| Possession glyph (`x` / `◀` / `▶`) | 0.383 | 0.404 | 0.898 | 0.954 |
| Home score digits | 0.406 | 0.447 | 0.898 | 0.954 |
| Quarter (`1st`–`4th`, `OT`) | 0.657 | 0.695 | 0.898 | 0.954 |
| Game clock (`M:SS`) | 0.697 | 0.737 | 0.898 | 0.954 |
| Play clock (`:SS`) | 0.745 | 0.792 | 0.898 | 0.954 |
| Down & distance (or `KICKOFF`) | 0.818 | 0.917 | 0.898 | 0.954 |
| Yard-line direction (▲/▼, shape-classified) | 0.940 | 0.955 | 0.898 | 0.954 |
| Yard-line number | 0.955 | 0.985 | 0.898 | 0.954 |

Team abbreviation/crest/record regions are intentionally not listed — REC already knows both
teams and their records from the matchup record, so there's nothing to OCR there.

Direction, score, quarter, clock, and possession are all collected because the user's stated
goal is per-clip *context*, not just a headline score — down the line, "who has the ball, what
down/distance, what's the field position, and which way are they headed" is what lets automated
clip selection distinguish a garbage-time snap from a 4th-and-goal.

### Calibration history

Three real bugs were found by actually running the parser and inspecting raw output against
known frames, not by re-eyeballing:

1. **The vertical band was ~30px too high** (first pass). It caught the tops of letters and the
   team-crest artwork above the text instead of the text itself.
2. **Quarter/game-clock/play-clock were each one slot too far left** (second pass). The away
   team's crest box is wider than the initial visual estimate assumed, so those three regions
   were actually landing on crest/quarter/clock respectively (one position early). Found via a
   vertical brightness projection across the row plus direct crop verification.
3. **The shape classifier measured the wrong pixels entirely** (third pass, found while adding
   yard-line direction). `threshold()` without a following `negate()` leaves the light
   background as the bright (255) pixels and the dark glyph as 0 — the classifier's "count
   bright pixels as ink" logic was measuring the *background*, not the glyph, which happened to
   still produce plausible-looking (but backwards) results for the roughly-symmetric "x"
   glyph. It only became obviously wrong once a real triangle (`▲`) landed in the "down" bucket
   instead of "up". Fixed by counting dark pixels as ink instead.
4. **A thin strip of green-field pixels bled into the very top of every crop**, found by
   dumping per-row dark-pixel counts for the yard-line-direction region: rows 0–6 were *fully*
   dark (the field, not the glyph) and were swamping the small triangle's real top/bottom
   balance. Nudging `y0` from 0.889 to 0.898 excludes it — this also incidentally raised OCR
   confidence on several text fields.
5. **Tesseract's default page-segmentation mode (PSM 3, "fully automatic") returns nothing on
   tiny isolated snippets.** Confirmed directly: the exact same cleanly-preprocessed play-clock
   crop (a small white box reading ":02" on solid black) came back as empty text under PSM 3 and
   read correctly as "02" under `PSM.SINGLE_LINE`. This wasn't visible from the region math at
   all — it only showed up as an unexplained 0/17 hit rate on one field after an unrelated fix.
   Fixed by giving scorebug OCR its own dedicated Tesseract worker pool
   (`scorebug-tesseract-pool.ts`) configured with `PSM.SINGLE_LINE`, instead of sharing the
   box-score module's pool (which needs the default full-page mode for its own large,
   document-like crops — the two can't share one scheduler with different desired PSMs, since
   tesseract.js's scheduler API has no per-job parameter override).

## Stress test results (after all five fixes above)

Run via `stress-test.ts` against all 17 uploaded highlights in the M27 league (one frame per
clip, pulled live from Cloudflare Stream at `t=2s`, 1920×1080). Non-null hit rate out of 17:

| Field | Hit rate | Notes |
|---|---|---|
| Live-scorebug classification | 10/17 correctly `true` | The known play-call-screen samples correctly classify `false` |
| Quarter | 7/17 | Correct when non-null; OCR sometimes drops the leading digit ("4th" → "ath"), and the regex correctly refuses to guess rather than misparse |
| Game clock | 6/17 | Accurate when it hits (`1:14`, `1:11`, `1:18`, `1:13`, `5:11` all matched known values) |
| Play clock | 10/17 | Was 0/17 before the PSM fix (bug #5) — now the best-improved field |
| Away/home score | 5/17, 9/17 | Correct when non-null against manually-checked ground truth |
| Down & distance | 7/17 | Correct when non-null, except one case where OCR noise inserted an extra digit into "1ST" and threw off the parsed down number |
| Yard line (number) | 10/17, 65-96% confidence when it hits | Confirmed correct against ground truth (`39`, `34`, `26`, `10`) |
| Yard-line direction | 12/17, confirmed correct on the one verified ground-truth frame (`▲39` → `up`) | Every hit in this batch happened to read `up` — the classifier's logic is confirmed correct for that case, but a genuine `down` sample hasn't been checked by eye yet |
| Possession glyph | 17/17 classified, all `neutral` in this batch | Mechanism now correctly measures the glyph; this sample batch happened to have no confirmed directional (`◀`/`▶`) frame to validate against |

**Takeaway:** every field is *accurate when it returns a non-null result*, and hit-rate improved
substantially once the PSM bug was found. Remaining gaps: quarter/game-clock still miss on
roughly half the frames (font-legibility issue with certain digits/letters, not a region
problem), and this sample batch never happened to contain a directional possession or "down"
yard-line frame to validate those two cases against. Likely next steps: per-field preprocessing
variants (mirroring how `box-score.parser.ocr.ts` runs multiple threshold/CLAHE variants and
merges results) to recover the quarter/clock misses, and pulling more samples specifically
looking for a directional possession/yard-line frame.

## Implementation

Scaffolding lives in `apps/api/src/modules/scorebug-ocr/`:
- `scorebug-regions.ts` — the region table above, as code.
- `scorebug-tesseract-pool.ts` — a dedicated small Tesseract worker pool, separate from the
  box-score module's own pool, configured with `PSM.SINGLE_LINE` (see calibration bug #5 below
  for why this has to be a separate pool rather than sharing box-score's).
- `scorebug-parser.ts` — crop + OCR per field + a pixel-mass shape-classification heuristic
  shared by the possession glyph and the yard-line direction triangle.
- `stress-test.ts` — standalone script (not part of `pnpm test`) that runs the parser against a
  directory of real sample frames and prints per-field results for manual review. Not wired
  into any route or scheduled job yet — this is calibration tooling, not a shipped feature.
