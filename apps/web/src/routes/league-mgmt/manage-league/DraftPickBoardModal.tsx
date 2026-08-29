import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { TeamManagementSummaryRow } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { Table, Th, Td } from "../../../components/ui/Table.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type DraftPickRow = {
  id: string; season_number: number; round: number; pick_number: number | null;
  original_team_id: string; current_team_id: string; manual_lock: boolean; admin_notes: string | null; asset_key: string;
};

// League-wide draft pick ownership grid — repairs pick numbers/ownership when a franchise's
// trades need correcting, and is also the source the annual rookie draft's on-clock pointer
// reads from (see DraftControlCard's "annual" mode).
export function DraftPickBoardModal({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const [picks, setPicks] = useState<DraftPickRow[] | null>(null);
  const [teams, setTeams] = useState<TeamManagementSummaryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [genSeason, setGenSeason] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  async function load() {
    try {
      const [picksResult, summary] = await Promise.all([recApi.listLeagueDraftPicks(guildId), recApi.getTeamManagementSummary(guildId)]);
      setPicks(picksResult as unknown as DraftPickRow[]);
      setTeams(summary.teams);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void load(); }, [guildId]);

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t.displayNick ?? t.displayAbbr ?? t.name])), [teams]);
  const seasons = useMemo(() => [...new Set((picks ?? []).map((p) => p.season_number))].sort((a, b) => a - b), [picks]);
  const activeSeason = selectedSeason ?? seasons[seasons.length - 1] ?? null;
  const seasonPicks = (picks ?? []).filter((p) => p.season_number === activeSeason).sort((a, b) => a.round - b.round || (a.pick_number ?? 0) - (b.pick_number ?? 0));

  async function movePick(pick: DraftPickRow, currentTeamId: string) {
    setBusyId(pick.id);
    setError(null);
    try {
      await recApi.moveDraftPick({ guildId, pickId: pick.id, currentTeamId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move pick.");
    } finally {
      setBusyId(null);
    }
  }

  async function setPickNumber(pick: DraftPickRow, pickNumber: string) {
    const value = pickNumber.trim() ? Number(pickNumber) : null;
    setBusyId(pick.id);
    setError(null);
    try {
      await recApi.moveDraftPick({ guildId, pickId: pick.id, pickNumber: value });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update pick number.");
    } finally {
      setBusyId(null);
    }
  }

  async function removePick(pick: DraftPickRow) {
    if (!window.confirm(`Delete Season ${pick.season_number} Round ${pick.round} pick (${teamById.get(pick.current_team_id) ?? "unknown"})?`)) return;
    setBusyId(pick.id);
    setError(null);
    try {
      await recApi.deleteDraftPick({ guildId, pickId: pick.id });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete pick.");
    } finally {
      setBusyId(null);
    }
  }

  async function generateSeason() {
    const seasonNumber = Number(genSeason);
    if (!seasonNumber) return;
    setGenBusy(true);
    setError(null);
    try {
      await recApi.generateSeasonDraftPicks({ guildId, seasonNumber });
      setGenSeason("");
      setSelectedSeason(seasonNumber);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate that season's draft class.");
    } finally {
      setGenBusy(false);
    }
  }

  return (
    <Modal title="Draft Picks" onClose={onClose} panelClassName="fantasy-draft-modal-wide">
      <p className="form-hint" style={{ marginTop: 0 }}>
        Who owns each round's pick, for trading and for the annual rookie draft's pick order. Move a pick to fix a bad
        trade, or fix a pick number. Season 4+ classes are auto-generated from the prior season's standings — use
        "Generate" below if a season's class doesn't exist yet.
      </p>
      {error && <ErrorState message={error} />}
      {!picks ? <LoadingState label="Loading draft picks…" /> : (
        <>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--space-3)" }}>
            {seasons.length > 0 && (
              <label className="form-field" style={{ margin: 0 }}>
                <span className="form-label">Season</span>
                <select className="form-select" value={activeSeason ?? ""} onChange={(event) => setSelectedSeason(Number(event.target.value))}>
                  {seasons.map((s) => <option key={s} value={s}>Season {s}</option>)}
                </select>
              </label>
            )}
            <label className="form-field" style={{ margin: 0 }}>
              <span className="form-label">Generate season</span>
              <input className="form-input" type="number" min={4} value={genSeason} onChange={(event) => setGenSeason(event.target.value)} placeholder="e.g. 5" style={{ width: 90 }} />
            </label>
            <Button size="compact" disabled={genBusy || !genSeason} onClick={() => void generateSeason()}>{genBusy ? "Generating…" : "Generate"}</Button>
          </div>

          {activeSeason == null ? (
            <p className="form-hint">No draft picks yet — generate a season above, or add early-season picks manually via the API.</p>
          ) : (
            <Table>
              <thead><tr><Th>Round</Th><Th>Pick #</Th><Th>Owner</Th><Th>Original</Th><Th>Move To</Th><Th /></tr></thead>
              <tbody>
                {seasonPicks.map((pick) => (
                  <tr key={pick.id}>
                    <Td>{pick.round}</Td>
                    <Td>
                      <input
                        className="form-input" style={{ width: 60 }} type="number" min={1}
                        defaultValue={pick.pick_number ?? ""} disabled={busyId === pick.id}
                        onBlur={(event) => { if (event.target.value !== String(pick.pick_number ?? "")) void setPickNumber(pick, event.target.value); }}
                      />
                    </Td>
                    <Td>{teamById.get(pick.current_team_id) ?? "Unknown"}{pick.manual_lock ? " 🔒" : ""}</Td>
                    <Td>{teamById.get(pick.original_team_id) ?? "Unknown"}</Td>
                    <Td>
                      <select
                        className="form-select" disabled={busyId === pick.id}
                        value="" onChange={(event) => { if (event.target.value) void movePick(pick, event.target.value); }}
                      >
                        <option value="">Move to…</option>
                        {teams.filter((t) => t.id !== pick.current_team_id).map((t) => <option key={t.id} value={t.id}>{t.displayNick ?? t.displayAbbr ?? t.name}</option>)}
                      </select>
                    </Td>
                    <Td><Button variant="danger" size="compact" disabled={busyId === pick.id} onClick={() => void removePick(pick)}>Delete</Button></Td>
                  </tr>
                ))}
                {seasonPicks.length === 0 && <tr><Td colSpan={6} style={{ textAlign: "center" }}>No picks for this season.</Td></tr>}
              </tbody>
            </Table>
          )}
        </>
      )}
    </Modal>
  );
}
