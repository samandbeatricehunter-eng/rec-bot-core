import { useEffect, useMemo, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { SearchInput } from "../../../components/ui/SearchInput.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import type { LinkedTeamRow, TeamLinkMatrix } from "../../../types/api.js";

function isRealDiscordId(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{5,}$/.test(value));
}

function coachLabel(row: LinkedTeamRow) {
  const accountName = row.discordAccount?.global_name || row.discordAccount?.username;
  const person = row.user?.display_name || accountName || row.discordId;
  const team = row.team?.name;
  return team ? `${person} — ${team}` : String(person);
}

export function RelinkDiscordModal({
  guildId,
  onClose,
  onDone,
}: {
  guildId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [linkedRows, setLinkedRows] = useState<LinkedTeamRow[] | null>(null);
  const [matrix, setMatrix] = useState<TeamLinkMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [fromDiscordId, setFromDiscordId] = useState<string | null>(null);
  const [toDiscordId, setToDiscordId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([recApi.listLinkedUsersTeams(guildId), recApi.getTeamLinkMatrix(guildId)])
      .then(([linked, nextMatrix]) => {
        setLinkedRows(linked.linked);
        setMatrix(nextMatrix);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load linked users."));
  }, [guildId]);

  const linked = useMemo(() => {
    if (!linkedRows) return [];
    const seen = new Set<string>();
    const rows: Array<{ discordId: string; label: string }> = [];
    for (const row of linkedRows) {
      if (!isRealDiscordId(row.discordId) || seen.has(row.discordId)) continue;
      seen.add(row.discordId);
      rows.push({ discordId: row.discordId, label: coachLabel(row) });
    }
    return rows;
  }, [linkedRows]);

  const linkedIds = useMemo(() => new Set(linked.map((row) => row.discordId)), [linked]);

  const filteredLinked = useMemo(() => {
    const q = fromQuery.trim().toLowerCase();
    return q ? linked.filter((row) => row.label.toLowerCase().includes(q)) : linked;
  }, [linked, fromQuery]);

  const filteredMembers = useMemo(() => {
    if (!matrix) return [];
    const q = toQuery.trim().toLowerCase();
    return matrix.users.filter((user) => {
      if (user.discordId === fromDiscordId) return false;
      if (linkedIds.has(user.discordId)) return false;
      if (!q) return true;
      return `${user.displayName} ${user.username} ${user.discordId}`.toLowerCase().includes(q);
    });
  }, [matrix, toQuery, fromDiscordId, linkedIds]);

  async function submit() {
    if (!fromDiscordId || !toDiscordId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recApi.relinkDiscord({ guildId, fromDiscordId, toDiscordId });
      onDone(`Relinked ${result.displayName || result.username || "member"}. Teams, wallet, and stats stayed on the same REC profile.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to relink Discord.");
      setBusy(false);
    }
  }

  if (error && !matrix && !linkedRows) return <ErrorState message={error} />;
  if (!matrix || !linkedRows) return <LoadingState />;

  return (
    <Modal title="Relink Discord" onClose={onClose}>
      <p className="form-hint" style={{ marginTop: 0 }}>
        Use this when a coach&apos;s Discord was banned or replaced. Pick the currently linked
        account, then the new Discord member already in this server. REC keeps their team, wallet, and stats.
        The new Discord cannot already belong to a different REC profile.
      </p>
      {error ? <p className="form-hint" style={{ color: "var(--error)" }}>{error}</p> : null}
      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ marginTop: 0 }}>Currently linked</h3>
          <SearchInput placeholder="Search linked coaches…" value={fromQuery} onChange={(e) => setFromQuery(e.target.value)} style={{ marginBottom: "var(--space-3)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", maxHeight: 280, overflowY: "auto" }}>
            {filteredLinked.map((row) => (
              <button
                key={row.discordId}
                type="button"
                className={fromDiscordId === row.discordId ? "btn btn-secondary" : "btn btn-ghost"}
                style={{ justifyContent: "flex-start", textAlign: "left" }}
                onClick={() => setFromDiscordId(row.discordId)}
              >
                {row.label}
              </button>
            ))}
            {!filteredLinked.length ? <p className="form-hint">No linked coaches match.</p> : null}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ marginTop: 0 }}>New Discord member</h3>
          <SearchInput placeholder="Search server members…" value={toQuery} onChange={(e) => setToQuery(e.target.value)} style={{ marginBottom: "var(--space-3)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", maxHeight: 280, overflowY: "auto" }}>
            {filteredMembers.map((user) => (
              <button
                key={user.discordId}
                type="button"
                className={toDiscordId === user.discordId ? "btn btn-secondary" : "btn btn-ghost"}
                style={{ justifyContent: "flex-start", textAlign: "left" }}
                onClick={() => setToDiscordId(user.discordId)}
              >
                {user.displayName || user.username}
              </button>
            ))}
            {!filteredMembers.length ? <p className="form-hint">No unlinked server members match.</p> : null}
          </div>
        </div>
      </div>
      <div style={{ marginTop: "var(--space-4)", display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || !fromDiscordId || !toDiscordId} onClick={() => void submit()}>
          {busy ? "Relinking…" : "Relink Discord"}
        </Button>
      </div>
    </Modal>
  );
}
