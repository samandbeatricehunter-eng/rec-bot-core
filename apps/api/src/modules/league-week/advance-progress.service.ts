// Keyed by leagueId (not the client-generated runId) so a freshly-mounted AdvanceStatusDrawer
// can discover an in-progress advance without the client needing to remember an id across a
// navigation/remount -- same shape as madden-ea's importProgressStore (getImportProgress),
// which ImportStatusDrawer polls by leagueId alone. `runId` is kept on the record only as an
// informational echo of which client-side advance attempt produced it.
export type AdvanceProgressState = {
  runId: string | null;
  stage: string;
  completed: string[];
  status: "running" | "complete" | "error";
  error?: string;
  updatedAt: string;
};

const runs = new Map<string, AdvanceProgressState>();

export function startAdvanceProgress(leagueId: string, runId?: string | null) {
  runs.set(leagueId, { runId: runId ?? null, stage: "Saving final results", completed: [], status: "running", updatedAt: new Date().toISOString() });
}

export function updateAdvanceProgress(leagueId: string | null | undefined, stage: string) {
  if (!leagueId) return;
  const prior = runs.get(leagueId);
  if (!prior) return startAdvanceProgress(leagueId, null);
  if (prior.stage !== stage && !prior.completed.includes(prior.stage)) prior.completed.push(prior.stage);
  runs.set(leagueId, { ...prior, stage, updatedAt: new Date().toISOString() });
}

export function finishAdvanceProgress(leagueId: string | null | undefined) {
  if (!leagueId) return;
  updateAdvanceProgress(leagueId, "Advance complete");
  const prior = runs.get(leagueId);
  if (prior) runs.set(leagueId, { ...prior, status: "complete", updatedAt: new Date().toISOString() });
}

export function failAdvanceProgress(leagueId: string | null | undefined, error: unknown) {
  if (!leagueId) return;
  const prior = runs.get(leagueId) ?? { runId: null, stage: "Advance failed", completed: [], status: "running" as const, updatedAt: new Date().toISOString() };
  runs.set(leagueId, { ...prior, status: "error", error: error instanceof Error ? error.message : "Advance failed.", updatedAt: new Date().toISOString() });
}

export function getAdvanceProgress(leagueId: string) {
  return runs.get(leagueId) ?? null;
}
