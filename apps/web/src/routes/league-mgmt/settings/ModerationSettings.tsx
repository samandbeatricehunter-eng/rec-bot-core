import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type ModerationData = {
  bans: Array<{ id: string; username: string | null; display_name: string | null; scope: string; reason: string; expires_at: string | null; active: boolean; currently_active: boolean }>;
  restrictions: Array<{ id: string; username: string | null; display_name: string | null; restriction_type: string; reason: string; expires_at: string | null; active: boolean; currently_active: boolean }>;
  audit: Array<{ id: string; action: string; target_username: string | null; reason: string | null; created_at: string }>;
};

export function ModerationSettings() {
  const { guildId } = useReadyAuth();
  const [data, setData] = useState<ModerationData | null>(null);
  const [targets, setTargets] = useState<Array<{ value: string; label: string; registered: boolean }>>([]);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<"week" | "season" | "permanent" | "custom">("week");
  const [customDays, setCustomDays] = useState("7");
  const [scope, setScope] = useState<"league" | "owner_all_leagues">("league");
  const [restrictionType, setRestrictionType] = useState<"wagers" | "highlights">("wagers");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => recApi.listModeration(guildId).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load moderation."));
  useEffect(() => { void reload(); void recApi.listModerationTargets(guildId).then((result) => setTargets(result.targets ?? [])).catch(() => setTargets([])); }, [guildId]);
  const durationDays = duration === "week" ? 7 : duration === "season" ? 120 : duration === "custom" ? Math.max(1, Number(customDays) || 1) : null;
  const expiresAt = durationDays ? new Date(Date.now() + durationDays * 86_400_000).toISOString() : null;

  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); setTarget(""); setReason(""); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Moderation action failed."); }
    finally { setBusy(false); }
  }

  return <div className="settings-moderation">
    {error ? <ErrorState message={error} /> : null}
    <Card>
      <h2>Ban or restrict a user</h2>
      <p className="form-hint">A league ban removes team access and membership. A league-scoped ban also bans the linked Discord account from this server. Owner-wide bans hide all of your leagues from that user.</p>
      <div className="form-field"><label className="form-label">Username or Discord user</label><select className="form-select" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Select a user</option>{targets.map((row) => <option key={`${row.value}:${row.label}`} value={row.value}>{row.label}</option>)}</select></div>
      <div className="form-field"><label className="form-label">Reason</label><textarea className="form-input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-field"><label className="form-label">Duration</label><select className="form-select" value={duration} onChange={(event) => setDuration(event.target.value as typeof duration)}><option value="week">1 Week</option><option value="season">1 Season</option><option value="permanent">Permanent</option><option value="custom">Custom (# of Days)</option></select>{duration === "custom" ? <input className="form-input" type="number" min={1} value={customDays} onChange={(event) => setCustomDays(event.target.value)} /> : null}</div>
      <div className="form-field"><label className="form-label">Ban scope</label><select className="form-select" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="league">This league + linked Discord server</option><option value="owner_all_leagues">All leagues I own + all linked servers</option></select></div>
      <div className="form-actions">
        <Button variant="danger" disabled={busy || !target.trim() || reason.trim().length < 3} onClick={() => void act(() => recApi.createModerationBan({ guildId, target, reason, scope, expiresAt }))}>Ban user</Button>
      </div>
      <hr />
      <div className="form-field"><label className="form-label">Restriction</label><select className="form-select" value={restrictionType} onChange={(event) => setRestrictionType(event.target.value as typeof restrictionType)}><option value="wagers">Wagers</option><option value="highlights">Highlight submissions</option></select></div>
      <Button variant="secondary" disabled={busy || !target.trim() || reason.trim().length < 3} onClick={() => void act(() => recApi.createModerationRestriction({ guildId, target, reason, restrictionType, expiresAt }))}>Apply restriction</Button>
    </Card>
    <Card><h2>Active bans</h2>{data?.bans.filter((row) => row.currently_active).map((row) => <div className="moderation-row" key={row.id}><span><strong>{row.username ?? row.display_name ?? "User"}</strong> · {row.scope}<small>{row.reason}</small></span><Button variant="secondary" disabled={busy} onClick={() => void act(() => recApi.liftModerationBan({ guildId, banId: row.id }))}>Lift</Button></div>)}{data && !data.bans.some((row) => row.currently_active) ? <p className="form-hint">No active bans.</p> : null}</Card>
    <Card><h2>Restrictions</h2>{data?.restrictions.filter((row) => row.currently_active).map((row) => <div className="moderation-row" key={row.id}><span><strong>{row.username ?? row.display_name ?? "User"}</strong> · {row.restriction_type}<small>{row.reason}</small></span><Button variant="secondary" disabled={busy} onClick={() => void act(() => recApi.liftModerationRestriction({ guildId, restrictionId: row.id }))}>Lift</Button></div>)}{data && !data.restrictions.some((row) => row.currently_active) ? <p className="form-hint">No active restrictions.</p> : null}</Card>
    <Card><h2>Audit log</h2>{data?.audit.map((row) => <div className="moderation-row" key={row.id}><span><strong>{row.action}</strong> · {row.target_username ?? "User"}<small>{row.reason ?? new Date(row.created_at).toLocaleString()}</small></span></div>)}</Card>
  </div>;
}
