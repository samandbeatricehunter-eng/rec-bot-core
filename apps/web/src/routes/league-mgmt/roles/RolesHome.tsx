import { useEffect, useMemo, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { RoleMgmtMember, RoleMgmtRoleKey } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { SearchInput } from "../../../components/ui/SearchInput.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";

const ROLE_LABELS: Record<RoleMgmtRoleKey, string> = {
  member: "REC League Member",
  compCommittee: "REC League Comp. Committee (Co-Commissioner)",
  commissioner: "REC League Commissioner",
};

// Searchable checklist instead of Discord's forced 25-per-page select menu (apps/bot/src/
// index-timeout.ts's role-mgmt flow) — same underlying grant/revoke, better for guilds with
// more than a screenful of members.
export function RolesHome() {
  const { guildId } = useReadyAuth();
  const [members, setMembers] = useState<RoleMgmtMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roleKey, setRoleKey] = useState<RoleMgmtRoleKey>("member");
  const [action, setAction] = useState<"add" | "remove">("add");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    recApi
      .listRoleMgmtMembers(guildId)
      .then((res) => setMembers(res.members))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load guild members."));
  }, [guildId]);

  const filtered = useMemo(() => {
    if (!members) return [];
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.displayName.toLowerCase().includes(q) || m.username.toLowerCase().includes(q));
  }, [members, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleApply() {
    setBusy(true);
    setError(null);
    setNotice(null);
    let succeeded = 0;
    const failed: string[] = [];
    for (const id of selected) {
      try {
        await recApi.updateMemberRole({ guildId, discordId: id, roleKey, action });
        succeeded += 1;
      } catch (err) {
        failed.push(`${id}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    setBusy(false);
    setSelected(new Set());
    setNotice(`${action === "add" ? "Granted" : "Revoked"} ${ROLE_LABELS[roleKey]} for ${succeeded} member(s).`);
    if (failed.length) setError(failed.join("; "));
  }

  return (
    <div>
      <PageHeader title="Roles" subtitle="Grant or revoke REC League roles for members of this server." />
      {notice && <p style={{ color: "var(--success)", marginTop: 0 }}>{notice}</p>}
      {error && <ErrorState message={error} />}
      {!members && !error && <LoadingState />}

      {members && (
        <>
          <Card style={{ marginBottom: "var(--space-4)" }}>
            <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
              <div className="form-field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
                <label className="form-label" htmlFor="role-select">Role</label>
                <select id="role-select" className="form-select" value={roleKey} onChange={(e) => setRoleKey(e.target.value as RoleMgmtRoleKey)}>
                  {(Object.keys(ROLE_LABELS) as RoleMgmtRoleKey[]).map((key) => (
                    <option key={key} value={key}>{ROLE_LABELS[key]}</option>
                  ))}
                </select>
              </div>
              <div className="form-field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
                <label className="form-label" htmlFor="action-select">Action</label>
                <select id="action-select" className="form-select" value={action} onChange={(e) => setAction(e.target.value as "add" | "remove")}>
                  <option value="add">Grant</option>
                  <option value="remove">Revoke</option>
                </select>
              </div>
            </div>
            <SearchInput placeholder="Search members…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Card>

          <Card>
            <div style={{ maxHeight: 400, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {filtered.map((m) => (
                <label key={m.discordId} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <input type="checkbox" checked={selected.has(m.discordId)} onChange={() => toggle(m.discordId)} disabled={busy} />
                  <span>{m.displayName} {m.displayName !== m.username && <span style={{ color: "var(--text-secondary)" }}>({m.username})</span>}</span>
                </label>
              ))}
              {filtered.length === 0 && <p style={{ color: "var(--text-secondary)", margin: 0 }}>No members match.</p>}
            </div>
          </Card>

          <div style={{ marginTop: "var(--space-4)" }}>
            <Tooltip text={roleKey === "commissioner" && action === "remove" ? "You can't remove your own Commissioner role from here." : "Applies the selected action to every checked member."}>
              <Button
                variant={action === "remove" ? "danger" : "primary"}
                onClick={handleApply}
                disabled={busy || selected.size === 0}
              >
                {busy ? "Applying…" : `${action === "add" ? "Grant" : "Revoke"} for ${selected.size} selected`}
              </Button>
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
}
