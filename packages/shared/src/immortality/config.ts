import coreConfigJson from "./config/core_config.json" with { type: "json" };
import iqTestsJson from "./config/iq_tests.json" with { type: "json" };
import personaJson from "./config/persona_interview.json" with { type: "json" };
import playstyleJson from "./config/playstyle_interview.json" with { type: "json" };
import qbJson from "./config/characteristics_QB.json" with { type: "json" };
import hbJson from "./config/characteristics_HB.json" with { type: "json" };
import wrTeJson from "./config/characteristics_WR_TE.json" with { type: "json" };
import dbJson from "./config/characteristics_DB.json" with { type: "json" };
import lbJson from "./config/characteristics_LB.json" with { type: "json" };
import synergiesJson from "./config/characteristic_synergies.json" with { type: "json" };
import milestonesJson from "./config/milestones_v1.json" with { type: "json" };
import contractsJson from "./config/contracts_v1.json" with { type: "json" };
import {
  characteristicKey,
  modifiersFromDefinition,
  DEFAULT_XP_COST_BY_SLOT,
  type CharacteristicDefinition,
  type CharacteristicTier,
} from "./characteristics.js";
import type { IqBankQuestion } from "./iq.js";
import type { PersonaQuestion } from "./persona.js";
import type { PlaystyleQuestion } from "./playstyle.js";
import type { ImmortalityPositionGroup, ImmortalitySide } from "./types.js";
import { FORMULA_VERSIONS } from "./types.js";

export const immortalityCoreConfig = coreConfigJson;
export const immortalitySynergies = synergiesJson;
export const immortalityMilestones = milestonesJson;
export const immortalityContractsConfig = contractsJson;

type RawIqQuestion = {
  number: number;
  question: string;
  options: string[];
  correct_index: number;
};

function loadIqBank(side: ImmortalitySide): IqBankQuestion[] {
  const raw = (side === "offense" ? iqTestsJson.offense : iqTestsJson.defense) as unknown as RawIqQuestion[];
  return raw.map((item) => ({
    number: item.number,
    question: item.question,
    options: item.options,
    correctIndex: item.correct_index,
  }));
}

export function iqBankForSide(side: ImmortalitySide): IqBankQuestion[] {
  return loadIqBank(side);
}

type RawPersonaOption = { text: string; dna_points: Record<string, number> };
type RawPersonaQuestion = { number: number; question: string; options: RawPersonaOption[] };

export function personaQuestionsForSide(side: ImmortalitySide): PersonaQuestion[] {
  const raw = (side === "offense" ? personaJson.offense : personaJson.defense) as unknown as RawPersonaQuestion[];
  return raw
    .filter((item) => item.number <= 5)
    .map((item) => ({
      number: item.number,
      question: item.question,
      options: item.options.map((option) => ({
        text: option.text,
        dnaPoints: option.dna_points,
      })),
    }));
}

type RawPlaystyleOption = { text: string; primary_archetype: string };
type RawPlaystyleQuestion = { number: number; question: string; options: RawPlaystyleOption[] };

export function playstyleQuestionsForGroup(group: ImmortalityPositionGroup): PlaystyleQuestion[] {
  const groups = playstyleJson.groups as unknown as Record<string, RawPlaystyleQuestion[]>;
  const raw = groups[group] ?? [];
  return raw.map((item) => ({
    number: item.number,
    question: item.question,
    options: item.options.map((option) => ({
      text: option.text,
      primaryArchetype: option.primary_archetype,
    })),
  }));
}

type RawCharacteristic = {
  name: string;
  slot_cost: number;
  effect: string;
  why_it_costs_that?: string;
  tags?: string;
  synergy?: unknown[];
  tier?: CharacteristicTier;
  xp_cost?: number;
};

function catalogFrom(raw: { position_group: string; characteristics: RawCharacteristic[] }): CharacteristicDefinition[] {
  const positionGroup = raw.position_group as ImmortalityPositionGroup;
  return raw.characteristics.map((item) => ({
    key: characteristicKey(item.name),
    displayName: item.name,
    positionGroup,
    slotCost: item.slot_cost,
    effect: item.effect,
    tags: String(item.tags ?? "").split(/[,\s]+/).filter(Boolean),
    modifiers: modifiersFromDefinition({ name: item.name, effect: item.effect }),
    configurationVersion: FORMULA_VERSIONS.characteristics,
    tier: item.tier ?? 1,
    xpCost: item.xp_cost ?? DEFAULT_XP_COST_BY_SLOT[item.slot_cost] ?? item.slot_cost * 40,
  }));
}

const CHARACTERISTIC_CATALOGS: Record<ImmortalityPositionGroup, CharacteristicDefinition[]> = {
  QB: catalogFrom(qbJson as { position_group: string; characteristics: RawCharacteristic[] }),
  HB: catalogFrom(hbJson as { position_group: string; characteristics: RawCharacteristic[] }),
  WR_TE: catalogFrom(wrTeJson as { position_group: string; characteristics: RawCharacteristic[] }),
  DB: catalogFrom(dbJson as { position_group: string; characteristics: RawCharacteristic[] }),
  LB: catalogFrom(lbJson as { position_group: string; characteristics: RawCharacteristic[] }),
};

export function characteristicCatalog(group: ImmortalityPositionGroup): CharacteristicDefinition[] {
  return CHARACTERISTIC_CATALOGS[group];
}

export function allCharacteristicCatalogs(): CharacteristicDefinition[] {
  return Object.values(CHARACTERISTIC_CATALOGS).flat();
}

export function publicPersonaQuestions(side: ImmortalitySide) {
  return personaQuestionsForSide(side).map(({ number, question, options }) => ({
    number,
    question,
    options: options.map((option) => ({ text: option.text })),
  }));
}

export function publicPlaystyleQuestions(group: ImmortalityPositionGroup) {
  return playstyleQuestionsForGroup(group).map(({ number, question, options }) => ({
    number,
    question,
    options: options.map((option) => ({ text: option.text })),
  }));
}

export function publicIqQuestions(side: ImmortalitySide): Array<{ number: number; question: string; options: string[] }> {
  return iqBankForSide(side).map(({ number, question, options }) => ({ number, question, options }));
}
