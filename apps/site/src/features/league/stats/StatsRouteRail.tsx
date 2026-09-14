import { useSearchParams } from "react-router-dom";
import { LeagueTopRail } from "../chassis/index.js";
import { StatsMiniNav, type StatsNavId } from "./StatsMiniNav.js";

export type StatsFamilyView =
  | "stats"
  | "standings"
  | "records"
  | "history"
  | "career-stats"
  | "playoff-bracket";

const STATS_FAMILY_NAV_ID: Record<Exclude<StatsFamilyView, "stats">, StatsNavId> = {
  standings: "standings",
  records: "records",
  history: "history",
  "career-stats": "career",
  "playoff-bracket": "bracket",
};

export function statsNavIdFromView(
  view: StatsFamilyView,
  searchParams: URLSearchParams,
): StatsNavId {
  if (view !== "stats") return STATS_FAMILY_NAV_ID[view];
  const viewParam = searchParams.get("view");
  if (viewParam === "season" || viewParam === "team") return viewParam;
  return "leaders";
}

export function StatsRouteRail({
  view,
  leagueId,
  bracketAvailable = true,
}: {
  view: StatsFamilyView;
  leagueId: string;
  bracketAvailable?: boolean;
}) {
  const [searchParams] = useSearchParams();
  return (
    <LeagueTopRail>
      <StatsMiniNav
        active={statsNavIdFromView(view, searchParams)}
        leagueId={leagueId}
        bracketAvailable={bracketAvailable}
      />
    </LeagueTopRail>
  );
}
