import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { recApi } from "../../lib/rec-api-client.js";
import type { Recruit, RecruitStatus, ScheduleTeam } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { Badge, type BadgeStatus } from "../ui/Badge.js";
import { ErrorState } from "../ui/ErrorState.js";

const STATUS_OPTIONS: Array<{ value: RecruitStatus; label: string }> = [
  { value: "undecided", label: "Undecided" },
  { value: "visit_scheduled", label: "Visit Scheduled" },
  { value: "recruiting_battle", label: "Recruiting Battle" },
  { value: "verbal_commit", label: "Verbal Commit" },
  { value: "hard_commit", label: "Hard Commit" },
  { value: "signed", label: "Signed" },
  { value: "committed_elsewhere", label: "Committed to Another U" },
];
const STATUS_BADGE: Record<RecruitStatus, BadgeStatus> = {
  undecided: "pending",
  visit_scheduled: "pending",
  recruiting_battle: "info",
  verbal_commit: "info",
  hard_commit: "approved",
  signed: "approved",
  committed_elsewhere: "denied",
};
// These stages mean "committed to a REC team in this league" — pick which one.
const IN_LEAGUE_COMMIT_STATUSES = new Set<RecruitStatus>(["verbal_commit", "hard_commit", "signed"]);

function formatHeight(inches: number | null): string | null {
  if (inches == null) return null;
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

// Two views: "Available Recruits" is the full league-wide pool (a prospect isn't owned by one
// team until committed, so everyone sees and can log activity on it). "My Board" is a per-team
// saved watch-list — pre-commit prospects a coach has flagged to track, viewable for any team
// via the dropdown but only editable for your own.
export function RecruitingBoardModal({ guildId, viewerUserId, canManageLeague, onClose }: { guildId: string; viewerUserId: string | null; canManageLeague: boolean; onClose: () => void }) {
  const [view, setView] = useState<"pool" | "board">("board");
  const [recruits, setRecruits] = useState<Recruit[] | null>(null);
  const [board, setBoard] = useState<Recruit[] | null>(null);
  const [boardIds, setBoardIds] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<ScheduleTeam[] | null>(null);
  const [recruitingTeams, setRecruitingTeams] = useState<Array<{ id: string; name: string; abbreviation: string }>>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ playerName: "", position: "", homeCity: "", homeState: "", starRating: 3, heightInches: "", weightLbs: "" });
  const [busy, setBusy] = useState(false);
  const [teamPickerId, setTeamPickerId] = useState<string | null>(null);
  const [pickedStatus, setPickedStatus] = useState<RecruitStatus>("verbal_commit");
  const [pickedTeamId, setPickedTeamId] = useState("");
  const [positionFilter, setPositionFilter] = useState<string>("ALL");

  function loadPool() {
    recApi.listRecruits(guildId).then((res) => setRecruits(res.recruits)).catch((err) => setError(err instanceof Error ? err.message : "Failed to load the recruiting board."));
  }
  function loadBoard(teamId?: string) {
    recApi.listRecruitingBoard({ guildId, teamId: teamId || undefined }).then((res) => {
      setBoard(res.recruits);
      setBoardIds(new Set(res.recruits.map((r) => r.id)));
    }).catch((err) => setError(err instanceof Error ? err.message : "Failed to load your board."));
  }
  useEffect(() => {
    loadPool();
    loadBoard();
    recApi.listScheduleTeams(guildId).then((res) => setTeams(res.teams)).catch(() => setTeams([]));
    recApi.listRecruitingTeams(guildId).then(setRecruitingTeams).catch(() => setRecruitingTeams([]));
  }, [guildId]);

  useEffect(() => {
    if (view === "board") loadBoard(selectedTeamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeamId, view]);

  const teamName = (id: string | null) => teams?.find((team) => team.id === id)?.name ?? null;
  const viewingOtherTeam = selectedTeamId && recruitingTeams.length ? true : false;

  async function addRecruit() {
    if (!draft.playerName.trim() || !draft.position.trim()) {
      setError("Name and position are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recApi.createRecruit({
        guildId, ...draft, homeCity: draft.homeCity || null, homeState: draft.homeState || null,
        heightInches: draft.heightInches ? Number(draft.heightInches) : null, weightLbs: draft.weightLbs ? Number(draft.weightLbs) : null,
      });
      setAdding(false);
      setDraft({ playerName: "", position: "", homeCity: "", homeState: "", starRating: 3, heightInches: "", weightLbs: "" });
      loadPool();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add the recruit.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: RecruitStatus) {
    if (IN_LEAGUE_COMMIT_STATUSES.has(status)) {
      setTeamPickerId(id);
      setPickedStatus(status);
      setPickedTeamId("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recApi.updateRecruitStatus({ guildId, id, status });
      loadPool();
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
      await recApi.updateRecruitStatus({ guildId, id, status: pickedStatus, committedTeamId: pickedTeamId || null });
      setTeamPickerId(null);
      loadPool();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleBoard(recruitId: string, onBoard: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (onBoard) await recApi.removeRecruitFromBoard({ guildId, recruitId });
      else await recApi.addRecruitToBoard({ guildId, recruitId });
      loadBoard(selectedTeamId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update your board.");
    } finally {
      setBusy(false);
    }
  }

  function recruitMeta(recruit: Recruit): string {
    const parts = [recruit.position, `${recruit.starRating}★`];
    const height = formatHeight(recruit.heightInches);
    if (height && recruit.weightLbs) parts.push(`${height}, ${recruit.weightLbs} lbs`);
    else if (height) parts.push(height);
    else if (recruit.weightLbs) parts.push(`${recruit.weightLbs} lbs`);
    if (recruit.homeCity) parts.push(`${recruit.homeCity}, ${recruit.homeState}`);
    if (recruit.committedTeamId) parts.push(teamName(recruit.committedTeamId) ?? "committed");
    else if (recruit.committedTeamExternal) parts.push(recruit.committedTeamExternal);
    return parts.join(" · ");
  }

  const listToShow = view === "board" ? board : recruits;

  const poolPositions = useMemo(() => {
    if (!recruits) return [];
    const seen = new Set<string>();
    return recruits.map((r) => r.position).filter((p) => { if (seen.has(p)) return false; seen.add(p); return true; }).sort();
  }, [recruits]);

  const filteredPool = useMemo(() => {
    if (!recruits) return null;
    if (positionFilter === "ALL") return recruits;
    return recruits.filter((r) => r.position === positionFilter);
  }, [recruits, positionFilter]);

  const displayList = view === "board" ? board : filteredPool;

  return (
    <Modal title="Recruiting Board" onClose={onClose}>
      <div className="recruiting-board">
      {error && <ErrorState message={error} />}

      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
        <div className="segmented">
          <Button variant={view === "board" ? "primary" : "secondary"} size="compact" onClick={() => setView("board")}>My Board</Button>
          <Button variant={view === "pool" ? "primary" : "secondary"} size="compact" onClick={() => setView("pool")}>Available Recruits</Button>
        </div>
        {view === "board" && recruitingTeams.length > 0 && (
          <select className="form-select" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)} style={{ maxWidth: 220 }}>
            <option value="">My team</option>
            {recruitingTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        )}
      </div>

      {view === "pool" && !adding && (
        <Button variant="secondary" onClick={() => setAdding(true)} style={{ marginBottom: "var(--space-3)" }}>
          <Plus size={16} /> Add Prospect
        </Button>
      )}
      {view === "pool" && adding && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-3)", padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
          <label className="form-field" style={{ margin: 0 }}><span className="form-label">Name</span><input className="form-input" value={draft.playerName} onChange={(e) => setDraft({ ...draft, playerName: e.target.value })} /></label>
          <label className="form-field" style={{ margin: 0 }}><span className="form-label">Position</span><input className="form-input" value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} /></label>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <label className="form-field" style={{ margin: 0, flex: 1 }}><span className="form-label">City</span><input className="form-input" value={draft.homeCity} onChange={(e) => setDraft({ ...draft, homeCity: e.target.value })} /></label>
            <label className="form-field" style={{ margin: 0, flex: 1 }}><span className="form-label">State</span><input className="form-input" value={draft.homeState} onChange={(e) => setDraft({ ...draft, homeState: e.target.value })} /></label>
            <label className="form-field" style={{ margin: 0 }}><span className="form-label">Stars</span><select className="form-select" value={draft.starRating} onChange={(e) => setDraft({ ...draft, starRating: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <label className="form-field" style={{ margin: 0, flex: 1 }}><span className="form-label">Height (in)</span><input className="form-input" type="number" min={60} max={84} value={draft.heightInches} onChange={(e) => setDraft({ ...draft, heightInches: e.target.value })} /></label>
            <label className="form-field" style={{ margin: 0, flex: 1 }}><span className="form-label">Weight (lbs)</span><input className="form-input" type="number" min={140} max={400} value={draft.weightLbs} onChange={(e) => setDraft({ ...draft, weightLbs: e.target.value })} /></label>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="primary" disabled={busy} onClick={() => void addRecruit()}>{busy ? "Adding…" : "Add"}</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {view === "pool" && poolPositions.length > 1 && (
        <div style={{ marginBottom: "var(--space-3)" }}>
          <label className="form-field" style={{ margin: 0, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <span className="form-label" style={{ whiteSpace: "nowrap" }}>Position</span>
            <select className="form-select" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} style={{ maxWidth: 180 }}>
              <option value="ALL">All positions</option>
              {poolPositions.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
            </select>
          </label>
        </div>
      )}

      {!displayList ? (
        <p className="hub-empty">Loading…</p>
      ) : displayList.length === 0 ? (
        <p className="hub-empty">{view === "board" ? "Nothing on this board yet — add prospects from Available Recruits." : positionFilter !== "ALL" ? `No ${positionFilter} prospects found.` : "No prospects tracked yet."}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {displayList.map((recruit) => {
            const isOwner = viewerUserId != null && recruit.submittedByUserId === viewerUserId;
            const canEditStatus = isOwner || canManageLeague;
            return (
            <div key={recruit.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
              <div style={{ minWidth: 0 }}>
                <strong>{recruit.playerName}</strong>{" "}
                <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{recruitMeta(recruit)}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
                <Badge status={STATUS_BADGE[recruit.status]}>{STATUS_OPTIONS.find((o) => o.value === recruit.status)?.label ?? recruit.status}</Badge>
                {view === "pool" && (teamPickerId === recruit.id ? (
                  <>
                    <select className="form-select" value={pickedTeamId} onChange={(e) => setPickedTeamId(e.target.value)}>
                      <option value="">Select a team…</option>
                      {(teams ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                    </select>
                    <Button variant="primary" size="compact" disabled={busy} onClick={() => void confirmCommit(recruit.id)}>Save</Button>
                    <Button variant="ghost" size="compact" onClick={() => setTeamPickerId(null)}>Cancel</Button>
                  </>
                ) : canEditStatus ? (
                  <select
                    className="form-select"
                    value={recruit.status}
                    disabled={busy}
                    onChange={(e) => void setStatus(recruit.id, e.target.value as RecruitStatus)}
                  >
                    {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : null)}
                {view === "pool" && (
                  <Button variant="secondary" size="compact" disabled={busy} onClick={() => void toggleBoard(recruit.id, boardIds.has(recruit.id))}>
                    {boardIds.has(recruit.id) ? "On Board" : "Add to Board"}
                  </Button>
                )}
                {view === "board" && !viewingOtherTeam && (
                  <Button variant="ghost" size="compact" disabled={busy} onClick={() => void toggleBoard(recruit.id, true)}>Remove</Button>
                )}
              </div>
            </div>
          );
          })}
        </div>
      )}
      </div>
    </Modal>
  );
}
