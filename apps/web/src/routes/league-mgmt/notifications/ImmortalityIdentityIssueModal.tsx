import { useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { CommissionerNotification } from "../../../types/api.js";
import { Button } from "../../../components/ui/Button.js";
import { Modal } from "../../../components/ui/Modal.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type IdentityIssuePayload = {
  prospectId: string;
  status: "missing" | "ambiguous" | "stale";
  name: string;
  position: string;
  side: "offense" | "defense";
  note: string;
};

const STATUS_LABEL: Record<IdentityIssuePayload["status"], string> = {
  missing: "Not Found",
  ambiguous: "Ambiguous Match",
  stale: "Went Stale",
};

// Opened from a Notifications pending item (type "immortality_identity_issue") -- fires when
// an RTI prospect's placeholder never got adopted onto a real imported player (or the real
// player it was linked to is no longer on the active roster). The commissioner searches the
// current roster by the in-game name and picks the right entry; linking regrades every
// completed week's XP for this prospect against the newly-connected stats.
export function ImmortalityIdentityIssueModal({
  guildId, notification, onClose, onResolved,
}: {
  guildId: string;
  notification: CommissionerNotification;
  onClose: () => void;
  onResolved: () => void;
}) {
  const data = notification.payload as unknown as IdentityIssuePayload;
  const [query, setQuery] = useState(data.name ?? "");
  const [candidates, setCandidates] = useState<Awaited<ReturnType<typeof recApi.searchImmortalityIdentityRoster>>["candidates"]>([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setSearching(true); setMessage(null);
    try {
      const result = await recApi.searchImmortalityIdentityRoster({ guildId, query: query.trim() });
      setCandidates(result.candidates);
      setSearched(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }

  async function link(playerId: string) {
    setLinkingId(playerId); setMessage(null);
    try {
      await recApi.linkImmortalityIdentity({ guildId, prospectId: data.prospectId, playerId });
      onResolved();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setLinkingId(null);
    }
  }

  return (
    <Modal title="Identity Issue" onClose={onClose}>
      {message && <ErrorState message={message} />}
      <div className="settings-review-row">
        <h3 style={{ margin: "0 0 4px" }}>{data.name} — {data.position} ({data.side === "offense" ? "Offense" : "Defense"})</h3>
        <p className="form-hint" style={{ margin: "0 0 4px" }}>
          Status: <strong>{STATUS_LABEL[data.status]}</strong>
        </p>
        <p className="form-hint" style={{ margin: "0 0 12px" }}>{data.note}</p>

        <label className="form-label" htmlFor="identity-issue-search">Search the current roster</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            id="identity-issue-search"
            className="form-input"
            style={{ flex: 1 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
            placeholder="In-game player name"
          />
          <Button variant="secondary" disabled={searching || !query.trim()} onClick={() => void search()}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>

        {searched && candidates.length === 0 && (
          <p className="form-hint">No active roster players match that name.</p>
        )}

        {candidates.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {candidates.map((candidate) => (
              <div key={candidate.id} className="pending-item-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span>
                  {candidate.fullName} — {candidate.position}
                  {candidate.jerseyNumber != null ? ` #${candidate.jerseyNumber}` : ""}
                  {candidate.overallRating != null ? ` · ${candidate.overallRating} OVR` : ""}
                </span>
                <Button variant="primary" disabled={linkingId != null} onClick={() => void link(candidate.id)}>
                  {linkingId === candidate.id ? "Linking…" : "Link"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
