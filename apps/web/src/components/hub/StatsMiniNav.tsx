import { SectionMiniNav } from "./SectionMiniNav.js";

export type StatsNavId =
  | "stats"
  | "standings"
  | "power"
  | "sos"
  | "bracket"
  | "records"
  | "history";

/** Plan order: Stats → Standings → Power → SOS → Bracket → Records → History. */
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
  return (
    <SectionMiniNav
      ariaLabel="Stats views"
      active={active}
      items={[
        { id: "stats", top: "Season", bottom: "Stats", to: `${base}/stats` },
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
        { id: "records", top: "League", bottom: "Records", to: `${base}/records` },
        { id: "history", top: "League", bottom: "History", to: `${base}/history` },
      ]}
    />
  );
}
