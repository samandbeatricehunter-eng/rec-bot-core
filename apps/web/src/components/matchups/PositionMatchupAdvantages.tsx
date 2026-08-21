import { ChevronDown } from "lucide-react";
import type { MatchupTeamBreakdown, WagerOptionsResponse } from "../../types/api.js";

const TRAITS: Record<string, string> = {
  qb: "quarterback OVR and speed against secondary coverage and pass-rush ratings",
  wr1: "WR1 route-running, speed and OVR against CB1 coverage, press and speed",
  wr2: "WR2 route-running, speed and OVR against CB2 coverage, press and speed",
  wr3: "slot route-running, speed and OVR against nickel coverage, press and speed",
  hb: "halfback speed and OVR against the linebacker and front-seven profile",
  te: "tight-end route-running, speed and OVR against linebacker coverage",
  ol: "offensive-line OVR against the defensive front's block-shedding and pass rush",
};

function production(key: string, offense: MatchupTeamBreakdown, defense: MatchupTeamBreakdown) {
  if (["qb", "wr1", "wr2", "wr3", "te"].includes(key)) return `${offense.passingYardsPerGame.toFixed(1)} pass yds/game vs ${defense.passingYardsAllowedPerGame.toFixed(1)} allowed`;
  if (["hb", "ol"].includes(key)) return `${offense.rushingYardsPerGame.toFixed(1)} rush yds/game vs ${defense.rushingYardsAllowedPerGame.toFixed(1)} allowed`;
  return `${offense.pointsPerGame.toFixed(1)} points/game vs ${defense.pointsAllowedPerGame.toFixed(1)} allowed`;
}

function verdict(offenseLabel: string, defenseLabel: string, offenseRating: number, defenseRating: number) {
  const gap = offenseRating - defenseRating;
  if (Math.abs(gap) < 2) return `${offenseLabel}'s offense and ${defenseLabel}'s defense are closely matched`;
  return gap > 0 ? `${offenseLabel}'s offense has the stronger profile` : `${defenseLabel}'s defense has the stronger profile`;
}

export function PositionMatchupAdvantages({ away, home, wagerOptions }: {
  away: MatchupTeamBreakdown;
  home: MatchupTeamBreakdown;
  wagerOptions?: WagerOptionsResponse | null;
}) {
  const units = wagerOptions?.matchup?.units ?? [];
  if (!units.length) return null;
  const homeLabel = home.abbr ?? home.teamName;
  const awayLabel = away.abbr ?? away.teamName;

  return <details className="hub-position-advantages">
    <summary><span><small>Roster and production comparison</small><strong>Position Matchups</strong></span><ChevronDown size={18} /></summary>
    <div className="hub-position-advantages-list">
      {units.map((unit) => <article key={unit.key}>
        <h4>{unit.label}</h4>
        <p><strong>{homeLabel} offense:</strong> {verdict(homeLabel, awayLabel, unit.homeOffenseRating, unit.awayDefenseRating)} based on {TRAITS[unit.key] ?? "the relevant player ratings"}. Season production: {production(unit.key, home, away)}.</p>
        <p><strong>{awayLabel} offense:</strong> {verdict(awayLabel, homeLabel, unit.awayOffenseRating, unit.homeDefenseRating)} based on {TRAITS[unit.key] ?? "the relevant player ratings"}. Season production: {production(unit.key, away, home)}.</p>
      </article>)}
    </div>
  </details>;
}
