import { PageHeader } from "../../../components/ui/PageHeader.js";
import { PendingItemsPanel } from "./PendingItemsPanel.js";

export function NotificationsHome() {
  return <div>
    <PageHeader title="Notifications" subtitle="Pending decisions and the league's latest approved or issued transactions." />
    <PendingItemsPanel />
  </div>;
}
