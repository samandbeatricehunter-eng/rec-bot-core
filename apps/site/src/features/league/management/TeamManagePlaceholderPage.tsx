import { useParams } from "react-router-dom";
import { PageHeader } from "../../../../../web/src/components/ui/PageHeader.js";
import { Card } from "../../../../../web/src/components/ui/Card.js";

/** Per-team management destination — body left empty until the next build-out. */
export function TeamManagePlaceholderPage() {
  const { teamId = "" } = useParams();

  return (
    <div>
      <PageHeader
        title="Team Management"
        subtitle="Tools for this franchise will land here."
      />
      <Card>
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>
          Team workspace placeholder{teamId ? ` (${teamId})` : ""}. Nothing to configure yet.
        </p>
      </Card>
    </div>
  );
}
