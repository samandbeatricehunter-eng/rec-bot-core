import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { LeagueSettingsDraft } from "../../../types/api.js";
import { SETTINGS_CATEGORIES } from "./settings-fields.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { FirstTimeSetupHome } from "../first-time-setup/FirstTimeSetupHome.js";
import { ChannelSettings } from "./ChannelSettings.js";
import { EosPayoutMaintenance } from "./EosPayoutMaintenance.js";

const FIRST_TIME_SETUP_KEY = "first-time-setup";
const EOS_PAYOUTS_KEY = "eos-payouts";

// One generic renderer for every category in settings-fields.ts's schema. See that file's
// header comment for what's deliberately out of scope (channel routing, attribute/conference
// map editors) and why.
//
// updateLeagueConfig requires the FULL config object every save, not a partial patch —
// CreateLeagueSchema gives nearly every field a Zod default, so any field omitted from the
// request resets to that default rather than preserving its current value (confirmed via
// how the bot itself always spreads its entire in-memory draft on every single-field edit).
// This screen holds one full draft in state and always submits all of it, never a subset.
export function SettingsHome() {
  const { guildId } = useReadyAuth();
  const [draft, setDraft] = useState<LeagueSettingsDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState(SETTINGS_CATEGORIES[0].key);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    recApi
      .getLeagueSettingsDraft(guildId)
      .then((res) => setDraft(res.draft))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load league settings."));
  }, [guildId]);

  function setField(key: string, value: unknown) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    // Apply every field's dependsOn/resetTo rule against the full current draft (not just
    // the active tab) before submitting — a hidden field's stale value shouldn't persist.
    const game = String(draft.game ?? "");
    const payload: LeagueSettingsDraft = { ...draft, guildId };
    for (const category of SETTINGS_CATEGORIES) {
      for (const field of category.fields) {
        if (field.gameFilter && !field.gameFilter(game)) continue;
        if (field.dependsOn && !field.dependsOn(draft) && "resetTo" in field) {
          payload[field.key] = field.resetTo;
        }
      }
    }
    try {
      await recApi.updateLeagueSettings(payload);
      setDraft(payload);
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save league settings.");
    } finally {
      setSaving(false);
    }
  }

  if (error && !draft) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="League configuration — economy, rules, gameplay, and more." />
        <ErrorState message={error} />
      </div>
    );
  }
  if (!draft) return <LoadingState />;

  const game = String(draft.game ?? "");
  const category = SETTINGS_CATEGORIES.find((c) => c.key === activeCategory) ?? SETTINGS_CATEGORIES[0];
  const visibleFields = category.fields.filter((f) => !f.gameFilter || f.gameFilter(game));

  return (
    <div>
      <PageHeader title="Settings" subtitle="League configuration — economy, rules, gameplay, and more." />
      {notice && <p style={{ color: "var(--success)", marginTop: 0 }}>{notice}</p>}
      {error && <ErrorState message={error} />}

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        {SETTINGS_CATEGORIES.map((c) => (
          <Button key={c.key} variant={c.key === activeCategory ? "primary" : "secondary"} onClick={() => setActiveCategory(c.key)}>
            {c.label}
          </Button>
        ))}
      </div>

      {activeCategory === "channels" ? <ChannelSettings /> : activeCategory === EOS_PAYOUTS_KEY ? <EosPayoutMaintenance /> : activeCategory === FIRST_TIME_SETUP_KEY ? (
        <FirstTimeSetupHome />
      ) : (
        <>
          <Card>
            {visibleFields.map((field) => {
              if (field.dependsOn && !field.dependsOn(draft)) return null;
              return (
                <div key={field.key} className="form-field">
                  {field.type === "toggle" ? (
                    <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(draft[field.key])}
                        onChange={(e) => setField(field.key, e.target.checked)}
                      />
                      {field.label}
                    </label>
                  ) : (
                    <>
                      <label className="form-label" htmlFor={field.key}>{field.label}</label>
                      {field.type === "enum" && (
                        <select
                          id={field.key}
                          className="form-select"
                          value={String(draft[field.key] ?? "")}
                          onChange={(e) => setField(field.key, e.target.value)}
                        >
                          {field.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      )}
                      {field.type === "number" && (
                        <input
                          id={field.key}
                          className="form-input"
                          type="number"
                          min={field.min}
                          max={field.max}
                          value={draft[field.key] == null ? "" : String(draft[field.key])}
                          onChange={(e) => setField(field.key, e.target.value === "" ? null : Number(e.target.value))}
                        />
                      )}
                      {field.type === "text" && (
                        <input
                          id={field.key}
                          className="form-input"
                          value={String(draft[field.key] ?? "")}
                          onChange={(e) => setField(field.key, e.target.value)}
                        />
                      )}
                      {field.type === "textarea" && (
                        <textarea
                          id={field.key}
                          className="form-input"
                          rows={3}
                          value={String(draft[field.key] ?? "")}
                          onChange={(e) => setField(field.key, e.target.value)}
                        />
                      )}
                    </>
                  )}
                  {field.hint && <p className="form-hint">{field.hint}</p>}
                </div>
              );
            })}
          </Card>

          <div style={{ marginTop: "var(--space-4)" }}>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save Settings"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
