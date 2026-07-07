import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { MADDEN_ATTRIBUTE_BY_CODE, MADDEN_ATTRIBUTE_DROPDOWN_GROUPS, type MaddenAttributeCode, type MaddenAttributeDropdownGroupKey } from "@rec/shared";
import { buildNavigationRow, NAV_CUSTOM_IDS } from "./navigation.js";
import { LEAGUE_SETUP_CUSTOM_IDS, type LeagueSetupDraft, type LeagueSetupStep } from "./league-setup-types.js";
import { option } from "./league-setup-shared.js";
import { buildLeagueTypeWindow } from "./league-setup-core.js";

export const ECONOMY_FEATURE_STEPS = {
  economy: {
    title: "Economy",
    key: "coinEconomyEnabled",
    description: "Economy: Allows users to get paid for game outcomes, stats, streams and highlights, as well as (if activated) making purchases and placing wagers within this league."
  },
  custom_players: {
    title: "Custom Players",
    key: "customPlayersEnabled",
    description: "Custom Players: Allows users to purchase and create custom players to be added to the draft pool and reserved for their team. Players are built using template archetypes and a range of 'creation points' based on how much the user spends when purchasing the player package."
  },
  legends: {
    title: "Legends",
    key: "legendsEnabled",
    description: "Legends: Allows users to purchase NFL legends to be added to their team instantly."
  },
  dev_upgrades: {
    title: "Dev Upgrades",
    key: "devUpgradesEnabled",
    description: "Dev Upgrades: Allows users to purchase a development trait upgrade for a player on their team. Upgrades are in one-tier increments, so Star to Superstar, etc."
  },
  age_resets: {
    title: "Age Resets",
    key: "ageResetsEnabled",
    description: "Age Resets: Allows users to purchase an age reset for a player, resetting their in-game age to 21."
  },
  attribute_purchases: {
    title: "Attribute Purchases",
    key: "attributePurchasesEnabled",
    description: "Attribute Purchases: Allows users to purchase upgrades to a players attributes (grouped as core & non-core with different caps)."
  },
  player_trait_purchases: {
    title: "Player Trait Purchases",
    key: "playerTraitPurchasesEnabled",
    description: "Player Trait Purchases: Allows users to purchase changes to a players trait, ie, they want a player to play the ball but their trait is currently set to Play Defender."
  },
  contract_purchases: {
    title: "Contract Purchases",
    key: "contractAdjustmentPurchasesEnabled",
    description: "Contract Purchases: Allows users to buy salary and bonus reductions for players contracts, as well as limited contract extensions."
  }
} as const satisfies Partial<Record<LeagueSetupStep, { title: string; key: keyof LeagueSetupDraft; description: string }>>;

type PurchaseSeasonCapField =
  | "customPlayersSeasonCap"
  | "legendsSeasonCap"
  | "devUpgradesSeasonCap"
  | "ageResetsSeasonCap"
  | "playerTraitPurchasesSeasonCap"
  | "contractPurchasesSeasonCap"
  | "coreAttributePurchasesSeasonCap"
  | "nonCoreAttributePurchasesSeasonCap";

