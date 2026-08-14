import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { Modal } from "../../../components/ui/Modal.js";
import { Button } from "../../../components/ui/Button.js";
import { Card } from "../../../components/ui/Card.js";
import { RepairGameChannelsModal } from "./RepairGameChannelsModal.js";

export function TroubleshootModal({
  guildId,
  onClose,
}: {
  guildId: string;
  onClose: () => void;
}) {
  const [repairOpen, setRepairOpen] = useState(false);
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

  return (
    <Modal title="Troubleshoot" onClose={onClose}>
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
