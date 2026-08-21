import type { EaImportProgressEvent } from "./rec-api-client.js";

const WEEKLY_DATASETS = new Set([
  "schedule",
  "passing",
  "rushing",
  "receiving",
  "defense",
  "kicking",
  "punting",
  "team_stats",
]);

const WEEK_IN_LABEL = /(Preseason Week \d+|Week \d+|Wild Card Round|Divisional Round|Conference Championship|Super Bowl)/i;

export type ImportProgressLine = {
  icon: string;
  text: string;
  isError?: boolean;
};

export function importProgressLines(events: EaImportProgressEvent[]): ImportProgressLine[] {
  return events.flatMap((event): ImportProgressLine[] => {
    if (event.type === "starting") {
      return [{ icon: "⏳", text: `Starting import — ${event.weeks} week${event.weeks === 1 ? "" : "s"} — ${event.datasets.join(", ")}` }];
    }
    if (event.type === "dataset_start") return [{ icon: "⏳", text: `${event.label} — fetching…` }];
    if (event.type === "dataset_done") {
      return [{ icon: "✅", text: `${event.label} — ${event.records} record${event.records === 1 ? "" : "s"}${event.duplicate ? " (already up to date)" : ""}` }];
    }
    if (event.type === "dataset_error") return [{ icon: "❌", text: `${event.label} — ${event.error}`, isError: true }];
    if (event.type === "reconciling") return [{ icon: "⏳", text: event.step }];
    if (event.type === "done") return [{ icon: "✅", text: "Import complete!" }];
    if (event.type === "error") return [{ icon: "❌", text: event.error, isError: true }];
    return [];
  });
}

export function summarizeImportProgress(events: EaImportProgressEvent[]): {
  step: number;
  total: number;
  weekLabel: string | null;
  currentAction: string;
  finished: boolean;
  failed: boolean;
} {
  const starting = events.find((event) => event.type === "starting");
  const datasets = starting?.datasets ?? [];
  const weeks = starting?.weeks ?? 0;
  const snapshotCount = datasets.filter((dataset) => !WEEKLY_DATASETS.has(dataset)).length;
  const weeklyCount = datasets.filter((dataset) => WEEKLY_DATASETS.has(dataset)).length;
  const total = Math.max(snapshotCount + (weeks > 0 ? weeklyCount * weeks : 0), 0);
  const completed = events.filter((event) => event.type === "dataset_done" || event.type === "dataset_error").length;
  const started = events.some((event) => event.type === "dataset_start" || event.type === "dataset_done" || event.type === "dataset_error");
  const finished = events.some((event) => event.type === "done" || event.type === "error");
  const failed = events.some((event) => event.type === "error");
  const step = finished
    ? Math.max(total, completed)
    : started
      ? Math.min(Math.max(completed + 1, 1), Math.max(total, 1))
      : 0;

  let weekLabel: string | null = null;
  for (const event of events) {
    if (event.type !== "dataset_start" && event.type !== "dataset_done" && event.type !== "dataset_error") continue;
    const match = event.label.match(WEEK_IN_LABEL);
    if (match) weekLabel = match[1];
  }

  const latest = events[events.length - 1];
  let currentAction = "Starting import…";
  if (latest?.type === "dataset_start") currentAction = actionFromLabel(latest.label);
  else if (latest?.type === "dataset_done") currentAction = `Imported ${stripWeek(latest.label)}`;
  else if (latest?.type === "dataset_error") currentAction = `${stripWeek(latest.label)} failed`;
  else if (latest?.type === "reconciling") currentAction = latest.step;
  else if (latest?.type === "done") currentAction = "Import complete";
  else if (latest?.type === "error") currentAction = "Import failed";

  return { step, total: total || Math.max(completed, 1), weekLabel, currentAction, finished, failed };
}

function stripWeek(label: string) {
  return label.replace(/\s+[—-]\s+(Preseason Week \d+|Week \d+|Wild Card Round|Divisional Round|Conference Championship|Super Bowl)\s*$/i, "").trim();
}

function actionFromLabel(label: string) {
  if (/^Fetching /i.test(label)) return label.replace(/^Fetching /i, "Importing ");
  return `Importing ${stripWeek(label)}…`;
}
