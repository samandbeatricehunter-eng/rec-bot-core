import { ApiError } from "../../lib/errors.js";

const STAGE_ORDER = [
  "preseason_training_camp", "preseason", "regular_season", "wild_card", "divisional",
  "conference_championship", "bowl_season", "cfp_first_round", "cfp_quarterfinal",
  "cfp_quarterfinals", "cfp_semifinal", "cfp_semifinals", "national_championship",
  "super_bowl", "offseason", "completed",
] as const;

function rank(stage: string) {
  const value = stage.trim().toLowerCase();
  const index = STAGE_ORDER.indexOf(value as (typeof STAGE_ORDER)[number]);
  return index < 0 ? null : index;
}

export function assertPurchaseDeadlineOpen(input: {
  purchaseType: string;
  deadlines: unknown;
  currentStage: string;
  currentWeek: number;
  /** Commissioner-level kill switch (League Settings) -- when off, configured deadlines are kept
   * on file but not enforced, so re-enabling doesn't require re-entering every stage/week. */
  enabled?: boolean;
}) {
  if (input.enabled === false) return;
  if (!input.deadlines || typeof input.deadlines !== "object" || Array.isArray(input.deadlines)) return;
  const deadline = (input.deadlines as Record<string, unknown>)[input.purchaseType];
  if (!deadline || typeof deadline !== "object" || Array.isArray(deadline)) return;
  const stage = String((deadline as Record<string, unknown>).stage ?? "");
  const week = Number((deadline as Record<string, unknown>).week ?? 1);
  if (!stage || !Number.isInteger(week)) return;
  const currentRank = rank(input.currentStage);
  const deadlineRank = rank(stage);
  const closed = currentRank != null && deadlineRank != null
    ? currentRank > deadlineRank || (currentRank === deadlineRank && input.currentWeek > week)
    : input.currentStage === stage && input.currentWeek > week;
  if (closed) throw new ApiError(409, `The ${input.purchaseType.replaceAll("_", " ")} purchase deadline passed after ${stage.replaceAll("_", " ")} week ${week}.`);
}
