import { MADDEN_ATTRIBUTE_DEFINITIONS } from "../madden/attributes.js";
import type { RecGameFamily, RecPackageTier } from "./archetypes.js";
import { REC_PACKAGE_RULES } from "./build-validator.js";
import { REC_ARCHETYPE_BASE_OVR_TARGET, REC_ARCHETYPE_GROWTH_OVR_TARGET } from "./archetype-templates.js";

export const REC_CUSTOM_PLAYER_PACKAGE_VERSION = "rec-custom-player-packages-v2.0.0" as const;
export const REC_CUSTOM_PLAYER_COST_VERSION = "rec-custom-player-costs-v1.3.0" as const;

export const REC_CUSTOM_PLAYER_POSITIONS = [
  "QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT",
  "LE", "RE", "DT", "LOLB", "MLB", "ROLB", "CB", "FS", "SS",
] as const;
export type RecCustomPlayerPosition = (typeof REC_CUSTOM_PLAYER_POSITIONS)[number];

// v2.0.0: package cards no longer advertise a flat CP number — bonus CP is now position-specific
// (see archetype-templates.ts getRecArchetypeBonusCp), so a single tier-wide figure would either
// overpromise for expensive positions (LOLB, OL) or wildly overstate cheap ones (K/P). Cards
// advertise the tier's real-player base OVR and growth target instead, true for every position.
export type RecCustomPlayerPackageDefinition = {
  game: RecGameFamily; gameYear: number; key: string; tier: RecPackageTier;
  displayName: string; description: string; coinPrice: number;
  baseOvrTarget: number; growthOvrTarget: number | null;
  includedDevCredit: number; maxHighImpactRating: number;
  configurationVersion: typeof REC_CUSTOM_PLAYER_PACKAGE_VERSION;
};

// Authoritative package definitions live here + REC_PACKAGE_RULES. Live coin prices may be
// overridden by global economy JSON at runtime. The DB table `rec_custom_player_packages`
// is legacy unused — do not read it for runtime package/config resolution.
const PACKAGE_NAMES: Record<RecGameFamily, string[]> = {
  CFB: ["Walk-On", "3-Star Recruit", "4-Star Recruit", "5-Star Recruit", "Campus GOAT"],
  MADDEN: ["JAG (Just a Guy)", "Solid Depth Player", "Future Starter", "Instant Starter", "Franchise Player"],
};
const COIN_PRICES = [500, 750, 1000, 1500, 2000] as const;

// Dev-trait credit per tier (Samuel, 2026-08) — chosen so the NET cost of upgrading one dev
// tier above that tier's default (see archetype-templates.ts REC_ARCHETYPE_DEFAULT_DEV_TRAIT_INDEX)
// comes out to exactly REC_ARCHETYPE_DEV_UPGRADE_CP: credit = defaultTrait.absoluteCost +
// (nextTrait.absoluteCost - defaultTrait.absoluteCost - desiredUpgradeCost). Same for CFB and
// Madden since both dev-trait ladders use the same absoluteCost values (0/400/1000/1800).
const DEV_CREDIT_BY_TIER: Readonly<Record<RecPackageTier, number>> = {
  1: 0,
  2: 300,
  3: 800,
  4: 600,
  5: 1100,
};

/** Canonical presentation order. UI aliases map to the actual stored game codes:
 * CAT=CTH, SPN=SPM, JUK=JKM, TOR=RUN, PLA=PAC, IMP=IBL, TKL=TAK, KPR=RET. */
export const REC_ATTRIBUTE_DISPLAY_ORDER = [
  "SPD", "ACC", "AGI", "STR", "AWR", "CAR", "BCV", "BTK", "TRK", "SFA", "COD", "SPM", "JKM",
  "CTH", "CIT", "SPC", "SRR", "MRR", "DRR", "RLS", "JMP", "THP", "SAC", "MAC", "DAC", "RUN",
  "TUP", "BSK", "PAC", "PBK", "PBP", "PBF", "RBK", "RBP", "RBF", "LBK", "IBL", "PRC", "TAK",
  "POW", "BSH", "FMV", "PMV", "PUR", "MCV", "ZCV", "PRS", "RET", "KPW", "KAC", "STA", "TOU", "INJ",
] as const;

