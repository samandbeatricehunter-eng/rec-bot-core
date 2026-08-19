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
type Override = { id: string; scope: string; startsAt: string; endsAt: string; unavailable: boolean; timezoneOverride: string | null; gameId: string | null };

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

function nextSevenDays(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    out.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) });
  }
  return out;
}

export function AvailabilityModal({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"weekly" | "thisWeek">("weekly");
  const [timezone, setTimezone] = useState<string | null>(null);
  const [timezoneSource, setTimezoneSource] = useState<string>("unset");
  const [windowsByDay, setWindowsByDay] = useState<Record<number, Window[]>>({});
  const [activeDay, setActiveDay] = useState<number>(1);
  const [draft, setDraft] = useState<Draft>({ hour: 6, minute: "00", meridiem: "PM" });
  const [draftEnd, setDraftEnd] = useState<Draft>({ hour: 9, minute: "00", meridiem: "PM" });
  const [savingDay, setSavingDay] = useState(false);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [thisWeekDate, setThisWeekDate] = useState<string>(nextSevenDays()[0]!.value);
  const [thisWeekDraft, setThisWeekDraft] = useState<Draft>({ hour: 6, minute: "00", meridiem: "PM" });
  const [thisWeekDraftEnd, setThisWeekDraftEnd] = useState<Draft>({ hour: 9, minute: "00", meridiem: "PM" });
  const [savingOverride, setSavingOverride] = useState(false);

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
        setOverrides(res.overrides.filter((o) => o.scope === "week"));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your availability."))
      .finally(() => setLoading(false));
  }, [guildId]);

  async function addThisWeekWindow() {
    if (!timezone) { setError("Set a timezone first."); return; }
    const start = toMinute(thisWeekDraft);
    let end = toMinute(thisWeekDraftEnd);
    if (end <= start) end += 1440;
    if (end - start < 30) { setError("A window needs to be at least 30 minutes."); return; }
    setSavingOverride(true);
    setError(null);
    try {
      const result = await recApi.setSchedulingOverride({ guildId, scope: "week", localDate: thisWeekDate, timezone, startMinute: start, endMinute: end % 1440, unavailable: false });
      setOverrides((prev) => [...prev, result]);
      setNotice(`Exception saved for ${thisWeekDate}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save that exception.");
    } finally {
      setSavingOverride(false);
    }
  }

  async function markThisWeekUnavailable() {
    if (!timezone) { setError("Set a timezone first."); return; }
    setSavingOverride(true);
    setError(null);
    try {
      const result = await recApi.setSchedulingOverride({ guildId, scope: "week", localDate: thisWeekDate, timezone, unavailable: true });
      setOverrides((prev) => [...prev, result]);
      setNotice(`Marked unavailable all day on ${thisWeekDate}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save that exception.");
    } finally {
      setSavingOverride(false);
    }
  }

  async function removeOverride(overrideId: string) {
    setSavingOverride(true);
    setError(null);
    try {
      await recApi.deleteSchedulingOverride({ guildId, overrideId });
      setOverrides((prev) => prev.filter((o) => o.id !== overrideId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove that exception.");
    } finally {
      setSavingOverride(false);
    }
  }

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
    <Modal title="Availability" onClose={onClose} panelClassName="availability-modal">
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
            <div className="availability-tz-row">
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
            {timezoneSource === "unset" && <p className="form-hint availability-tz-warning">Set a timezone so your availability lines up correctly for opponents.</p>}
          </div>

          <div className="availability-tabs">
            <button type="button" className={`site-btn site-btn-ghost${tab === "weekly" ? " is-active" : ""}`} onClick={() => setTab("weekly")}>Set Availability</button>
            <button type="button" className={`site-btn site-btn-ghost${tab === "thisWeek" ? " is-active" : ""}`} onClick={() => setTab("thisWeek")}>This Week</button>
          </div>

          {tab === "weekly" && (
            <div className="form-field">
              <label className="form-label">Weekly availability</label>
              <div className="availability-weekday-grid">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.weekday}
                    type="button"
                    className={`site-btn site-btn-ghost${activeDay === d.weekday ? " is-active" : ""}`}
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

              <div className="availability-window-row">
                <div className="availability-time-range">
                  <TimeSelect value={draft} onChange={setDraft} />
                  <span className="availability-time-to">to</span>
                  <TimeSelect value={draftEnd} onChange={setDraftEnd} />
                </div>
                <Button variant="primary" size="compact" disabled={savingDay} onClick={() => void addWindow()}>Add Window</Button>
              </div>
            </div>
          )}

          {tab === "thisWeek" && (
            <div className="form-field">
              <label className="form-label">This week's exceptions</label>
              <p className="form-hint">One-off changes to your normal weekly availability for a specific day, e.g. unavailable this Saturday or an extra window Tuesday night.</p>

              {overrides.length === 0 && <p className="hub-empty">No exceptions set for this week.</p>}
              <ul className="site-public-league-list">
                {overrides.map((o) => (
                  <li key={o.id}>
                    <span>{new Date(o.startsAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} — {o.unavailable ? "Unavailable" : `${new Date(o.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}–${new Date(o.endsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}</span>
                    <Button variant="ghost" size="compact" disabled={savingOverride} onClick={() => void removeOverride(o.id)}>Remove</Button>
                  </li>
                ))}
              </ul>

              <div className="availability-window-row">
                <select className="form-select availability-date-select" value={thisWeekDate} onChange={(e) => setThisWeekDate(e.target.value)}>
                  {nextSevenDays().map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
                <Button variant="ghost" size="compact" disabled={savingOverride} onClick={() => void markThisWeekUnavailable()}>Mark Unavailable All Day</Button>
              </div>
              <div className="availability-window-row">
                <div className="availability-time-range">
                  <TimeSelect value={thisWeekDraft} onChange={setThisWeekDraft} />
                  <span className="availability-time-to">to</span>
                  <TimeSelect value={thisWeekDraftEnd} onChange={setThisWeekDraftEnd} />
                </div>
                <Button variant="primary" size="compact" disabled={savingOverride} onClick={() => void addThisWeekWindow()}>Add Exception Window</Button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function TimeSelect({ value, onChange }: { value: Draft; onChange: (d: Draft) => void }) {
  return (
    <span className="availability-time-select">
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
