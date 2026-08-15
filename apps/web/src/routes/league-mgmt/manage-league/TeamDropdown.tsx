import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Calendar, UserPlus, UserMinus, Shield, Gavel, UserCog, Search } from "lucide-react";
import type { TeamManagementSummaryRow } from "../../../types/api.js";
import { Button } from "../../../components/ui/Button.js";
import { Modal } from "../../../components/ui/Modal.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { SearchInput } from "../../../components/ui/SearchInput.js";
import { recApi } from "../../../lib/rec-api-client.js";

type Props = {
  team: TeamManagementSummaryRow;
  guildId: string;
  leagueId: string;
  isMadden: boolean;
  onAction: (message: string) => void;
};

// Per-team action menu in the division cards. Menu contents depend on team state:
//   pending link request -> Approve/Deny (+ the unlinked options below)
//   unlinked            -> the three invite options
//   linked              -> Change Role / Restriction / Remove User
// Edit Schedule and Edit Roster/Picks are always present.
export function TeamDropdown({ team, guildId, leagueId, onAction }: Props) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function closeAll() {
    setOpen(false);
    setModal(null);
  }

  const hasLinkedUser = Boolean(team.linkedUser);
  const hasPendingRequest = Boolean(team.pendingRequest);
  const requesterLabel = team.pendingRequest
    ? team.pendingRequest.displayName ?? team.pendingRequest.discordUsername ?? "a user"
    : null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-ghost"
        aria-label={`Actions for ${team.name}`}
        style={{ padding: "var(--space-1) var(--space-2)", display: "flex", alignItems: "center", gap: "4px", fontSize: "var(--text-xs)" }}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown size={14} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            zIndex: 50,
            minWidth: 210,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-lg)",
            padding: "var(--space-1) 0",
          }}
        >
          {hasPendingRequest ? (
            <>
              <DropdownItem
                label={`Approve Link Request${requesterLabel ? ` — ${requesterLabel}` : ""}`}
                icon={<UserPlus size={14} />}
                onClick={() => setModal("approve-request")}
              />
              <DropdownItem
                label={`Deny Link Request${requesterLabel ? ` — ${requesterLabel}` : ""}`}
                icon={<UserMinus size={14} />}
                onClick={() => setModal("deny-request")}
                danger
              />
              <DropdownDivider />
            </>
          ) : !hasLinkedUser ? (
            <>
              <DropdownItem label="Invite Friend" icon={<UserPlus size={14} />} onClick={() => setModal("invite-friend")} />
              <DropdownItem label="Invite by Username" icon={<Search size={14} />} onClick={() => setModal("invite-username")} />
              <DropdownItem label="Invite from Discord Server" icon={<UserPlus size={14} />} onClick={() => setModal("invite-discord")} />
              <DropdownDivider />
            </>
          ) : (
            <>
              {team.linkedUser?.role !== "commissioner" && (
                <DropdownItem label="Change Role" icon={<UserCog size={14} />} onClick={() => setModal("change-role")} />
              )}
            </>
          )}

          <DropdownItem
            label="Edit Schedule"
            icon={<Calendar size={14} />}
            onClick={() => {
              closeAll();
              navigate(`/league-mgmt/manage-league/${team.id}`);
            }}
          />
          <DropdownItem
            label="Edit Roster/Picks"
            icon={<Shield size={14} />}
            onClick={() => {
              closeAll();
              navigate(`/league-mgmt/manage-league/rosters/${team.id}`);
            }}
          />

          {hasLinkedUser && (
            <>
              <DropdownDivider />
              <DropdownItem label="Restriction/Suspension" icon={<Gavel size={14} />} onClick={() => setModal("restriction")} />
              <DropdownItem label="Remove User" icon={<UserMinus size={14} />} onClick={() => setModal("remove-user")} danger />
            </>
          )}
        </div>
      )}

      {modal === "approve-request" && team.pendingRequest && (
        <ConfirmModal
          title="Approve Link Request"
          message={`Link ${requesterLabel} to ${team.name}?`}
          confirmLabel="Approve"
          onConfirm={async () => {
            await recApi.approveTeamRequest({ guildId, leagueId, requestId: team.pendingRequest!.requestId });
            onAction(`${requesterLabel} was linked to ${team.name}.`);
            closeAll();
          }}
          onClose={closeAll}
        />
      )}
      {modal === "deny-request" && team.pendingRequest && (
        <ConfirmModal
          title="Deny Link Request"
          message={`Deny ${requesterLabel}'s request to link ${team.name}?`}
          confirmLabel="Deny"
          danger
          onConfirm={async () => {
            await recApi.rejectTeamRequest({ guildId, leagueId, requestId: team.pendingRequest!.requestId });
            onAction(`Denied the link request for ${team.name}.`);
            closeAll();
          }}
          onClose={closeAll}
        />
      )}
      {modal === "remove-user" && (
        <RemoveUserModal team={team} guildId={guildId} onAction={onAction} onClose={closeAll} />
      )}
      {modal === "change-role" && team.linkedUser && (
        <ChangeRoleModal team={team} guildId={guildId} leagueId={leagueId} onAction={onAction} onClose={closeAll} />
      )}
      {(modal === "invite-friend" || modal === "invite-username" || modal === "invite-discord") && (
        <InviteModal
          mode={modal}
          team={team}
          guildId={guildId}
          leagueId={leagueId}
          onAction={onAction}
          onClose={closeAll}
        />
      )}
      {modal === "restriction" && (
        <RestrictionModal team={team} onAction={onAction} onClose={closeAll} />
      )}
    </div>
  );
}

