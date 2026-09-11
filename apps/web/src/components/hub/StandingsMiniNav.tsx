import { StatsMiniNav, type StatsNavId } from "./StatsMiniNav.js";

/** Legacy ids used by standings/bracket pages before StatsMiniNav. */
export type StandingsNavId = "division" | "power" | "sos" | "bracket";

const TO_STATS: Record<StandingsNavId, StatsNavId> = {
  division: "standings",
  power: "power",
  sos: "sos",
  bracket: "bracket",
};

/** @deprecated Prefer StatsMiniNav — thin alias for existing standings/bracket call sites. */
export function StandingsMiniNav({
  active,
  leagueId,
  bracketAvailable = true,
}: {
  active: StandingsNavId;
  leagueId: string;
  bracketAvailable?: boolean;
}) {
  return <StatsMiniNav active={TO_STATS[active]} leagueId={leagueId} bracketAvailable={bracketAvailable} />;
}
