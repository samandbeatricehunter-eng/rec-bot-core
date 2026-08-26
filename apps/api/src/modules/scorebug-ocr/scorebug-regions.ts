// Crop regions for the Madden 27 live scorebug, as fractions of frame width/height so they
// scale to whatever resolution a live capture actually runs at. See docs/scorebug-ocr-regions.md
// for how these were derived and what's still approximate.
export type FractionalRegion = { x0: number; x1: number; y0: number; y1: number };

// Pixel-measured against a5eefdc3d94cb4cf00f9e9a50fcf2661 (a 1920x1080 M27 highlight frame,
// "CAR 25 x 28 NO", "4th 1:05", ":02", "3RD & 7", "▲39") -- see docs/scorebug-ocr-regions.md.
// The original visual-estimate pass had the vertical band ~30px too high (catching letter tops
// / the crest artwork above the bar instead of the text itself); these were re-derived by
// cropping generous bands and reading exact pixel boundaries off them directly.
export const SCOREBUG_REGIONS = {
  awayScore: { x0: 0.341, x1: 0.380, y0: 0.898, y1: 0.954 },
  possessionGlyph: { x0: 0.383, x1: 0.404, y0: 0.898, y1: 0.954 },
  homeScore: { x0: 0.406, x1: 0.447, y0: 0.898, y1: 0.954 },
  // First pass placed these one slot too far left -- the away team's crest box is wider than
  // the initial visual estimate accounted for, so "quarter"/"gameClock"/"playClock" were
  // actually landing on crest/quarter/clock respectively. Re-measured via a vertical brightness
  // projection + direct crop verification against the black quarter/clock/play-clock box.
  quarter: { x0: 0.657, x1: 0.695, y0: 0.898, y1: 0.954 },
  gameClock: { x0: 0.697, x1: 0.737, y0: 0.898, y1: 0.954 },
  playClock: { x0: 0.745, x1: 0.792, y0: 0.898, y1: 0.954 },
  downDistance: { x0: 0.818, x1: 0.917, y0: 0.898, y1: 0.954 },
  // Split from one combined region into the direction glyph (▲/▼, shape-classified like
  // possessionGlyph) and the yard number itself (OCR'd) -- verified against a direct 5x crop of
  // "▲39": triangle at ~0.940-0.955, digits at ~0.955-0.985.
  yardLineDirection: { x0: 0.940, x1: 0.955, y0: 0.898, y1: 0.954 },
  yardLine: { x0: 0.955, x1: 0.985, y0: 0.898, y1: 0.954 },
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
