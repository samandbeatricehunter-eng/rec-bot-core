import { useEffect, useState } from "react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { RosterEditProposal } from "../../../types/api.js";
import { Button } from "../../../components/ui/Button.js";
import { Card } from "../../../components/ui/Card.js";

function describeChanges(changes: RosterEditProposal["proposed_changes"]): string {
  const lines: string[] = [];
  if (changes.position !== undefined) lines.push(`Position: ${changes.position}`);
  if (changes.jerseyNumber !== undefined) lines.push(`Jersey #: ${changes.jerseyNumber ?? "—"}`);
  if (changes.devTrait !== undefined) lines.push(`Dev trait: ${changes.devTrait ?? "—"}`);
  if (changes.archetype !== undefined) lines.push(`Archetype: ${changes.archetype ?? "—"}`);
  if (changes.attributes) {
    for (const [code, value] of Object.entries(changes.attributes)) lines.push(`${code.toUpperCase()}: ${value}`);
  }
  return lines.join(" · ") || "No changes specified.";
}

// Manual Entry mode's commissioner side of self-service roster editing — mirrors
// CustomPlayerReviewQueue's list-and-approve/reject pattern, but far simpler: a proposal is
// just a field diff, not an evaluated economy purchase.
export function RosterEditProposalQueue({ guildId }: { guildId: string }) {
  const [proposals, setProposals] = useState<RosterEditProposal[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const result = await recApi.listRosterEditProposals({ guildId, manage: true });
    setProposals((result.proposals ?? []).filter((p) => p.status === "pending_review"));
  }
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : String(error))); }, [guildId]);

  async function review(proposalId: string, action: "approve" | "reject") {
    if (action === "reject" && !notes[proposalId]?.trim()) { setMessage("A rejection reason is required."); return; }
    setBusy(proposalId); setMessage(null);
    try {
      await recApi.reviewRosterEditProposal({ guildId, proposalId, action, note: notes[proposalId]?.trim() || undefined });
      setMessage(action === "approve" ? "Roster edit approved and applied." : "Roster edit proposal rejected.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  }

  return (
    <Card>
      <h3>Roster Edit Proposals</h3>
      <p className="form-hint">Coaches propose changes to their own players in Manual Entry mode. Approving applies the change immediately.</p>
      {message && <p>{message}</p>}
      {!proposals.length ? <p className="form-hint">No roster edit proposals are awaiting review.</p> : proposals.map((proposal) => (
        <div key={proposal.id} className="settings-review-row">
          <div>
            <strong>{proposal.player?.full_name ?? "Player"}</strong>{proposal.player?.position ? ` · ${proposal.player.position}` : ""}{proposal.team?.name ? ` — ${proposal.team.name}` : ""}
            <p className="form-hint">{describeChanges(proposal.proposed_changes)}</p>
          </div>
          <label className="form-field">
            <span className="form-label">Note (required to reject)</span>
            <input className="form-input" value={notes[proposal.id] ?? ""} onChange={(e) => setNotes((current) => ({ ...current, [proposal.id]: e.target.value }))} />
          </label>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="primary" size="compact" disabled={busy === proposal.id} onClick={() => void review(proposal.id, "approve")}>Approve</Button>
            <Button variant="danger" size="compact" disabled={busy === proposal.id} onClick={() => void review(proposal.id, "reject")}>Reject</Button>
          </div>
        </div>
      ))}
    </Card>
  );
}
