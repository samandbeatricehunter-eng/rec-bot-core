// Crop regions for the Madden 27 live scorebug, as fractions of frame width/height so they
// scale to whatever resolution a live capture actually runs at. See docs/scorebug-ocr-regions.md
// for how these were derived and what's still approximate.
export type FractionalRegion = { x0: number; x1: number; y0: number; y1: number };

// Re-measured 2026-08-28 against a real live-captured Twitch VOD frame (rec_stream_capture_jobs
// id 4c6debdb-daa8-445e-af97-72dd5258b6cc, second=2487, ground truth "CIN 10 x 24 DEN", "2nd
// 0:26", ":40", "2ND & 10", "▲41") -- the first time this calibration was ever validated against
// genuine live-capture footage rather than a static reference frame. The whole y-band was
// landing almost entirely on grass above the bar (confirmed via direct crop: the old y0=0.898
// caught nothing but field, and y1=0.954 cut off before the real text even started) -- every
// field needed the same ~0.049 downward shift, verified one at a time via direct crop inspection
// exactly like the original calibration's own methodology. x-positions were mostly already
// correct; only homeScore and quarter needed small nudges (both were clipping a character at
// their old x0). The previous calibration frame was apparently a rendered highlight/replay
// screen, not genuine live gameplay HUD -- explaining why it never surfaced this until a real
// live capture was actually run through this diagnostic.
export const SCOREBUG_REGIONS = {
  awayScore: { x0: 0.341, x1: 0.380, y0: 0.947, y1: 0.990 },
  possessionGlyph: { x0: 0.383, x1: 0.404, y0: 0.947, y1: 0.990 },
  // x0 nudged from 0.406 -- the old value clipped the "2" of a 2-digit home score.
  homeScore: { x0: 0.401, x1: 0.447, y0: 0.947, y1: 0.990 },
  // x0/x1 nudged right from 0.657/0.695 -- the old window left dead space on the left and
  // clipped the "d" of "2nd" on the right.
  quarter: { x0: 0.665, x1: 0.703, y0: 0.947, y1: 0.990 },
  gameClock: { x0: 0.697, x1: 0.749, y0: 0.947, y1: 0.990 },
  // playClock keeps a small y0 nudge below the shared band, same rationale as before this
  // recalibration: its white box has a dark top border that risks reading as solid "ink" after
  // threshold+negate right at the shared band's top edge.
  playClock: { x0: 0.754, x1: 0.792, y0: 0.951, y1: 0.990 },
  downDistance: { x0: 0.818, x1: 0.917, y0: 0.947, y1: 0.990 },
  yardLineDirection: { x0: 0.940, x1: 0.955, y0: 0.947, y1: 0.990 },
  yardLine: { x0: 0.955, x1: 0.985, y0: 0.947, y1: 0.990 },
} as const satisfies Record<string, FractionalRegion>;

// Second framing: pre-snap/kickoff wide shots don't render the milestone/ticker row below the
// main scorebug bar, which shifts the whole bar ~40-50px lower than the "ticker present"
// framing above -- the x-positions shift slightly too (different zoom level). Pixel-measured
// against 60ea1bc9809bc41107e50ddc3d08dc4f at t=1s ("ATL 0 ▶ 0 NO", "1ST 4:39", ":33",
// "2ND & 2", "▲40"). See docs/scorebug-ocr-regions.md's "no-ticker framing" section.
export const SCOREBUG_REGIONS_NO_TICKER = {
  awayScore: { x0: 0.336, x1: 0.367, y0: 0.949, y1: 0.991 },
  possessionGlyph: { x0: 0.383, x1: 0.404, y0: 0.949, y1: 0.991 },
  homeScore: { x0: 0.424, x1: 0.456, y0: 0.949, y1: 0.991 },
  quarter: { x0: 0.665, x1: 0.690, y0: 0.949, y1: 0.991 },
  gameClock: { x0: 0.697, x1: 0.732, y0: 0.949, y1: 0.991 },
  // Same top-border fix as the ticker framing's playClock, proportionally scaled to this
  // framing's shorter band height.
  playClock: { x0: 0.738, x1: 0.784, y0: 0.958, y1: 0.991 },
  downDistance: { x0: 0.825, x1: 0.870, y0: 0.949, y1: 0.991 },
  // yardLineDirection/yardLine were badly miscalibrated: a column-brightness projection against
  // the ground-truth frame ("▲40") showed the old yardLineDirection band (0.914-0.924, pixels
  // 1755-1774) was actually landing on a diagonal on-field yard-marker stripe at 1756-1770 --
  // not the triangle at all, which sits at 1801-1810 -- and yardLine (0.924-0.948, 1774-1820)
  // only caught the triangle's tail plus half of "40" (the real digits run 1817-1844). Both
  // re-measured directly off the same column projection; the digits get extra right padding
  // since 2-digit yard numbers vary in width.
  yardLineDirection: { x0: 0.936, x1: 0.945, y0: 0.949, y1: 0.991 },
  yardLine: { x0: 0.944, x1: 0.965, y0: 0.949, y1: 0.991 },
} as const satisfies Record<string, FractionalRegion>;

export type ScorebugFieldName = keyof typeof SCOREBUG_REGIONS;

/** Convert a fractional region into absolute pixel bounds for a specific frame size, clamped
 * so rounding never produces an out-of-bounds `sharp.extract` call. */
export function regionToPixels(region: FractionalRegion, frameWidth: number, frameHeight: number) {
  const left = Math.max(0, Math.round(region.x0 * frameWidth));
  const top = Math.max(0, Math.round(region.y0 * frameHeight));
  const right = Math.min(frameWidth, Math.round(region.x1 * frameWidth));
  const bottom = Math.min(frameHeight, Math.round(region.y1 * frameHeight));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
