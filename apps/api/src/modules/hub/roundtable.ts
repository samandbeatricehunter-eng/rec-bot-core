import { selectRoundtableTakes } from "./roundtable-take-bank.js";

export type RoundtablePanelist = { speaker: string; role: string; take: string };

/**
 * Build a desk panel that reacts to keywords/context from the story.
 * Never prefix takes with raw coach answers or the full headline quote.
 */
export function buildRoundtableDiscussion(input: {
  headline: string;
  body: string;
  notes?: string[];
  statsSummary?: string[];
}): RoundtablePanelist[] {
  const corpus = [
    input.headline,
    input.body,
    ...(input.notes ?? []),
    ...(input.statsSummary ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  return selectRoundtableTakes(corpus);
}
