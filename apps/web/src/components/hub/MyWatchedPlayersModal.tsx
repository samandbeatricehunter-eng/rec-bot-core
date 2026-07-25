import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { recApi } from "../../lib/rec-api-client.js";
import type { ClassYear, WatchedPlayer } from "../../types/api.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorState } from "../ui/ErrorState.js";

const CLASS_YEAR_OPTIONS: Array<{ value: ClassYear | ""; label: string }> = [
  { value: "", label: "No class" },
  { value: "freshman", label: "Freshman" },
  { value: "sophomore", label: "Sophomore" },
  { value: "junior", label: "Junior" },
  { value: "senior", label: "Senior" },
];

type DraftPlayer = { playerName: string; position: string; classYear: ClassYear | "" };
const EMPTY_DRAFT: DraftPlayer = { playerName: "", position: "", classYear: "" };

// Self-serve version of WatchedPlayersPanel (which is commissioner-only) — lets a coach
// manage their own team's "players to watch" list from My Team, via the create-mine/
// remove-mine routes that resolve the team from the caller's own active assignment.
export function MyWatchedPlayersModal({ guildId, onClose }: { guildId: string; onClose: () => void }) {
  const [players, setPlayers] = useState<WatchedPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftPlayer>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  function load() {
    recApi.listMyWatchedPlayers({ guildId })
      .then((res) => setPlayers(res.players))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load players to watch."));
  }
  useEffect(() => { load(); }, [guildId]);

  function startAdd() { setAdding(true); setDraft(EMPTY_DRAFT); }
  function cancel() { setAdding(false); setDraft(EMPTY_DRAFT); }

  async function save() {
    if (!draft.playerName.trim() || !draft.position.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await recApi.createMyWatchedPlayer({ guildId, playerName: draft.playerName.trim(), position: draft.position.trim(), classYear: draft.classYear || null });
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
    setError(null);
    try { await recApi.removeMyWatchedPlayer({ guildId, id }); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to remove the player."); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Players to Watch" onClose={onClose}>
      <p style={{ margin: "0 0 var(--space-3)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
        Add players on your team so they can be selected from a dropdown when tagging performances in a game result.
      </p>
      {error && <ErrorState message={error} />}
      {players === null ? (
        <p className="hub-empty">Loading…</p>
      ) : players.length === 0 && !adding ? (
        <p className="hub-empty">No players added yet.</p>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          {players.map((player) => (
            <div key={player.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-raised)" }}>
              <span>
                <strong>{player.playerName}</strong>{" "}
                <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  {player.position}{player.classYear ? ` · ${player.classYear}` : ""}
                </span>
              </span>
              <Button variant="danger" size="compact" disabled={busy} onClick={() => void remove(player.id)}><Trash2 size={14} /></Button>
            </div>
          ))}
        </div>
      )}
      {adding ? (
        <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <input className="form-input" placeholder="Player name" value={draft.playerName} onChange={(e) => setDraft({ ...draft, playerName: e.target.value })} />
          <input className="form-input" placeholder="Position" value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} />
          <select className="form-select" value={draft.classYear} onChange={(e) => setDraft({ ...draft, classYear: e.target.value as ClassYear | "" })}>
            {CLASS_YEAR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="primary" disabled={busy || !draft.playerName.trim() || !draft.position.trim()} onClick={() => void save()}>Save</Button>
            <Button variant="ghost" onClick={cancel}><X size={14} /> Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" style={{ marginTop: "var(--space-3)" }} onClick={startAdd}><Plus size={16} /> Add Player</Button>
      )}
    </Modal>
  );
}
