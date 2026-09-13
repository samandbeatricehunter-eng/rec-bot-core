import { SectionMiniNav } from "./SectionMiniNav.js";

export type MgmtNavId = "inbox" | "teams" | "advance" | "tools";

/** League Mgmt's bottom-row nav -- same universal box-grid chassis as every other section's
 * mini-nav (Stats/Team/Game Day). Inbox: pending commissioner items. Teams: every team's site/
 * Discord/EA name plus schedule status. Advance: import data, then review scores and complete
 * the week. Tools: Settings, Roles, and troubleshooting. */
export function MgmtMiniNav({ active, leagueId }: { active: MgmtNavId; leagueId: string }) {
  const base = `/l/${leagueId}/mgmt`;
  return (
    <SectionMiniNav
      ariaLabel="League Mgmt views"
      active={active}
      items={[
        { id: "inbox", top: "Pending", bottom: "Inbox", to: `${base}/inbox` },
        { id: "teams", top: "View", bottom: "Teams", to: `${base}/teams` },
        { id: "advance", top: "Advance", bottom: "Week", to: `${base}/advance` },
        { id: "tools", top: "League", bottom: "Tools", to: `${base}/tools` },
      ]}
    />
  );
}
