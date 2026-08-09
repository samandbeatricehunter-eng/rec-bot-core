import { useMemo, useState } from "react";
import { MADDEN_ATTRIBUTE_BY_CODE, MADDEN_ATTRIBUTE_DROPDOWN_GROUPS } from "@rec/shared";

// Same searchable, grouped multiselect as apps/site's league-creation wizard
// (CreateLeagueWizard -> CoreAttributePicker in apps/site/src/components/wizard/fields.tsx) —
// reimplemented here rather than shared cross-app so a commissioner editing Core attributes
// after creation sees the identical picker they used during setup instead of a raw
// comma-separated text field.
export function CoreAttributePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(MADDEN_ATTRIBUTE_DROPDOWN_GROUPS).map((group) => ({
      label: group.label,
      codes: group.codes.filter((code) => {
        if (!q) return true;
        const def = MADDEN_ATTRIBUTE_BY_CODE.get(code);
        return code.toLowerCase().includes(q) || (def?.name.toLowerCase().includes(q) ?? false);
      }),
    }));
  }, [query]);

  function toggle(code: string) {
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  }

  return (
    <div className="form-field core-attribute-picker">
      <label className="form-label" htmlFor="core-attributes-trigger">Core attributes</label>
      <p className="form-hint">The attributes users can spend points on at the premium Core rate. Every attribute not selected here is Non-Core.</p>
      <button id="core-attributes-trigger" type="button" className="core-attribute-picker-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{value.length === 0 ? "No core attributes selected" : `${value.length} core attribute${value.length === 1 ? "" : "s"} selected`}</span>
        <span aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {value.length > 0 && (
        <div className="core-attribute-picker-chips">
          {value.map((code) => (
            <span key={code} className="core-attribute-picker-chip">
              {code}
              <button type="button" aria-label={`Remove ${code}`} onClick={() => toggle(code)}>×</button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="core-attribute-picker-panel">
          <input className="form-input" placeholder="Search attributes…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="core-attribute-picker-scroll">
            {groups.map((group) => (
              <div key={group.label} className="core-attribute-picker-group">
                <strong>{group.label}</strong>
                {group.codes.length === 0 ? (
                  <p className="hub-muted">No matches.</p>
                ) : (
                  group.codes.map((code) => {
                    const def = MADDEN_ATTRIBUTE_BY_CODE.get(code);
                    const checked = value.includes(code);
                    return (
                      <label key={code} className="core-attribute-picker-option">
                        <input type="checkbox" checked={checked} onChange={() => toggle(code)} />
                        <span><strong>{code}</strong> {def?.name ?? code}</span>
                      </label>
                    );
                  })
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
