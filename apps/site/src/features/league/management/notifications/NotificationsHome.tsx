import { PageHeader } from "../../../../../../web/src/components/ui/PageHeader.js";
import { PendingItemsPanel } from "./PendingItemsPanel.js";

export function NotificationsHome() {
  return <div>
    <PageHeader title="Pending" subtitle="Decisions waiting on a commissioner and recent resolved transactions." />
    <PendingItemsPanel />
  </div>;
}
