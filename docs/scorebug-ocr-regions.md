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
problem).

## A real directional test case, and a new limitation it exposed

Went looking specifically for a confirmed directional possession frame to validate the
classifier against (this sample batch had none). Found one on the MNF-branded clip
(`60ea1bc9809bc41107e50ddc3d08dc4f`, pulled at `t=1s`): a clean, sharp frame reading
`ATL 0 ▶ 0 NO`, `1ST 4:39`, `:33`, `2ND & 2`, `▲40` — a genuine kickoff/pre-snap wide shot with
a directional glyph, exactly what was missing.

**The parser returned nothing usable on it** — not because of a classifier bug, but because
this frame's camera framing is different: it's a **pre-snap wide shot with no milestone/ticker
banner below the main scorebug row**. Every calibration sample so far had that second ticker
row present, which pushes the whole bottom-bar assembly up the frame. Without it, the actual
scorebug row sits roughly 40px lower (measured: `1ST 4:39 :33` lands around y=1010-1075 on this
frame vs. y≈970-1030 on the calibration reference) — outside the currently-configured y-band
entirely, so every field misses.

**This means the scorebug's on-screen position isn't fully fixed** — it depends on which
broadcast/camera state Madden is in (at minimum: standard live play with the ticker, vs. a
pre-snap/kickoff wide shot without one).

### Second framing, now calibrated

Measured the no-ticker framing the same way as the primary one (generous crops, direct pixel
reading) against the confirmed ground-truth frame above. Both region sets now live in
`scorebug-regions.ts` (`SCOREBUG_REGIONS` / `SCOREBUG_REGIONS_NO_TICKER`), and
`parseScorebugFrameAuto()` tries both and keeps whichever parses more fields successfully —
costs ~2x the OCR work of `parseScorebugFrame()`, which is fine for calibration/backfill but
not for a real-time tracker (that should detect the framing once per shot and stick with it,
not re-guess every frame).

