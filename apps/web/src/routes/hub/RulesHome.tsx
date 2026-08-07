import { useEffect, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { LeagueSettingsDraft } from "../../types/api.js";
import { SETTINGS_CATEGORIES } from "../league-mgmt/settings/settings-fields.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Card } from "../../components/ui/Card.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";

// Read-only mirror of SettingsHome's generic field renderer — same schema
// (settings-fields.ts), no edit affordance, open to every league member. Channels,
// moderation, and the maintenance/first-time-setup tabs aren't "rules" a member needs to
// read, so those categories are skipped here.
const HIDDEN_CATEGORY_KEYS = new Set(["channels", "moderation", "eos-payouts", "first-time-setup"]);

function formatValue(field: (typeof SETTINGS_CATEGORIES)[number]["fields"][number], draft: LeagueSettingsDraft) {
  const value = draft[field.key];
  if (field.type === "toggle") return value ? "On" : "Off";
  if (field.type === "enum") return field.options?.find((opt) => opt.value === value)?.label ?? (value == null || value === "" ? "—" : String(value));
  if (value == null || value === "") return "—";
  return String(value);
}

export function RulesHome() {
  const { guildId } = useReadyAuth();
  const [draft, setDraft] = useState<LeagueSettingsDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recApi
      .getLeagueRulesDraft(guildId)
      .then((res) => setDraft(res.draft))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load league rules."));
  }, [guildId]);

  if (error && !draft) {
    return (
      <div className="hub-page">
        <PageHeader title="Rules" subtitle="This league's settings, in read-only form." />
        <ErrorState message={error} />
      </div>
    );
  }
  if (!draft) return <LoadingState />;

  const game = String(draft.game ?? "");
  const playCallFields = SETTINGS_CATEGORIES.find((c) => c.key === "play_call")?.fields ?? [];
  const customRules = Array.isArray(draft.customRules)
    ? (draft.customRules as Array<{ id: string; category: string; title: string; text: string; sortOrder?: number }>)
    : [];
  const rulesByCategory = new Map<string, typeof customRules>();
  for (const rule of [...customRules].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const list = rulesByCategory.get(rule.category) ?? [];
    list.push(rule);
    rulesByCategory.set(rule.category, list);
  }

  return (
    <div className="hub-page">
      <PageHeader title="Rules" subtitle="This league's settings, in read-only form." />

      {customRules.length > 0 && (
        <Card className="hub-rules-category">
          <h3>Custom Rules</h3>
          {[...rulesByCategory.entries()].map(([category, rules]) => (
            <div key={category} className="hub-rules-custom-group">
              <h4>{category}</h4>
              {rules.map((rule) => (
                <div key={rule.id} className="hub-rules-row">
                  <span className="hub-rules-label">{rule.title}</span>
                  <span className="hub-rules-value">{rule.text}</span>
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}

      {SETTINGS_CATEGORIES.filter((category) => !HIDDEN_CATEGORY_KEYS.has(category.key)).map((category) => {
        const fields = [...category.fields, ...(category.key === "rules" ? playCallFields : [])]
          .filter((field) => !field.gameFilter || field.gameFilter(game))
          .filter((field) => !field.dependsOn || field.dependsOn(draft));
        if (!fields.length) return null;
        return (
          <Card key={category.key} className="hub-rules-category">
            <h3>{category.label}</h3>
            {fields.map((field) => (
              <div key={field.key} className="hub-rules-row">
                <span className="hub-rules-label">{field.label}</span>
                <span className="hub-rules-value">{formatValue(field, draft)}</span>
              </div>
            ))}
          </Card>
        );
      })}
    </div>
  );
}