const ATTRIBUTE_DISPLAY_RANK = new Map<string, number>(REC_ATTRIBUTE_DISPLAY_ORDER.map((code, index) => [code, index]));
export function sortRecAttributeCodes(codes: readonly string[]): string[] {
  return [...codes].sort((a, b) => (ATTRIBUTE_DISPLAY_RANK.get(a.toUpperCase()) ?? 999) - (ATTRIBUTE_DISPLAY_RANK.get(b.toUpperCase()) ?? 999) || a.localeCompare(b));
}

export const REC_POSITION_DISPLAY_ORDER = [
  "QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LEDGE", "REDGE", "DT", "SAM", "MIKE", "WILL", "CB", "FS", "SS", "K", "P",
] as const;

export function listRecCustomPlayerPackages(game: RecGameFamily, gameYear = 27): RecCustomPlayerPackageDefinition[] {
  return ([1, 2, 3, 4, 5] as RecPackageTier[]).map((tier) => {
    const rules = REC_PACKAGE_RULES[tier];
    const name = PACKAGE_NAMES[game][tier - 1]!;
    const baseOvrTarget = REC_ARCHETYPE_BASE_OVR_TARGET[tier];
    const growthOvrTarget = REC_ARCHETYPE_GROWTH_OVR_TARGET[tier];
    return {
      game, gameYear, key: `tier_${tier}`, tier, displayName: name,
      description: growthOvrTarget
        ? `${name} custom-player build starting from a real ~${baseOvrTarget} OVR player, with room to build toward ~${growthOvrTarget}.`
        : `${name} custom-player build starting from a real ~${baseOvrTarget} OVR player.`,
      coinPrice: COIN_PRICES[tier - 1]!, baseOvrTarget, growthOvrTarget,
      includedDevCredit: DEV_CREDIT_BY_TIER[tier],
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

// Legend catalog keys use full display names (and a few aliases that differ from
// MADDEN_ATTRIBUTE_DEFINITIONS.name, e.g. "Throwing Power" vs "Throw Power"). Map those
// to the same 3-letter codes so notification/list UIs can share one in-game sort order.
const ATTRIBUTE_LABEL_ALIASES: Record<string, string> = {
  "throwing power": "THP",
  "tackling": "TAK",
  "bc vision": "BCV",
  "run blocking": "RBK",
  "pass blocking": "PBK",
  "kicking power": "KPW",
  "kicking accuracy": "KAC",
  "kick/punt return": "RET",
  "long snap": "LSN",
};
const ATTRIBUTE_LABEL_TO_CODE = new Map<string, string>();
for (const [code, name] of Object.entries(EXTRA_ATTRIBUTE_NAMES)) {
  ATTRIBUTE_LABEL_TO_CODE.set(name.toLowerCase(), code.toUpperCase());
}
for (const definition of MADDEN_ATTRIBUTE_DEFINITIONS) {
  ATTRIBUTE_LABEL_TO_CODE.set(definition.name.toLowerCase(), definition.code);
}
for (const [label, code] of Object.entries(ATTRIBUTE_LABEL_ALIASES)) {
  ATTRIBUTE_LABEL_TO_CODE.set(label, code);
}

/** Resolve a 3-letter code or a display/legend label to the canonical attribute code. */
export function resolveRecAttributeCode(key: string): string {
  const trimmed = key.trim();
  const upper = trimmed.toUpperCase();
  if (ATTRIBUTE_DISPLAY_RANK.has(upper)) return upper;
  return ATTRIBUTE_LABEL_TO_CODE.get(trimmed.toLowerCase()) ?? upper;
}

/** Sort attribute keys whether they are codes (SPD) or display/legend labels (Speed). */
export function sortRecAttributeKeys(keys: readonly string[]): string[] {
  return [...keys].sort((a, b) => {
    const rankA = ATTRIBUTE_DISPLAY_RANK.get(resolveRecAttributeCode(a)) ?? 999;
    const rankB = ATTRIBUTE_DISPLAY_RANK.get(resolveRecAttributeCode(b)) ?? 999;
    return rankA - rankB || a.localeCompare(b);
  });
}

export function isRecCustomPlayerPosition(value: string): value is RecCustomPlayerPosition {
  return (REC_CUSTOM_PLAYER_POSITIONS as readonly string[]).includes(value.toUpperCase());
}
