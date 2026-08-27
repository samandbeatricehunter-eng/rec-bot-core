// Dedicated Tesseract worker pool for scorebug OCR -- deliberately separate from the box-score
// module's pool (box-score.parser.types.ts) rather than sharing it, because scorebug crops need
// a different page-segmentation mode. Box-score crops are large, document-like regions where
// Tesseract's default full-page segmentation (PSM 3) works fine; scorebug crops are tiny,
// isolated single-line snippets (a score, a clock, a down/distance string) where PSM 3 reliably
// returns nothing at all -- confirmed directly: the exact same preprocessed play-clock crop that
// PSM 3 read as empty text read correctly as "02" under PSM.SINGLE_LINE. Sharing one scheduler
// across two different desired PSMs isn't safe (per-job parameter overrides aren't a thing in
// tesseract.js's scheduler API), so this gets its own small pool instead.
import Tesseract from "tesseract.js";

const OCR_POOL_SIZE = Number(process.env.SCOREBUG_OCR_WORKER_POOL_SIZE ?? 2);

let _scheduler: Tesseract.Scheduler | null = null;
let _schedulerInitializing: Promise<Tesseract.Scheduler> | null = null;

async function getScheduler(): Promise<Tesseract.Scheduler> {
  if (_scheduler) return _scheduler;
  if (_schedulerInitializing) return _schedulerInitializing;
  _schedulerInitializing = (async () => {
    const scheduler = Tesseract.createScheduler();
    const workers = await Promise.all(
      Array.from({ length: Math.max(1, OCR_POOL_SIZE) }, async () => {
        const worker = await Tesseract.createWorker("eng");
        await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE });
        return worker;
      }),
    );
    for (const worker of workers) scheduler.addWorker(worker);
    _scheduler = scheduler;
    _schedulerInitializing = null;
    return scheduler;
  })();
  return _schedulerInitializing;
}

export async function recognizeScorebugField(
  ...args: Parameters<Tesseract.Worker["recognize"]>
): Promise<Tesseract.RecognizeResult> {
  const scheduler = await getScheduler();
  return scheduler.addJob("recognize", ...args);
}

export async function terminateScorebugTesseractWorker() {
  if (_scheduler) {
    await _scheduler.terminate();
    _scheduler = null;
  }
}
