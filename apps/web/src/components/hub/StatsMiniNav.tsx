import { SectionMiniNav } from "./SectionMiniNav.js";

export type StatsNavId =
  | "leaders"
  | "season"
  | "career"
  | "team"
  | "standings"
  | "power"
  | "sos"
  | "bracket"
  | "records"
  | "history"
  /** @deprecated Prefer "season" — kept for older call sites during transition. */
  | "stats";

/**
 * Desktop rows (5 + 5):
 * 1) League Leaders · Season Stats · Career Stats · Team Stats · League Records
 * 2) Division Standings · Power Rankings · Strength of Schedule · Playoff Bracket · League History
 */
export function StatsMiniNav({
  active,
  leagueId,
  bracketAvailable = true,
}: {
  active: StatsNavId;
  leagueId: string;
  bracketAvailable?: boolean;
}) {
  const base = `/l/${leagueId}`;
  const resolved: Exclude<StatsNavId, "stats"> = active === "stats" ? "season" : active;
  return (
    <SectionMiniNav
      ariaLabel="Stats views"
      active={resolved}
      className="hub-section-mini-nav--stats"
      items={[
        { id: "leaders", top: "League", bottom: "Leaders", to: `${base}/stats` },
        { id: "season", top: "Season", bottom: "Stats", to: `${base}/stats?view=season` },
        { id: "career", top: "Career", bottom: "Stats", to: `${base}/career-stats` },
        { id: "team", top: "Team", bottom: "Stats", to: `${base}/stats?view=team` },
        { id: "records", top: "League", bottom: "Records", to: `${base}/records` },
        { id: "standings", top: "Division", bottom: "Standings", to: `${base}/standings` },
        { id: "power", top: "Power", bottom: "Rankings", to: `${base}/standings?view=power` },
        { id: "sos", top: "Strength of", bottom: "Schedule", to: `${base}/standings?view=sos` },
        {
          id: "bracket",
          top: "Playoff",
          bottom: "Bracket",
          to: `${base}/playoff-bracket`,
          disabled: !bracketAvailable,
          disabledTitle: "Playoff bracket unlocks in Week 12",
        },
        { id: "history", top: "League", bottom: "History", to: `${base}/history` },
      ]}
    />
  );
}
