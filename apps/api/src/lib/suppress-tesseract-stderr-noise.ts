// tesseract.js's WASM core (tesseract.js-core) wires its native module's default printErr
// straight to console.error, and that debug/statistics printf code (Leptonica's histogram
// stats -- "Mean=", "SD=", "Median=", "Upper/Lower quartile=", "Total count=",
// "Bottom=X, top=Y, base=Z, x=W") runs during ordinary image-thresholding regardless of which
// OCR engine mode is selected -- OEM.LSTM_ONLY does NOT remove it (verified against the
// installed tesseract-core-lstm.wasm binary directly; both the LSTM-only and full cores contain
// the same debug strings). tesseract.js v7 doesn't expose a public hook to override the WASM
// module's printErr, so this filters the known-noise lines out of process.stderr.write itself --
// the actual final sink console.error routes through. A single finished stream-autoclip capture
// (stream-autoclip.service.ts's processCapture) can fan out into tens of thousands of Tesseract
// recognitions in one unthrottled burst, each capable of emitting several of these lines, which
// previously hit Railway's 500 logs/sec rate limit and dropped real log lines alongside the noise.
// Only ever drops lines matching this exact, narrow set of patterns -- everything else (including
// genuine errors) passes through unchanged.
const NOISE_PATTERN = /^(Upper quartile=|Lower quartile=|Mean=\s|SD=\s|Median=\d|Median=0|Min=.*Really=|Max=.*Really=|Range=\d|Total count=|Bottom=\d+, top=\d+, base=\d+, x=\d+)/;

/** Exported for testing -- true if this line is the known Leptonica histogram-stats noise (or
 * blank), false for anything else (including real errors, which must always pass through). */
export function isTesseractStderrNoise(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "" || NOISE_PATTERN.test(trimmed);
}

let installed = false;

export function suppressTesseractStderrNoise(): void {
  if (installed) return;
  installed = true;
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: any, ...args: any[]) => {
    const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : null;
    if (text !== null && isTesseractStderrNoise(text)) return true;
    return (realWrite as any)(chunk, ...args);
  }) as typeof process.stderr.write;
}
