import sharp from "sharp";
import Tesseract, { type Page as TesseractPage } from "tesseract.js";
import { recognizeWithPool, LEFT_VAL_X_MAX, RIGHT_VAL_X_MIN, type NormalizedWord } from "./box-score.parser.types.js";
import { statZoneMinY } from "./box-score.parser.stats.js";

// ─── Image preprocessing ─────────────────────────────────────────────────────

// "default":   global threshold — fast, proven for the dark-panel scoreboard.
// "stats":     CLAHE on the full frame — recovers stat-table digits without crushing the left column.
// "robust":    stronger CLAHE for dim rows over the bright field background.
// "highlight": high threshold (no merge of white text into a light highlight bar) —
//              recovers the selected/highlighted schedule row that the others wash out.
export type PreprocessVariant = "default" | "stats" | "robust" | "highlight";

export async function preprocessImage(
  buffer: Buffer,
  variant: PreprocessVariant = "default",
): Promise<{ processed: Buffer; width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  const originalWidth = meta.width ?? 1920;
  // Upscale small captures (e.g. 817px wide) — without this, Tesseract often returns nothing.
  const MIN_OCR_WIDTH = 1024;
  const targetWidth = Math.min(Math.max(originalWidth, MIN_OCR_WIDTH), 1920);

  // RGBA screenshots (4-channel PNGs from Discord/consoles) break sharp's
  // normalise() — the alpha channel prevents histogram stretching, producing
  // a blank white output that Tesseract sees as empty. Flatten to RGB first.
  let pipeline = sharp(buffer)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .resize(targetWidth, undefined, { fit: "inside", withoutEnlargement: false })
    .grayscale();

  if (variant === "robust") {
    pipeline = pipeline.clahe({ width: 128, height: 128, maxSlope: 3 }).negate();
  } else if (variant === "stats") {
    pipeline = pipeline.clahe({ width: 64, height: 64, maxSlope: 2 }).normalise().negate();
  } else if (variant === "highlight") {
    // A low threshold merges near-white text into a light highlight bar (the
    // selected row). A high cutoff isolates the brightest text from the bar while
    // still catching normal light-on-dark rows; negate → black text on white.
    pipeline = pipeline.threshold(200).negate();
  } else {
    pipeline = pipeline
      .normalise()
      .threshold(100)
      .negate();
  }

  const processed = await pipeline.png().toBuffer();
  const processedMeta = await sharp(processed).metadata();
  return { processed, width: processedMeta.width!, height: processedMeta.height! };
}

// ─── Word extraction ─────────────────────────────────────────────────────────

export function flattenPageWords(page: TesseractPage): Tesseract.Word[] {
  const out: Tesseract.Word[] = [];
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        out.push(...line.words);
      }
    }
  }
  return out;
}

export async function extractNormalizedWords(buffer: Buffer, variant: PreprocessVariant = "default"): Promise<{ words: NormalizedWord[]; width: number; height: number }> {
  const { processed, width, height } = await preprocessImage(buffer, variant);
  const result = await recognizeWithPool(processed, undefined, { blocks: true });

  const rawWords = flattenPageWords(result.data);

  const words: NormalizedWord[] = rawWords
    .filter((w) => {
      if (w.text.trim().length === 0) return false;
      if (w.confidence > 25) return true;
      const cx = ((w.bbox.x0 + w.bbox.x1) / 2) / width;
      // Keep low-confidence lone digits in the stat value columns — arrow rows
      // often lose one side (e.g. fourth-down 0/3) at the default threshold.
      return (cx < LEFT_VAL_X_MAX || cx > RIGHT_VAL_X_MIN) && /^[0-9Oo°©¢]+$/.test(w.text.trim()) && w.confidence > 12;
    })
    .map((w) => ({
      text: w.text.trim(),
      confidence: w.confidence,
      x: (w.bbox.x0 + w.bbox.x1) / 2 / width,
      y: (w.bbox.y0 + w.bbox.y1) / 2 / height,
      x0: w.bbox.x0 / width,
      x1: w.bbox.x1 / width,
      y0: w.bbox.y0 / height,
      y1: w.bbox.y1 / height,
    }));

  return { words, width, height };
}

// Left column digits sit on a dark panel; a global threshold often destroys them.
const LEFT_COL_CROP_FRAC = 0.32;

type LeftColPreprocess = "threshold" | "clahe" | "soft" | "highlight" | "brightbar";

