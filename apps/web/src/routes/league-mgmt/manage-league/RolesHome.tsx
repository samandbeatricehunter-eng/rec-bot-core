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
export function RolesHome() {
  const { guildId } = useReadyAuth();
  const [members, setMembers] = useState<RoleMgmtMember[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => recApi.listRoleMgmtMembers(guildId).then((r) => setMembers(r.members)).catch((e) => setError(e instanceof Error ? e.message : "Failed to load roles."));
  useEffect(() => { void load(); }, [guildId]);
  const groups = useMemo(() => (Object.keys(LABELS) as RoleMgmtRoleKey[]).map((role) => [role, (members ?? []).filter((m) => m.managedRole === role)] as const), [members]);
  async function change(member: RoleMgmtMember, roleKey: RoleMgmtRoleKey) {
    setBusy(member.discordId); setError(null);
    try { await recApi.setMemberRole({ guildId, discordId: member.discordId, roleKey }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to change role."); } finally { setBusy(null); }
  }
  return <div><PageHeader title="Roles" subtitle="Linked users grouped by their current REC role. Changes save immediately." />
    {error && <ErrorState message={error} />}{!members && !error && <LoadingState />}
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
