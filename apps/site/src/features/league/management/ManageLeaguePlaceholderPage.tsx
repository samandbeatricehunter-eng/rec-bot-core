import { PageHeader } from "../../../../../web/src/components/ui/PageHeader.js";
import { Card } from "../../../../../web/src/components/ui/Card.js";

/** Manage League destination — structural placeholder. */
export function ManageLeaguePlaceholderPage() {
  return (
    <div>
      <PageHeader
        title="Manage League"
        subtitle="League-wide settings and tools will live here."
      />
      <Card>
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>
          League management placeholder. Content coming after the structural pass.
        </p>
      </Card>
    </div>
  );
}
