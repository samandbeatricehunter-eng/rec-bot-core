import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { HeismanCandidate, ScheduleTeam } from "../../../types/api.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

const MAX_CANDIDATES = 4;

export function HeismanRaceCard({ guildId, teams }: { guildId: string; teams: ScheduleTeam[] }) {
  const [candidates, setCandidates] = useState<HeismanCandidate[] | null>(null);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    recApi.listHeismanCandidates(guildId)
      .then((res) => setCandidates(res.candidates))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load the Heisman Race."));
  }

  useEffect(load, [guildId]);

  async function addCandidate() {
    if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await recApi.addHeismanCandidate({ guildId, playerName: name.trim(), teamId: teamId || null });
      setCandidates(res.candidates);
      setName("");
      setTeamId("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add candidate."); }
    finally { setBusy(false); }
  }

  async function removeCandidate(candidateId: string) {
    setRemovingId(candidateId); setError(null);
    try {
      const res = await recApi.removeHeismanCandidate({ guildId, candidateId });
      setCandidates(res.candidates);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove candidate."); }
    finally { setRemovingId(null); }
  }

  const atCapacity = (candidates?.length ?? 0) >= MAX_CANDIDATES;

  return <Card>
    <h2>Heisman Race</h2>
    <p className="form-hint">Track up to {MAX_CANDIDATES} candidates by name and team through the season.</p>
    {error && <ErrorState message={error} />}
    {candidates && candidates.length > 0 && (
      <div className="cfp-heisman-list">
        {candidates.map((candidate) => (
          <div className="cfp-heisman-row" key={candidate.id}>
            <span className="cfp-heisman-name">{candidate.player_name}</span>
            <span className="cfp-heisman-team">{candidate.team_name ?? "No team"}</span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={removingId === candidate.id}
              onClick={() => void removeCandidate(candidate.id)}
              aria-label={`Remove ${candidate.player_name}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    )}
    {candidates && candidates.length === 0 && <p className="hub-empty">No candidates yet.</p>}
    {!atCapacity && (
      <div className="cfp-heisman-add-row">
        <input
          className="form-input"
          placeholder="Player name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <select className="form-select" value={teamId} disabled={busy} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">No team</option>
          {[...teams].sort((a, b) => a.name.localeCompare(b.name)).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
        <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void addCandidate()}>
          {busy ? "Adding…" : "Add Candidate"}
        </Button>
      </div>
    )}
    {atCapacity && <p className="form-hint">At the {MAX_CANDIDATES}-candidate cap — remove one to add another.</p>}
  </Card>;
}
