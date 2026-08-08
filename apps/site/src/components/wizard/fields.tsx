import { useMemo, useState } from "react";
import { MADDEN_ATTRIBUTE_BY_CODE, MADDEN_ATTRIBUTE_DROPDOWN_GROUPS, REC_ATTRIBUTE_POINT_PRICE } from "@rec/shared";

// Generic, reusable form-field building blocks shared by CreateLeagueWizard's steps. Kept
// stateless/presentational (no wizard-specific state) so they can't accidentally develop a
// dependency on the wizard's own step logic.

export function Tooltip({ text }: { text: string }) {
  return (
    <span className="wizard-tooltip" tabIndex={0} role="tooltip" aria-label={text}>
      <span className="wizard-tooltip-icon" aria-hidden="true">?</span>
      <span className="wizard-tooltip-bubble">{text}</span>
    </span>
  );
}

export function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <label className="site-field-label">
      {label}
      {hint && <Tooltip text={hint} />}
    </label>
  );
}

export function SelectField({ label, hint, value, onChange, options }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="site-field">
      <FieldLabel label={label} hint={hint} />
      <select className="site-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function ToggleField({ label, hint, checked, onChange, disabled, desc }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; desc?: string;
}) {
  return (
    <div className="site-field">
      <label className="site-field site-field-checkbox">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
        <span>{label}</span>
        {hint && <Tooltip text={hint} />}
      </label>
      {desc && <p className="wizard-field-desc">{desc}</p>}
    </div>
  );
}

// Counter (stepper) input for caps: a toggle pair plus a read-only value, so commissioners can
// bump a cap up/down without fighting a native number input that refuses to clear its default 0.
// 0 always means "no limit" for purchase caps and is labelled as such via unlimitedLabel.
export function CounterField({ label, hint, desc, value, onChange, min = 0, max = 99, disabled, unlimitedLabel = false }: {
  label: string; hint?: string; desc?: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; disabled?: boolean; unlimitedLabel?: boolean;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <label className="site-field">
      <FieldLabel label={label} hint={hint} />
      <div className="wizard-counter">
        <button type="button" className="wizard-counter-btn" aria-label={`Decrease ${label}`}
          disabled={disabled || value <= min} onClick={() => onChange(clamp(value - 1))}>−</button>
        <span className={`wizard-counter-value ${value === 0 && unlimitedLabel ? "wizard-counter-value-zero" : ""}`}>
          {value === 0 && unlimitedLabel ? "0 · Unlimited" : String(value)}
        </span>
        <button type="button" className="wizard-counter-btn" aria-label={`Increase ${label}`}
          disabled={disabled || value >= max} onClick={() => onChange(clamp(value + 1))}>+</button>
      </div>
      {desc && <p className="wizard-field-desc">{desc}</p>}
    </label>
  );
}

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

  const toggle = (code: string) => {
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  };

  return (
    <div className="site-field wizard-multiselect">
      <FieldLabel label="Core attributes" hint="The attributes users can spend points on at the premium Core rate. Every attribute not selected here is treated as Non-Core." />
      <button type="button" className="wizard-multiselect-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{value.length === 0 ? "No core attributes selected" : `${value.length} core attribute${value.length === 1 ? "" : "s"} selected`}</span>
        <span className="wizard-multiselect-caret" aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="wizard-multiselect-panel">
          <input className="site-input" placeholder="Search attributes…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="wizard-multiselect-scroll">
            {groups.map((group) => (
              <div key={group.label} className="wizard-multiselect-group">
                <strong className="wizard-multiselect-group-label">{group.label}</strong>
                {group.codes.length === 0 ? (
                  <p className="site-muted wizard-multiselect-empty">No matches.</p>
                ) : (
                  group.codes.map((code) => {
                    const def = MADDEN_ATTRIBUTE_BY_CODE.get(code);
                    const checked = value.includes(code);
                    return (
                      <label key={code} className="wizard-multiselect-option">
                        <input type="checkbox" checked={checked} onChange={() => toggle(code)} />
                        <span><strong>{code}</strong>{def ? ` — ${def.name}` : ""}</span>
                      </label>
                    );
                  })
                )}
              </div>
            ))}
          </div>
          <div className="wizard-multiselect-footer">
            <span className="site-muted">Core points cost {REC_ATTRIBUTE_POINT_PRICE.core} coins each; Non-Core cost {REC_ATTRIBUTE_POINT_PRICE.non_core} coins each.</span>
            {value.length > 0 && (
              <button type="button" className="site-btn site-btn-ghost site-btn-sm" onClick={() => onChange([])}>Clear all</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function NumberField({ label, hint, value, onChange, min, max, disabled }: {
  label: string; hint?: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; disabled?: boolean;
}) {
  return (
    <label className="site-field">
      <FieldLabel label={label} hint={hint} />
      <input className="site-input" type="number" value={value} min={min} max={max} disabled={disabled}
        onChange={(e) => onChange(Math.max(min ?? 0, Math.min(max ?? 999, Number(e.target.value))))} />
    </label>
  );
}

export function TextField({ label, hint, value, onChange, placeholder, disabled, maxLength }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean; maxLength?: number;
}) {
  return (
    <label className="site-field">
      <FieldLabel label={label} hint={hint} />
      <input className="site-input" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled} maxLength={maxLength} />
    </label>
  );
}

export function TextareaField({ label, hint, value, onChange, placeholder, disabled }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean;
}) {
  return (
    <label className="site-field">
      <FieldLabel label={label} hint={hint} />
      <textarea className="site-input" rows={3} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled} />
    </label>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="wizard-section">
      <h3 className="wizard-section-title">{title}</h3>
      {children}
    </div>
  );
}
