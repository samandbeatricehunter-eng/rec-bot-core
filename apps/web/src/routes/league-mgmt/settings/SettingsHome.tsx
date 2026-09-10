import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { LeagueSettingsDraft } from "../../../types/api.js";
import { SETTINGS_CATEGORIES, isSettingsCategoryVisible } from "./settings-fields.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Modal } from "../../../components/ui/Modal.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { ChannelSettings } from "./ChannelSettings.js";
import { DeleteLeagueHome } from "../delete-league/DeleteLeagueHome.js";
import { SliderSettingsPanel } from "./SliderSettingsPanel.js";
import { RiseSettings } from "./RiseSettings.js";

const TOP_TABS = [
  { key: "discord", label: "Discord" },
  { key: "league", label: "League Settings" },
  { key: "delete-league", label: "Delete League" },
] as const;
type TopTab = (typeof TOP_TABS)[number]["key"];

function summarizeValue(field: { type: string; options?: { value: string; label: string }[] }, value: unknown): string {
  if (field.type === "toggle") return value ? "Enabled" : "Disabled";
  if (field.type === "enum") return field.options?.find((o) => o.value === value)?.label ?? "Not set";
  if (field.type === "multiselect") {
    const arr = Array.isArray(value) ? value : [];
    if (!arr.length) return "None";
    return arr.map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(", ");
  }
  if (value == null || value === "") return "Not set";
  return String(value);
}

