import { SectionMiniNav } from "./SectionMiniNav.js";

export type MediaNavId = "headlines" | "social" | "highlights" | "press";

/**
 * Universal league Media strip (plan Phase 3).
 * Headlines → News Room; Social / Highlights still live on Home until dedicated hubs ship;
 * Press Conferences → Media Day archive entry (Home Media Day for now).
 */
export function MediaMiniNav({
  active,
  leagueId,
}: {
  active: MediaNavId;
  leagueId: string;
}) {
  const base = `/l/${leagueId}`;
  return (
    <SectionMiniNav
      ariaLabel="Media views"
      active={active}
      items={[
        { id: "headlines", top: "League", bottom: "Headlines", to: `${base}/news` },
        { id: "social", top: "REC", bottom: "Social", to: `${base}/buzz?view=social` },
        { id: "highlights", top: "Highlight", bottom: "Reel", to: `${base}/buzz?view=highlights` },
        { id: "press", top: "Press", bottom: "Conferences", to: `${base}/buzz?view=press` },
      ]}
    />
  );
}
