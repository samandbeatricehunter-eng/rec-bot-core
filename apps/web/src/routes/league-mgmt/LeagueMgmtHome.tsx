import { CommandCenterDashboard } from "../../components/league-mgmt/CommandCenterDashboard.js";
import { PendingCommissionerPollsBanner } from "../../components/league-mgmt/PendingCommissionerPollsBanner.js";
import { PageHeader } from "../../components/ui/PageHeader.js";

// Linked coaches used to render here as their own panel — the Manage League division grid
// now shows every linked coach inline, so the duplicate panel was removed.
export function LeagueMgmtHome() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <PageHeader
        title="League Command Center"
        subtitle="Tap “Advance Readiness” and “Manage League” below to expand them — that's where advancing the week, editing rosters, and league settings live."
      />
      <PendingCommissionerPollsBanner />
      <CommandCenterDashboard />
    </div>
  );
}
