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
import { BadgeMaintenance } from "./BadgeMaintenance.js";
import { ModerationSettings } from "./ModerationSettings.js";
import { CustomPlayerReviewQueue } from "./CustomPlayerReviewQueue.js";

const FIRST_TIME_SETUP_KEY = "first-time-setup";
const EOS_PAYOUTS_KEY = "eos-payouts";
const PURCHASE_DEADLINE_TYPES = [
  ["custom_player", "Custom Players"], ["legend", "Legends"], ["attribute", "Attributes"],
  ["dev_upgrade", "Development Upgrades"], ["age_reset", "Age Resets"],
  ["contract", "Contract Adjustments"], ["player_trait", "Player Traits"],
] as const;
const PURCHASE_DEADLINE_STAGES = [
  "preseason_training_camp", "regular_season", "wild_card", "divisional",
  "conference_championship", "bowl_season", "cfp_first_round", "cfp_quarterfinal",
  "cfp_semifinal", "national_championship", "super_bowl", "offseason",
] as const;

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
  const [newNonCoreCode, setNewNonCoreCode] = useState("");

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
  const coreAttributes = Array.isArray(draft.coreAttributes) ? draft.coreAttributes.map(String) : [];
  const coreOverrides = draft.coreAttributeCapOverrides && typeof draft.coreAttributeCapOverrides === "object"
    ? draft.coreAttributeCapOverrides as Record<string, number>
    : {};
  const nonCoreOverrides = draft.nonCoreAttributeCapOverrides && typeof draft.nonCoreAttributeCapOverrides === "object"
    ? draft.nonCoreAttributeCapOverrides as Record<string, number>
    : {};
  const purchaseDeadlines = draft.purchaseDeadlines && typeof draft.purchaseDeadlines === "object" && !Array.isArray(draft.purchaseDeadlines)
    ? draft.purchaseDeadlines as Record<string, { stage?: string; week?: number }>
    : {};

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

      {activeCategory === "channels" ? <ChannelSettings /> : activeCategory === "moderation" ? <ModerationSettings /> : activeCategory === EOS_PAYOUTS_KEY ? <><EosPayoutMaintenance /><BadgeMaintenance /></> : activeCategory === FIRST_TIME_SETUP_KEY ? (
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
            {activeCategory === "purchases" && Boolean(draft.coinEconomyEnabled) ? (
              <div className="form-field">
                <label className="form-label">Purchase deadlines</label>
                <p className="form-hint">Each product becomes unavailable after the selected stage and week. Leave a product unset to keep it available for the full season.</p>
                {PURCHASE_DEADLINE_TYPES.filter(([key]) => game !== "cfb_27" || !["age_reset", "contract", "player_trait"].includes(key)).map(([key, label]) => {
                  const current = purchaseDeadlines[key];
                  return <div className="attribute-cap-row" key={key}>
                    <span>{label}</span>
                    <select className="form-select" value={current?.stage ?? ""} onChange={(event) => {
                      const next = { ...purchaseDeadlines };
                      if (!event.target.value) delete next[key];
                      else next[key] = { stage: event.target.value, week: current?.week ?? 1 };
                      setField("purchaseDeadlines", next);
                    }}>
                      <option value="">No deadline</option>
                      {PURCHASE_DEADLINE_STAGES.map((stage) => <option key={stage} value={stage}>{stage.replaceAll("_", " ")}</option>)}
                    </select>
                    <input className="form-input" aria-label={`${label} deadline week`} type="number" min={1} max={30} disabled={!current?.stage} value={current?.week ?? 1} onChange={(event) => setField("purchaseDeadlines", { ...purchaseDeadlines, [key]: { stage: current?.stage ?? "regular_season", week: Math.max(1, Math.min(30, Number(event.target.value))) } })} />
                  </div>;
                })}
              </div>
            ) : null}
            {activeCategory === "purchases" && Boolean(draft.attributePurchasesEnabled) ? (
              <div className="form-field">
                <label className="form-label" htmlFor="core-attributes">Core attributes</label>
                <input
                  id="core-attributes"
                  className="form-input"
                  value={coreAttributes.join(", ")}
                  onChange={(event) => {
                    const next = [...new Set(event.target.value.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean))];
                    setDraft((current) => current ? {
                      ...current,
                      coreAttributes: next,
                      coreAttributeCapOverrides: Object.fromEntries(Object.entries(coreOverrides).filter(([key]) => next.includes(key))),
                    } : current);
                  }}
                />
                <p className="form-hint">Comma-separated in-game attribute codes. Each uses the default core cap unless an override is set below — and the group cap above still applies to their combined total.</p>
                {coreAttributes.map((code) => (
                  <label key={code} className="attribute-cap-row">
                    <span>{code} season cap</span>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      max={99}
                      placeholder={String(draft.coreAttributePurchasesSeasonCap ?? 0)}
                      value={coreOverrides[code] ?? ""}
                      onChange={(event) => {
                        const next = { ...coreOverrides };
                        if (event.target.value === "") delete next[code];
                        else next[code] = Math.max(0, Math.min(99, Number(event.target.value)));
                        setField("coreAttributeCapOverrides", next);
                      }}
                    />
                  </label>
                ))}

                <label className="form-label" htmlFor="non-core-override-code" style={{ marginTop: "var(--space-3)" }}>Non-Core attribute overrides</label>
                <p className="form-hint">Any attribute not listed as Core above is Non-Core. It has no individual cap by default — only the Non-Core group cap — unless you add a specific override here.</p>
                {Object.entries(nonCoreOverrides).map(([code, cap]) => (
                  <label key={code} className="attribute-cap-row">
                    <span>{code} season cap</span>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      max={99}
                      value={cap}
                      onChange={(event) => {
                        const next = { ...nonCoreOverrides };
                        if (event.target.value === "") delete next[code];
                        else next[code] = Math.max(0, Math.min(99, Number(event.target.value)));
                        setField("nonCoreAttributeCapOverrides", next);
                      }}
                    />
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={`Remove ${code} override`}
                      onClick={() => {
                        const next = { ...nonCoreOverrides };
                        delete next[code];
                        setField("nonCoreAttributeCapOverrides", next);
                      }}
                    >
                      ×
                    </button>
                  </label>
                ))}
                <div className="attribute-cap-row">
                  <input
                    id="non-core-override-code"
                    className="form-input"
                    placeholder="Attribute code (e.g. SPD)"
                    value={newNonCoreCode}
                    onChange={(event) => setNewNonCoreCode(event.target.value.toUpperCase())}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const code = newNonCoreCode.trim();
                      if (!code || coreAttributes.includes(code) || nonCoreOverrides[code] != null) return;
                      setField("nonCoreAttributeCapOverrides", { ...nonCoreOverrides, [code]: 0 });
                      setNewNonCoreCode("");
                    }}
                  >
                    Add Override
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>

          {activeCategory === "purchases" && Boolean(draft.customPlayersEnabled) ? <CustomPlayerReviewQueue guildId={guildId} /> : null}

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
