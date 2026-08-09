import { MADDEN_ATTRIBUTE_DEFINITIONS } from "../madden/attributes.js";
import type { RecGameFamily, RecPackageTier } from "./archetypes.js";
import { REC_PACKAGE_RULES } from "./build-validator.js";

export const REC_CUSTOM_PLAYER_PACKAGE_VERSION = "rec-custom-player-packages-v1.1.0" as const;
export const REC_CUSTOM_PLAYER_COST_VERSION = "rec-custom-player-costs-v1.1.0" as const;

export const REC_CUSTOM_PLAYER_POSITIONS = [
  "QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT",
  "LE", "RE", "DT", "LOLB", "MLB", "ROLB", "CB", "FS", "SS",
] as const;
export type RecCustomPlayerPosition = (typeof REC_CUSTOM_PLAYER_POSITIONS)[number];

export type RecCustomPlayerPackageDefinition = {
  game: RecGameFamily; gameYear: number; key: string; tier: RecPackageTier;
  displayName: string; description: string; coinPrice: number; creationPoints: number;
  targetOvrMin: number; targetOvrMax: number; rawOvrCap: number;
  includedDevCredit: number; maxHighImpactRating: number;
  configurationVersion: typeof REC_CUSTOM_PLAYER_PACKAGE_VERSION;
};

const PACKAGE_NAMES: Record<RecGameFamily, string[]> = {
  CFB: ["Walk-On", "3-Star Recruit", "4-Star Recruit", "5-Star Recruit", "Campus GOAT"],
  MADDEN: ["JAG (Just a Guy)", "Solid Depth Player", "Future Starter", "Instant Starter", "Franchise Player"],
};
const COIN_PRICES = [400, 600, 800, 1200, 1600] as const;
const TARGETS = [[58, 63], [64, 69], [70, 76], [77, 82], [83, 87]] as const;

export function listRecCustomPlayerPackages(game: RecGameFamily, gameYear = 27): RecCustomPlayerPackageDefinition[] {
  return ([1, 2, 3, 4, 5] as RecPackageTier[]).map((tier) => {
    const rules = REC_PACKAGE_RULES[tier];
    const name = PACKAGE_NAMES[game][tier - 1]!;
    return {
      game, gameYear, key: `tier_${tier}`, tier, displayName: name,
      description: `${name} build with a ${TARGETS[tier - 1]![0]}-${TARGETS[tier - 1]![1]} target OVR and a ${rules.rawOverallCap} raw OVR ceiling.`,
      coinPrice: COIN_PRICES[tier - 1]!, creationPoints: rules.creationPoints,
      targetOvrMin: TARGETS[tier - 1]![0], targetOvrMax: TARGETS[tier - 1]![1],
      rawOvrCap: rules.rawOverallCap, includedDevCredit: tier >= 3 ? 400 : 0,
      maxHighImpactRating: rules.highImpactAttributeCap,
      configurationVersion: REC_CUSTOM_PLAYER_PACKAGE_VERSION,
    };
  });
}

export function getRecCustomPlayerPackage(game: RecGameFamily, tier: RecPackageTier, gameYear = 27) {
  return listRecCustomPlayerPackages(game, gameYear)[tier - 1]!;
}

export const REC_DEV_TRAITS = {
  CFB: [
    { key: "normal", label: "Normal", absoluteCost: 0 }, { key: "impact", label: "Impact", absoluteCost: 400 },
    { key: "star", label: "Star", absoluteCost: 1000 }, { key: "elite", label: "Elite", absoluteCost: 1800 },
  ],
  MADDEN: [
    { key: "normal", label: "Normal", absoluteCost: 0 }, { key: "star", label: "Star", absoluteCost: 400 },
    { key: "superstar", label: "Superstar", absoluteCost: 1000 }, { key: "xfactor", label: "X-Factor", absoluteCost: 1800 },
  ],
} as const;

export function getRecNetDevelopmentCost(game: RecGameFamily, tier: RecPackageTier, traitKey: string) {
  const trait = REC_DEV_TRAITS[game].find((entry) => entry.key === traitKey);
  if (!trait) throw new Error(`Unsupported ${game} development trait: ${traitKey}`);
  return Math.max(0, trait.absoluteCost - getRecCustomPlayerPackage(game, tier).includedDevCredit);
}

const EXTRA_ATTRIBUTE_NAMES: Record<string, string> = { tgh: "Toughness", lsn: "Long Snapping", ovr: "Overall" };
const ATTRIBUTE_NAMES = new Map(MADDEN_ATTRIBUTE_DEFINITIONS.map((definition) => [definition.code.toLowerCase(), definition.name]));
export function getRecAttributeDisplayName(code: string): string {
  const normalized = code.trim().toLowerCase();
  return ATTRIBUTE_NAMES.get(normalized) ?? EXTRA_ATTRIBUTE_NAMES[normalized] ?? normalized.toUpperCase();
}

export function isRecCustomPlayerPosition(value: string): value is RecCustomPlayerPosition {
  return (REC_CUSTOM_PLAYER_POSITIONS as readonly string[]).includes(value.toUpperCase());
}
