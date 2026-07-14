import { useEffect, useMemo, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { ClassYear, Recruit, RecruitStatus, ScheduleTeam, TransferEntry, TransferStatus } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Badge, type BadgeStatus } from "../../../components/ui/Badge.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";

const RECRUIT_STATUS_BADGE: Record<RecruitStatus, BadgeStatus> = { uncommitted: "pending", committed: "approved", decommitted: "denied" };
const TRANSFER_STATUS_BADGE: Record<TransferStatus, BadgeStatus> = { entered_portal: "pending", transferred: "approved", withdrawn: "denied" };
const CLASS_YEAR_OPTIONS: Array<{ value: ClassYear | ""; label: string }> = [
  { value: "", label: "No class" }, { value: "freshman", label: "Freshman" }, { value: "sophomore", label: "Sophomore" }, { value: "junior", label: "Junior" }, { value: "senior", label: "Senior" },
];

export function RecruitingHome() {
  const { guildId } = useReadyAuth();
  const [tab, setTab] = useState<"recruits" | "transfers">("recruits");
  const [teams, setTeams] = useState<ScheduleTeam[] | null>(null);

  useEffect(() => { recApi.listScheduleTeams(guildId).then((res) => setTeams(res.teams)).catch(() => setTeams([])); }, [guildId]);
  const teamName = (id: string | null) => teams?.find((team) => team.id === id)?.name ?? "Unknown team";

  return (
    <div>
      <PageHeader title="Recruiting & Transfer Portal" subtitle="Track incoming recruits and outgoing transfers, with headlines generated automatically on commitment." />
      <div className="segmented" style={{ maxWidth: 360, marginBottom: "var(--space-4)" }}>
        <Button variant={tab === "recruits" ? "primary" : "secondary"} onClick={() => setTab("recruits")}>Recruits</Button>
        <Button variant={tab === "transfers" ? "primary" : "secondary"} onClick={() => setTab("transfers")}>Transfer Portal</Button>
      </div>
      {tab === "recruits" ? <RecruitsPanel guildId={guildId} teams={teams} teamName={teamName} /> : <TransfersPanel guildId={guildId} teams={teams} teamName={teamName} />}
    </div>
  );
}

