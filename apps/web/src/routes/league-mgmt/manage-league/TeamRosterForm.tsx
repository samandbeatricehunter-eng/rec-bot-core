import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CFB_POSITIONS } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { RosterPlayer, TeamRosterResponse } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Table, Th, Td } from "../../../components/ui/Table.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

function formatHeight(inches: number | null): string {
  if (inches == null) return "—";
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function AddPlayerForm({ guildId, teamId, onAdded }: { guildId: string; teamId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [position, setPosition] = useState("");
  const [overallRating, setOverallRating] = useState("");
  const [heightInches, setHeightInches] = useState("");
  const [weightLbs, setWeightLbs] = useState("");
  const [handedness, setHandedness] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!firstName.trim() || !lastName.trim() || !position) {
      setError("First name, last name, and position are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recApi.addRosterPlayer({
        guildId, teamId,
        firstName: firstName.trim(), lastName: lastName.trim(), position,
        heightInches: heightInches.trim() ? Number(heightInches) : null,
        weightLbs: weightLbs.trim() ? Number(weightLbs) : null,
        handedness: handedness || null,
        overallRating: overallRating.trim() ? Number(overallRating) : null,
      });
      setFirstName(""); setLastName(""); setPosition(""); setOverallRating(""); setHeightInches(""); setWeightLbs(""); setHandedness("");
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add player.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <Button variant="primary" onClick={() => setOpen(true)}>Add Player</Button>;

  return (
    <Card style={{ marginBottom: "var(--space-4)" }}>
      {error && <ErrorState message={error} />}
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="form-field" style={{ minWidth: 140 }}>
          <span className="form-label">First name</span>
          <input className="form-input" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
        </label>
        <label className="form-field" style={{ minWidth: 140 }}>
          <span className="form-label">Last name</span>
          <input className="form-input" value={lastName} onChange={(event) => setLastName(event.target.value)} />
        </label>
        <label className="form-field" style={{ minWidth: 120 }}>
          <span className="form-label">Position</span>
          <select className="form-input" value={position} onChange={(event) => setPosition(event.target.value)}>
            <option value="">Select</option>
            {CFB_POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
          </select>
        </label>
        <label className="form-field" style={{ minWidth: 100 }}>
          <span className="form-label">OVR</span>
          <input className="form-input" type="number" min={0} max={99} value={overallRating} onChange={(event) => setOverallRating(event.target.value)} />
        </label>
        <label className="form-field" style={{ minWidth: 100 }}>
          <span className="form-label">Height (in)</span>
          <input className="form-input" type="number" min={60} max={84} value={heightInches} onChange={(event) => setHeightInches(event.target.value)} />
        </label>
        <label className="form-field" style={{ minWidth: 100 }}>
          <span className="form-label">Weight (lb)</span>
          <input className="form-input" type="number" min={100} max={450} value={weightLbs} onChange={(event) => setWeightLbs(event.target.value)} />
        </label>
        <label className="form-field" style={{ minWidth: 100 }}>
          <span className="form-label">Hand</span>
          <select className="form-input" value={handedness} onChange={(event) => setHandedness(event.target.value)}>
            <option value="">—</option>
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
        </label>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>{busy ? "Adding…" : "Save"}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </Card>
  );
}

export function TeamRosterForm() {
  const { teamId } = useParams<{ teamId: string }>();
  const { guildId } = useReadyAuth();
  const [data, setData] = useState<TeamRosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positionFilter, setPositionFilter] = useState("ALL");

  function load() {
    if (!teamId) return;
    recApi.getTeamRoster({ guildId, teamId })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load roster."));
  }

  useEffect(load, [guildId, teamId]);

  const filtered = useMemo(() => {
    const players = data?.players ?? [];
    return positionFilter === "ALL" ? players : players.filter((p: RosterPlayer) => p.position === positionFilter);
  }, [data, positionFilter]);

  if (error) return <div><PageHeader title="Edit Roster" /><ErrorState message={error} /></div>;
  if (!data || !teamId) return <LoadingState label="Loading roster…" />;

  return (
    <div>
      <PageHeader title={data.team.name ?? "Team Roster"} subtitle="Add players directly, or review who's currently on this roster." />
      <div style={{ marginBottom: "var(--space-4)" }}>
        <AddPlayerForm guildId={guildId} teamId={teamId} onAdded={load} />
      </div>
      <Card style={{ marginBottom: "var(--space-4)" }}>
        <label className="form-field" style={{ margin: 0, maxWidth: 200 }}>
          <span className="form-label">Position</span>
          <select className="form-select" value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)}>
            <option value="ALL">ALL</option>
            {CFB_POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
          </select>
        </label>
      </Card>
      <Card style={{ padding: 0 }}>
        <Table>
          <thead>
            <tr>
              <Th>Player</Th>
              <Th>Position</Th>
              <Th>Height</Th>
              <Th>Weight</Th>
              <Th>Hand</Th>
              <Th>OVR</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((player: RosterPlayer) => (
              <tr key={player.id}>
                <Td>{player.fullName}</Td>
                <Td>{player.position}</Td>
                <Td>{formatHeight(player.heightInches)}</Td>
                <Td>{player.weightLbs != null ? `${player.weightLbs} lbs` : "—"}</Td>
                <Td>{player.handedness ? player.handedness[0].toUpperCase() + player.handedness.slice(1) : "—"}</Td>
                <Td>{player.overallRating ?? "—"}</Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><Td colSpan={6} style={{ textAlign: "center", color: "var(--text-secondary)" }}>No players match.</Td></tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
