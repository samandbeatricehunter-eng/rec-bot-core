import { estimateRecPlayerOverall, type RecPlayerAttributes } from "../player-builder/ovr-model.js";
import { FORMULA_VERSIONS, ovrPositionFor, type AttributeMap, type ImmortalityPosition } from "./types.js";
import { blendAttributeTemplates, type PlaystyleBlend } from "./playstyle.js";

export const BASELINE_OVR_MIN = 68;
export const BASELINE_OVR_MAX = 72;
export const BASELINE_BLEND_ARCHETYPE_WEIGHT = 0.7;
export const BASELINE_BLEND_POSITION_WEIGHT = 0.3;
export const BASELINE_MIN_SAMPLE = 4;

export type BaselinePlayerRow = {
  position: string;
  archetype: string | null;
  overallRating: number | null;
  attributes: AttributeMap;
};

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

export function medianTemplate(rows: BaselinePlayerRow[]): AttributeMap {
  const buckets: Record<string, number[]> = {};
  for (const row of rows) {
    for (const [code, value] of Object.entries(row.attributes)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      (buckets[code] ??= []).push(value);
    }
  }
  const out: AttributeMap = {};
  for (const [code, values] of Object.entries(buckets)) {
    out[code] = median(values);
  }
  return out;
}

export function blendTemplates(primary: AttributeMap, fallback: AttributeMap): AttributeMap {
  const keys = new Set([...Object.keys(primary), ...Object.keys(fallback)]);
  const out: AttributeMap = {};
  for (const key of keys) {
    const a = primary[key];
    const b = fallback[key];
    if (typeof a === "number" && typeof b === "number") {
      out[key] = Math.round(a * BASELINE_BLEND_ARCHETYPE_WEIGHT + b * BASELINE_BLEND_POSITION_WEIGHT);
    } else {
      out[key] = a ?? b ?? 0;
    }
  }
  return out;
}

export function attributesForOvr(attributes: AttributeMap): RecPlayerAttributes {
  const out: RecPlayerAttributes = {};
  for (const [code, value] of Object.entries(attributes)) {
    out[code.toLowerCase()] = value;
  }
  return out;
}

export function displayOvrFor(position: ImmortalityPosition, attributes: AttributeMap): number {
  return estimateRecPlayerOverall(ovrPositionFor(position), attributesForOvr(attributes)).displayOverall;
}

function nudgeIntoBand(position: ImmortalityPosition, template: AttributeMap): AttributeMap {
  const next = { ...template };
  const secondary = ["STA", "INJ", "TOU", "RET", "KPW", "KAC", "LBK"];
  for (let step = 0; step < 40; step += 1) {
    const ovr = displayOvrFor(position, next);
    if (ovr >= BASELINE_OVR_MIN && ovr <= BASELINE_OVR_MAX) return next;
    const delta = ovr < BASELINE_OVR_MIN ? 1 : -1;
    const code = secondary[step % secondary.length];
    if (!code) break;
    const current = next[code] ?? 60;
    next[code] = Math.max(40, Math.min(85, current + delta));
  }
  return next;
}

export function deriveBaselineTemplate(input: {
  position: ImmortalityPosition;
  archetype: string | null;
  pool: BaselinePlayerRow[];
}): { template: AttributeMap; sampleSize: number; blended: boolean; formulaVersion: string } {
  const positionRows = input.pool.filter((row) => {
    const overall = row.overallRating ?? 0;
    return row.position === input.position && overall >= BASELINE_OVR_MIN && overall <= BASELINE_OVR_MAX;
  });
  const archetypeKey = (input.archetype ?? "").toLowerCase();
  const archetypeRows = archetypeKey
    ? positionRows.filter((row) => (row.archetype ?? "").toLowerCase().includes(archetypeKey.split(" ")[0] ?? archetypeKey))
    : [];
  const useArchetype = archetypeRows.length >= BASELINE_MIN_SAMPLE;
  const primary = medianTemplate(useArchetype ? archetypeRows : positionRows);
  const blended = !useArchetype && positionRows.length > 0 && archetypeRows.length > 0;
  const template = blended ? blendTemplates(medianTemplate(archetypeRows), medianTemplate(positionRows)) : primary;
  delete template.AWR;
  delete template.PRC;
  return {
    template: nudgeIntoBand(input.position, template),
    sampleSize: useArchetype ? archetypeRows.length : positionRows.length,
    blended,
    formulaVersion: FORMULA_VERSIONS.baseline,
  };
}

