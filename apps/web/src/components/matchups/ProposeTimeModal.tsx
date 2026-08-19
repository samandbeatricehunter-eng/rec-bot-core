import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTE_OPTIONS = ["00", "15", "30", "45"];

type TimeDraft = { hour: number; minute: string; meridiem: "AM" | "PM" };

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toLocalTimeString(draft: TimeDraft): string {
  return `${draft.hour}:${draft.minute} ${draft.meridiem}`;
}

function TimeSelect({ value, onChange }: { value: TimeDraft; onChange: (d: TimeDraft) => void }) {
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

// Shared by "Propose Time" (fresh offer) and "Counter" (from Review Offers) -- same date/time
// picker with the coach's timezone preloaded, differing only in which API call submit() makes.
export function ProposeTimeModal({
  guildId, gameId, proposalId, title, onClose, onDone,
}: {
  guildId: string; gameId: string;
  /** Present only when countering an existing offer instead of proposing a fresh one. */
  proposalId?: string;
  title: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [localDate, setLocalDate] = useState(todayLocalDate());
  const [draft, setDraft] = useState<TimeDraft>({ hour: 8, minute: "00", meridiem: "PM" });

  const detectedTimezone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
  }, []);

  useEffect(() => {
    recApi.getSchedulingAvailabilityProfile(guildId)
      .then((res) => setTimezone(res.profile.timezone ?? detectedTimezone))
      .catch(() => setTimezone(detectedTimezone))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  async function submit() {
    if (!timezone) { setError("Set your timezone before proposing a time."); return; }
    setSaving(true);
    setError(null);
    try {
      const localTime = toLocalTimeString(draft);
      if (proposalId) {
        await recApi.respondToSchedulingProposal({ guildId, gameId, proposalId, action: "counter", localDate, localTime, timezone });
        onDone("Countered.");
      } else {
        await recApi.proposeSchedulingTime({ guildId, gameId, localDate, localTime, timezone });
        onDone("Time proposed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {error && <ErrorState message={error} />}
      {loading ? <p className="hub-empty">Loading…</p> : (
        <>
          <div className="form-field">
            <label className="form-label">Timezone</label>
            {timezone ? (
              <p className="form-hint">Using <strong>{timezone}</strong>.</p>
            ) : (
              <p className="form-hint" style={{ color: "var(--warning, #d9a521)" }}>We couldn't detect your timezone — set it in Availability first.</p>
            )}
          </div>
          <div className="form-field">
            <label className="form-label">Date</label>
            <input className="form-input" type="date" value={localDate} onChange={(e) => setLocalDate(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Kickoff time</label>
            <TimeSelect value={draft} onChange={setDraft} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button variant="primary" size="compact" disabled={saving || !timezone} onClick={() => void submit()}>
              {proposalId ? "Send Counter" : "Propose Time"}
            </Button>
            <Button variant="ghost" size="compact" onClick={onClose}>Cancel</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
