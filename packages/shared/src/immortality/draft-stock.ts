import { projectedRoundFromRank } from "./draft.js";

export const DRAFT_STOCK_STAGE_WEIGHTS = {
  identity: 5,
  iq: 28,
  persona: 8,
  playstyle: 8,
  characteristics: 16,
  creation: 35,
} as const;

export type DraftStockDirection = "new" | "rising" | "holding" | "sliding";

export type DraftStockInput = {
  prospectId: string;
  userId: string;
  side: "offense" | "defense";
  firstName?: string | null;
  lastName?: string | null;
  iqScore?: number | null;
  iqCompleted?: boolean;
  personaCompleted?: boolean;
  playstyleBlendKind?: "dominant" | "clear" | "near_tie" | null;
  characteristicSlotCost?: number;
  startDevStar?: boolean;
  estimatedOvr?: number | null;
  previousClassRank?: number | null;
  previousDraftValue?: number | null;
};

export type DraftGradeSnapshot = {
  prospectId: string;
  userId: string;
  side: "offense" | "defense";
  rawScore: number;
  stageScores: Record<keyof typeof DRAFT_STOCK_STAGE_WEIGHTS, number>;
  draftValue: number;
  classRank: number;
  classSize: number;
  projectedRound: number;
  preferredMin: number;
  preferredMax: number;
  gradeLabel: string;
  stock: DraftStockDirection;
  ready: boolean;
};

const IQ_FLOOR = 80;
const IQ_CEILING = 140;
const OVR_FLOOR = 66;
const OVR_SPAN = 22;

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function identityStageScore(input: Pick<DraftStockInput, "firstName" | "lastName">): number {
  return input.firstName?.trim() && input.lastName?.trim() ? DRAFT_STOCK_STAGE_WEIGHTS.identity : 0;
}

export function iqStageScore(input: Pick<DraftStockInput, "iqCompleted" | "iqScore">): number {
  if (!input.iqCompleted) return 0;
  const iq = Number(input.iqScore ?? IQ_FLOOR);
  return Math.round(DRAFT_STOCK_STAGE_WEIGHTS.iq * clamp01((iq - IQ_FLOOR) / (IQ_CEILING - IQ_FLOOR)));
}

export function personaStageScore(input: Pick<DraftStockInput, "personaCompleted">): number {
  return input.personaCompleted ? DRAFT_STOCK_STAGE_WEIGHTS.persona : 0;
}

export function playstyleStageScore(input: Pick<DraftStockInput, "playstyleBlendKind">): number {
  if (input.playstyleBlendKind === "dominant") return DRAFT_STOCK_STAGE_WEIGHTS.playstyle;
  if (input.playstyleBlendKind === "clear") return 7;
  if (input.playstyleBlendKind === "near_tie") return 6;
  return 0;
}

export function characteristicStageScore(input: Pick<DraftStockInput, "characteristicSlotCost" | "startDevStar">): number {
  const used = Math.max(0, Math.min(6, Number(input.characteristicSlotCost ?? 0)));
  const base = Math.round((used / 6) * (DRAFT_STOCK_STAGE_WEIGHTS.characteristics - 4));
  return base + (input.startDevStar ? 4 : 0);
}

export function creationStageScore(input: Pick<DraftStockInput, "estimatedOvr">): number {
  if (input.estimatedOvr == null || !Number.isFinite(input.estimatedOvr)) return 0;
  return Math.round(DRAFT_STOCK_STAGE_WEIGHTS.creation * clamp01((Number(input.estimatedOvr) - OVR_FLOOR) / OVR_SPAN));
}

export function rawDraftStockScore(input: DraftStockInput): {
  rawScore: number;
  stageScores: Record<keyof typeof DRAFT_STOCK_STAGE_WEIGHTS, number>;
} {
  const stageScores = {
    identity: identityStageScore(input),
    iq: iqStageScore(input),
    persona: personaStageScore(input),
    playstyle: playstyleStageScore(input),
    characteristics: characteristicStageScore(input),
    creation: creationStageScore(input),
  };
  return {
    rawScore: stageScores.identity + stageScores.iq + stageScores.persona + stageScores.playstyle + stageScores.characteristics + stageScores.creation,
    stageScores,
  };
}

export function draftGradeLabel(projectedRound: number): string {
  if (projectedRound <= 1) return "A";
  if (projectedRound === 2) return "A-";
  if (projectedRound === 3) return "B+";
  if (projectedRound === 4) return "B";
  if (projectedRound === 5) return "C+";
  if (projectedRound === 6) return "C";
  return "C-";
}

export function stockDirection(previousRank: number | null | undefined, nextRank: number): DraftStockDirection {
  if (previousRank == null || previousRank <= 0) return "new";
  if (nextRank < previousRank) return "rising";
  if (nextRank > previousRank) return "sliding";
  return "holding";
}

export function preferredRoundRange(projectedRound: number): { min: number; max: number } {
  return { min: Math.max(1, projectedRound - 1), max: Math.min(7, projectedRound + 1) };
}

export function rankDraftClass(prospects: DraftStockInput[]): DraftGradeSnapshot[] {
  const bySide: Record<"offense" | "defense", DraftStockInput[]> = { offense: [], defense: [] };
  for (const prospect of prospects) {
    bySide[prospect.side].push(prospect);
  }
  const ranked: DraftGradeSnapshot[] = [];
  for (const side of ["offense", "defense"] as const) {
    const group = [...bySide[side]].sort((a, b) => {
      const scoreDiff = rawDraftStockScore(b).rawScore - rawDraftStockScore(a).rawScore;
      if (scoreDiff !== 0) return scoreDiff;
      return a.prospectId.localeCompare(b.prospectId);
    });
    const classSize = group.length;
    group.forEach((prospect, index) => {
      const { rawScore, stageScores } = rawDraftStockScore(prospect);
      const classRank = index + 1;
      const projectedRound = projectedRoundFromRank(classRank, Math.max(classSize, 32));
      const range = preferredRoundRange(projectedRound);
      ranked.push({
        prospectId: prospect.prospectId,
        userId: prospect.userId,
        side,
        rawScore,
        stageScores,
        draftValue: Math.round(rawScore * 10),
        classRank,
        classSize,
        projectedRound,
        preferredMin: range.min,
        preferredMax: range.max,
        gradeLabel: draftGradeLabel(projectedRound),
        stock: stockDirection(prospect.previousClassRank, classRank),
        ready: prospect.estimatedOvr != null && Number.isFinite(prospect.estimatedOvr),
      });
    });
  }
  return ranked;
}

export function completePairUserIds(grades: Array<{ userId: string; side: "offense" | "defense"; ready: boolean }>): string[] {
  const byUser = new Map<string, { offense: boolean; defense: boolean }>();
  for (const grade of grades) {
    const row = byUser.get(grade.userId) ?? { offense: false, defense: false };
    if (grade.side === "offense") row.offense = row.offense || grade.ready;
    else row.defense = row.defense || grade.ready;
    byUser.set(grade.userId, row);
  }
  return [...byUser.entries()].filter(([, pair]) => pair.offense && pair.defense).map(([userId]) => userId);
}

export function seedFranchisePickOrder(leagueId: string, teamIds: string[]): Array<{ teamId: string; pickOrder: number }> {
  return [...teamIds]
    .sort((a, b) => {
      const diff = stableHash(`${leagueId}:${a}`) - stableHash(`${leagueId}:${b}`);
      return diff !== 0 ? diff : a.localeCompare(b);
    })
    .map((teamId, index) => ({ teamId, pickOrder: index + 1 }));
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