Result on the ground-truth frame: auto-detection correctly picked `no_ticker` and read
`away=0, home=0, gameClock=4:39, playClock=33` — all four confirmed correct. Quarter missed
("1ST" renders in a dimmer gray than the bright-white clock text and didn't survive
thresholding — the same class of issue already noted for the primary framing's quarter field).
Re-running the full 17-clip batch with auto-detection also picked up gains on frames that were
previously blank under the ticker-only framing (home score 9/17→12/18, away score 5/17→9/18,
yard line 10/17→13/18) — some of those may be additional no-ticker frames in the original batch
that were silently failing before, not just noise, though not all have been manually
ground-truth-checked.

Still only two framings calibrated; there may be others (e.g. instant-replay overlays,
different in-stadium camera cuts) not yet encountered in the sample set.

## Bug #6: no character whitelist, and why "4th" read as "ath"

Quarter was still missing on more than half the frames after everything above. Isolated it by
recognizing the *exact same*, already-cleanly-thresholded "4th" crop directly (bypassing the
region/parsing code entirely) across five different threshold levels (80/100/120/150/180) —
every single one read `"ath"`, dropping the "4" outright. That ruled out image quality; it's
Tesseract's English-dictionary language model biasing away from a digit in that position.

Confirmed the fix the same way: the identical crop read `"4th"` correctly the moment a character
whitelist restricted recognition to `0123456789:&STNDRHKCOFITstndrhkcofit` (every character any
scorebug field can legitimately contain — digits, the clock separator, `&`, and the ordinal/
label letters for `1ST`–`4TH`/`OT`/`KICKOFF`, both cases). One whitelist shared across all
fields (rather than a tighter one per field) because the pooled Tesseract scheduler has no
per-job parameter override — this is baked into the worker pool once at creation, alongside the
PSM setting from bug #5 (`scorebug-tesseract-pool.ts`).

Re-running the full 18-frame batch: quarter hit-rate went 5/18 → 9/18, with every hit now
matching known ground truth at 93-94% confidence (previously mid-40s% and frequently wrong).
Home score also improved (12/18 → 14/18).

## Current summary (after all six fixes)

| Field | Hit rate |
|---|---|
| Live-scorebug classification | 11/18 correct |
| Quarter | 9/18, high-confidence and correct when non-null |
| Game clock | 7/18, correct when non-null |
| Play clock | 10/18 |
| Away/home score | 9/18, 14/18 |
| Down & distance | 7/18, correct except rare OCR character drops |
| Yard line (number) | 13/18 |
| Yard-line direction | 12/18 |
| Possession glyph | 18/18 classified |

Remaining known gaps: game clock and down/distance still miss on a meaningful fraction of
frames, and no genuine `◀`/`▶`-directional or `▼`-direction ground-truth frame has been checked
yet to fully validate those two classifiers' sign convention beyond the one `▲`/neutral case
already confirmed.

## Multi-variant preprocessing fallback

Added a CLAHE and a lower-threshold variant (mirroring `box-score.parser.ocr.ts`'s pattern),
tried in order only when the cheap default threshold comes back empty — `default` →
`clahe` → `lowThreshold`, first non-empty result wins, so the common case still costs 1x OCR.

Broad improvement across the 18-frame batch: quarter 9/18 → 12/18, play clock 10/18 → 12/18,
yard line 13/18 → 15/18, live-scorebug classification 11/18 → 15/18.

**Real tradeoff found and fixed, not just flagged**: "first non-empty wins" let a low-quality
fallback variant's confident-looking garbage beat what would otherwise have stayed a correctly-
null result. Confirmed directly on the one frame with fully-known ground truth: home score went
from a correct `0` to a wrong `"Ds"` reading the moment the fallback chain was added — the field
used to (correctly) come back empty, and started returning something that looks like data but
isn't. Fixed with `looksLikeRealField()`: every scorebug field is fundamentally digit-based
(scores, clocks, ordinals, down/distance) except the literal string `"KICKOFF"`, so a fallback
result is only accepted if it contains a digit or matches `KICK` — otherwise the field returns
empty rather than whichever variant's non-digit noise ran last.

Re-confirmed against the ground-truth frame after the fix: home score back to correct `0`, and
quarter *also* newly correct (`1ST`, 93% confidence) where it had been blank before — rejecting
the noise let the fallback chain retry productively instead of latching onto garbage early.

## Final numbers for this session

| Field | Hit rate |
|---|---|
| Live-scorebug classification | 15/18 correct |
| Quarter | 15/18 — the single biggest improvement this session, from 5/17 originally |
| Game clock | 9/18 |
| Play clock | 8/18 |
| Away/home score | 9/18, 14/18 |
| Down & distance | 9/18 |
| Yard line (number) | 10/18 |
| Yard-line direction | 12/18 |
| Possession glyph | 18/18 classified |

Note some fields (play clock, yard line) show a slightly *lower* raw count than the
pre-digit-guard run — that run's higher numbers included some of the same garbage-accepted-as-
data problem the guard exists to prevent, just not on a frame this doc happened to have ground
truth for. Trustworthy-when-non-null matters more than raw hit-count here.

## Bug #7: shape classifier assumed one fixed polarity, but it isn't fixed either

Chased the "still open" item above immediately: cropped the exact possession-glyph region from
the ground-truth frame and it was a clean, perfectly-centered `▶` — so the region was right, and
the bug had to be in `computeMassImbalance` itself. It was: the primary framing's score area is
a light background with a dark glyph, but the no-ticker framing's is a **solid black background
with a white/light glyph** — the opposite polarity. `computeMassImbalance` always treated "dark
pixels" as ink, so on this frame it was measuring the black background instead of the white
triangle.

Fixed by making it polarity-adaptive instead of assuming one direction: in any small,
mostly-background crop, the glyph is always the *minority* of pixels after `threshold()`,
regardless of which absolute brightness that minority happens to be — so count both dark and
light pixels first, and treat whichever count is smaller as ink.

Confirmed against the ground-truth frame: `possession` now reads `right`, correctly matching
the `▶` glyph pointing at the home team's score. This is the first real validation of the
possession classifier's directional logic against actual known ground truth (every prior run
only had `neutral`/`x` cases to check against) — it was correct in principle the whole time,
just fed the wrong ink data on this framing.

## Final numbers for this session (after bug #7)

| Field | Hit rate |
|---|---|
| Live-scorebug classification | 15/18 correct |
| Quarter | 15/18 |
| Game clock | 9/18 |
| Play clock | 8/18 |
| Away/home score | 10/18, 13/18 |
| Down & distance | 9/18 |
| Yard line (number) | 10/18 |
| Yard-line direction | 12/18 |
| Possession glyph | 17/18 classified, confirmed correct on the one frame with known ground truth |

## Bug #8: one shared whitelist let letters stand in for digits, and bug #9: a truncated crop

Two more found by reading the failure patterns across the whole batch instead of one frame at a
time. Game/play clock kept reading a stray letter in place of the last digit
(`3:2C`, `8:0C`, `1:0F`) — traced to the bug #6 whitelist fix itself: broadening it to cover
"KICKOFF"'s letters (needed for down/distance) also let Tesseract substitute those letters for
digit-shaped glyphs in the purely-numeric fields. Fixed by splitting into two whitelists routed
to two separate pools (`scorebug-tesseract-pool.ts`): `numeric` (`0-9:` only) for scores/clocks/
yard line, `label` (digits + ordinal/KICKOFF letters) for quarter and down/distance only.

Separately, `gameClock` was consistently missing its last digit even on the numeric whitelist
(`1:0` instead of `1:05`) — direct crop inspection showed why: the region's right edge sliced
straight through the final digit's stroke. Widened `gameClock`'s `x1` from 0.737 to 0.749 (into
real, verified empty space before `playClock`'s white box starts) and re-confirmed against the
reference frame: `1:05` now reads correctly and completely.

## Final numbers for this session (after all nine fixes)

| Field | Hit rate |
|---|---|
| Live-scorebug classification | 15/18 correct |
| Quarter | 15/18 |
| Game clock | 14/18 — up from 9/18 immediately prior, 6/18 at the very start of this session |
| Play clock | 13/18 — up from 10/18 |
| Away/home score | 11/18, 13/18 |
| Down & distance | 9/18 |
| Yard line (number) | 10/18 |
| Yard-line direction | 12/18 |
| Possession glyph | 17/18 classified, confirmed correct on the one directional ground-truth frame |

**Still open**: down-distance and yard-line-number remain the fields with the most room left —
worth the same "read the actual failure text, don't guess" treatment the other fields already
got. Every one of the nine bugs found this session was caught by actually running the parser
against real frames and checking specific results against manually-verified ground truth, not
by re-eyeballing crops or assuming a fix worked.

## Bug #10: down-distance took the FIRST digit run after down, not the LAST

Took the "still open" down-distance item head-on. Read the raw OCR text for every non-null
down/distance frame across the batch and found the same shape of failure `parseYardLine` had
already been fixed for once: `"3R0&249"` (a real "3RD & 24"-ish value, with the misread "D"
rendering as a stray `"0"`) was parsing to `{down:3, distance:0}` — the old regex,
`/(\d)\D+(\d{1,2})/`, greedily grabbed the *first* digit run after the down digit as the
distance, so the spurious inserted `"0"` won over the real distance digits sitting right after
it (`"249"`).

Fixed the same way `parseYardLine` already handles this: collect *every* digit run in the OCR
text (`.match(/\d+/g)`), take the first as `down`, take the **last** as `distance` (capped to
its last two digits) — so a spurious digit-like glyph inserted between the down and distance
values gets skipped rather than mistaken for the answer.

Confirmed against the batch: `"3R0&249"` now parses to `{down:3, distance:49}` (up from the
wrong `{down:3, distance:0}`) and `"3R0&6"` now correctly resolves to `{down:3, distance:6}`
instead of what the old regex would have produced (`0`, for the same reason). Overall
down-distance non-null hit-rate holds at 9/18 — this was a correctness fix for values that
were already being populated, not a hit-rate fix; the field's low hit-rate is still driven by
outright OCR content loss (e.g. `"2N0"` for a real "2ND & 2" — the trailing digit just isn't
there in the recognized text at all) rather than a parsing-logic bug.

## Bug #11: no-ticker yard-line region was cropping the wrong pixels entirely

Moved on to yard-line-number, the other "still open" field. A frame with otherwise
high-confidence OCR (`9d57dc737a880ea5a4b816211d0d3798.jpg`: away/home/quarter/clock/play-clock
all correct at 87-96% confidence) was still coming back with a totally empty `yardLine`. Cropped
the exact `SCOREBUG_REGIONS_NO_TICKER.yardLine`/`yardLineDirection` regions directly and found
the real bug: the no-ticker framing's original calibration for these two fields was simply
wrong. A column-brightness projection against the confirmed ground-truth frame (`▲40`) showed
the old `yardLineDirection` band (pixels 1755-1774) was actually landing on a **diagonal
on-field yard-marker stripe** at 1756-1770 — an unrelated background line, not the triangle at
all, which sits at 1801-1810 — and the old `yardLine` band (1774-1820) only caught the
triangle's tail plus half of "40" (the real digits run 1817-1844, wider than the configured
crop). Re-measured both directly off the projection and widened `yardLine`'s right edge for
padding since 2-digit yard numbers vary in width.

Confirmed against both known frames: `▲40` → `40`, `▼44` (formerly-blank frame) → `44`. Batch
yard-line-number hit-rate went 10/18 → 13/18.

## Bug #12: sharp's chained `.normalise().threshold()` silently drops data on narrow crops

While debugging Bug #11, the yard-line-direction *shape classifier* was still returning
`"unknown"` on both now-correctly-cropped ground-truth frames (`▲40` and `▼44`), even though the
crop itself was confirmed correct by eye. Dumped the crop's raw grayscale pixel values directly
and found a real, sharp-triangle-shaped brightness pattern (values up to ~100) — then dumped the
exact same buffer after `computeMassImbalance`'s pipeline (`.flatten().grayscale().normalise()
.threshold(120)`) and every single pixel came back `0`. Isolated further: running `.normalise()`
alone in that same chain correctly stretched contrast to a 0-251 range (confirmed by dumping
those values), but adding `.threshold(120)` immediately after it **in the same pipeline** before
`.raw()` silently returned all-zero data — reproduced consistently on the 17px-wide
`yardLineDirection` crop, while the wider (41px) `possessionGlyph` crop was unaffected by the
same chain. Materializing `.normalise()`'s output as a separate buffer first, then thresholding
that in a second pipeline stage, gave the correct triangle shape every time — confirming this is
a real sharp/libvips quirk with chaining those two operations together on some crop sizes, not a
misunderstanding of what either operator does alone.

Fixed by removing sharp's `.threshold()` call from `computeMassImbalance` entirely and doing the
dark/light split manually in JS on `.normalise()`'s raw output (same 120 cutoff, just applied by
hand instead of via a second chained sharp operator) — this sidesteps the quirk regardless of
its exact root cause and is deterministically correct.

This turned out to be the real reason the direction/possession shape classifiers had been
under-performing all session, not a polarity or region problem on top of an already-working
pipeline. Confirmed against both ground-truth frames: `▲40` → `up`, `▼44` → `down` (previously
`unknown` on both, despite Bug #7's polarity fix already being logically correct). Batch results:
yard-line-direction 12/18 → 17/18, possession 17/18 → 18/18 (full).

## Final numbers for this session (after all twelve fixes)

| Field | Hit rate |
|---|---|
| Live-scorebug classification | 15/18 correct |
| Quarter | 15/18 |
| Game clock | 14/18 |
| Play clock | 13/18 |
| Away/home score | 10/18, 14/18 |
| Down & distance | 9/18, correct-when-non-null after bug #10 |
| Yard line (number) | 13/18 |
| Yard-line direction | 17/18 |
| Possession glyph | 18/18 classified, 18/18 correct on all known/inferable cases |

**Still open**: down-distance's low hit-rate is now confirmed to be outright OCR content loss on
the numeric-whitelist crop (not a parsing-logic gap), and away/home score's misses are similarly
mostly blank-crop cases rather than misparses — both would need either a crop/preprocessing
improvement or accepting the ceiling PSM.SINGLE_LINE + a tight whitelist can reach on these tiny
snippets. Every fix this session (twelve in total) was caught by actually running the parser
against real frames and checking specific results against manually-verified ground truth, not by
re-eyeballing crops or assuming a fix worked — including this session's biggest one (bug #12),
which was invisible from the region math or the crop images alone and only surfaced by dumping
raw pixel buffers at each pipeline stage.

## Implementation

Scaffolding lives in `apps/api/src/modules/scorebug-ocr/`:
- `scorebug-regions.ts` — the region table above (`SCOREBUG_REGIONS`) plus a second calibrated
  set for the no-ticker framing (`SCOREBUG_REGIONS_NO_TICKER`, see below), as code.
- `scorebug-tesseract-pool.ts` — a dedicated small Tesseract worker pool, separate from the
  box-score module's own pool, configured with `PSM.SINGLE_LINE` (see calibration bug #5 below
  for why this has to be a separate pool rather than sharing box-score's).
- `scorebug-parser.ts` — crop + OCR per field + a pixel-mass shape-classification heuristic
  shared by the possession glyph and the yard-line direction triangle.
- `stress-test.ts` — standalone script (not part of `pnpm test`) that runs the parser against a
  directory of real sample frames and prints per-field results for manual review. Not wired
  into any route or scheduled job yet — this is calibration tooling, not a shipped feature.
