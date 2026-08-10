import {
  LEAGUE_SLIDER_CATALOGS,
  LEAGUE_SLIDER_CATALOG_VERSION,
  communitySliderPresetsFor,
  defaultLeagueSliderValues,
  resolveLeagueSliderValues,
  type SliderGame,
} from "@rec/shared";
import { Card } from "../../../components/ui/Card.js";

const CATEGORY_LABELS: Record<string, string> = {
  gameplay: "Gameplay", special_teams: "Special Teams", penalties: "Penalties",
  wear_and_tear: "Wear & Tear", xp: "Player XP", regression: "Position Regression",
  age_regression: "Age Regression",
};

export function SliderSettingsPanel({ game, enabled, presetId, values, onChange }: {
  game: SliderGame;
  enabled: boolean;
  presetId: string;
  values: Record<string, number>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  if (!enabled) return null;
  const catalog = LEAGUE_SLIDER_CATALOGS[game];
  const presets = communitySliderPresetsFor(game);
  const resolved = { ...defaultLeagueSliderValues(game), ...values };
  const categories = [...new Set(catalog.map((slider) => slider.category))];
  const selected = presets.find((preset) => preset.id === presetId);

  function choosePreset(nextId: string) {
    onChange({
      sliderPresetId: nextId || null,
      sliderCatalogVersion: LEAGUE_SLIDER_CATALOG_VERSION[game],
      sliderSettings: resolveLeagueSliderValues(game, nextId || null),
    });
  }

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Custom Slider Configuration</h3>
      <p className="text-muted">Game defaults begin at 50. Community templates are starting points; every value remains editable.</p>
      <div className="form-field">
        <label className="form-label" htmlFor="slider-preset">Slider template</label>
        <select id="slider-preset" className="form-select" value={presetId} onChange={(event) => choosePreset(event.target.value)}>
          <option value="">Game defaults — all values 50</option>
          {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </select>
      </div>
      {selected && <p className="text-muted">Created by <strong>{selected.creator}</strong>. {selected.description}{" "}
        <a href={selected.sourceUrl} target="_blank" rel="noreferrer">Source/version {selected.sourceVersion}</a>. Community preset; not endorsed by EA or REC.</p>}
      {categories.map((category) => (
        <details key={category} style={{ border: "1px solid var(--border)", borderRadius: 8, marginTop: 8 }}>
          <summary style={{ cursor: "pointer", padding: 12, fontWeight: 800 }}>{CATEGORY_LABELS[category] ?? category}</summary>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, padding: "0 12px 12px" }}>
            {catalog.filter((slider) => slider.category === category).map((slider) => (
              <div className="form-field" key={slider.key}>
                <label className="form-label" htmlFor={`slider-${slider.key}`}>
                  {slider.side === "shared" ? slider.label : `${slider.side === "user" ? "User" : "CPU"} — ${slider.label}`}
                </label>
                <input id={`slider-${slider.key}`} className="form-input" type="number" min={slider.min} max={slider.max}
                  value={resolved[slider.key] ?? slider.defaultValue}
                  onChange={(event) => onChange({
                    sliderPresetId: null,
                    sliderCatalogVersion: LEAGUE_SLIDER_CATALOG_VERSION[game],
                    sliderSettings: { ...resolved, [slider.key]: Math.max(slider.min, Math.min(slider.max, Number(event.target.value) || 0)) },
                  })} />
              </div>
            ))}
          </div>
        </details>
      ))}
    </Card>
  );
}
