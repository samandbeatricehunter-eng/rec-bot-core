import { useCallback, useEffect, useMemo, useState } from "react";
import { CFB_POSITIONS, REC_DEV_TRAITS, getRecAttributeDisplayName, getRecEditableAttributes, sortRecAttributeCodes } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { useLeagueTheme } from "../../../lib/league-theme-context.js";
import type { RosterPoolPlayer, RosterPositionGroup, TeamManagementSummaryRow, TeamRosterResponse } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Table, Th, Td } from "../../../components/ui/Table.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

function formatHeight(inches: number | null): string {
  if (inches == null) return "—";
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

const CLASS_YEARS = ["FR", "SO", "JR", "SR", "RS-FR", "RS-SO", "RS-JR", "RS-SR"];

/** Team-selectable roster editor for League Mgmt. Pick a team, then assign unassigned pool
 * players to it, release its rosters back into the pool, or edit any player's full detail
 * (identity, physicals, and the full attribute grid) in place. Madden and CFB both flow
 * through the same surface — dev trait renders only for Madden, class year only for CFB. */
export function RosterPoolEditor() {
  const { guildId } = useReadyAuth();
  const { game } = useLeagueTheme();
  const isMadden = game === "madden_26" || game === "madden_27";

  const [teams, setTeams] = useState<TeamManagementSummaryRow[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [pool, setPool] = useState<RosterPoolPlayer[]>([]);
  const [positionGroups, setPositionGroups] = useState<RosterPositionGroup[]>([]);
  const [teamRoster, setTeamRoster] = useState<TeamRosterResponse | null>(null);
  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RosterPoolPlayer | null>(null);

  const loadPool = useCallback(() => {
    recApi.listRosterPool({ guildId, search, positionGroup: positionFilter || null })
      .then((res) => { setPool(res.players); setPositionGroups(res.positionGroups); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the player pool."));
  }, [guildId, search, positionFilter]);

  useEffect(() => { void recApi.getTeamManagementSummary(guildId).then((res) => setTeams(res.teams)).catch(() => undefined); }, [guildId]);
  useEffect(loadPool, [loadPool]);

  useEffect(() => {
    if (!selectedTeamId) { setTeamRoster(null); return; }
    recApi.getTeamRoster({ guildId, teamId: selectedTeamId })
      .then(setTeamRoster)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load that team's roster."));
  }, [guildId, selectedTeamId]);

  async function assign(player: RosterPoolPlayer) {
    if (!selectedTeamId) { setError("Pick a team first to assign players to."); return; }
    setBusyId(player.id); setError(null);
    try {
      await recApi.assignRosterPlayer({ guildId, playerId: player.id, teamId: selectedTeamId });
      loadPool();
      if (selectedTeamId) {
        const roster = await recApi.getTeamRoster({ guildId, teamId: selectedTeamId });
        setTeamRoster(roster);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign that player.");
    } finally {
      setBusyId(null);
    }
  }

  async function release(player: { id: string; fullName: string }) {
    if (!window.confirm(`Release ${player.fullName} back into the pool? They'll become a free agent and can be re-assigned to any team.`)) return;
    setBusyId(player.id); setError(null);
    try {
      await recApi.releaseRosterPlayer({ guildId, playerId: player.id });
      loadPool();
      if (selectedTeamId) {
        const roster = await recApi.getTeamRoster({ guildId, teamId: selectedTeamId });
        setTeamRoster(roster);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to release that player.");
    } finally {
      setBusyId(null);
    }
  }

  const grouped = useMemo(() => {
    const byGroup = new Map<string, RosterPoolPlayer[]>();
    for (const player of pool) {
      const list = byGroup.get(player.positionGroup) ?? [];
      list.push(player);
      byGroup.set(player.positionGroup, list);
    }
    return byGroup;
  }, [pool]);

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  return (
    <div>
      <PageHeader title="Edit Rosters" subtitle="Pick a team, then assign or release players across the roster and the free-agent pool." />
      {error && <div style={{ marginBottom: "var(--space-3)" }}><ErrorState message={error} /></div>}

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="form-field" style={{ margin: 0, minWidth: 240 }}>
            <span className="form-label">Assign to team</span>
            <select className="form-select" value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)}>
              <option value="">Select a team…</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label className="form-field" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            <span className="form-label">Search pool</span>
            <input className="form-input" placeholder="Search unassigned players…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="form-field" style={{ margin: 0, minWidth: 160 }}>
            <span className="form-label">Position group</span>
            <select className="form-select" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)}>
              <option value="">All groups</option>
              {positionGroups.map((group) => <option key={group.group} value={group.group}>{group.group} ({group.playerCount})</option>)}
            </select>
          </label>
        </div>
      </Card>

      {selectedTeam && (
        <Card style={{ marginBottom: "var(--space-4)", padding: 0 }}>
          <div style={{ padding: "var(--space-2) var(--space-4)", borderBottom: "1px solid var(--border)" }}>
            <h3 style={{ margin: 0 }}>{selectedTeam.name} — current roster</h3>
          </div>
          {teamRoster ? <Table>
            <thead><tr><Th>Player</Th><Th>Position</Th><Th>Height</Th><Th>Weight</Th><Th>OVR</Th><Th></Th></tr></thead>
            <tbody>
              {teamRoster.players.map((player) => (
                <tr key={player.id}>
                  <Td>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                      {player.photoUrl
                        ? <img src={player.photoUrl} alt={player.fullName} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} loading="lazy" />
                        : <div style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px dashed var(--border)", color: "var(--text-muted)", fontSize: 12 }}>{player.position}</div>}
                      <strong>{player.fullName}</strong>
                    </div>
                  </Td>
                  <Td>{player.position}</Td>
                  <Td>{formatHeight(player.heightInches)}</Td>
                  <Td>{player.weightLbs != null ? `${player.weightLbs} lbs` : "—"}</Td>
                  <Td>{player.overallRating ?? "—"}</Td>
                  <Td>
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <Button size="compact" disabled={busyId === player.id} onClick={() => release(player)}>{busyId === player.id ? "Releasing…" : "Remove"}</Button>
                    </div>
                  </Td>
                </tr>
              ))}
              {teamRoster.players.length === 0 && <tr><Td colSpan={6} style={{ textAlign: "center", color: "var(--text-secondary)" }}>No players assigned yet — assign some from the pool below.</Td></tr>}
            </tbody>
          </Table> : <LoadingState label="Loading roster…" />}
        </Card>
      )}

      <h3 style={{ margin: "0 0 var(--space-2)", color: "var(--gold)" }}>Unassigned pool</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {grouped.size === 0 && <Card><p style={{ margin: 0, color: "var(--text-secondary)" }}>No unassigned players match.</p></Card>}
        {[...grouped.entries()].map(([group, players]) => (
          <Card key={group} style={{ padding: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "var(--space-2) var(--space-4)", borderBottom: "1px solid var(--border)" }}>
              <h4 style={{ margin: 0 }}>{group}</h4>
              <span className="form-hint" style={{ margin: 0 }}>{players.length} player{players.length === 1 ? "" : "s"}</span>
            </div>
            <Table>
              <thead><tr><Th>Player</Th><Th>Position</Th><Th>Height</Th><Th>Weight</Th><Th>Hand</Th><Th>OVR</Th><Th>Dev trait</Th><Th>Actions</Th></tr></thead>
              <tbody>
                {players.map((player) => (
                  <tr key={player.id}>
                    <Td>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                        {player.photoUrl
                          ? <img src={player.photoUrl} alt={player.fullName} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} loading="lazy" />
                          : <div style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px dashed var(--border)", color: "var(--text-muted)", fontSize: 12 }}>{player.position}</div>}
                        <strong>{player.fullName}</strong>
                      </div>
                    </Td>
                    <Td>{player.position}</Td>
                    <Td>{formatHeight(player.heightInches)}</Td>
                    <Td>{player.weightLbs != null ? `${player.weightLbs} lbs` : "—"}</Td>
                    <Td>{player.handedness ? player.handedness[0].toUpperCase() + player.handedness.slice(1) : "—"}</Td>
                    <Td>{player.overallRating ?? "—"}</Td>
                    <Td>{isMadden ? (player.devTrait ?? "—") : "—"}</Td>
                    <Td>
                      <div style={{ display: "flex", gap: "var(--space-2)" }}>
                        <Button variant="primary" size="compact" disabled={busyId === player.id || !selectedTeamId} onClick={() => void assign(player)}>
                          {busyId === player.id ? "Assigning…" : "Assign"}
                        </Button>
                        <Button size="compact" onClick={() => setEditing(player)}>Edit</Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ))}
      </div>

      {editing && (
        <EditPlayerModal
          guildId={guildId}
          player={editing}
          isMadden={isMadden}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadPool(); if (selectedTeamId) recApi.getTeamRoster({ guildId, teamId: selectedTeamId }).then(setTeamRoster).catch(() => undefined); }}
        />
      )}
    </div>
  );
}

function EditPlayerModal({ guildId, player, isMadden, onClose, onSaved }: {
  guildId: string;
  player: RosterPoolPlayer;
  isMadden: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const firstName = player.fullName.trim().split(/\s+/)[0] ?? "";
  const lastName = player.fullName.trim().split(/\s+/).slice(1).join(" ") ?? "";

  const [form, setForm] = useState(() => ({
    firstName,
    lastName,
    position: player.position || "",
    jerseyNumber: player.jerseyNumber != null ? String(player.jerseyNumber) : "",
    archetype: player.archetype ?? "",
    devTrait: player.devTrait ?? "",
    classYear: "",
    overallRating: player.overallRating != null ? String(player.overallRating) : "",
    heightInches: player.heightInches != null ? String(player.heightInches) : "",
    weightLbs: player.weightLbs != null ? String(player.weightLbs) : "",
    handedness: player.handedness ?? "",
  }));
  const [attributes, setAttributes] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const [code, value] of Object.entries(player.attributes ?? {})) {
      if (typeof value === "number") out[code] = value;
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editableCodes = useMemo(
    () => sortRecAttributeCodes(getRecEditableAttributes(isMadden ? "MADDEN" : "CFB", form.position, form.archetype || undefined)),
    [isMadden, form.position, form.archetype],
  );

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  function setAttribute(code: string, value: number) {
    setAttributes((current) => ({ ...current, [code]: Math.max(0, Math.min(99, Number.isFinite(value) ? Math.round(value) : 0)) }));
  }
  function mutate(code: string, delta: number) {
    setAttribute(code, (attributes[code] ?? 0) + delta);
  }

  async function save() {
    if (!form.firstName.trim() || !form.lastName.trim()) { setError("First and last name are required."); return; }
    setBusy(true); setError(null);
    try {
      await recApi.updateRosterPlayer({
        guildId,
        playerId: player.id,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        position: form.position,
        jerseyNumber: form.jerseyNumber === "" ? null : Number(form.jerseyNumber),
        archetype: form.archetype.trim() || null,
        devTrait: form.devTrait || null,
        classYear: form.classYear || null,
        overallRating: form.overallRating === "" ? null : Number(form.overallRating),
        heightInches: form.heightInches === "" ? null : Number(form.heightInches),
        weightLbs: form.weightLbs === "" ? null : Number(form.weightLbs),
        handedness: form.handedness || null,
        attributes,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save that player.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit ${player.fullName}`} onClose={onClose} panelClassName="fantasy-draft-modal-wide">
      <div className="fantasy-draft-form-grid">
        <label>First name<input className="form-input" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></label>
        <label>Last name<input className="form-input" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></label>
        <label>Position<select className="form-input" value={form.position} onChange={(e) => set("position", e.target.value)}>
          <option value="">Select</option>
          {CFB_POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
        </select></label>
        <label>Jersey #<input className="form-input" type="number" min="0" max="99" value={form.jerseyNumber} onChange={(e) => set("jerseyNumber", e.target.value)} /></label>
        <label>Archetype<input className="form-input" value={form.archetype} placeholder="e.g. Field General" onChange={(e) => set("archetype", e.target.value)} /></label>
        {isMadden ? (
          <label>Development trait<select className="form-input" value={form.devTrait} onChange={(e) => set("devTrait", e.target.value)}>
            <option value="">—</option>
            {REC_DEV_TRAITS.MADDEN.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          </select></label>
        ) : (
          <label>Class year<select className="form-input" value={form.classYear} onChange={(e) => set("classYear", e.target.value)}>
            <option value="">—</option>
            {CLASS_YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
          </select></label>
        )}
        <label>OVR<input className="form-input" type="number" min="0" max="99" value={form.overallRating} onChange={(e) => set("overallRating", e.target.value)} /></label>
        <label>Height (in)<input className="form-input" type="number" min="48" max="90" value={form.heightInches} onChange={(e) => set("heightInches", e.target.value)} /></label>
        <label>Weight (lb)<input className="form-input" type="number" min="100" max="450" value={form.weightLbs} onChange={(e) => set("weightLbs", e.target.value)} /></label>
        <label>Handedness<select className="form-input" value={form.handedness} onChange={(e) => set("handedness", e.target.value)}>
          <option value="">—</option>
          <option value="right">Right</option>
          <option value="left">Left</option>
        </select></label>
      </div>

      <h4 style={{ margin: "var(--space-4) 0 var(--space-2)" }}>Attributes</h4>
      <div className="fantasy-draft-attribute-list">
        {editableCodes.map((code) => (
          <div key={code} className="fantasy-draft-attribute-row">
            <span><strong>{getRecAttributeDisplayName(code)}</strong><small>{code.toUpperCase()}</small></span>
            <button type="button" onClick={() => mutate(code, -1)}>−</button>
            <input className="custom-player-attribute-input" type="number" min={0} max={99}
              value={attributes[code] ?? 0}
              onChange={(e) => setAttribute(code, Number(e.target.value))} />
            <button type="button" onClick={() => mutate(code, 1)}>+</button>
          </div>
        ))}
      </div>

      {error && <p className="hub-error">{error}</p>}
      <div className="fantasy-draft-form-actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save Player"}</Button>
      </div>
    </Modal>
  );
}