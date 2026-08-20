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
import { FAIR_SIM_RULE_OPTIONS, FORCE_WIN_RULE_OPTIONS } from "@rec/shared";
import { buildNavigationRow } from "./navigation.js";
import { LEAGUE_SETUP_CUSTOM_IDS, type LeagueSetupDraft } from "./league-setup-types.js";
import { baseEmbed, option, selectRow } from "./league-setup-shared.js";

export function buildCustomCoachesRequiredWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Custom Coaches Required?", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.customCoachesRequired, "Are custom coaches required?", [
        option("Yes", "yes"),
        option("No", "no")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildCustomPlaybooksAllowedWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Custom Playbooks Allowed?", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.customPlaybooksAllowedSelect, "Are custom playbooks allowed?", [
        option("Yes", "yes"),
        option("No", "no")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildCoachAbilitiesRestrictedWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: Coach Abilities Restricted?", draft);
  if (draft.coachAbilitiesRestrictionNotes) {
    embed.addFields({ name: "Current Restriction Notes", value: draft.coachAbilitiesRestrictionNotes.slice(0, 1024) });
  }

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.coachAbilitiesRestricted, "Are coach abilities restricted?", [
        option("Yes - Set custom restrictions", "yes_custom"),
        option("No", "no")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildCoachAbilitiesRestrictionModal(draft: LeagueSetupDraft) {
  return new ModalBuilder()
    .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.coachAbilitiesRestrictionModal)
    .setTitle("Coach Ability Restrictions")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.coachAbilitiesRestrictionInput)
          .setLabel("Custom coach ability restriction notes")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setValue(draft.coachAbilitiesRestrictionNotes ?? "")
          .setPlaceholder("e.g., No strategist tree, no offseason boost abilities, etc.")
      )
    );
}

export function buildRegularSeasonStreamingWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Regular Season Streaming", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.regularSeasonStreaming, "Regular season streaming requirement", [
        option("Required", "required"),
        option("Recommended", "recommended"),
        option("Not required", "disabled")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildPostseasonStreamingWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Postseason Streaming", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.postseasonStreaming, "Postseason streaming requirement", [
        option("Required", "required"),
        option("Recommended", "recommended"),
        option("Not required", "disabled")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildRegularSeasonStreamingSideWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Regular Season Streaming Side", draft)
      .setDescription("When regular-season streaming is required or recommended, who must stream?")],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.regularSeasonStreamingSide, "Regular season streaming side", [
        option("Home Team", "home"),
        option("Away Team", "away"),
        option("Either Team", "either"),
        option("Both Teams", "both")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildPostseasonStreamingSideWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Postseason Streaming Side", draft)
      .setDescription("When postseason streaming is required or recommended, who must stream?")],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.postseasonStreamingSide, "Postseason streaming side", [
        option("Home Team", "home"),
        option("Away Team", "away"),
        option("Either Team", "either"),
        option("Both Teams", "both")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildStreamingSideWindow(draft: LeagueSetupDraft) {
  return buildRegularSeasonStreamingSideWindow(draft);
}

/**
 * Build 4th down rules window for either regular season or playoff
 * Allows different rules to apply in different phases of the season
 *
 * @param draft Current setup draft
 * @param phase "Regular Season" or "Playoff" to show in title
 * @returns Embed and components for 4th down rule selection
 */
export function buildFourthDownWindow(draft: LeagueSetupDraft, phase: "Regular Season" | "Playoff" = "Regular Season") {
  // Determine which rule to display based on phase
  const customId = phase === "Playoff" ? LEAGUE_SETUP_CUSTOM_IDS.fourthDownRulePlayoff : LEAGUE_SETUP_CUSTOM_IDS.fourthDownRuleRegular;
  const currentCustom = phase === "Playoff" ? draft.customFourthDownRulePlayoff : draft.customFourthDownRuleRegular;
  const embed = baseEmbed(`League Setup: 4th Down Rules - ${phase}`, draft);
  if (currentCustom) embed.addFields({ name: "Current Custom Rule", value: currentCustom.slice(0, 1024) });

  return {
    embeds: [embed],
    components: [
      selectRow(customId, "Select 4th down rule", [
        option("No 4th Down Rules", "none"),
        option("Standard REC Rule", "standard_rec", "Past midfield and 4th & 3 or less; trailing in second half can go anytime."),
        option("Custom 4th Down Rules", "custom")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildFourthDownCustomModal(draft: LeagueSetupDraft, phase: "regular" | "playoff") {
  const isPlayoff = phase === "playoff";
  return new ModalBuilder()
    .setCustomId(`${LEAGUE_SETUP_CUSTOM_IDS.fourthDownCustomModal}:${phase}`)
    .setTitle(`${isPlayoff ? "Playoff" : "Regular Season"} 4th Down Rule`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.fourthDownCustomInput)
          .setLabel("Custom 4th Down Rule")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setValue(isPlayoff ? draft.customFourthDownRulePlayoff : draft.customFourthDownRuleRegular)
          .setPlaceholder("Describe when users may go for it on 4th down.")
      )
    );
}

export function buildPositionChangeWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: Position Changes", draft);
  if (draft.positionChangePolicy !== "open" && draft.positionChangePolicyDescription) {
    embed.addFields({ name: "Current Restriction Notes", value: draft.positionChangePolicyDescription.slice(0, 1024) });
  }

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.positionChangePolicy, "Select position change policy", [
        option("Open", "open"),
        option("Restricted", "restricted", "Realistic changes only."),
        option("Highly Restricted", "highly_restricted", "Same-group changes only unless approved.")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildPositionRestrictionModal(draft: LeagueSetupDraft) {
  return new ModalBuilder()
    .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.positionChangeRestrictionModal)
    .setTitle("Position Change Restrictions")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.positionChangeRestrictionInput)
          .setLabel("Explain the restrictions")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setValue(draft.positionChangePolicyDescription ?? "")
          .setPlaceholder("e.g., Realistic changes only; OL-to-OL allowed, WR-to-TE requires approval.")
      )
    );
}

export function buildTradeApprovalWindow(draft: LeagueSetupDraft) {
  return {
    embeds: [baseEmbed("League Setup: Trade Approval", draft)],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.tradeApprovalPolicy, "Select trade approval rule", [
        option("No Approval Required", "no_approval_required"),
        option("Commissioner Review", "commissioner_review"),
        option("Competition Committee Review", "competition_committee_review")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildCpuRulesWindow(draft: LeagueSetupDraft) {
  const embed = baseEmbed("League Setup: CPU Trading", draft);
  if (draft.cpuTradingPolicy === "restricted" && draft.cpuTradingRestriction) {
    embed.addFields({ name: "Current Restriction Notes", value: draft.cpuTradingRestriction.slice(0, 1024) });
  }

  return {
    embeds: [embed],
    components: [
      selectRow(LEAGUE_SETUP_CUSTOM_IDS.cpuTradingPolicy, "Select CPU trading policy", [
        option("Allowed", "allowed"),
        option("Restricted", "restricted", "Requires commissioner-defined restrictions."),
        option("Not Allowed", "not_allowed")
      ]),
      buildNavigationRow()
    ]
  };
}

export function buildCpuTradingRestrictionModal(draft: LeagueSetupDraft) {
  return new ModalBuilder()
    .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.cpuTradingRestrictionModal)
    .setTitle("CPU Trading Restrictions")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LEAGUE_SETUP_CUSTOM_IDS.cpuTradingRestrictionInput)
          .setLabel("Explain CPU trading restrictions")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setValue(draft.cpuTradingRestriction ?? "")
          .setPlaceholder("e.g., Commissioner approval required; no CPU trades for star dev players.")
      )
    );
}

