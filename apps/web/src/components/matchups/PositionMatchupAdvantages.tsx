import type { MatchupTeamBreakdown, WagerOptionsResponse } from "../../types/api.js";

const LANE_PARTS: Record<string, { offense: string; defense: string }> = {
  qb: { offense: "quarterback play", defense: "secondary and pass rush" },
  wr1: { offense: "WR1", defense: "top corner" },
  wr2: { offense: "WR2", defense: "second corner" },
  wr3: { offense: "slot receiver", defense: "nickel coverage" },
  hb: { offense: "halfback", defense: "linebacker core" },
  te: { offense: "tight end", defense: "second linebacker" },
  ol: { offense: "offensive line", defense: "defensive line" },
};

function edgeSize(edge: number) {
  const value = Math.abs(edge);
  if (value >= 20) return "a large";
  if (value >= 10) return "a clear";
  if (value >= 5) return "a slight";
  return "a narrow";
}

function explanation(
  unit: NonNullable<WagerOptionsResponse["matchup"]>["units"][number],
  away: MatchupTeamBreakdown,
  home: MatchupTeamBreakdown,
) {
  const parts = LANE_PARTS[unit.key] ?? { offense: unit.label.split(/\s+vs\s+/i)[0] ?? "offense", defense: unit.label.split(/\s+vs\s+/i)[1] ?? "defense" };
  const homeLabel = home.abbr ?? home.teamName;
  const awayLabel = away.abbr ?? away.teamName;
  const points = Math.abs(Math.round(unit.edge));
  if (Math.abs(unit.edge) <= 0.1) {
    return { label: "Even", text: `${homeLabel}'s ${parts.offense} and ${awayLabel}'s ${parts.defense} grade essentially even.` };
  }
  if (unit.edge > 0) {
    return {
      label: `${homeLabel} +${points}`,
      text: `${homeLabel} has ${edgeSize(unit.edge)} advantage: its ${parts.offense} grades ${points} points above ${awayLabel}'s ${parts.defense}.`,
    };
  }
  return {
    label: `${awayLabel} +${points}`,
    text: `${awayLabel} has ${edgeSize(unit.edge)} defensive advantage: its ${parts.defense} grades ${points} points above ${homeLabel}'s ${parts.offense}.`,
  };
}

export function PositionMatchupAdvantages({
  away,
  home,
  wagerOptions,
}: {
  away: MatchupTeamBreakdown;
  home: MatchupTeamBreakdown;
  wagerOptions?: WagerOptionsResponse | null;
}) {
  const units = wagerOptions?.matchup?.units ?? [];
  if (!units.length) return null;
  return <section className="matchup-preview__lanes hub-position-advantages">
    <header className="matchup-preview__wagers-head">
      <span>Roster model</span>
      <strong>Position Matchups</strong>
    </header>
    <p className="hub-position-advantages-note">Edges compare active-roster overall ratings, X-Factors, abilities and relevant speed. Positive points show the size of the modeled advantage—not a predicted score.</p>
    <div className="matchup-preview__lane-grid">
      {units.map((unit) => {
        const detail = explanation(unit, away, home);
        const favor = unit.edge > 0.1 ? "home" : unit.edge < -0.1 ? "away" : null;
        return <article key={unit.key} className="matchup-preview__lane hub-position-advantage">
          <span className="matchup-preview__lane-label">{unit.label}</span>
          <span className="matchup-preview__lane-bar" aria-hidden="true"><span className={unit.edge > 0 ? "is-home" : "is-away"} style={{ width: `${Math.min(100, Math.abs(unit.edge) * 2.5)}%` }} /></span>
          <small className={`matchup-preview__lane-edge${favor ? ` is-${favor}` : ""}`}>{detail.label}</small>
          <p>{detail.text}</p>
        </article>;
      })}
    </div>
  </section>;
}
