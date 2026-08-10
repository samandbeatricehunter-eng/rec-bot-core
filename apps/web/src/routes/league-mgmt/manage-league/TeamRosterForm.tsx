import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CFB_POSITIONS } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { useLeagueTheme } from "../../../lib/league-theme-context.js";
import type { RosterPlayer, TeamDraftPick, TeamManagementSummaryRow, TeamRosterResponse } from "../../../types/api.js";
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

const HEADSHOT_MAX_DIMENSION = 600;
const HEADSHOT_MAX_BASE64 = 6_000_000; // ≈4.5 MB binary, safely under the server's 5 MB cap

/** Read + downscale an image file to a base64 data URL the API can re-host. */
function readImageAsResizedBase64(file: File): Promise<{ contentType: string; imageBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read the image file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a valid image."));
      img.onload = () => {
        const scale = Math.min(1, HEADSHOT_MAX_DIMENSION / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Your browser can't resize this image here.")); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const preferred = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
        let dataUrl = canvas.toDataURL(preferred, preferred === "image/png" ? undefined : 0.9);
        if (dataUrl.length > HEADSHOT_MAX_BASE64) {
          for (const quality of [0.7, 0.5, 0.35]) {
            dataUrl = canvas.toDataURL("image/jpeg", quality);
            if (dataUrl.length <= HEADSHOT_MAX_BASE64) break;
          }
        }
        const contentType = dataUrl.startsWith("data:image/png") ? "image/png" : dataUrl.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
        resolve({ contentType, imageBase64: dataUrl.split(",")[1] ?? "" });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function HeadshotCell({ guildId, player, onUploaded }: { guildId: string; player: RosterPlayer; onUploaded: () => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setError("Headshot must be a JPEG, PNG, or WebP image.");
        return;
      }
      const resized = await readImageAsResizedBase64(file);
      await recApi.uploadPlayerPhoto({ guildId, playerId: player.id, contentType: resized.contentType, imageBase64: resized.imageBase64 });
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload headshot.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Td>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        {player.photoUrl
          ? <img src={player.photoUrl} alt={player.fullName} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} loading="lazy" />
          : <div style={{ width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px dashed var(--border)", color: "var(--text-muted)", fontSize: 12 }}>{player.position}</div>}
        <div>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(event) => { void handleFile(event.target.files?.[0]); event.target.value = ""; }} />
          <Button size="compact" disabled={busy} onClick={() => fileInputRef.current?.click()}>{busy ? "Uploading…" : player.photoUrl ? "Replace" : "Add headshot"}</Button>
          {error && <p className="form-hint" style={{ color: "var(--error)", margin: "4px 0 0" }}>{error}</p>}
        </div>
      </div>
    </Td>
  );
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
  const { game } = useLeagueTheme();
  const [data, setData] = useState<TeamRosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [teams, setTeams] = useState<TeamManagementSummaryRow[]>([]);
  const isMadden = game === "madden_26" || game === "madden_27";

  function load() {
    if (!teamId) return;
    recApi.getTeamRoster({ guildId, teamId })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load roster."));
  }

  useEffect(load, [guildId, teamId]);
  useEffect(() => { if (isMadden) void recApi.getTeamManagementSummary(guildId).then((result) => setTeams(result.teams)); }, [guildId, isMadden]);

  const filtered = useMemo(() => {
    const players = data?.players ?? [];
    return positionFilter === "ALL" ? players : players.filter((p: RosterPlayer) => p.position === positionFilter);
  }, [data, positionFilter]);

  if (error) return <div><PageHeader title="Edit Roster" /><ErrorState message={error} /></div>;
  if (!data || !teamId) return <LoadingState label="Loading roster…" />;

  return (
    <div>
      <PageHeader title={data.team.name ?? "Team Roster"} subtitle="Add players directly, or review who's currently on this roster." />
      {positionFilter !== "Draft Picks" && <div style={{ marginBottom: "var(--space-4)" }}>
        <AddPlayerForm guildId={guildId} teamId={teamId} onAdded={load} />
      </div>}
      <Card style={{ marginBottom: "var(--space-4)" }}>
        <label className="form-field" style={{ margin: 0, maxWidth: 200 }}>
          <span className="form-label">Position</span>
          <select className="form-select" value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)}>
            <option value="ALL">ALL</option>
            {CFB_POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
            {isMadden && <option value="Draft Picks">Draft Picks</option>}
          </select>
        </label>
      </Card>
      {positionFilter === "Draft Picks" ? (
        <DraftPickManager guildId={guildId} currentTeamId={teamId} picks={data.draftPicks} teams={teams} onMoved={load} />
      ) : <Card style={{ padding: 0 }}>
        <Table>
          <thead>
            <tr>
              <Th>Headshot</Th>
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
                <HeadshotCell guildId={guildId} player={player} onUploaded={load} />
                <Td>{player.fullName}</Td>
                <Td>{player.position}</Td>
                <Td>{formatHeight(player.heightInches)}</Td>
                <Td>{player.weightLbs != null ? `${player.weightLbs} lbs` : "—"}</Td>
                <Td>{player.handedness ? player.handedness[0].toUpperCase() + player.handedness.slice(1) : "—"}</Td>
                <Td>{player.overallRating ?? "—"}</Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><Td colSpan={7} style={{ textAlign: "center", color: "var(--text-secondary)" }}>No players match.</Td></tr>
            )}
          </tbody>
        </Table>
      </Card>}
    </div>
  );
}

function DraftPickManager({ guildId, currentTeamId, picks, teams, onMoved }: {
  guildId: string; currentTeamId: string; picks: TeamDraftPick[]; teams: TeamManagementSummaryRow[]; onMoved: () => void;
}) {
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function movePick(pick: TeamDraftPick) {
    const currentTeamIdTarget = destinations[pick.id];
    if (!currentTeamIdTarget) return;
    setBusyId(pick.id); setError(null);
    try { await recApi.moveDraftPick({ guildId, pickId: pick.id, currentTeamId: currentTeamIdTarget }); onMoved(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to move pick."); }
    finally { setBusyId(null); }
  }
  return <Card style={{ padding: 0 }}>
    {error && <ErrorState message={error} />}
    <Table><thead><tr><Th>Year</Th><Th>Round</Th><Th>Pick #</Th><Th>Acquired From</Th><Th>Original Owner</Th><Th>Move Pick</Th></tr></thead>
      <tbody>{[...picks].sort((a, b) => a.seasonNumber - b.seasonNumber || a.round - b.round).map((pick) => <tr key={pick.id}>
        <Td>Season {pick.seasonNumber}</Td><Td>{pick.round}</Td><Td>{pick.pickNumber ?? "TBD"}</Td>
        <Td>{pick.acquiredFromTeamName ?? "Original allocation"}</Td><Td>{pick.originalTeamName}</Td>
        <Td><div style={{ display: "flex", gap: "var(--space-2)", minWidth: 280 }}>
          <select className="form-select" aria-label={`Move season ${pick.seasonNumber} round ${pick.round} pick`} value={destinations[pick.id] ?? ""} onChange={(event) => setDestinations((value) => ({ ...value, [pick.id]: event.target.value }))}>
            <option value="">Select destination</option>
            {teams.filter((team) => team.id !== currentTeamId).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
          <Button size="compact" disabled={!destinations[pick.id] || busyId === pick.id} onClick={() => void movePick(pick)}>{busyId === pick.id ? "Moving…" : "Move Pick"}</Button>
        </div></Td>
      </tr>)}{picks.length === 0 && <tr><Td colSpan={6}>No draft picks are currently owned by this team.</Td></tr>}</tbody>
    </Table>
  </Card>;
}