const PURCHASE_FEATURE_STEPS = {
  custom_players: {
    title: "Custom Players",
    enabledKey: "customPlayersEnabled",
    seasonCapKey: "customPlayersSeasonCap",
    maxSeasonCap: 5,
    description: "Custom Players: Allows users to purchase and create custom players to be added to the draft pool and reserved for their team. Players are built using template archetypes and a range of 'creation points' based on how much the user spends when purchasing the player package."
  },
  legends: {
    title: "Legends",
    enabledKey: "legendsEnabled",
    seasonCapKey: "legendsSeasonCap",
    maxSeasonCap: 5,
    description: "Legends: Allows users to purchase NFL legends to be added to their team instantly."
  },
  dev_upgrades: {
    title: "Dev Upgrades",
    enabledKey: "devUpgradesEnabled",
    seasonCapKey: "devUpgradesSeasonCap",
    maxSeasonCap: 5,
    description: "Dev Upgrades: Allows users to purchase a development trait upgrade for a player on their team. Upgrades are in one-tier increments, so Star to Superstar, etc."
  },
  age_resets: {
    title: "Age Resets",
    enabledKey: "ageResetsEnabled",
    seasonCapKey: "ageResetsSeasonCap",
    maxSeasonCap: 5,
    description: "Age Resets: Allows users to purchase an age reset for a player, resetting their in-game age to 21."
  },
  attribute_purchases: {
    title: "Attribute Purchases",
    enabledKey: "attributePurchasesEnabled",
    seasonCapKey: null,
    maxSeasonCap: 20,
    description: "Attribute Purchases: Allows users to purchase upgrades to a players attributes (grouped as core & non-core with different caps)."
  },
  player_trait_purchases: {
    title: "Player Trait Purchases",
    enabledKey: "playerTraitPurchasesEnabled",
    seasonCapKey: "playerTraitPurchasesSeasonCap",
    maxSeasonCap: 10,
    description: "Player Trait Purchases: Allows users to purchase changes to a players trait, ie, they want a player to play the ball but their trait is currently set to Play Defender."
  },
  contract_purchases: {
    title: "Contract Purchases",
    enabledKey: "contractAdjustmentPurchasesEnabled",
    seasonCapKey: "contractPurchasesSeasonCap",
    maxSeasonCap: 5,
    description: "Contract Purchases: Allows users to buy salary and bonus reductions for players contracts, as well as limited contract extensions."
  }
} as const satisfies Partial<Record<LeagueSetupStep, {
  title: string;
  enabledKey: keyof LeagueSetupDraft;
  seasonCapKey: PurchaseSeasonCapField | null;
  maxSeasonCap: number;
  description: string;
}>>;

export type PurchaseFeatureStep = keyof typeof PURCHASE_FEATURE_STEPS;

export function isPurchaseFeatureStep(step: LeagueSetupStep): step is PurchaseFeatureStep {
  return step in PURCHASE_FEATURE_STEPS;
}

export function purchaseCapCustomId(step: PurchaseFeatureStep, cap: "season" | "core" | "non_core" = "season") {
  return `${LEAGUE_SETUP_CUSTOM_IDS.purchaseCapPrefix}:${step}:${cap}`;
}

export function coreAttributeGroupCustomId(group: MaddenAttributeDropdownGroupKey) {
  return `${LEAGUE_SETUP_CUSTOM_IDS.coreAttrsPrefix}:${group}`;
}

export function attributeCapGroupCustomId(group: MaddenAttributeDropdownGroupKey) {
  return `${LEAGUE_SETUP_CUSTOM_IDS.attrCapGroupPrefix}:${group}`;
}

export function attributeCapModalCustomId(code: string) {
  return `${LEAGUE_SETUP_CUSTOM_IDS.attrCapModalPrefix}:${code}`;
}

function attrLabel(code: string) {
  const def = MADDEN_ATTRIBUTE_BY_CODE.get(code as MaddenAttributeCode);
  return def ? `${code} — ${def.name}` : code;
}

function effectiveCoreCap(draft: LeagueSetupDraft, code: string) {
  const override = draft.coreAttributeCapOverrides?.[code];
  const base = override != null ? override : draft.coreAttributePurchasesSeasonCap;
  return base === 0 ? "Unlimited" : String(base);
}

function capOptions(maxCap: number, unitLabel = "season") {
  return Array.from({ length: maxCap + 1 }, (_, index) => option(String(index), String(index), index === 0 ? "Unlimited (no cap)" : `${index} per ${unitLabel}`));
}

function formatPurchaseCapSummary(draft: LeagueSetupDraft, step: PurchaseFeatureStep) {
  const config = PURCHASE_FEATURE_STEPS[step];
  if (step === "attribute_purchases") {
    const fmt = (n: number) => (n === 0 ? "Unlimited" : `${n} pts`);
    return [
      `Default Core Cap: **${fmt(draft.coreAttributePurchasesSeasonCap)}**/season`,
      `Non-Core Total Cap: **${fmt(draft.nonCoreAttributePurchasesSeasonCap)}**/season`,
      `Core Attributes: **${draft.coreAttributes.length}** (per-attribute overrides: **${Object.keys(draft.coreAttributeCapOverrides ?? {}).length}**)`,
      "_Caps are points per user, per season. Core/Non-Core pricing: $100 / $50 per point._",
    ].join("\n");
  }
  if (!config.seasonCapKey) return "";
  const cap = draft[config.seasonCapKey];
  return `Season Cap: **${cap}**/${config.maxSeasonCap}`;
}

