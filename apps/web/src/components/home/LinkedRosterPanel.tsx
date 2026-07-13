import { useEffect, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { LinkedRosterEntry } from "../../types/api.js";
import { Card } from "../ui/Card.js";
import { LoadingState } from "../ui/LoadingState.js";
import { ErrorState } from "../ui/ErrorState.js";

// Home page's left column — "who's linked to what team, and how's their season going," at a
// glance. Ordered by power ranking (see getLinkedRoster in team-schedule-summary.service.ts,
// which reuses computePowerRankings rather than re-deriving the ranking formula), with the
// change since the last snapshot shown in parentheses next to the rank.
export function LinkedRosterPanel() {
  const { guildId } = useReadyAuth();
  const [entries, setEntries] = useState<LinkedRosterEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recApi
      .getLinkedRoster(guildId)
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load roster."));
  }, [guildId]);

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Linked Coaches</h2>
      {error && <ErrorState message={error} />}
      {!entries && !error && <LoadingState />}
      {entries && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", maxHeight: 520, overflowY: "auto", paddingRight: "var(--space-2)" }}>
          {entries.map((e) => (
            <div
              key={e.teamId}
              style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-1)", borderBottom: "1px solid var(--border)" }}
            >
              <div style={{ flexShrink: 0, minWidth: 60, textAlign: "right" }}>
                <span style={{ fontWeight: 700, color: "var(--gold)" }}>{e.powerRank != null ? `#${e.powerRank}` : "—"}</span>
                {e.rankChange != null && e.rankChange !== 0 && (
                  <div style={{ fontSize: "var(--text-xs)", color: e.rankChange > 0 ? "var(--success)" : "var(--error)" }}>
                    ({e.rankChange > 0 ? "+" : ""}{e.rankChange})
                  </div>
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.userDisplayName}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.teamName}</div>
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", flexShrink: 0, whiteSpace: "nowrap" }}>
                {e.record.wins}-{e.record.losses}{e.record.ties > 0 ? `-${e.record.ties}` : ""}
              </div>
            </div>
          ))}
          {entries.length === 0 && <p style={{ color: "var(--text-secondary)", margin: 0 }}>No teams are linked to a user yet.</p>}
        </div>
      )}
    </Card>
  );
}
