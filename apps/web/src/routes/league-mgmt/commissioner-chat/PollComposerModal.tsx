import { useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

const DURATION_OPTIONS = [
  { value: "1", label: "1 hour" },
  { value: "6", label: "6 hours" },
  { value: "24", label: "1 day" },
  { value: "72", label: "3 days" },
  { value: "168", label: "1 week" },
  { value: "none", label: "No time limit" },
];

// Discord-poll-style composer: question, 2-10 options, and a time limit — createChatTopic
// already accepted closesAt server-side, it just never had a UI to set it.
export function PollComposerModal({ guildId, onClose, onCreated }: { guildId: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [durationHours, setDurationHours] = useState("24");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSubmit = title.trim().length > 0 && trimmedOptions.length >= 2;

  async function handleCreate() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const closesAt = durationHours === "none" ? null : new Date(Date.now() + Number(durationHours) * 60 * 60 * 1000).toISOString();
      await recApi.createChatTopic({ guildId, title: title.trim(), description: description.trim() || null, options: trimmedOptions, closesAt });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the poll.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New Poll" onClose={onClose}>
      {error && <ErrorState message={error} />}
      <div className="form-field">
        <label className="form-label" htmlFor="poll-title">Question</label>
        <input id="poll-title" className="form-input" value={title} disabled={saving} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="form-field">
        <label className="form-label" htmlFor="poll-desc">Description (optional)</label>
        <textarea id="poll-desc" className="form-input" rows={2} value={description} disabled={saving} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="form-field">
        <label className="form-label">Options</label>
        {options.map((opt, i) => (
          <input
            key={i}
            className="form-input"
            style={{ marginBottom: "var(--space-2)" }}
            placeholder={`Option ${i + 1}`}
            value={opt}
            disabled={saving}
            onChange={(e) => setOptions((prev) => prev.map((o, idx) => (idx === i ? e.target.value : o)))}
          />
        ))}
        <Button variant="secondary" onClick={() => setOptions((prev) => [...prev, ""])} disabled={saving || options.length >= 10}>
          Add Option
        </Button>
      </div>
      <div className="form-field">
        <label className="form-label" htmlFor="poll-duration">Time Limit</label>
        <select id="poll-duration" className="form-select" value={durationHours} disabled={saving} onChange={(e) => setDurationHours(e.target.value)}>
          {DURATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <Button variant="primary" onClick={handleCreate} disabled={!canSubmit || saving}>
        {saving ? "Creating…" : "Create Poll"}
      </Button>
    </Modal>
  );
}