export function setPurchaseCapValue(draft: LeagueSetupDraft, customId: string, value: string) {
  const parts = customId.split(":");
  const capKind = parts.at(-1);
  const step = parts.at(-2) as PurchaseFeatureStep;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;

  if (capKind === "core") {
    draft.coreAttributePurchasesSeasonCap = numeric;
    return;
  }
  if (capKind === "non_core") {
    draft.nonCoreAttributePurchasesSeasonCap = numeric;
    return;
  }

  const config = PURCHASE_FEATURE_STEPS[step];
  if (!config?.seasonCapKey) return;
  (draft as any)[config.seasonCapKey] = numeric;
}

export function setCoreAttributesForGroup(draft: LeagueSetupDraft, group: MaddenAttributeDropdownGroupKey, selected: string[]) {
  const groupCodes = new Set(MADDEN_ATTRIBUTE_DROPDOWN_GROUPS[group].codes);
  draft.coreAttributes = [
    ...draft.coreAttributes.filter((code) => !groupCodes.has(code as any)),
    ...selected
  ];
  // Drop overrides for attributes no longer core.
  const coreSet = new Set(draft.coreAttributes);
  for (const code of Object.keys(draft.coreAttributeCapOverrides ?? {})) {
    if (!coreSet.has(code)) delete draft.coreAttributeCapOverrides[code];
  }
}

export function setAttributeCapOverride(draft: LeagueSetupDraft, code: string, raw: string): "ok" | "invalid" {
  const trimmed = raw.trim();
  draft.coreAttributeCapOverrides = draft.coreAttributeCapOverrides ?? {};
  if (!trimmed || trimmed.toLowerCase() === "default") {
    delete draft.coreAttributeCapOverrides[code];
    return "ok";
  }
  const numeric = Number(trimmed);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 99) return "invalid";
  draft.coreAttributeCapOverrides[code] = numeric;
  return "ok";
}

export function buildPurchaseSettingWindow(draft: LeagueSetupDraft) {
  if (!isPurchaseFeatureStep(draft.step)) return buildLeagueTypeWindow(draft);
  const config = PURCHASE_FEATURE_STEPS[draft.step];
  const enabled = Boolean(draft[config.enabledKey]);
  // CFB calls these "Custom Recruits" rather than "Custom Players".
  const isCfbRecruits = draft.game === "cfb_27" && draft.step === "custom_players";
  // CFB calls Legends "Campus Legends" and it's a plain toggle — no season/all-time caps.
  const isCfbCampusLegends = draft.game === "cfb_27" && draft.step === "legends";
  const title = isCfbRecruits ? "Custom Recruits" : isCfbCampusLegends ? "Campus Legends" : config.title;
  const description = isCfbRecruits
    ? "Custom Recruits: Allows users to purchase and create custom recruits added to the recruiting pool and reserved for their program. Recruits are built using template archetypes and a range of 'creation points' based on how much the user spends when purchasing the recruit package."
    : isCfbCampusLegends
    ? "Campus Legends: Allows users to purchase college football legends to be added to their program instantly."
    : config.description;
  const embed = new EmbedBuilder()
    .setTitle(`League Setup: ${title}`)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      description,
      "",
      `Current Selection: **${enabled ? "Activated" : "Deactivated"}**`,
      isCfbCampusLegends ? "" : formatPurchaseCapSummary(draft, draft.step)
    ].filter(Boolean).join("\n"));

  const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.featureActivate).setLabel("Activate Feature").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.featureDeactivate).setLabel("Deactivate Feature").setStyle(ButtonStyle.Danger)
    )
  ];

  if (draft.step === "attribute_purchases") {
    const overrideCount = Object.keys(draft.coreAttributeCapOverrides ?? {}).length;
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(purchaseCapCustomId("attribute_purchases", "core"))
          .setPlaceholder("Default core attribute cap — points/season")
          .addOptions(...capOptions(24, "season"))
      ),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(purchaseCapCustomId("attribute_purchases", "non_core"))
          .setPlaceholder("Non-core total cap — points/season")
          .addOptions(...capOptions(24, "season"))
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.purchaseCoreAttrsOpen)
          .setLabel(`Configure Core Attributes (${draft.coreAttributes.length})`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.attrCapOverrideOpen)
          .setLabel(`Per-Attribute Caps (${overrideCount})`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(draft.coreAttributes.length === 0)
      )
    );
  } else if (config.seasonCapKey && !isCfbCampusLegends) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(purchaseCapCustomId(draft.step))
          .setPlaceholder(`Season cap (0 = unlimited)`)
          .addOptions(...capOptions(config.maxSeasonCap))
      )
    );
  }

  components.push(buildNavigationRow());
  return { embeds: [embed], components };
}

