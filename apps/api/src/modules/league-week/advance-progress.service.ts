export type AdvanceProgressState = {
  runId: string;
  stage: string;
  completed: string[];
  status: "running" | "complete" | "error";
  error?: string;
  updatedAt: string;
};

const runs = new Map<string, AdvanceProgressState>();

export function startAdvanceProgress(runId: string) {
  runs.set(runId, { runId, stage: "Saving final results", completed: [], status: "running", updatedAt: new Date().toISOString() });
}

export function updateAdvanceProgress(runId: string | null | undefined, stage: string) {
  if (!runId) return;
  const prior = runs.get(runId);
  if (!prior) return startAdvanceProgress(runId);
  if (prior.stage !== stage && !prior.completed.includes(prior.stage)) prior.completed.push(prior.stage);
  runs.set(runId, { ...prior, stage, updatedAt: new Date().toISOString() });
}

export function finishAdvanceProgress(runId: string | null | undefined) {
  if (!runId) return;
  updateAdvanceProgress(runId, "Advance complete");
  const prior = runs.get(runId);
  if (prior) runs.set(runId, { ...prior, status: "complete", updatedAt: new Date().toISOString() });
}

export function failAdvanceProgress(runId: string | null | undefined, error: unknown) {
  if (!runId) return;
  const prior = runs.get(runId) ?? { runId, stage: "Advance failed", completed: [], status: "running" as const, updatedAt: new Date().toISOString() };
  runs.set(runId, { ...prior, status: "error", error: error instanceof Error ? error.message : "Advance failed.", updatedAt: new Date().toISOString() });
}

export function getAdvanceProgress(runId: string) {
  return runs.get(runId) ?? null;
}
