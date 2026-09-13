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
 * Desktop rows (4 + 4):
 * 1) League Leaders · Season Stats · Career Stats · Team Stats
 * 2) League Records · Division Standings · Playoff Bracket · League History
 *
 * Power Rankings and Strength of Schedule are no longer separate destinations -- Division
 * Standings shows each team's power rank inline (next to its nickname) and SoS as a hover
 * tooltip, so those two nav buttons were trimmed rather than duplicating the same data behind
 * a second click.
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
