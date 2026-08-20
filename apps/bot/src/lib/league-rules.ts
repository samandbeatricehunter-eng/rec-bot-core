// Curated rules categories for /rules -- deliberately NOT a 1:1 mirror of the site's ~90-field
// Settings schema (apps/web/src/routes/league-mgmt/settings/settings-fields.ts, not importable
// from this package); this covers the subset a coach actually needs to check mid-season,
// grouped for a Discord embed. Custom Rules (free-text, commissioner-authored) come from the
// same draft and get their own category per the draft's own `category` field.
import { fairSimRuleLabel, forceWinRuleLabel } from "@rec/shared";

export type RuleRow = { label: string; value: string };
export type RuleCategory = { key: string; label: string; rows: RuleRow[] };

function label(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "On" : "Off";
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function row(l: string, value: unknown): RuleRow | null {
  if (value == null || value === "") return null;
  return { label: l, value: label(value) };
}

function compact(rows: Array<RuleRow | null>): RuleRow[] {
  return rows.filter((r): r is RuleRow => r !== null);
}

function formatRuleKeyList(keys: unknown, labeler: (key: string) => string): string | null {
  if (!Array.isArray(keys) || keys.length === 0) return null;
  return keys.map((k) => labeler(String(k))).join(", ");
}

export function buildRuleCategories(draft: Record<string, any>): RuleCategory[] {
  const categories: RuleCategory[] = [];

  categories.push({
    key: "gameplay",
    label: "Gameplay Rules",
    rows: compact([
      row("Difficulty", draft.difficulty ?? draft.cfbDifficulty),
      row("4th Down (Regular Season)", draft.fourthDownRuleTypeRegular === "custom" ? draft.customFourthDownRuleRegular : draft.fourthDownRuleTypeRegular),
      row("4th Down (Playoffs)", draft.fourthDownRuleTypePlayoff === "custom" ? draft.customFourthDownRulePlayoff : draft.fourthDownRuleTypePlayoff),
      row("Injuries", draft.injuryPolicy),
      row("Min. Play Clock", draft.minimumPlayClockSeconds ? `${draft.minimumPlayClockSeconds}s` : null),
      row("Sliders Adjusted", draft.slidersAdjusted),
    ]),
  });

  categories.push({
    key: "streaming",
    label: "Streaming Requirements",
    rows: compact([
      row("Regular Season", draft.regularSeasonStreamingRequirement),
      row("Regular Season — Side", draft.regularSeasonStreamingSide),
      row("Postseason", draft.postseasonStreamingRequirement),
      row("Postseason — Side", draft.postseasonStreamingSide),
      row("Game of the Week", draft.gotwStreamingRequirement),
      row("Game of the Week — Side", draft.gotwStreamingSide),
    ]),
  });

  categories.push({
    key: "fs_fw",
    label: "Fair Sim / Force Win",
    rows: compact([
      row("Fair Sim — Regular", formatRuleKeyList(draft.fairSimRulesRegular, fairSimRuleLabel)),
      row("Fair Sim — Postseason", formatRuleKeyList(draft.fairSimRulesPostseason, fairSimRuleLabel)),
      row("Force Win — Regular", formatRuleKeyList(draft.forceWinRulesRegular, forceWinRuleLabel)),
      row("Force Win — Postseason", formatRuleKeyList(draft.forceWinRulesPostseason, forceWinRuleLabel)),
    ]),
  });

  categories.push({
    key: "trades",
    label: "Trade Rules",
    rows: compact([
      row("Approval Policy", draft.tradeApprovalPolicy),
      row("Trade Difficulty", draft.tradeDifficulty),
      row("CPU Trading", draft.cpuTradingPolicy),
      row("CPU Trading Notes", draft.cpuTradingRestriction),
      row("CPU Trades / Season Cap", draft.cpuTradesSeasonCap),
      row("CPU Free Agency", draft.cpuFreeAgencyPolicy),
    ]),
  });

  categories.push({
    key: "roster",
    label: "Roster Rules",
    rows: compact([
      row("Player Edit Permission", draft.playerEditPermission),
      row("Position Change Policy", draft.positionChangePolicy),
      row("Position Change Notes", draft.positionChangePolicyDescription),
      row("Custom Coaches Required", draft.customCoachesRequired),
      row("Custom Playbooks Allowed", draft.customPlaybooksAllowed),
      row("Coach Abilities Restricted", draft.coachAbilitiesRestricted),
      row("Coach Abilities Notes", draft.coachAbilitiesRestrictionNotes),
    ]),
  });

  const customRules = Array.isArray(draft.customRules) ? draft.customRules as Array<{ id: string; category: string; title: string; text: string; sortOrder?: number }> : [];
  const byCategory = new Map<string, typeof customRules>();
  for (const rule of [...customRules].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    byCategory.set(rule.category, [...(byCategory.get(rule.category) ?? []), rule]);
  }
  for (const [category, rules] of byCategory) {
    categories.push({
      key: `custom:${category}`,
      label: category || "Custom Rules",
      rows: rules.map((r) => ({ label: r.title, value: r.text.slice(0, 1000) })),
    });
  }

  return categories.filter((c) => c.rows.length > 0);
}