const ATTRIBUTE_DROPDOWN_GROUP_ENTRIES = Object.entries(MADDEN_ATTRIBUTE_DROPDOWN_GROUPS) as Array<
  [MaddenAttributeDropdownGroupKey, typeof MADDEN_ATTRIBUTE_DROPDOWN_GROUPS[MaddenAttributeDropdownGroupKey]]
>;

export function buildAttributeCoreSelectionWindow(draft: LeagueSetupDraft) {
  const groupDoc = ATTRIBUTE_DROPDOWN_GROUP_ENTRIES.map(
    ([, group]) => `**${group.label}:** ${group.codes.join(", ")}`
  );
  const embed = new EmbedBuilder()
    .setTitle("League Setup: Core Attributes")
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Select which player attributes count as **core** (priced $100/pt; others are non-core at $50/pt). The 53 attributes are split across three dropdowns:",
      "",
      ...groupDoc,
      "",
      `Currently core (**${draft.coreAttributes.length}**): ${draft.coreAttributes.length ? draft.coreAttributes.join(", ") : "None selected yet."}`,
    ].join("\n").slice(0, 4096));

  const rows = ATTRIBUTE_DROPDOWN_GROUP_ENTRIES.map(([groupKey, group]) => {
    const selected = draft.coreAttributes.filter((code) => group.codes.includes(code as any));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(coreAttributeGroupCustomId(groupKey))
        .setPlaceholder(group.label)
        .setMinValues(0)
        .setMaxValues(group.codes.length)
        .addOptions(
          ...group.codes.map((code) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(attrLabel(code).slice(0, 100))
              .setValue(code)
              .setDefault(selected.includes(code))
          )
        )
    );
  });

  return {
    embeds: [embed],
    components: [
      ...rows,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.purchaseCoreAttrsDone)
          .setLabel(draft.editMode ? "Save & Back to Purchases" : "Continue")
          .setStyle(ButtonStyle.Success)
      ),
      buildNavigationRow()
    ]
  };
}

// Per-individual core-attribute cap overrides. One single-select per dropdown group, listing
// only that group's core attributes (with their current effective cap); picking one opens a
// modal to set its cap. Default cap applies to anything without an override.
export function buildAttributeCapOverrideWindow(draft: LeagueSetupDraft) {
  const coreSet = new Set(draft.coreAttributes);
  const overrides = draft.coreAttributeCapOverrides ?? {};
  const overrideLines = Object.keys(overrides).length
    ? Object.entries(overrides).map(([code, cap]) => `${attrLabel(code)}: **${cap === 0 ? "Unlimited" : `${cap} pts`}**`)
    : ["None — all core attributes use the default cap."];

  const embed = new EmbedBuilder()
    .setTitle("League Setup: Per-Attribute Caps")
    .setDescription([
      `Default core cap: **${draft.coreAttributePurchasesSeasonCap === 0 ? "Unlimited" : `${draft.coreAttributePurchasesSeasonCap} pts`}** / season.`,
      "Pick a core attribute below to override its cap. Leave a cap blank in the popup to revert it to the default.",
      "",
      "**Overrides:**",
      ...overrideLines,
    ].join("\n").slice(0, 4096));

  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  for (const [groupKey, group] of ATTRIBUTE_DROPDOWN_GROUP_ENTRIES) {
    const coreCodes = group.codes.filter((code) => coreSet.has(code));
    if (!coreCodes.length) continue;
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(attributeCapGroupCustomId(groupKey))
          .setPlaceholder(`${group.label} — set a cap`)
          .setMinValues(0)
          .setMaxValues(1)
          .addOptions(
            ...coreCodes.map((code) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(attrLabel(code).slice(0, 100))
                .setValue(code)
                .setDescription(`Current: ${effectiveCoreCap(draft, code)}`.slice(0, 100))
            )
          )
      )
    );
  }

  return {
    embeds: [embed],
    components: [
      ...rows,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.attrCapOverrideDone)
          .setLabel("Done")
          .setStyle(ButtonStyle.Success)
      ),
    ],
  };
}

