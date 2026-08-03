import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { recApi } from "../../lib/rec-api-client.js";
import type { Recruit, RecruitStatus, ScheduleTeam } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { Badge, type BadgeStatus } from "../ui/Badge.js";
import { ErrorState } from "../ui/ErrorState.js";

const STATUS_OPTIONS: Array<{ value: RecruitStatus; label: string }> = [
  { value: "uncommitted", label: "Uncommitted" },
  { value: "committed", label: "Committed" },
  { value: "flipped", label: "Flipped" },
  { value: "decommitted", label: "Decommitted" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "signed", label: "Signed" },
];
const STATUS_BADGE: Record<RecruitStatus, BadgeStatus> = {
  uncommitted: "pending",
  committed: "approved",
  flipped: "info",
  decommitted: "denied",
  withdrawn: "denied",
  signed: "approved",
};

// A coach-facing view of the same league-wide recruiting board RecruitingHome (League Mgmt)
// manages — recruiting is shared across every team (a prospect isn't owned by one team until
// committed), so any coach can see it and log/update their own team's activity here.
export function RecruitingBoardModal({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const [recruits, setRecruits] = useState<Recruit[] | null>(null);
  const [teams, setTeams] = useState<ScheduleTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ playerName: "", position: "", homeCity: "", homeState: "", starRating: 3 });
  const [busy, setBusy] = useState(false);
  const [teamPickerId, setTeamPickerId] = useState<string | null>(null);
  const [pickedTeamId, setPickedTeamId] = useState("");

  function load() {
    recApi.listRecruits(guildId).then((res) => setRecruits(res.recruits)).catch((err) => setError(err instanceof Error ? err.message : "Failed to load the recruiting board."));
  }
  useEffect(() => {
    load();
    recApi.listScheduleTeams(guildId).then((res) => setTeams(res.teams)).catch(() => setTeams([]));
  }, [guildId]);

  const teamName = (id: string | null) => teams?.find((team) => team.id === id)?.name ?? null;

  async function addRecruit() {
    if (!draft.playerName.trim() || !draft.position.trim()) {
      setError("Name and position are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recApi.createRecruit({ guildId, ...draft, homeCity: draft.homeCity || null, homeState: draft.homeState || null });
      setAdding(false);
      setDraft({ playerName: "", position: "", homeCity: "", homeState: "", starRating: 3 });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add the recruit.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: RecruitStatus) {
    if (status === "committed") {
      setTeamPickerId(id);
      setPickedTeamId("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recApi.updateRecruitStatus({ guildId, id, status });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCommit(id: string) {
    setBusy(true);
    setError(null);
    try {
      await recApi.updateRecruitStatus({ guildId, id, status: "committed", committedTeamId: pickedTeamId || null });
      setTeamPickerId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Recruiting Board" onClose={onClose}>
      {error && <ErrorState message={error} />}
      {!adding && (
        <Button variant="secondary" onClick={() => setAdding(true)} style={{ marginBottom: "var(--space-3)" }}>
          <Plus size={16} /> Add Prospect
        </Button>
      )}
      {adding && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-3)", padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
          <label className="form-field" style={{ margin: 0 }}><span className="form-label">Name</span><input className="form-input" value={draft.playerName} onChange={(e) => setDraft({ ...draft, playerName: e.target.value })} /></label>
          <label className="form-field" style={{ margin: 0 }}><span className="form-label">Position</span><input className="form-input" value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} /></label>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <label className="form-field" style={{ margin: 0, flex: 1 }}><span className="form-label">City</span><input className="form-input" value={draft.homeCity} onChange={(e) => setDraft({ ...draft, homeCity: e.target.value })} /></label>
            <label className="form-field" style={{ margin: 0, flex: 1 }}><span className="form-label">State</span><input className="form-input" value={draft.homeState} onChange={(e) => setDraft({ ...draft, homeState: e.target.value })} /></label>
            <label className="form-field" style={{ margin: 0 }}><span className="form-label">Stars</span><select className="form-select" value={draft.starRating} onChange={(e) => setDraft({ ...draft, starRating: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="primary" disabled={busy} onClick={() => void addRecruit()}>{busy ? "Adding…" : "Add"}</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {!recruits ? (
        <p className="hub-empty">Loading…</p>
      ) : recruits.length === 0 ? (
        <p className="hub-empty">No prospects tracked yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {recruits.map((recruit) => (
            <div key={recruit.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
              <div style={{ minWidth: 0 }}>
                <strong>{recruit.playerName}</strong>{" "}
                <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  {recruit.position} · {"★".repeat(recruit.starRating)}
                  {recruit.homeCity ? ` · ${recruit.homeCity}, ${recruit.homeState}` : ""}
                  {recruit.committedTeamId ? ` · ${teamName(recruit.committedTeamId) ?? "committed"}` : recruit.committedTeamExternal ? ` · ${recruit.committedTeamExternal}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
                <Badge status={STATUS_BADGE[recruit.status]}>{STATUS_OPTIONS.find((o) => o.value === recruit.status)?.label ?? recruit.status}</Badge>
                {teamPickerId === recruit.id ? (
                  <>
                    <select className="form-select" value={pickedTeamId} onChange={(e) => setPickedTeamId(e.target.value)}>
                      <option value="">Outside program</option>
                      {(teams ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                    </select>
                    <Button variant="primary" size="compact" disabled={busy} onClick={() => void confirmCommit(recruit.id)}>Save</Button>
                    <Button variant="ghost" size="compact" onClick={() => setTeamPickerId(null)}>Cancel</Button>
                  </>
                ) : (
                  <select
                    className="form-select"
                    value={recruit.status}
                    disabled={busy}
                    onChange={(e) => void setStatus(recruit.id, e.target.value as RecruitStatus)}
                  >
                    {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
