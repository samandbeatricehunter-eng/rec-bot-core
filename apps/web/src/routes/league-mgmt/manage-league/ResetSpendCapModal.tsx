import { useEffect, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { LinkedTeamRow } from "../../../types/api.js";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";

type Category = "core" | "non_core";

export function ResetSpendCapModal({
  guildId,
  onClose,
  onDone,
}: {
  guildId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [members, setMembers] = useState<LinkedTeamRow[] | null>(null);
  const [categories, setCategories] = useState<Category[]>(["core"]);
  const [scope, setScope] = useState<"all" | "targeted">("all");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    recApi.listLinkedUsersTeams(guildId).then((result) => {
      if (!cancelled) setMembers(result.linked);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load league members.");
    });
    return () => { cancelled = true; };
  }, [guildId]);

  function toggleCategory(category: Category) {
    setCategories((prev) => prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]);
  }

  function toggleUser(userId: string) {
    setSelectedUserIds((prev) => prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]);
  }

  const allConfirmed = scope === "targeted" || confirmText.trim().toLowerCase() === "reset";
  const canSubmit = categories.length > 0 && (scope === "all" ? allConfirmed : selectedUserIds.length > 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await recApi.resetAttributeCapSpend({
        guildId,
        categories,
        userIds: scope === "targeted" ? selectedUserIds : undefined,
      });
      onDone(`Reset ${categories.join(" and ")} spend for ${result.userCount} user${result.userCount === 1 ? "" : "s"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset the spend cap.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Reset Spend Cap" onClose={onClose}>
      <div className="hub-hero-action-modal">
        <p>
          Resets how much a player has spent toward this season's core/non-core attribute cap, so they can
          spend a fresh budget. This does not undo any attribute changes already applied — it only clears
          the cap counter.
        </p>
        <label className="form-field">
          <span className="form-label">Reset which cap</span>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input type="checkbox" checked={categories.includes("core")} onChange={() => toggleCategory("core")} /> Core
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input type="checkbox" checked={categories.includes("non_core")} onChange={() => toggleCategory("non_core")} /> Non-core
            </label>
          </div>
        </label>
        <label className="form-field">
          <span className="form-label">Who</span>
          <select className="form-input" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} disabled={busy}>
            <option value="all">Everyone in the league</option>
            <option value="targeted">Specific user(s)</option>
          </select>
        </label>
        {scope === "targeted" ? (
          <div className="form-field">
            <span className="form-label">Select users</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "220px", overflowY: "auto" }}>
              {(members ?? []).map((row) => (
                <label key={row.user_id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input type="checkbox" checked={selectedUserIds.includes(row.user_id)} onChange={() => toggleUser(row.user_id)} />
                  {row.user?.display_name ?? row.discordAccount?.username ?? "Unknown"}{row.team ? ` — ${row.team.name}` : ""}
                </label>
              ))}
              {members && !members.length ? <p className="form-hint">No linked users found.</p> : null}
            </div>
          </div>
        ) : (
          <label className="form-field">
            <span className="form-label">Type RESET to confirm resetting every user in the league</span>
            <input className="form-input" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="RESET" disabled={busy} />
          </label>
        )}
        {error ? <p className="hub-transfer-status">{error}</p> : null}
        <Button variant="danger" disabled={busy || !canSubmit} onClick={() => void submit()}>
          {busy ? "Resetting…" : "Reset Spend Cap"}
        </Button>
      </div>
    </Modal>
  );
}