function DropdownItem({ label, icon, onClick, danger }: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        width: "100%",
        padding: "var(--space-2) var(--space-3)",
        justifyContent: "flex-start",
        fontSize: "var(--text-sm)",
        textAlign: "left",
        color: danger ? "var(--error)" : undefined,
      }}
      onClick={onClick}
    >
      {icon}
      <span style={{ whiteSpace: "normal" }}>{label}</span>
    </button>
  );
}

function DropdownDivider() {
  return <div style={{ height: 1, background: "var(--border)", margin: "var(--space-1) 0" }} />;
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {error && <ErrorState message={error} />}
      <p>{message}</p>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        <Button variant={danger ? "danger" : "primary"} disabled={busy} onClick={() => void handleConfirm()}>
          {busy ? "Working…" : confirmLabel}
        </Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

// ── Invites ──

type InviteCandidate = { userId: string; label: string; sublabel: string | null };

function InviteModal({
  mode,
  team,
  guildId,
  leagueId,
  onAction,
  onClose,
}: {
  mode: "invite-friend" | "invite-username" | "invite-discord";
  team: TeamManagementSummaryRow;
  guildId: string;
  leagueId: string;
  onAction: (message: string) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<InviteCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // Friends and Discord-server lists load once; username search refires on each keystroke.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (mode === "invite-friend") {
          const result = await recApi.listFriends(guildId);
          if (!cancelled) setCandidates(result.accepted.map((f) => ({ userId: f.peer.userId, label: f.peer.displayName, sublabel: f.peer.username })));
        } else if (mode === "invite-discord") {
          const result = await recApi.listDiscordInviteTargets({ guildId, leagueId });
          if (!cancelled) setCandidates(result.members.map((m) => ({ userId: m.userId, label: m.displayName, sublabel: m.username ?? null })));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load invite candidates.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [mode, guildId, leagueId]);

  useEffect(() => {
    if (mode !== "invite-username") return;
    const trimmed = query.trim();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await recApi.searchLeagueInviteTargets({ guildId, query: trimmed || undefined, limit: 20 });
        setCandidates(result.users.map((u) => ({ userId: u.userId, label: u.displayName, sublabel: u.username })));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [mode, query, guildId]);

  async function invite(candidate: InviteCandidate) {
    setBusyUserId(candidate.userId);
    setError(null);
    try {
      await recApi.sendLeagueTeamInvite({
        guildId,
        leagueId,
        userId: candidate.userId,
        teamId: team.id,
        message: `You've been invited to take over the ${team.name}!`,
      });
      setSentTo(candidate.label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send the invite.");
    } finally {
      setBusyUserId(null);
    }
  }

  const title =
    mode === "invite-friend" ? `Invite a Friend to ${team.name}`
    : mode === "invite-username" ? `Invite by Username to ${team.name}`
    : `Invite from Discord to ${team.name}`;

  return (
    <Modal title={title} onClose={onClose}>
      {error && <ErrorState message={error} />}
      {sentTo ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <p style={{ margin: 0 }}>
            Invite sent to <strong>{sentTo}</strong>. They can accept from their site inbox — accepting links them to {team.name}.
          </p>
          <Button variant="secondary" onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {mode === "invite-username" && (
            <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a username to search…" />
          )}
          {loading && <LoadingState label="Loading…" />}
          {!loading && candidates.length === 0 && (
            <p className="form-hint" style={{ margin: 0 }}>
              {mode === "invite-friend"
                ? "You have no friends on REC yet. Use Invite by Username instead."
                : mode === "invite-discord"
                  ? "No eligible Discord server members found — members need a linked site account and an open team slot."
                  : "No matching members found."}
            </p>
          )}
          {!loading && candidates.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxHeight: 320, overflowY: "auto" }}>
              {candidates.map((candidate) => (
                <div key={candidate.userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-2)" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{candidate.label}</div>
                    {candidate.sublabel && candidate.sublabel !== candidate.label && (
                      <div style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>{candidate.sublabel}</div>
                    )}
                  </div>
                  <Button size="compact" disabled={busyUserId === candidate.userId} onClick={() => void invite(candidate)}>
                    {busyUserId === candidate.userId ? "Inviting…" : "Invite"}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      )}
    </Modal>
  );
}

// ── Remove / Role / Restriction ──

function RemoveUserModal({
  team,
  guildId,
  onAction,
  onClose,
}: {
  team: TeamManagementSummaryRow;
  guildId: string;
  onAction: (message: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await recApi.unlinkTeam({ guildId, teamId: team.id });
      onAction(`Removed ${team.linkedUser?.displayName ?? "user"} from ${team.name}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove user.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Remove User from ${team.name}`} onClose={onClose}>
      {error && <ErrorState message={error} />}
      <p>Choose how to remove <strong>{team.linkedUser?.displayName}</strong> from {team.name}:</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", margin: "var(--space-3) 0" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <input type="radio" name="remove-option" defaultChecked onChange={() => {}} />
          <span>Remove team link only (clears this team's pending purchases)</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", opacity: 0.5 }}>
          <input type="radio" name="remove-option" disabled />
          <span>Remove &amp; kick from Discord (requires a linked server)</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", opacity: 0.5 }}>
          <input type="radio" name="remove-option" disabled />
          <span>Remove &amp; ban from league</span>
        </label>
      </div>
      <p className="form-hint">Kick and ban options require the league's Discord server link — coming soon.</p>
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button variant="danger" disabled={busy} onClick={() => void handleRemove()}>
          {busy ? "Removing…" : "Remove User"}
        </Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

function ChangeRoleModal({
  team,
  guildId,
  leagueId,
  onAction,
  onClose,
}: {
  team: TeamManagementSummaryRow;
  guildId: string;
  leagueId: string;
  onAction: (message: string) => void;
  onClose: () => void;
}) {
  const currentRole = team.linkedUser?.role === "co_commissioner" ? "co_commissioner" : "member";
  const [role, setRole] = useState<"member" | "co_commissioner">(currentRole);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await recApi.updateLeagueMemberRole({ guildId, leagueId, userId: team.linkedUser!.userId, role });
      onAction(`Changed ${team.linkedUser?.displayName}'s role to ${role === "co_commissioner" ? "Co-Commissioner" : "Member"}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Change Role — ${team.linkedUser?.displayName ?? "User"}`} onClose={onClose}>
      {error && <ErrorState message={error} />}
      <div className="form-field">
        <label className="form-label" htmlFor="role-select">Role</label>
        <select id="role-select" className="form-select" value={role} onChange={(e) => setRole(e.target.value as "member" | "co_commissioner")}>
          <option value="member">Member</option>
          <option value="co_commissioner">Co-Commissioner</option>
        </select>
      </div>
      {confirming && role !== currentRole ? (
        <>
          <p>Confirm: change {team.linkedUser?.displayName} to <strong>{role === "co_commissioner" ? "Co-Commissioner" : "Member"}</strong>?</p>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
            <Button disabled={busy} onClick={() => void handleSave()}>{busy ? "Saving…" : "Confirm"}</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Back</Button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button disabled={busy || role === currentRole} onClick={() => setConfirming(true)}>Save Role</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      )}
    </Modal>
  );
}

function RestrictionModal({
  team,
  onAction,
  onClose,
}: {
  team: TeamManagementSummaryRow;
  onAction: (message: string) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState("restriction");
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={`Restriction/Suspension — ${team.name}`} onClose={onClose}>
      <div className="form-field">
        <label className="form-label" htmlFor="restriction-type">Type</label>
        <select id="restriction-type" className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="restriction">Restriction</option>
          <option value="suspension">Suspension</option>
        </select>
      </div>
      <p className="form-hint">Detailed restriction, wager, and suspension controls (plus ending active ones) live under Settings &gt; Bans &amp; Restrictions.</p>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        <Button disabled={busy} onClick={() => { onAction(`Use Settings > Bans & Restrictions to manage ${type}s for ${team.name}.`); onClose(); }}>
          Open Settings
        </Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}
