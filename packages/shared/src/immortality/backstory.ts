// Builds the short bio paragraph on a prospect's player card by combining data the user already
// entered during Origins (hometown/college, persona label, playstyle archetype, Persona DNA
// traits) into a few templated sentences. Deterministic per-prospect (seeded, not random) so a
// re-render of the same prospect always reads the same way, while different prospects land on
// different phrasing -- "possible combinations of our options" rather than one fixed Mad Libs.
function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pick<T>(items: readonly T[], seed: number, salt: number): T {
  return items[(seed + salt) % items.length];
}

const ORIGIN_TEMPLATES: Array<(name: string, home: string, college: string) => string> = [
  (name, home, college) => `${name} grew up in ${home} before taking their talents to ${college}.`,
  (name, home, college) => `Out of ${home}, ${name} built a name for themselves at ${college}.`,
  (name, home, college) => `${name}'s path to the league started in ${home} and ran through ${college}.`,
  (name, home, college) => `Raised in ${home}, ${name} turned heads at ${college} on the way here.`,
];

const ORIGIN_TEMPLATES_NO_COLLEGE: Array<(name: string, home: string) => string> = [
  (name, home) => `${name} grew up in ${home} and never stopped chasing this moment.`,
  (name, home) => `Out of ${home}, ${name} carved their own path to the league.`,
];

const PERSONA_TEMPLATES: Array<(name: string, label: string) => string> = [
  (name, label) => `Teammates already know ${name} as a ${label.toLowerCase()} in the locker room.`,
  (name, label) => `On and off the field, ${name} carries themselves like a true ${label.toLowerCase()}.`,
  (name, label) => `${name} plays with the mindset of a ${label.toLowerCase()}.`,
];

const PLAYSTYLE_TEMPLATES: Array<(name: string, archetype: string) => string> = [
  (name, archetype) => `Scouts tag their game as ${archetype}.`,
  (name, archetype) => `${name}'s style on tape reads as ${archetype}.`,
  (name, archetype) => `The tape shows a ${archetype} through and through.`,
];

const TRAIT_TEMPLATES: Array<(traits: string) => string> = [
  (traits) => `Known for being ${traits}.`,
  (traits) => `The scouting report keeps coming back to the same words: ${traits}.`,
  (traits) => `What stands out most: ${traits}.`,
];

function joinTraits(names: string[]): string {
  const lower = names.map((name) => name.toLowerCase());
  if (lower.length <= 1) return lower[0] ?? "";
  if (lower.length === 2) return `${lower[0]} and ${lower[1]}`;
  return `${lower.slice(0, -1).join(", ")}, and ${lower[lower.length - 1]}`;
}

export function buildProspectBackstory(input: {
  firstName: string;
  lastName: string;
  hometown?: string | null;
  hometownState?: string | null;
  college?: string | null;
  personaLabel?: string | null;
  playstyleArchetype?: string | null;
  traitNames?: string[];
  seed: string;
}): string {
  const seed = hashSeed(input.seed);
  const name = `${input.firstName} ${input.lastName}`.trim() || "This prospect";
  const sentences: string[] = [];

  const home = input.hometown ? `${input.hometown}${input.hometownState ? `, ${input.hometownState}` : ""}` : null;
  if (home && input.college) {
    sentences.push(pick(ORIGIN_TEMPLATES, seed, 1)(name, home, input.college));
  } else if (home) {
    sentences.push(pick(ORIGIN_TEMPLATES_NO_COLLEGE, seed, 2)(name, home));
  } else if (input.college) {
    sentences.push(`${name} arrives by way of ${input.college}.`);
  }

  if (input.personaLabel) {
    sentences.push(pick(PERSONA_TEMPLATES, seed, 3)(name, input.personaLabel));
  }

  if (input.playstyleArchetype) {
    sentences.push(pick(PLAYSTYLE_TEMPLATES, seed, 5)(name, input.playstyleArchetype));
  }

  if (input.traitNames?.length) {
    const top = input.traitNames.slice(0, 3);
    sentences.push(pick(TRAIT_TEMPLATES, seed, 7)(joinTraits(top)));
  }

  if (!sentences.length) return `${name} is ready to make their mark in the league.`;
  return sentences.join(" ");
}