function RecruitsPanel({ guildId, teams, teamName }: { guildId: string; teams: ScheduleTeam[] | null; teamName: (id: string | null) => string }) {
  const [recruits, setRecruits] = useState<Recruit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ playerName: "", position: "", homeCity: "", homeState: "", starRating: 3 });
  const [committingId, setCommittingId] = useState<string | null>(null);
  const [commitTeamId, setCommitTeamId] = useState("");
  const [busy, setBusy] = useState(false);

  function load() { recApi.listRecruits(guildId).then(setRecruitsRes).catch((err) => setError(err instanceof Error ? err.message : "Failed to load recruits.")); }
  function setRecruitsRes(res: { recruits: Recruit[] }) { setRecruits(res.recruits); }
  useEffect(() => { load(); }, [guildId]);

  async function submitDraft() {
    if (!draft.playerName.trim() || !draft.position.trim()) return;
    setBusy(true);
    try {
      await recApi.createRecruit({ guildId, ...draft, homeCity: draft.homeCity || null, homeState: draft.homeState || null });
      setAdding(false); setDraft({ playerName: "", position: "", homeCity: "", homeState: "", starRating: 3 }); load();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to add the recruit."); }
    finally { setBusy(false); }
  }
  async function markCommitted(id: string) {
    setBusy(true);
    try { await recApi.updateRecruitStatus({ guildId, id, status: "committed", committedTeamId: commitTeamId || null }); setCommittingId(null); setCommitTeamId(""); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to update status."); }
    finally { setBusy(false); }
  }
  async function decommit(id: string) {
    setBusy(true);
    try { await recApi.updateRecruitStatus({ guildId, id, status: "decommitted" }); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to update status."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true);
    try { await recApi.deleteRecruit(guildId, id); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to delete the recruit."); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {error && <ErrorState message={error} />}
      {!adding && <Button variant="secondary" onClick={() => setAdding(true)} style={{ marginBottom: "var(--space-3)" }}><Plus size={16} /> Add Recruit</Button>}
      {adding && (
        <Card style={{ marginBottom: "var(--space-4)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: "var(--space-2)", alignItems: "end" }}>
            <label className="form-field" style={{ margin: 0 }}><span className="form-label">Name</span><input className="form-input" value={draft.playerName} onChange={(e) => setDraft({ ...draft, playerName: e.target.value })} /></label>
            <label className="form-field" style={{ margin: 0 }}><span className="form-label">Position</span><input className="form-input" value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} /></label>
            <label className="form-field" style={{ margin: 0 }}><span className="form-label">City</span><input className="form-input" value={draft.homeCity} onChange={(e) => setDraft({ ...draft, homeCity: e.target.value })} /></label>
            <label className="form-field" style={{ margin: 0 }}><span className="form-label">State</span><input className="form-input" value={draft.homeState} onChange={(e) => setDraft({ ...draft, homeState: e.target.value })} /></label>
            <label className="form-field" style={{ margin: 0 }}><span className="form-label">Stars</span><select className="form-select" value={draft.starRating} onChange={(e) => setDraft({ ...draft, starRating: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} Star{n > 1 ? "s" : ""}</option>)}</select></label>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
            <Button variant="primary" disabled={busy} onClick={() => void submitDraft()}>Save Recruit</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Card>
      )}
      {!recruits ? <LoadingState label="Loading recruits…" /> : recruits.length === 0 ? <Card><p style={{ margin: 0, color: "var(--text-secondary)" }}>No recruits tracked yet.</p></Card> : (
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          {recruits.map((recruit) => (
            <Card key={recruit.id} style={{ padding: "var(--space-3) var(--space-4)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  <strong>{recruit.playerName}</strong>
                  <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{recruit.position}{recruit.homeCity ? ` · ${recruit.homeCity}, ${recruit.homeState ?? ""}` : ""}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "var(--gold)" }}>{Array.from({ length: recruit.starRating }).map((_, i) => <Star key={i} size={13} fill="currentColor" />)}</span>
                  <Badge status={RECRUIT_STATUS_BADGE[recruit.status]}>{recruit.status}</Badge>
                  {recruit.status === "committed" && recruit.committedTeamId && <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>→ {teamName(recruit.committedTeamId)}</span>}
                </div>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  {recruit.status !== "committed" && committingId !== recruit.id && <Button variant="secondary" size="compact" onClick={() => setCommittingId(recruit.id)}>Mark Committed</Button>}
                  {recruit.status === "committed" && <Button variant="secondary" size="compact" onClick={() => void decommit(recruit.id)}>Decommit</Button>}
                  <Button variant="danger" size="compact" disabled={busy} onClick={() => void remove(recruit.id)}><Trash2 size={14} /></Button>
                </div>
              </div>
              {committingId === recruit.id && (
                <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                  <select className="form-select" value={commitTeamId} onChange={(e) => setCommitTeamId(e.target.value)}>
                    <option value="">Select committed team…</option>
                    {(teams ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                  <Button variant="primary" size="compact" disabled={busy || !commitTeamId} onClick={() => void markCommitted(recruit.id)}>Confirm Commitment</Button>
                  <Button variant="ghost" size="compact" onClick={() => { setCommittingId(null); setCommitTeamId(""); }}>Cancel</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TransfersPanel({ guildId, teams, teamName }: { guildId: string; teams: ScheduleTeam[] | null; teamName: (id: string | null) => string }) {
  const [entries, setEntries] = useState<TransferEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ playerName: "", position: "", classYear: "" as ClassYear | "", originTeamId: "" });
  const [landingId, setLandingId] = useState<string | null>(null);
  const [destinationTeamId, setDestinationTeamId] = useState("");
  const [busy, setBusy] = useState(false);

  function load() { recApi.listTransferEntries(guildId).then((res) => setEntries(res.entries)).catch((err) => setError(err instanceof Error ? err.message : "Failed to load transfer portal entries.")); }
  useEffect(() => { load(); }, [guildId]);

  const canSubmit = useMemo(() => draft.playerName.trim() && draft.position.trim() && draft.originTeamId, [draft]);

  async function submitDraft() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await recApi.createTransferEntry({ guildId, playerName: draft.playerName, position: draft.position, classYear: draft.classYear || null, originTeamId: draft.originTeamId });
      setAdding(false); setDraft({ playerName: "", position: "", classYear: "", originTeamId: "" }); load();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to add the transfer entry."); }
    finally { setBusy(false); }
  }
  async function markLanded(id: string) {
    setBusy(true);
    try { await recApi.updateTransferStatus({ guildId, id, status: "transferred", destinationTeamId: destinationTeamId || null }); setLandingId(null); setDestinationTeamId(""); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to update status."); }
    finally { setBusy(false); }
  }
  async function withdraw(id: string) {
    setBusy(true);
    try { await recApi.updateTransferStatus({ guildId, id, status: "withdrawn" }); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to update status."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true);
    try { await recApi.deleteTransferEntry(guildId, id); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to delete the entry."); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {error && <ErrorState message={error} />}
      {!adding && <Button variant="secondary" onClick={() => setAdding(true)} style={{ marginBottom: "var(--space-3)" }}><Plus size={16} /> Add Transfer Entry</Button>}
      {adding && (
        <Card style={{ marginBottom: "var(--space-4)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 2fr", gap: "var(--space-2)", alignItems: "end" }}>
            <label className="form-field" style={{ margin: 0 }}><span className="form-label">Name</span><input className="form-input" value={draft.playerName} onChange={(e) => setDraft({ ...draft, playerName: e.target.value })} /></label>
            <label className="form-field" style={{ margin: 0 }}><span className="form-label">Position</span><input className="form-input" value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} /></label>
            <label className="form-field" style={{ margin: 0 }}><span className="form-label">Class</span><select className="form-select" value={draft.classYear} onChange={(e) => setDraft({ ...draft, classYear: e.target.value as ClassYear | "" })}>{CLASS_YEAR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="form-field" style={{ margin: 0 }}><span className="form-label">Leaving team</span><select className="form-select" value={draft.originTeamId} onChange={(e) => setDraft({ ...draft, originTeamId: e.target.value })}><option value="">Select team…</option>{(teams ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
            <Button variant="primary" disabled={busy || !canSubmit} onClick={() => void submitDraft()}>Save Entry</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Card>
      )}
      {!entries ? <LoadingState label="Loading transfer portal…" /> : entries.length === 0 ? <Card><p style={{ margin: 0, color: "var(--text-secondary)" }}>No transfer portal entries tracked yet.</p></Card> : (
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          {entries.map((entry) => (
            <Card key={entry.id} style={{ padding: "var(--space-3) var(--space-4)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  <strong>{entry.playerName}</strong>
                  <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{entry.position}{entry.classYear ? ` · ${entry.classYear}` : ""} · from {teamName(entry.originTeamId)}</span>
                  <Badge status={TRANSFER_STATUS_BADGE[entry.status]}>{entry.status.replace("_", " ")}</Badge>
                  {entry.status === "transferred" && entry.destinationTeamId && <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>→ {teamName(entry.destinationTeamId)}</span>}
                </div>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  {entry.status === "entered_portal" && landingId !== entry.id && <>
                    <Button variant="secondary" size="compact" onClick={() => setLandingId(entry.id)}>Mark Landed</Button>
                    <Button variant="ghost" size="compact" onClick={() => void withdraw(entry.id)}>Withdraw</Button>
                  </>}
                  <Button variant="danger" size="compact" disabled={busy} onClick={() => void remove(entry.id)}><Trash2 size={14} /></Button>
                </div>
              </div>
              {landingId === entry.id && (
                <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                  <select className="form-select" value={destinationTeamId} onChange={(e) => setDestinationTeamId(e.target.value)}>
                    <option value="">Select destination team…</option>
                    {(teams ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                  <Button variant="primary" size="compact" disabled={busy || !destinationTeamId} onClick={() => void markLanded(entry.id)}>Confirm Landing Spot</Button>
                  <Button variant="ghost" size="compact" onClick={() => { setLandingId(null); setDestinationTeamId(""); }}>Cancel</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
