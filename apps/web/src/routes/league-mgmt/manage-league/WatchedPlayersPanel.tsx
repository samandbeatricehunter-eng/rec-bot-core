import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { ClassYear, WatchedPlayer } from "../../../types/api.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

const CLASS_YEAR_OPTIONS: Array<{ value: ClassYear | ""; label: string }> = [
  { value: "", label: "No class" },
  { value: "freshman", label: "Freshman" },
  { value: "sophomore", label: "Sophomore" },
  { value: "junior", label: "Junior" },
  { value: "senior", label: "Senior" },
];

type DraftPlayer = { playerName: string; position: string; classYear: ClassYear | "" };
const EMPTY_DRAFT: DraftPlayer = { playerName: "", position: "", classYear: "" };

// Commissioner-managed roster of "players to watch" for a team — added here once, then
// selected from a dropdown (rather than re-typed) whenever a game result is tagged with
// player performances in EnterFinalScoreModal.
export function WatchedPlayersPanel({ guildId, teamId }: { guildId: string; teamId: string }) {
  const [players, setPlayers] = useState<WatchedPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftPlayer>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    recApi.listWatchedPlayers(guildId, teamId)
      .then((res) => setPlayers(res.players))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load players to watch."));
  }
  useEffect(() => { load(); }, [guildId, teamId]);

  function startAdd() { setAdding(true); setEditingId(null); setDraft(EMPTY_DRAFT); }
  function startEdit(player: WatchedPlayer) { setEditingId(player.id); setAdding(false); setDraft({ playerName: player.playerName, position: player.position, classYear: player.classYear ?? "" }); }
  function cancel() { setAdding(false); setEditingId(null); setDraft(EMPTY_DRAFT); }

  async function save() {
    if (!draft.playerName.trim() || !draft.position.trim()) return;
    setBusy(true);
    try {
      const payload = { playerName: draft.playerName.trim(), position: draft.position.trim(), classYear: draft.classYear || null };
      if (editingId) await recApi.updateWatchedPlayer({ guildId, id: editingId, ...payload });
      else await recApi.createWatchedPlayer({ guildId, teamId, ...payload });
      cancel();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the player.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try { await recApi.removeWatchedPlayer(guildId, id); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to remove the player."); }
    finally { setBusy(false); }
  }

  return (
    <Card style={{ marginTop: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
        <div>
          <h3 style={{ margin: 0 }}>Players to Watch</h3>
          <p style={{ margin: "2px 0 0", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
            Add players here so they can be selected from a dropdown when tagging performances in a game result.
          </p>
        </div>
        {!adding && !editingId && <Button variant="secondary" onClick={startAdd}><Plus size={16} /> Add Player</Button>}
      </div>
      {error && <ErrorState message={error} />}
      {players === null ? (
        <p className="hub-empty">Loading…</p>
      ) : players.length === 0 && !adding ? (
        <p className="hub-empty">No players added yet.</p>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          {players.map((player) => editingId === player.id ? (
            <PlayerDraftRow key={player.id} draft={draft} setDraft={setDraft} busy={busy} onSave={() => void save()} onCancel={cancel} />
          ) : (
            <div key={player.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-raised)" }}>
              <span>
                <strong>{player.playerName}</strong>{" "}
                <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  {player.position}{player.classYear ? ` · ${player.classYear}` : ""}
                </span>
              </span>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button variant="ghost" size="compact" onClick={() => startEdit(player)}><Pencil size={14} /></Button>
                <Button variant="danger" size="compact" disabled={busy} onClick={() => void remove(player.id)}><Trash2 size={14} /></Button>
              </div>
            </div>
          ))}
          {adding && <PlayerDraftRow draft={draft} setDraft={setDraft} busy={busy} onSave={() => void save()} onCancel={cancel} />}
        </div>
      )}
    </Card>
  );
}

function PlayerDraftRow({ draft, setDraft, busy, onSave, onCancel }: {
  draft: DraftPlayer; setDraft: (draft: DraftPlayer) => void; busy: boolean; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto auto", gap: "var(--space-2)", alignItems: "center" }}>
      <input className="form-input" placeholder="Player name" value={draft.playerName} onChange={(e) => setDraft({ ...draft, playerName: e.target.value })} />
      <input className="form-input" placeholder="Position" value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} />
      <select className="form-select" value={draft.classYear} onChange={(e) => setDraft({ ...draft, classYear: e.target.value as ClassYear | "" })}>
        {CLASS_YEAR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <Button variant="primary" size="compact" disabled={busy || !draft.playerName.trim() || !draft.position.trim()} onClick={onSave}>Save</Button>
      <Button variant="ghost" size="compact" onClick={onCancel}><X size={14} /></Button>
    </div>
  );
}
