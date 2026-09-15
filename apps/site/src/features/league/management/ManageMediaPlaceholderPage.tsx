import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";

/** Manage Media destination — structural placeholder. */
export function ManageMediaPlaceholderPage() {
  return (
    <div>
      <PageHeader
        title="Manage Media"
        subtitle="Publishing and media tools will live here."
      />
      <Card>
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>
          Media management placeholder. Content coming after the structural pass.
        </p>
      </Card>
    </div>
  );
}