async function preprocessColumnCrop(
  cropBuffer: Buffer,
  cropWidth: number,
  height: number,
  variant: LeftColPreprocess,
): Promise<Buffer> {
  let pipeline = sharp(cropBuffer)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .grayscale();

  if (variant === "threshold") {
    pipeline = pipeline.normalise().threshold(80).negate();
  } else if (variant === "clahe") {
    pipeline = pipeline.clahe({ width: 48, height: 48, maxSlope: 3 }).normalise().negate();
  } else if (variant === "highlight") {
    // Mirrors the full-frame "highlight" pass — the CFB Score row sits in a bright
    // highlighted bar whose near-white digits a normalised/CLAHE'd threshold can
    // merge into the light background and lose. A high, un-normalised cutoff
    // isolates just the brightest pixels instead of redistributing the histogram.
    pipeline = pipeline.threshold(200).negate();
  } else if (variant === "brightbar") {
    // The Score row's digits are dark text on a light bar — the opposite polarity
    // from every other (light-text-on-dark) row in the table. Thresholding without
    // negating keeps that dark-on-light polarity, which is the orientation Tesseract
    // is best trained on, instead of inverting it into a hard-edged rectangle that
    // tends to swallow thin strokes like "1".
    pipeline = pipeline.threshold(180);
  } else {
    pipeline = pipeline.normalise().linear(1.6, -35).sharpen().negate();
  }

  return pipeline
    .resize(cropWidth * 2, height * 2, { fit: "fill" })
    .png()
    .toBuffer();
}

async function preprocessLeftCrop(
  resized: Buffer,
  cropWidth: number,
  height: number,
  variant: LeftColPreprocess,
): Promise<Buffer> {
  const crop = await sharp(resized)
    .extract({ left: 0, top: 0, width: cropWidth, height })
    .toBuffer();
  return preprocessColumnCrop(crop, cropWidth, height, variant);
}

function mapLeftCropWords(rawWords: Tesseract.Word[], ocrWidth: number, ocrHeight: number): NormalizedWord[] {
  return rawWords
    .filter((w) => {
      if (w.text.trim().length === 0) return false;
      if (w.confidence > 18) return true;
      return /^[0-9/:>\-]+$/.test(w.text.trim()) && w.confidence > 8;
    })
    .map((w) => {
      const cx = (w.bbox.x0 + w.bbox.x1) / 2 / ocrWidth;
      const mappedX = cx * LEFT_COL_CROP_FRAC;
      return {
        text: w.text.trim(),
        confidence: w.confidence,
        x: mappedX,
        y: (w.bbox.y0 + w.bbox.y1) / 2 / ocrHeight,
        x0: (w.bbox.x0 / ocrWidth) * LEFT_COL_CROP_FRAC,
        x1: (w.bbox.x1 / ocrWidth) * LEFT_COL_CROP_FRAC,
        y0: w.bbox.y0 / ocrHeight,
        y1: w.bbox.y1 / ocrHeight,
      };
    });
}

/** Pull numeric tokens out of noisy left-column OCR (e.g. ">143" -> "143"). */
function salvageDigitWords(words: NormalizedWord[]): NormalizedWord[] {
  const out: NormalizedWord[] = [];
  for (const w of words) {
    const text = w.text.replace(/[Oo]/g, "0");
    const ratio = text.match(/(\d+)\s*[\/:]\s*(\d+)/);
    if (ratio) {
      out.push({ ...w, text: `${ratio[1]}/${ratio[2]}`, confidence: w.confidence * 0.92 });
      continue;
    }
    const digits = text.match(/\d+/);
    if (!digits || digits[0].length > 4) continue;
    out.push({ ...w, text: digits[0], confidence: w.confidence * 0.88 });
  }
  return out;
}

const RIGHT_COL_CROP_FRAC = 0.32;

function mapRightCropWords(rawWords: Tesseract.Word[], ocrWidth: number, ocrHeight: number): NormalizedWord[] {
  const xOffset = 1 - RIGHT_COL_CROP_FRAC;
  return rawWords
    .filter((w) => {
      if (w.text.trim().length === 0) return false;
      if (w.confidence > 18) return true;
      return /^[0-9/:>\-]+$/.test(w.text.trim()) && w.confidence > 8;
    })
    .map((w) => {
      const cx = (w.bbox.x0 + w.bbox.x1) / 2 / ocrWidth;
      const mappedX = xOffset + cx * RIGHT_COL_CROP_FRAC;
      return {
        text: w.text.trim(),
        confidence: w.confidence,
        x: mappedX,
        y: (w.bbox.y0 + w.bbox.y1) / 2 / ocrHeight,
        x0: xOffset + (w.bbox.x0 / ocrWidth) * RIGHT_COL_CROP_FRAC,
        x1: xOffset + (w.bbox.x1 / ocrWidth) * RIGHT_COL_CROP_FRAC,
        y0: w.bbox.y0 / ocrHeight,
        y1: w.bbox.y1 / ocrHeight,
      };
    });
}

