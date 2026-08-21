import { useState } from "react";
import { ChevronDown, ChevronRight, Coins, Trophy, Wrench } from "lucide-react";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { Card } from "../../../components/ui/Card.js";
import { RepairGameChannelsModal } from "./RepairGameChannelsModal.js";
import { ManageGameWagersModal } from "./ManageGameWagersModal.js";
import { ManageGotwToolsModal } from "./ManageGotwToolsModal.js";

export function TroubleshootModal({
  guildId,
  onClose,
}: {
  guildId: string;
  onClose: () => void;
}) {
  const [repairOpen, setRepairOpen] = useState(false);
  const [wagersOpen, setWagersOpen] = useState(false);
  const [gotwOpen, setGotwOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (repairOpen) {
    return (
      <RepairGameChannelsModal
        guildId={guildId}
        onClose={() => setRepairOpen(false)}
        onDone={(message) => {
          setRepairOpen(false);
          setNotice(message);
        }}
      />
    );
  }
  if (wagersOpen) return <ManageGameWagersModal guildId={guildId} onClose={() => setWagersOpen(false)} onDone={(message) => { setWagersOpen(false); setNotice(message); }} />;
  if (gotwOpen) {
    return (
      <ManageGotwToolsModal
        guildId={guildId}
        onClose={() => setGotwOpen(false)}
        onDone={(message) => {
          setGotwOpen(false);
          setNotice(message);
        }}
      />
    );
  }

  return (
    <Modal title="Tools" onClose={onClose}>
      {notice && (
        <p className="form-hint" style={{ color: "var(--gold)", marginBottom: "var(--space-3)" }}>
          {notice}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <CollapsibleSection title="Repair Game Channels">
          <p className="form-hint" style={{ marginTop: 0 }}>
            Wipe and recreate Discord game channels for the current week. Use this if channels
            are missing, misnamed, or out of sync with the schedule.
          </p>
          <Button variant="secondary" onClick={() => setRepairOpen(true)}>
            <Wrench size={14} /> Open Repair Tool
          </Button>
        </CollapsibleSection>
        <CollapsibleSection title="Game of the Week">
          <p className="form-hint" style={{ marginTop: 0 }}>
            Close voting when a GOTW started without a stream, or clear logged votes if a Force Win
            or Fair Sim was settled as a real pick.
          </p>
          <Button variant="secondary" onClick={() => setGotwOpen(true)}>
            <Trophy size={14} /> Open GOTW Tools
          </Button>
        </CollapsibleSection>
        <CollapsibleSection title="Close or Refund Wagers">
          <p className="form-hint" style={{ marginTop: 0 }}>Select a game to close new wagering and/or cancel and refund its open wagers.</p>
          <Button variant="secondary" onClick={() => setWagersOpen(true)}><Coins size={14} /> Open Wager Tool</Button>
        </CollapsibleSection>
      </div>
    </Modal>
  );
}

function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ padding: 0 }}>
      <button
        type="button"
        className="btn btn-ghost"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          width: "100%",
          padding: "var(--space-3) var(--space-4)",
          fontWeight: 600,
          textAlign: "left",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {title}
      </button>
      {open && (
        <div style={{ padding: "0 var(--space-4) var(--space-4)" }}>
          {children}
        </div>
      )}
    </Card>
  );
}