/**
 * Permanent, hand-set starting attributes for QB and MIKE, read directly off real Madden 27
 * create-a-player screens (source images in apps/qb1-4.jpg, apps/mike1-4.jpg). Replaces the
 * old live median-of-real-roster-players lookup for these two positions -- deliberately not a
 * formula, not derived from any dataset that could change under it. AWR and PRC are excluded
 * on purpose; both come from the IQ test overlay (applyIqOverlay), never from this table.
 */
export const FIXED_RTI_BASELINES: Partial<Record<ImmortalityPosition, AttributeMap>> = {
  QB: {
    SPD: 82, ACC: 84, AGI: 85, STR: 60, CAR: 65, BCV: 85, BTK: 75, TRK: 40, SFA: 65, COD: 80,
    SPM: 70, JKM: 75, CTH: 60, CIT: 26, SPC: 31, SRR: 39, MRR: 29, DRR: 19, RLS: 23, JMP: 84,
    THP: 86, SAC: 78, MAC: 75, DAC: 72, RUN: 81, TUP: 79, BSK: 78, PAC: 81,
    PBK: 20, PBP: 15, PBF: 15, RBK: 28, RBP: 20, RBF: 20, LBK: 29, IBL: 43,
    TAK: 28, POW: 25, BSH: 25, FMV: 10, PMV: 10, PUR: 35, MCV: 10, ZCV: 24, PRS: 10,
    RET: 10, KPW: 37, KAC: 35, STA: 74, TOU: 90, INJ: 79,
  },
  MIKE: {
    SPD: 83, ACC: 85, AGI: 83, STR: 75, CAR: 67, BCV: 65, BTK: 46, TRK: 56, SFA: 63, COD: 75,
    SPM: 49, JKM: 61, CTH: 64, CIT: 50, SPC: 50, SRR: 25, MRR: 20, DRR: 15, RLS: 18, JMP: 84,
    THP: 24, SAC: 6, MAC: 6, DAC: 6, RUN: 6, TUP: 10, BSK: 16, PAC: 6,
    PBK: 45, PBP: 45, PBF: 45, RBK: 42, RBP: 52, RBF: 53, LBK: 28, IBL: 75,
    TAK: 78, POW: 78, BSH: 75, FMV: 55, PMV: 55, PUR: 80, MCV: 65, ZCV: 65, PRS: 46,
    RET: 14, KPW: 14, KAC: 13, STA: 80, TOU: 90, INJ: 82,
  },
};

export function hasFixedRtiBaseline(position: ImmortalityPosition): boolean {
  return position in FIXED_RTI_BASELINES;
}

/**
 * Branching Playstyle's Q3-5 answers accumulate a floor/ceiling delta per attribute (see
 * scoreBranchingPlaystyleInterview) -- not an additive bonus, a literal band: the fixed
 * baseline value is pulled up to the delta-adjusted floor or down to the delta-adjusted
 * ceiling if it would otherwise fall outside that band, and left alone if it already fits.
 */
export function applyBranchingDeltas(
  baseline: AttributeMap,
  deltas: Record<string, { floor: number; ceiling: number }>,
): AttributeMap {
  const next = { ...baseline };
  for (const [code, { floor, ceiling }] of Object.entries(deltas)) {
    const current = next[code] ?? 0;
    const effectiveFloor = current + floor;
    const effectiveCeiling = current + ceiling;
    next[code] = Math.min(Math.max(current, effectiveFloor), Math.max(effectiveFloor, effectiveCeiling));
  }
  return next;
}

export function applyIqOverlay(input: {
  position: ImmortalityPosition;
  attributes: AttributeMap;
  awareness: number;
  playRecognition: number;
}): AttributeMap {
  const next = { ...input.attributes, AWR: input.awareness };
  if (input.position === "QB" || input.position === "HB" || input.position === "WR" || input.position === "TE") {
    return next;
  }
  return { ...next, PRC: input.playRecognition };
}

export function hybridBaseline(input: {
  primary: AttributeMap;
  secondary: AttributeMap;
  blend: PlaystyleBlend;
  awareness: number;
  playRecognition: number;
  position: ImmortalityPosition;
}): AttributeMap {
  return applyIqOverlay({
    position: input.position,
    attributes: blendAttributeTemplates(input.primary, input.secondary, input.blend),
    awareness: input.awareness,
    playRecognition: input.playRecognition,
  });
}
