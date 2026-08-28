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
