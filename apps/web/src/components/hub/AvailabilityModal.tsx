import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

const WEEKDAYS = [
  { weekday: 1, label: "Monday" }, { weekday: 2, label: "Tuesday" }, { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" }, { weekday: 5, label: "Friday" }, { weekday: 6, label: "Saturday" },
  { weekday: 0, label: "Sunday" },
];

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTE_OPTIONS = ["00", "15", "30", "45"];

type Window = { startMinute: number; endMinute: number };
type Draft = { hour: number; minute: string; meridiem: "AM" | "PM" };

function toMinute(draft: Draft): number {
  const hour24 = draft.meridiem === "AM" ? (draft.hour === 12 ? 0 : draft.hour) : (draft.hour === 12 ? 12 : draft.hour + 12);
  return hour24 * 60 + Number(draft.minute);
}

function formatWindow(w: Window): string {
  const fmt = (total: number) => {
    const hour24 = Math.floor(total / 60) % 24;
    const minute = total % 60;
    const meridiem = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return minute === 0 ? `${hour12}${meridiem}` : `${hour12}:${String(minute).padStart(2, "0")}${meridiem}`;
  };
  return `${fmt(w.startMinute)}–${fmt(w.endMinute % 1440)}${w.endMinute >= 1440 ? " (+1d)" : ""}`;
}

export function AvailabilityModal({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [timezoneSource, setTimezoneSource] = useState<string>("unset");
  const [windowsByDay, setWindowsByDay] = useState<Record<number, Window[]>>({});
  const [activeDay, setActiveDay] = useState<number>(1);
  const [draft, setDraft] = useState<Draft>({ hour: 6, minute: "00", meridiem: "PM" });
  const [draftEnd, setDraftEnd] = useState<Draft>({ hour: 9, minute: "00", meridiem: "PM" });
  const [savingDay, setSavingDay] = useState(false);

  const detectedTimezone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
  }, []);

  useEffect(() => {
    recApi.getSchedulingAvailabilityProfile(guildId)
      .then((res) => {
        setTimezone(res.profile.timezone);
        setTimezoneSource(res.profile.timezone_source);
        const byDay: Record<number, Window[]> = {};
        for (const w of res.windows) byDay[w.weekday] = [...(byDay[w.weekday] ?? []), { startMinute: w.startMinute, endMinute: w.endMinute }];
        setWindowsByDay(byDay);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your availability."))
      .finally(() => setLoading(false));
  }, [guildId]);

  async function useDetectedTimezone() {
    if (!detectedTimezone) return;
    try {
      await recApi.setSchedulingTimezone({ guildId, timezone: detectedTimezone, source: "site_detected" });
      setTimezone(detectedTimezone);
      setTimezoneSource("site_detected");
      setNotice(`Timezone set to ${detectedTimezone}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save your timezone.");
    }
  }

  async function saveManualTimezone(tz: string) {
    try {
      await recApi.setSchedulingTimezone({ guildId, timezone: tz, source: "site_manual" });
      setTimezone(tz);
      setTimezoneSource("site_manual");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save your timezone.");
    }
  }

  async function addWindow() {
    const start = toMinute(draft);
    let end = toMinute(draftEnd);
    if (end <= start) end += 1440;
    if (end - start < 30) { setError("A window needs to be at least 30 minutes."); return; }
    const next = [...(windowsByDay[activeDay] ?? []), { startMinute: start, endMinute: end }];
    await saveDay(next);
  }

  async function removeWindow(index: number) {
    const next = (windowsByDay[activeDay] ?? []).filter((_, i) => i !== index);
    await saveDay(next);
  }

  async function saveDay(windows: Window[]) {
    setSavingDay(true);
    setError(null);
    try {
      const res = await recApi.setSchedulingWindows({ guildId, leagueScoped: false, weekday: activeDay, windows });
      setWindowsByDay((prev) => ({ ...prev, [activeDay]: res.windows.map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute })) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save availability.");
    } finally {
      setSavingDay(false);
    }
  }

  return (
    <Modal title="Availability" onClose={onClose}>
      {error && <ErrorState message={error} />}
      {notice && <p className="site-auth-success">{notice}</p>}
      {loading ? <p className="hub-empty">Loading…</p> : (
        <>
          <div className="form-field">
            <label className="form-label">Timezone</label>
            {timezone ? (
              <p className="form-hint">Currently set to <strong>{timezone}</strong>.</p>
            ) : detectedTimezone ? (
              <p className="form-hint">We detected <strong>{detectedTimezone}</strong>.</p>
            ) : (
              <p className="form-hint">We couldn't detect your timezone automatically.</p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {detectedTimezone && detectedTimezone !== timezone && (
                <Button variant="ghost" size="compact" onClick={() => void useDetectedTimezone()}>Use {detectedTimezone}</Button>
              )}
              <select className="form-select" value={timezone ?? ""} onChange={(e) => void saveManualTimezone(e.target.value)}>
                <option value="">Choose manually…</option>
                <option value="America/New_York">Eastern</option>
                <option value="America/Chicago">Central</option>
                <option value="America/Denver">Mountain</option>
                <option value="America/Los_Angeles">Pacific</option>
                <option value="America/Anchorage">Alaska</option>
                <option value="Pacific/Honolulu">Hawaii</option>
              </select>
            </div>
            {timezoneSource === "unset" && <p className="form-hint" style={{ color: "var(--warning, #d9a521)" }}>Set a timezone so your availability lines up correctly for opponents.</p>}
          </div>

          <div className="form-field">
            <label className="form-label">Weekly availability</label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "4px 0 12px" }}>
              {WEEKDAYS.map((d) => (
                <button
                  key={d.weekday}
                  type="button"
                  className="site-btn site-btn-ghost"
                  style={activeDay === d.weekday ? { borderColor: "var(--accent, var(--gold))", color: "var(--accent, var(--gold))" } : undefined}
                  onClick={() => setActiveDay(d.weekday)}
                >
                  {d.label.slice(0, 3)}
                </button>
              ))}
            </div>

            <p className="form-hint">{WEEKDAYS.find((d) => d.weekday === activeDay)?.label}</p>
            {(windowsByDay[activeDay] ?? []).length === 0 && <p className="hub-empty">No windows set — unavailable by default.</p>}
            <ul className="site-public-league-list">
              {(windowsByDay[activeDay] ?? []).map((w, i) => (
                <li key={i}><span>{formatWindow(w)}</span><Button variant="ghost" size="compact" disabled={savingDay} onClick={() => void removeWindow(i)}>Remove</Button></li>
              ))}
            </ul>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <TimeSelect value={draft} onChange={setDraft} />
              <span>to</span>
              <TimeSelect value={draftEnd} onChange={setDraftEnd} />
              <Button variant="primary" size="compact" disabled={savingDay} onClick={() => void addWindow()}>Add Window</Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function TimeSelect({ value, onChange }: { value: Draft; onChange: (d: Draft) => void }) {
  return (
    <span style={{ display: "flex", gap: 4 }}>
      <select className="form-select" value={value.hour} onChange={(e) => onChange({ ...value, hour: Number(e.target.value) })}>
        {HOUR_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select className="form-select" value={value.minute} onChange={(e) => onChange({ ...value, minute: e.target.value })}>
        {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select className="form-select" value={value.meridiem} onChange={(e) => onChange({ ...value, meridiem: e.target.value as "AM" | "PM" })}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </span>
  );
}
