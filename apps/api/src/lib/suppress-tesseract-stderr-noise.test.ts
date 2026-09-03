import assert from "node:assert/strict";
import test from "node:test";
import { isTesseractStderrNoise } from "./suppress-tesseract-stderr-noise.js";

test("recognizes every observed Leptonica histogram-stats noise line", () => {
  const noiseLines = [
    "Upper quartile=0.00",
    "Lower quartile=0.00",
    "Mean= 0.00",
    "SD= 0.00",
    "Median=0.00, ile(0.5)=0.00",
    "Min=0.00 Really=0",
    "Max=0.00 Really=0",
    "Range=1",
    "Total count=0",
    "Bottom=0, top=93, base=0, x=0",
    "",
    "   ",
  ];
  for (const line of noiseLines) assert.equal(isTesseractStderrNoise(line), true, `expected noise: ${JSON.stringify(line)}`);
});

test("never drops real error output", () => {
  const realLines = [
    "Error: Cannot find module 'foo'",
    "TypeError: Cannot read properties of undefined (reading 'x')",
    "[ERROR] Failed to spend Player XP.",
    "UnhandledPromiseRejection: something broke",
    "at Object.<anonymous> (/app/dist/index.js:12:34)",
  ];
  for (const line of realLines) assert.equal(isTesseractStderrNoise(line), false, `expected NOT noise: ${JSON.stringify(line)}`);
});