// Two small fixed-option multi-selects (regular season / postseason), each with independent
// Force Win eligibility rules -- replaces the old free-text "Force Win Requirements" modal,
// which described a policy but had no logic behind it (see packages/shared/fw-fs-rules.ts).
export function buildActivityRequirementsWindow(draft: LeagueSetupDraft) {
  const embed = new EmbedBuilder()
    .setTitle("League Setup: Force Win Rules")
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Select every condition that should let a coach request (or a commissioner grant) a Force Win. Selecting **Never granted** overrides any other selection for that season stage.",
    ].join("\n"));

  function row(customId: string, selected: string[]) {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder("Select Force Win rules")
        .setMinValues(0)
        .setMaxValues(FORCE_WIN_RULE_OPTIONS.length)
        .addOptions(
          ...FORCE_WIN_RULE_OPTIONS.map((opt) =>
            new StringSelectMenuOptionBuilder().setLabel(opt.label).setDescription(opt.description.slice(0, 100)).setValue(opt.key).setDefault(selected.includes(opt.key))
          )
        )
    );
  }

  return {
    embeds: [embed],
    components: [
      row(LEAGUE_SETUP_CUSTOM_IDS.forceWinRulesRegularSelect, draft.forceWinRulesRegular),
      row(LEAGUE_SETUP_CUSTOM_IDS.forceWinRulesPostseasonSelect, draft.forceWinRulesPostseason),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.forceWinRulesDone).setLabel(draft.editMode ? "Save & Continue" : "Continue").setStyle(ButtonStyle.Success)
      ),
      buildNavigationRow()
    ]
  };
}

export function buildFairSimRulesWindow(draft: LeagueSetupDraft) {
  const embed = new EmbedBuilder()
    .setTitle("League Setup: Fair Sim Rules")
    .setDescription([
      `League: **${draft.name}**`,
      "",
      "Select every condition where the game should be settled as a Fair Sim instead of played.",
    ].join("\n"));

  function row(customId: string, selected: string[]) {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder("Select Fair Sim rules")
        .setMinValues(0)
        .setMaxValues(FAIR_SIM_RULE_OPTIONS.length)
        .addOptions(
          ...FAIR_SIM_RULE_OPTIONS.map((opt) =>
            new StringSelectMenuOptionBuilder().setLabel(opt.label).setDescription(opt.description.slice(0, 100)).setValue(opt.key).setDefault(selected.includes(opt.key))
          )
        )
    );
  }

  return {
    embeds: [embed],
    components: [
      row(LEAGUE_SETUP_CUSTOM_IDS.fairSimRulesRegularSelect, draft.fairSimRulesRegular),
      row(LEAGUE_SETUP_CUSTOM_IDS.fairSimRulesPostseasonSelect, draft.fairSimRulesPostseason),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(LEAGUE_SETUP_CUSTOM_IDS.fairSimRulesDone).setLabel(draft.editMode ? "Save & Continue" : "Continue").setStyle(ButtonStyle.Success)
      ),
      buildNavigationRow()
    ]
  };
}