export async function extractRightColumnWords(buffer: Buffer): Promise<NormalizedWord[]> {
  const meta = await sharp(buffer).metadata();
  const originalWidth = meta.width ?? 1920;
  const targetWidth = Math.min(Math.max(originalWidth, 1024), 1920);
  const resized = await sharp(buffer)
    .resize(targetWidth, undefined, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  const actualWidth = resizedMeta.width ?? 1920;
  const actualHeight = resizedMeta.height ?? 1080;
  const cropWidth = Math.max(1, Math.round(actualWidth * RIGHT_COL_CROP_FRAC));
  const cropLeft = actualWidth - cropWidth;

  const variants: LeftColPreprocess[] = ["clahe", "threshold", "soft", "highlight", "brightbar"];
  const allWords: NormalizedWord[] = [];

  for (const variant of variants) {
    const crop = await sharp(resized)
      .extract({ left: cropLeft, top: 0, width: cropWidth, height: actualHeight })
      .toBuffer();
    const processed = await preprocessColumnCrop(crop, cropWidth, actualHeight, variant);
    const result = await recognizeWithPool(processed, undefined, { blocks: true });
    allWords.push(...mapRightCropWords(flattenPageWords(result.data), cropWidth * 2, actualHeight * 2));
  }

  return dedupeWords(allWords);
}

export async function extractLeftColumnWords(buffer: Buffer): Promise<NormalizedWord[]> {
  const meta = await sharp(buffer).metadata();
  const originalWidth = meta.width ?? 1920;
  const targetWidth = Math.min(Math.max(originalWidth, 1024), 1920);
  const resized = await sharp(buffer)
    .resize(targetWidth, undefined, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  const actualWidth = resizedMeta.width ?? 1920;
  const actualHeight = resizedMeta.height ?? 1080;
  const cropWidth = Math.max(1, Math.round(actualWidth * LEFT_COL_CROP_FRAC));

  const variants: LeftColPreprocess[] = ["clahe", "threshold", "soft", "highlight", "brightbar"];
  const allWords: NormalizedWord[] = [];

  for (const variant of variants) {
    const processed = await preprocessLeftCrop(resized, cropWidth, actualHeight, variant);
    const result = await recognizeWithPool(processed, undefined, { blocks: true });
    allWords.push(...mapLeftCropWords(flattenPageWords(result.data), cropWidth * 2, actualHeight * 2));
  }

  return dedupeWords(allWords);
}

export function dedupeWords(words: NormalizedWord[]): NormalizedWord[] {
  const out: NormalizedWord[] = [];
  for (const w of words) {
    const existing = out.find(
      (e) => Math.abs(e.x - w.x) < 0.02 && Math.abs(e.y - w.y) < 0.015,
    );
    if (!existing) {
      out.push(w);
      continue;
    }
    if (w.confidence > existing.confidence) {
      out[out.indexOf(existing)] = w;
    }
  }
  return out;
}

export function mergeStatWords(
  leftWords: NormalizedWord[],
  rightWords: NormalizedWord[],
  bodyWords: NormalizedWord[],
  defaultWords: NormalizedWord[],
  statsTopY: number,
): NormalizedWord[] {
  const zoneMinY = statZoneMinY(statsTopY);
  const inZone = (w: NormalizedWord) => w.y >= zoneMinY;
  const left = dedupeWords([
    ...leftWords.filter((w) => inZone(w) && w.x < LEFT_VAL_X_MAX),
    ...bodyWords.filter((w) => inZone(w) && w.x < LEFT_VAL_X_MAX),
    ...salvageDigitWords(defaultWords.filter((w) => inZone(w) && w.x < LEFT_VAL_X_MAX)),
  ]);
  const right = dedupeWords([
    ...rightWords.filter((w) => inZone(w) && w.x > RIGHT_VAL_X_MIN),
    ...bodyWords.filter((w) => inZone(w) && w.x > RIGHT_VAL_X_MIN),
    ...salvageDigitWords(defaultWords.filter((w) => inZone(w) && w.x > RIGHT_VAL_X_MIN)),
  ]);
  const body = dedupeWords(bodyWords.filter(inZone));
  const defaultFill = dedupeWords(defaultWords.filter((w) => inZone(w) && w.x >= LEFT_VAL_X_MAX && w.x <= RIGHT_VAL_X_MIN));

  const merged = [...left, ...right, ...body];
  for (const w of defaultFill) {
    const overlap = merged.some((m) => Math.abs(m.x - w.x) < 0.02 && Math.abs(m.y - w.y) < 0.015);
    if (!overlap) merged.push(w);
  }
  return merged;
}

function mergeWordLists(...lists: NormalizedWord[][]): NormalizedWord[] {
  const out: NormalizedWord[] = [];
  for (const list of lists) out.push(...list);
  return out;
}

export function groupIntoRows(words: NormalizedWord[], yTolerance = 0.04): NormalizedWord[][] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => a.y - b.y);
  const rows: NormalizedWord[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const lastRow = rows[rows.length - 1];
    const lastY = lastRow.reduce((s, w) => s + w.y, 0) / lastRow.length;
    if (Math.abs(sorted[i].y - lastY) < yTolerance) {
      lastRow.push(sorted[i]);
    } else {
      rows.push([sorted[i]]);
    }
  }

  return rows;
}