// One generic renderer for every category in settings-fields.ts's schema, presented as a
// block card (bold-label summary rows) with a + that opens the full editor in a modal — the
// same pattern ChannelSettings.tsx uses for the Discord tab.
export function SettingsHome() {
  const { guildId } = useReadyAuth();
  const [draft, setDraft] = useState<LeagueSettingsDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("category") === "delete-league" ? "delete-league" : "league";
  const [topTab, setTopTab] = useState<TopTab>(requestedTab);
  const [editCategory, setEditCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newRuleCategory, setNewRuleCategory] = useState("");
  const [newRuleTitle, setNewRuleTitle] = useState("");
  const [newRuleText, setNewRuleText] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [editDraft, setEditDraft] = useState<LeagueSettingsDraft | null>(null);

  useEffect(() => {
    recApi
      .getLeagueSettingsDraft(guildId)
      .then((res) => setDraft(res.draft))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load league settings."));
  }, [guildId]);

  if (error && !draft) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="League configuration — economy, rules, gameplay, and more." />
        <ErrorState message={error} />
      </div>
    );
  }
  if (!draft) return <LoadingState />;

  const isRise = draft.leagueType === "rise_to_immortality";
  const game = String(draft.game ?? "");
  const visibleCategories = SETTINGS_CATEGORIES.filter((c) => isSettingsCategoryVisible(c) && (c.key !== "rise" || isRise));

  function openEdit(categoryKey: string) {
    setEditDraft(draft);
    setEditCategory(categoryKey);
  }

  async function handleSave() {
    if (!editDraft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const nextDraft = { ...editDraft };
    for (const category of SETTINGS_CATEGORIES) {
      for (const field of category.fields) {
        if (field.dependsOn && !field.dependsOn(nextDraft) && "resetTo" in field) {
          (nextDraft as Record<string, unknown>)[field.key] = field.resetTo;
        }
      }
    }
    const payload: LeagueSettingsDraft = { ...nextDraft, guildId };
    try {
      await recApi.updateLeagueSettings(payload);
      setDraft(payload);
      setNotice("Settings saved.");
      setEditCategory(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save league settings.");
    } finally {
      setSaving(false);
    }
  }

  function setEditField(key: string, value: unknown) {
    setEditDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }
  function setEditFields(patch: Record<string, unknown>) {
    setEditDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  const editCategoryDef = editCategory ? visibleCategories.find((c) => c.key === editCategory) : null;
  const customRules = Array.isArray(draft.customRules) ? draft.customRules as Array<{ id: string; category: string; title: string; text: string; sortOrder?: number; createdAt?: string; updatedAt?: string }> : [];
  const editCustomRules = Array.isArray(editDraft?.customRules) ? editDraft!.customRules as typeof customRules : [];

  return (
    <div>
      <PageHeader title="Settings" subtitle="League configuration — economy, rules, gameplay, and more." />
      {notice && <p style={{ color: "var(--success)", marginTop: 0 }}>{notice}</p>}
      {error && <ErrorState message={error} />}

      <nav className="settings-nav" aria-label="Settings sections" style={{ marginBottom: "var(--space-4)" }}>
        <div className="settings-nav-group-tabs">
          {TOP_TABS.map((tab) => (
            <Button key={tab.key} variant={tab.key === topTab ? "primary" : "secondary"} onClick={() => setTopTab(tab.key)}>
              {tab.label}
            </Button>
          ))}
        </div>
      </nav>

      {topTab === "discord" ? (
        <ChannelSettings />
      ) : topTab === "delete-league" ? (
        <DeleteLeagueHome />
      ) : (
        <>
          {visibleCategories.map((category) => (
            <Card key={category.key} style={{ marginBottom: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
                <p style={{ fontWeight: 500, fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{category.label}</p>
                <button type="button" aria-label={`Edit ${category.label}`} className="btn-icon" onClick={() => openEdit(category.key)}>
                  <Plus size={16} />
                </button>
              </div>
              {category.key === "league_info" && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "var(--text-sm)", borderTop: "1px solid var(--border)" }}>
                  <span>League Logo</span>
                  <span style={{ fontWeight: 500 }}>{draft.logoUrl ? "Assigned" : "Unassigned"}</span>
                </div>
              )}
              {category.key === "rise" ? (
                <div style={{ padding: "6px 0", fontSize: "var(--text-sm)" }}>Intro video and rookie draft scheduling.</div>
              ) : category.fields.map((field) => {
                if (field.dependsOn && !field.dependsOn(draft)) return null;
                return (
                  <div key={field.key} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "var(--text-sm)", borderTop: "1px solid var(--border)" }}>
                    <span style={{ fontWeight: 500 }}>{field.label}</span>
                    <span>{summarizeValue(field, draft[field.key])}</span>
                  </div>
                );
              })}
            </Card>
          ))}
        </>
      )}

      {editCategory && editCategoryDef && editDraft && (
        <Modal title={editCategoryDef.label} onClose={() => setEditCategory(null)}>
          {editCategoryDef.key === "rise" ? (
            <RiseSettings />
          ) : editCategoryDef.key === "league_info" ? (
            <div className="form-field">
              <label className="form-label" htmlFor="league-logo-upload">League Logo</label>
              <input id="league-logo-upload" className="form-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={logoUploading}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setLogoUploading(true);
                  setError(null);
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
              <p className="form-hint">PNG, JPEG, or WebP, up to 5 MB. Without a logo, REC uses the league abbreviation.</p>
              {editCategoryDef.fields.map((field) => (
                <FieldEditor key={field.key} field={field} draft={editDraft} setField={setEditField} />
              ))}
            </div>
          ) : (
            <>
              {editCategoryDef.key === "gameplay" && (game === "madden_26" || game === "madden_27") && (
                <SliderSettingsPanel game={game} enabled={Boolean(editDraft.slidersAdjusted)}
                  presetId={String(editDraft.sliderPresetId ?? "")}
                  values={editDraft.sliderSettings && typeof editDraft.sliderSettings === "object" ? editDraft.sliderSettings as Record<string, number> : {}}
                  onChange={setEditFields} />
              )}
              {editCategoryDef.fields.map((field) => (
                <FieldEditor key={field.key} field={field} draft={editDraft} setField={setEditField} />
              ))}
              {editCategoryDef.key === "gameplay" && (
                <div className="form-field">
                  <label className="form-label">Custom league rules</label>
                  <p className="form-hint">Add categories and individual rules. These appear in the read-only League Rules view and the REC Guide.</p>
                  {editCustomRules.map((rule, index) => (
                    <div key={rule.id} style={{ border: "1px solid var(--card-border)", borderRadius: "var(--radius-md)", padding: "var(--space-2)", marginBottom: "var(--space-2)", background: "rgba(255,255,255,0.02)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)", flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, minWidth: 24 }}>{index + 1}.</span>
                        <input className="form-input" aria-label="Rule category" placeholder="Category" style={{ flex: 1, minWidth: 100 }} value={rule.category} onChange={(event) => setEditField("customRules", editCustomRules.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value, updatedAt: new Date().toISOString() } : item))} />
                        <input className="form-input" aria-label="Rule title" placeholder="Title" style={{ flex: 1, minWidth: 100 }} value={rule.title} onChange={(event) => setEditField("customRules", editCustomRules.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value, updatedAt: new Date().toISOString() } : item))} />
                        <Button variant="danger" size="compact" onClick={() => setEditField("customRules", editCustomRules.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button>
                      </div>
                      <textarea className="form-input" aria-label="Rule text" rows={2} value={rule.text} onChange={(event) => setEditField("customRules", editCustomRules.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value, updatedAt: new Date().toISOString() } : item))} />
                    </div>
                  ))}
                  <div style={{ border: "1px dashed var(--card-border)", borderRadius: "var(--radius-md)", padding: "var(--space-2)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                      <input className="form-input" placeholder="Category" value={newRuleCategory} onChange={(event) => setNewRuleCategory(event.target.value)} />
                      <input className="form-input" placeholder="Rule title" value={newRuleTitle} onChange={(event) => setNewRuleTitle(event.target.value)} />
                    </div>
                    <textarea className="form-input" rows={2} placeholder="Rule details" value={newRuleText} onChange={(event) => setNewRuleText(event.target.value)} />
                    <div style={{ marginTop: "var(--space-2)" }}>
                      <Button variant="secondary" size="compact" disabled={!newRuleCategory.trim() || !newRuleTitle.trim() || !newRuleText.trim()} onClick={() => {
                        const now = new Date().toISOString();
                        setEditField("customRules", [...editCustomRules, { id: crypto.randomUUID(), category: newRuleCategory.trim(), title: newRuleTitle.trim(), text: newRuleText.trim(), sortOrder: editCustomRules.length, createdAt: now, updatedAt: now }]);
                        setNewRuleCategory(""); setNewRuleTitle(""); setNewRuleText("");
                      }}>Add rule</Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          {editCategoryDef.key !== "rise" && (
            <div style={{ marginTop: "var(--space-3)" }}>
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function FieldEditor({ field, draft, setField }: { field: (typeof SETTINGS_CATEGORIES)[number]["fields"][number]; draft: LeagueSettingsDraft; setField: (key: string, value: unknown) => void }) {
  if (field.dependsOn && !field.dependsOn(draft)) return null;
  return (
    <div className="form-field">
      {field.type === "toggle" ? (
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <input type="checkbox" checked={Boolean(draft[field.key])} onChange={(e) => setField(field.key, e.target.checked)} />
          {field.label}
        </label>
      ) : (
        <>
          <label className="form-label" htmlFor={field.key}>{field.label}</label>
          {field.type === "enum" && (
            <select id={field.key} className="form-select" value={String(draft[field.key] ?? "")} onChange={(e) => setField(field.key, e.target.value)}>
              {field.options?.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          )}
          {field.type === "number" && (
            <input id={field.key} className="form-input" type="number" min={field.min} max={field.max}
              value={draft[field.key] == null ? "" : String(draft[field.key])}
              onChange={(e) => setField(field.key, e.target.value === "" ? null : Number(e.target.value))} />
          )}
          {field.type === "text" && (
            <input id={field.key} className="form-input" value={String(draft[field.key] ?? "")} onChange={(e) => setField(field.key, e.target.value)} />
          )}
          {field.type === "textarea" && (
            <textarea id={field.key} className="form-input" rows={3} value={String(draft[field.key] ?? "")} onChange={(e) => setField(field.key, e.target.value)} />
          )}
          {field.type === "multiselect" && (() => {
            const selected = Array.isArray(draft[field.key]) ? draft[field.key] as string[] : [];
            return (
              <div className="settings-multiselect">
                {field.options?.map((opt) => {
                  const checked = selected.includes(opt.value);
                  return (
                    <label key={opt.value} className="settings-multiselect-option">
                      <input type="checkbox" checked={checked} onChange={() => setField(field.key, checked ? selected.filter((v) => v !== opt.value) : [...selected, opt.value])} />
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
}
