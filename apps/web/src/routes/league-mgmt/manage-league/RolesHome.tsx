import { useEffect, useMemo, useState } from "react";
import { roleDisplayTitle } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { RoleMgmtMember, RoleMgmtRoleKey } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

const LABELS: Record<RoleMgmtRoleKey, string> = { member: roleDisplayTitle("member"), compCommittee: roleDisplayTitle("co_commissioner"), commissioner: roleDisplayTitle("commissioner") };
const SITE_ASSIGNABLE_ROLES: RoleMgmtRoleKey[] = ["member", "compCommittee"];
type ResyncResult = { synced: Array<{ discordId: string; nickname: string }>; failed: Array<{ discordId: string; nickname: string; reason: string }>; skipped: Array<{ discordId: string; reason: string }> };

export function RolesHome() {
  const { guildId } = useReadyAuth();
  const [members, setMembers] = useState<RoleMgmtMember[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resyncBusy, setResyncBusy] = useState(false);
  const [resyncResult, setResyncResult] = useState<ResyncResult | null>(null);
  const load = () => recApi.listRoleMgmtMembers(guildId).then((r) => setMembers(r.members)).catch((e) => setError(e instanceof Error ? e.message : "Failed to load roles."));
  useEffect(() => { void load(); }, [guildId]);
  const groups = useMemo(() => (Object.keys(LABELS) as RoleMgmtRoleKey[]).map((role) => [role, (members ?? []).filter((m) => m.managedRole === role)] as const), [members]);
  async function change(member: RoleMgmtMember, roleKey: RoleMgmtRoleKey) {
    setBusy(member.discordId); setError(null);
    try { await recApi.setMemberRole({ guildId, discordId: member.discordId, roleKey }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to change role."); } finally { setBusy(null); }
  }
  async function resyncNicknames() {
    setResyncBusy(true); setResyncResult(null); setError(null);
    try { setResyncResult(await recApi.resyncNicknames(guildId)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to resync nicknames."); }
    finally { setResyncBusy(false); }
  }
  return <div><PageHeader title="Roles" subtitle="Linked users grouped by their current REC role. Changes save immediately." />
    {error && <ErrorState message={error} />}{!members && !error && <LoadingState />}
    <Card style={{ marginBottom: "var(--space-4)" }}>
      <h3 style={{ marginTop: 0 }}>Nicknames</h3>
      <p style={{ color: "var(--text-secondary)" }}>Force-sets every linked user's server nickname to their team name — use this if nicknames aren't updating on their own (new link, joining after being approved, or role changes).</p>
      <button type="button" className="btn btn-secondary" disabled={resyncBusy} onClick={() => void resyncNicknames()}>{resyncBusy ? "Syncing…" : "Resync Nicknames"}</button>
      {resyncResult && (
        <div style={{ marginTop: "var(--space-3)" }}>
          <p style={{ margin: 0 }}><strong>{resyncResult.synced.length}</strong> updated, <strong>{resyncResult.failed.length}</strong> failed, <strong>{resyncResult.skipped.length}</strong> skipped.</p>
          {resyncResult.failed.length > 0 && (
            <ul style={{ color: "var(--danger, #e05252)", margin: "8px 0 0" }}>
              {resyncResult.failed.map((row) => <li key={row.discordId}>&lt;@{row.discordId}&gt; → "{row.nickname}": {row.reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </Card>
    <div style={{ display: "grid", gap: "var(--space-4)" }}>{groups.map(([role, rows]) => <Card key={role}><h3 style={{ marginTop: 0 }}>{LABELS[role]} ({rows.length})</h3>
      <div style={{ display: "grid", gap: "var(--space-3)" }}>{rows.map((member) => <div key={member.discordId} className="inline-admin-row">
        <span><strong>{member.displayName}</strong>{member.displayName !== member.username && <small style={{ display: "block", color: "var(--text-secondary)" }}>{member.username}</small>}</span>
        {member.managedRole === "commissioner"
          ? <span className="badge badge-info">Head {roleDisplayTitle("commissioner")}</span>
          : <select className="form-select" aria-label={`Role for ${member.displayName}`} value={member.managedRole} disabled={busy === member.discordId} onChange={(e) => change(member, e.target.value as RoleMgmtRoleKey)}>{SITE_ASSIGNABLE_ROLES.map((key) => <option key={key} value={key}>{LABELS[key]}</option>)}</select>}
      </div>)}{rows.length === 0 && <p style={{ color: "var(--text-secondary)", margin: 0 }}>No linked users in this role.</p>}</div>
    </Card>)}</div>
  </div>;
}
