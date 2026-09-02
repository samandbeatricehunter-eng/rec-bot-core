// Dedicated Tesseract worker pools for scorebug OCR -- deliberately separate from the box-score
// module's pool (box-score.parser.types.ts) rather than sharing it, because scorebug crops need
// a different page-segmentation mode. Box-score crops are large, document-like regions where
// Tesseract's default full-page segmentation (PSM 3) works fine; scorebug crops are tiny,
// isolated single-line snippets (a score, a clock, a down/distance string) where PSM 3 reliably
// returns nothing at all -- confirmed directly: the exact same preprocessed play-clock crop that
// PSM 3 read as empty text read correctly as "02" under PSM.SINGLE_LINE. Sharing one scheduler
// across two different desired PSMs isn't safe (per-job parameter overrides aren't a thing in
// tesseract.js's scheduler API), so this gets its own small pool instead.
//
// Two pools, not one, for the same reason: a single shared character whitelist broad enough to
// cover every field (digits + ordinal letters + KICKOFF's letters) let Tesseract substitute a
// whitelisted letter for a digit-shaped glyph in purely-numeric fields -- confirmed directly,
// clock fields started reading "3:2C"/"8:0C"/"1:0F" (a stray C/F standing in for what should be
// a trailing "0"/"5") only after the whitelist was broadened to include those letters for
// "KICKOFF"/ordinals. Numeric-only fields (scores, clocks, yard line) get a tight
// digits-and-colon-only whitelist; only quarter and down/distance (which can legitimately read
// "4TH" or "KICKOFF") get the broader one.
import Tesseract from "tesseract.js";

const OCR_POOL_SIZE = Number(process.env.SCOREBUG_OCR_WORKER_POOL_SIZE ?? 2);

export type ScorebugWhitelistKind = "numeric" | "label";

const WHITELISTS: Record<ScorebugWhitelistKind, string> = {
  numeric: "0123456789:",
  label: "0123456789:&STNDRHKCOFITstndrhkcofit",
};

const schedulers = new Map<ScorebugWhitelistKind, Tesseract.Scheduler>();
const schedulerInitializing = new Map<ScorebugWhitelistKind, Promise<Tesseract.Scheduler>>();

async function getScheduler(kind: ScorebugWhitelistKind): Promise<Tesseract.Scheduler> {
  const existing = schedulers.get(kind);
  if (existing) return existing;
  const inFlight = schedulerInitializing.get(kind);
  if (inFlight) return inFlight;

  const initializing = (async () => {
    const scheduler = Tesseract.createScheduler();
    const workers = await Promise.all(
      Array.from({ length: Math.max(1, OCR_POOL_SIZE) }, async () => {
        const worker = await Tesseract.createWorker("eng");
        await worker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
          tessedit_char_whitelist: WHITELISTS[kind],
          // LSTM-only skips the "Legacy" engine's Otsu-thresholding pass entirely -- that pass
          // is where Leptonica prints raw debug histogram stats (quartiles/median/SD) straight
          // to stdout via native printf, bypassing tesseract.js's own logger hook completely.
          // That's the source of the constant "Upper quartile=.../Bottom=.../Really=..." spam
          // flooding Railway logs -- this is the documented fix, not a workaround.
          tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
        });
        return worker;
      }),
    );
    for (const worker of workers) scheduler.addWorker(worker);
    schedulers.set(kind, scheduler);
    schedulerInitializing.delete(kind);
    return scheduler;
  })();
  schedulerInitializing.set(kind, initializing);
  return initializing;
}

export async function recognizeScorebugField(
  kind: ScorebugWhitelistKind,
  ...args: Parameters<Tesseract.Worker["recognize"]>
): Promise<Tesseract.RecognizeResult> {
  const scheduler = await getScheduler(kind);
  return scheduler.addJob("recognize", ...args);
}

export async function terminateScorebugTesseractWorker() {
  await Promise.all([...schedulers.values()].map((scheduler) => scheduler.terminate()));
  schedulers.clear();
}
