import { ApiError } from "../../lib/errors.js";

const STAGE_ORDER = [
  "preseason_training_camp", "preseason", "regular_season", "wild_card", "divisional",
  "conference_championship", "bowl_season", "cfp_first_round", "cfp_quarterfinal",
  "cfp_quarterfinals", "cfp_semifinal", "cfp_semifinals", "national_championship",
  "super_bowl", "offseason", "completed",
] as const;

/** In-season deadlines (e.g. regular-season week 10) close the competitive window, then
 * the postseason-end cap reset is supposed to reopen the store for the offseason pipeline. */
const OFFSEASON_PURCHASE_WINDOW = new Set([
  "offseason", "completed", "coach_hiring", "final_resigning", "free_agency", "draft",
  "end_of_season_recap", "players_leaving", "transfer_portal", "signing_day",
  "training_results", "offseason_phase",
]);

const DEADLINE_KEY_ALIASES: Record<string, string[]> = {
  attribute: ["attribute", "attribute_purchase", "attribute_purchases"],
  contract: ["contract", "contract_adjustment"],
  legend: ["legend"],
  custom_player: ["custom_player"],
  age_reset: ["age_reset"],
  dev_upgrade: ["dev_upgrade"],
};

function rank(stage: string) {
  const value = stage.trim().toLowerCase();
  const index = STAGE_ORDER.indexOf(value as (typeof STAGE_ORDER)[number]);
  return index < 0 ? null : index;
}

function deadlineFor(deadlines: Record<string, unknown>, purchaseType: string): Record<string, unknown> | null {
  const keys = DEADLINE_KEY_ALIASES[purchaseType] ?? [purchaseType];
  for (const key of keys) {
    const deadline = deadlines[key];
    if (deadline && typeof deadline === "object" && !Array.isArray(deadline)) {
      return deadline as Record<string, unknown>;
    }
  }
  return null;
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
  const deadline = deadlineFor(input.deadlines as Record<string, unknown>, input.purchaseType);
  if (!deadline) return;
  const stage = String(deadline.stage ?? "");
  const week = Number(deadline.week ?? 1);
  if (!stage || !Number.isInteger(week)) return;
  const currentStage = input.currentStage.trim().toLowerCase();
  if (OFFSEASON_PURCHASE_WINDOW.has(currentStage) && !OFFSEASON_PURCHASE_WINDOW.has(stage.trim().toLowerCase())) return;
  const currentRank = rank(input.currentStage);
  const deadlineRank = rank(stage);
  const closed = currentRank != null && deadlineRank != null
    ? currentRank > deadlineRank || (currentRank === deadlineRank && input.currentWeek > week)
    : input.currentStage === stage && input.currentWeek > week;
  if (closed) throw new ApiError(409, `The ${input.purchaseType.replaceAll("_", " ")} purchase deadline passed after ${stage.replaceAll("_", " ")} week ${week}.`);
}
