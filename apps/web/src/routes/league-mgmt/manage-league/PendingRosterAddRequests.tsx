import { useEffect, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type RosterAddRequest = { id: string; header: string; summary: string; payload: any; requester_discord_id: string | null; created_at: string };

// The "Edit Roster" quick-action's approval queue — a non-commissioner's submitted addition
// sits here until a commissioner approves (inserts into the roster) or denies (requires a
// reason, deletes the request) it. See roster-add-requests.service.ts.
export function PendingRosterAddRequests({ guildId }: { guildId: string }) {
  const [requests, setRequests] = useState<RosterAddRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");

  function load() {
    recApi.listRosterAddRequests(guildId)
      .then((res) => setRequests(res.requests))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load pending roster additions."));
  }

  useEffect(load, [guildId]);

  async function approve(requestId: string) {
    setBusyId(requestId);
    setError(null);
    try {
      await recApi.approveRosterAddRequest({ guildId, requestId });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve request.");
    } finally {
      setBusyId(null);
    }
  }

  async function deny(requestId: string) {
    if (!denyReason.trim()) return;
    setBusyId(requestId);
    setError(null);
    try {
      await recApi.denyRosterAddRequest({ guildId, requestId, reason: denyReason.trim() });
      setDenyingId(null);
      setDenyReason("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deny request.");
    } finally {
      setBusyId(null);
    }
  }

  if (!requests || requests.length === 0) return error ? <ErrorState message={error} /> : null;

  return (
    <Card style={{ marginBottom: "var(--space-4)" }}>
      <h3 style={{ margin: "0 0 var(--space-3)" }}>Pending Roster Additions</h3>
      {error && <ErrorState message={error} />}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {requests.map((request) => (
          <div key={request.id} style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{request.header}</p>
            <p style={{ margin: "4px 0 var(--space-2)", color: "var(--text-secondary)" }}>{request.summary}</p>
            {denyingId === request.id ? (
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <input className="form-input" placeholder="Reason for denial" value={denyReason} onChange={(event) => setDenyReason(event.target.value)} style={{ flex: 1, minWidth: 200 }} />
                <Button variant="danger" disabled={busyId === request.id || !denyReason.trim()} onClick={() => void deny(request.id)}>Confirm Deny</Button>
                <Button variant="ghost" onClick={() => { setDenyingId(null); setDenyReason(""); }}>Cancel</Button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button variant="primary" disabled={busyId === request.id} onClick={() => void approve(request.id)}>{busyId === request.id ? "Approving…" : "Approve"}</Button>
                <Button variant="danger" disabled={busyId === request.id} onClick={() => setDenyingId(request.id)}>Deny</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