export function buildAttributeCapModal(code: string, draft: LeagueSetupDraft) {
  const current = draft.coreAttributeCapOverrides?.[code];
  return new ModalBuilder()
    .setCustomId(attributeCapModalCustomId(code))
    .setTitle(`Cap: ${attrLabel(code)}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.attrCapModalInput)
          .setLabel("Points/season (blank = use default)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(current == null ? "" : String(current))
          .setPlaceholder("0 = unlimited, blank = default")
      )
    );
}

export function formatPurchaseCapsReview(draft: LeagueSetupDraft) {
  const lines: string[] = [];
  for (const [step, config] of Object.entries(PURCHASE_FEATURE_STEPS) as Array<[PurchaseFeatureStep, typeof PURCHASE_FEATURE_STEPS[PurchaseFeatureStep]]>) {
    const enabled = Boolean(draft[config.enabledKey]);
    if (!enabled) continue;
    // Campus Legends (CFB) is a plain toggle with no caps — already reported as its own
    // Features line by the review screens, so skip it here.
    if (draft.game === "cfb_27" && step === "legends") continue;
    if (step === "attribute_purchases") {
      lines.push(`Attributes: default core ${draft.coreAttributePurchasesSeasonCap === 0 ? "unlimited" : `${draft.coreAttributePurchasesSeasonCap} pts`}/season, non-core ${draft.nonCoreAttributePurchasesSeasonCap === 0 ? "unlimited" : `${draft.nonCoreAttributePurchasesSeasonCap} pts`}/season, ${draft.coreAttributes.length} core attrs (${Object.keys(draft.coreAttributeCapOverrides ?? {}).length} overrides)`);
      continue;
    }
    if (config.seasonCapKey) {
      lines.push(`${config.title}: ${draft[config.seasonCapKey]}/season`);
    }
  }
  return lines.length ? lines.join("\n") : "No purchase caps configured.";
}

export function isLeagueSetupFeatureStep(step: LeagueSetupStep): step is keyof typeof ECONOMY_FEATURE_STEPS {
  return step in ECONOMY_FEATURE_STEPS;
}

export function setLeagueSetupFeatureAnswer(draft: LeagueSetupDraft, enabled: boolean) {
  if (isPurchaseFeatureStep(draft.step)) {
    const config = PURCHASE_FEATURE_STEPS[draft.step];
    (draft as any)[config.enabledKey] = enabled;
    return;
  }
  if (!isLeagueSetupFeatureStep(draft.step)) return;
  const config = ECONOMY_FEATURE_STEPS[draft.step];
  (draft as any)[config.key] = enabled;
}

export function buildFeatureTogglesWindow(draft: LeagueSetupDraft) {
  return buildFeatureDecisionWindow(draft);
}

export function buildFeatureDecisionWindow(draft: LeagueSetupDraft) {
  if (!isLeagueSetupFeatureStep(draft.step)) return buildLeagueTypeWindow(draft);
  const config = ECONOMY_FEATURE_STEPS[draft.step];
  const current = Boolean(draft[config.key]);
  const embed = new EmbedBuilder()
    .setTitle(`League Setup: ${config.title}`)
    .setDescription([
      `League: **${draft.name}**`,
      "",
      config.description,
      "",
      `Current Selection: **${current ? "Activated" : "Deactivated"}**`,
      draft.step === "economy" ? "If Economy is deactivated, setup skips the purchase-feature questions that depend on it." : null
    ].filter(Boolean).join("\n"));

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.featureActivate).setLabel("Activate Feature").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.featureDeactivate).setLabel("Deactivate Feature").setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.back).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.cancelWizard).setLabel("Cancel Wizard").setStyle(ButtonStyle.Danger)
      )
    ]
  };
}
