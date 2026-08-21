import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { LeagueSettingsDraft } from "../../../types/api.js";
import { SETTINGS_CATEGORIES } from "./settings-fields.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { ChannelSettings } from "./ChannelSettings.js";
import { EosPayoutMaintenance } from "./EosPayoutMaintenance.js";
import { WagerMaintenance } from "./WagerMaintenance.js";
import { TransactionMaintenance } from "./TransactionMaintenance.js";
import { CfbRosterMaintenance } from "./CfbRosterMaintenance.js";
import { ModerationSettings } from "./ModerationSettings.js";
import { CustomPlayerReviewQueue } from "./CustomPlayerReviewQueue.js";
import { CoreAttributePicker } from "./CoreAttributePicker.js";
import { DeleteLeagueHome } from "../delete-league/DeleteLeagueHome.js";
import { RetireSettings } from "./RetireSettings.js";
import { SliderSettingsPanel } from "./SliderSettingsPanel.js";
import { MaddenCompanionSettings } from "./MaddenCompanionSettings.js";
import { DataModeSettings } from "./DataModeSettings.js";

const EOS_PAYOUTS_KEY = "eos-payouts";
const RETIRE_KEY = "retire";
const DELETE_LEAGUE_KEY = "delete-league";
const PURCHASE_DEADLINE_TYPES = [
  ["custom_player", "Custom Players"], ["legend", "Legends"], ["attribute", "Attributes"],
  ["dev_upgrade", "Development Upgrades"], ["age_reset", "Age Resets"],
  ["contract", "Contract Adjustments"],
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
  const [searchParams] = useSearchParams();
  // Deep-linked here from the commissioner Pending Items panel (custom-player review has no
  // generic approve/deny modal, so that click navigates straight to Settings > Purchases) —
  // without reading this, the link landed on whatever category is first in the list, which
  // looked from the Pending Items side like the click had done nothing at all.
  const requestedCategory = searchParams.get("category");
  const [activeCategory, setActiveCategory] = useState(
    requestedCategory && SETTINGS_CATEGORIES.some((c) => c.key === requestedCategory) ? requestedCategory : SETTINGS_CATEGORIES[0].key,
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newNonCoreCode, setNewNonCoreCode] = useState("");
  const [newRuleCategory, setNewRuleCategory] = useState("");
  const [newRuleTitle, setNewRuleTitle] = useState("");
  const [newRuleText, setNewRuleText] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);

  useEffect(() => {
    recApi
      .getLeagueSettingsDraft(guildId)
      .then((res) => setDraft(res.draft))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load league settings."));
  }, [guildId]);

  function setField(key: string, value: unknown) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function setFields(patch: Record<string, unknown>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
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
  const playCallFields = SETTINGS_CATEGORIES.find((c) => c.key === "play_call")?.fields ?? [];
  const visibleFields = [...category.fields, ...(category.key === "rules" ? playCallFields : [])].filter((f) => !f.gameFilter || f.gameFilter(game));
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
  const customRules = Array.isArray(draft.customRules) ? draft.customRules as Array<{ id:string; category:string; title:string; text:string; sortOrder?:number; createdAt?:string; updatedAt?:string }> : [];

  return (
    <div>
      <PageHeader title="Settings" subtitle="League configuration — economy, rules, gameplay, and more." />
      {notice && <p style={{ color: "var(--success)", marginTop: 0 }}>{notice}</p>}
      {error && <ErrorState message={error} />}

      <Card>
        <div className="form-field">
          <label className="form-label" htmlFor="league-logo-upload">League logo</label>
          <input id="league-logo-upload" className="form-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={logoUploading}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setLogoUploading(true);
              setError(null);
              setNotice(null);
              try {
                await recApi.uploadLeagueLogo(guildId, file);
                setNotice("League logo updated.");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to upload league logo.");
              } finally {
                setLogoUploading(false);
                event.target.value = "";
              }
            }} />
          <p className="form-hint">PNG, JPEG, or WebP, up to 5 MB. Animated GIFs are rejected. Without a logo, REC uses the league abbreviation.</p>
        </div>
      </Card>

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        {SETTINGS_CATEGORIES.filter((c) => c.key !== "play_call").map((c) => (
          <Button key={c.key} variant={c.key === activeCategory ? "primary" : "secondary"} onClick={() => setActiveCategory(c.key)}>
            {c.label}
          </Button>
        ))}
      </div>

      {activeCategory === "channels" ? <ChannelSettings /> : activeCategory === "integrations" ? (
        <>
          <DataModeSettings game={game} dataMode={String(draft.dataMode ?? "box_scores")} onChange={(next) => setField("dataMode", next)} />
          <div style={{ margin: "var(--space-3) 0 var(--space-4)" }}>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save Settings"}
            </Button>
          </div>
          <MaddenCompanionSettings leagueId={String(draft.leagueId ?? "")} game={game} />
        </>
      ) : activeCategory === "moderation" ? <ModerationSettings /> : activeCategory === EOS_PAYOUTS_KEY ? <><EosPayoutMaintenance /><WagerMaintenance /><TransactionMaintenance /><CfbRosterMaintenance /></> : activeCategory === RETIRE_KEY ? (
        <RetireSettings />
      ) : activeCategory === DELETE_LEAGUE_KEY ? (
        <DeleteLeagueHome />
      ) : (
        <>
          {category.key === "gameplay" && (game === "cfb_27" || game === "madden_26" || game === "madden_27") && (
            <SliderSettingsPanel game={game} enabled={Boolean(draft.slidersAdjusted)}
              presetId={String(draft.sliderPresetId ?? "")}
              values={draft.sliderSettings && typeof draft.sliderSettings === "object" ? draft.sliderSettings as Record<string, number> : {}}
              onChange={setFields} />
          )}
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
                      {field.type === "multiselect" && (() => {
                        const selected = Array.isArray(draft[field.key]) ? draft[field.key] as string[] : [];
                        return (
                          <div className="settings-multiselect">
                            {field.options?.map((opt) => {
                              const checked = selected.includes(opt.value);
                              return (
                                <label key={opt.value} className="settings-multiselect-option">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => setField(field.key, checked ? selected.filter((v) => v !== opt.value) : [...selected, opt.value])}
                                  />
                                  <span>{opt.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </>
                  )}
                  {field.hint && <p className="form-hint">{field.hint}</p>}
                </div>
              );
            })}
            {activeCategory === "rules" ? <div className="form-field">
              <label className="form-label">Custom league rules</label>
              <p className="form-hint">Add categories and individual rules. These appear in the read-only League Rules view and the REC Guide. Use the arrows to reorder rules.</p>
              {customRules.map((rule, index) => <div key={rule.id} style={{ border: "1px solid var(--card-border)", borderRadius: "var(--radius-md)", padding: "var(--space-2)", marginBottom: "var(--space-2)", background: "rgba(255,255,255,0.02)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, minWidth: 24 }}>{index + 1}.</span>
                  <input className="form-input" aria-label="Rule category" placeholder="Category" style={{ flex: 1, minWidth: 100 }} value={rule.category} onChange={(event) => setField("customRules", customRules.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value, updatedAt: new Date().toISOString() } : item))} />
                  <input className="form-input" aria-label="Rule title" placeholder="Title" style={{ flex: 1, minWidth: 100 }} value={rule.title} onChange={(event) => setField("customRules", customRules.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value, updatedAt: new Date().toISOString() } : item))} />
                  <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                    <Button variant="secondary" size="compact" disabled={index === 0} onClick={() => { const updated = [...customRules]; [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]]; updated.forEach((r, i) => { r.sortOrder = i; r.updatedAt = new Date().toISOString(); }); setField("customRules", updated); }}>&uarr;</Button>
                    <Button variant="secondary" size="compact" disabled={index === customRules.length - 1} onClick={() => { const updated = [...customRules]; [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]]; updated.forEach((r, i) => { r.sortOrder = i; r.updatedAt = new Date().toISOString(); }); setField("customRules", updated); }}>&darr;</Button>
                    <Button variant="danger" size="compact" onClick={() => setField("customRules", customRules.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button>
                  </div>
                </div>
                <textarea className="form-input" aria-label="Rule text" rows={2} value={rule.text} onChange={(event) => setField("customRules", customRules.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value, updatedAt: new Date().toISOString() } : item))} />
                <div style={{ display: "flex", gap: "var(--space-2)", fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  <span>Created: {new Date(rule.createdAt ?? Date.now()).toLocaleString()}</span>
                  {rule.updatedAt && rule.updatedAt !== rule.createdAt && <span>Edited: {new Date(rule.updatedAt).toLocaleString()}</span>}
                </div>
              </div>)}
              <div style={{ border: "1px dashed var(--card-border)", borderRadius: "var(--radius-md)", padding: "var(--space-2)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                  <div style={{ position: "relative" }}>
                    <input className="form-input" placeholder="Category" value={newRuleCategory} onChange={(event) => setNewRuleCategory(event.target.value)} />
                    {newRuleCategory.trim() && (() => {
                      const existingCats = [...new Set(customRules.map((r) => r.category))].filter((c) => c.toLowerCase().includes(newRuleCategory.toLowerCase()));
                      return existingCats.length > 0 ? (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "var(--card-bg)", border: "var(--card-border)", borderRadius: "var(--radius-md)", maxHeight: 120, overflowY: "auto", boxShadow: "var(--shadow-card)" }}>
                          {existingCats.map((cat) => <button key={cat} type="button" style={{ display: "block", width: "100%", padding: "4px 8px", background: "none", border: "none", color: "var(--text)", textAlign: "left", fontSize: 13, cursor: "pointer" }} onClick={() => setNewRuleCategory(cat)}>{cat}</button>)}
                        </div>
                      ) : null;
                    })()}
                  </div>
                  <input className="form-input" placeholder="Rule title" value={newRuleTitle} onChange={(event) => setNewRuleTitle(event.target.value)} />
                </div>
                <textarea className="form-input" rows={2} placeholder="Rule details" value={newRuleText} onChange={(event) => setNewRuleText(event.target.value)} />
                <div style={{ marginTop: "var(--space-2)" }}>
                  <Button variant="secondary" size="compact" disabled={!newRuleCategory.trim() || !newRuleTitle.trim() || !newRuleText.trim()} onClick={() => {
                    const now = new Date().toISOString();
                    setField("customRules", [...customRules, { id: crypto.randomUUID(), category: newRuleCategory.trim(), title: newRuleTitle.trim(), text: newRuleText.trim(), sortOrder: customRules.length, createdAt: now, updatedAt: now }]);
                    setNewRuleCategory(""); setNewRuleTitle(""); setNewRuleText("");
                  }}>Add rule</Button>
                </div>
              </div>
            </div> : null}
            {activeCategory === "purchases" && Boolean(draft.attributePurchasesEnabled) ? (
              <div className="form-field">
                <CoreAttributePicker
                  value={coreAttributes}
                  onChange={(next) => {
                    setDraft((current) => current ? {
                      ...current,
                      coreAttributes: next,
                      coreAttributeCapOverrides: Object.fromEntries(Object.entries(coreOverrides).filter(([key]) => next.includes(key))),
                    } : current);
                  }}
                />
                <p className="form-hint">Each selected attribute uses the Core Attribute Default Cap above unless overridden below. Core attributes do not share a pooled group cap.</p>
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

                {draft.nonCoreAttributeCapMode === "individual" ? <>
                <label className="form-label" htmlFor="non-core-override-code" style={{ marginTop: "var(--space-3)" }}>Individual Non-Core attribute caps</label>
                <p className="form-hint">Individual mode disables the pooled Non-Core group cap. Add only the attributes that need a limit; unlisted Non-Core attributes remain unlimited.</p>
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
                </> : null}
              </div>
            ) : null}
            {activeCategory === "purchases" && Boolean(draft.coinEconomyEnabled) ? (
              <div className="form-field">
                <label className="form-label">Purchase deadlines</label>
                <p className="form-hint">Each product becomes unavailable after the selected stage and week. Leave a product unset to keep it available for the full season.</p>
                {PURCHASE_DEADLINE_TYPES.filter(([key]) => game !== "cfb_27" || !["age_reset", "contract"].includes(key)).map(([key, label]) => {
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
