import type { CSSProperties } from "react";
import type { MatchupPreview, MatchupTeamBreakdown, WagerOptionsResponse } from "../../types/api.js";
import { PositionMatchupAdvantages } from "../matchups/PositionMatchupAdvantages.js";

const FALLBACK_PRIMARY = "#8a94a6";

function rankLabel(rank: number | null, missingRankLabel = "Unranked") {
  return rank == null ? missingRankLabel : `#${rank}`;
}

function formatValue(value: number, suffix = "") {
  const signed = suffix === " signed" && value > 0 ? "+" : "";
  return `${signed}${value.toFixed(Number.isInteger(value) ? 0 : 1)}`;
}

type StatRow = {
  key: string; label: string; awayValue: number; awayRank: number | null; homeValue: number; homeRank: number | null;
  suffix?: string; lowerIsBetter?: boolean;
};

function statRows(away: MatchupTeamBreakdown, home: MatchupTeamBreakdown) {
  return [
    { label: null as string | null, rows: [
      { key: "points-for", label: "Points / game", awayValue: away.pointsPerGame, awayRank: away.pointsPerGameRank, homeValue: home.pointsPerGame, homeRank: home.pointsPerGameRank },
      { key: "points-allowed", label: "Points allowed / game", awayValue: away.pointsAllowedPerGame, awayRank: away.pointsAllowedPerGameRank, homeValue: home.pointsAllowedPerGame, homeRank: home.pointsAllowedPerGameRank, lowerIsBetter: true },
      { key: "point-diff", label: "Point differential", awayValue: away.pointDifferential, awayRank: away.pointDifferentialRank, homeValue: home.pointDifferential, homeRank: home.pointDifferentialRank, suffix: " signed" },
    ] as StatRow[] },
    { label: "Offensive", rows: [
      { key: "pass-for", label: "Passing yards / game", awayValue: away.passingYardsPerGame, awayRank: away.passingYardsRank, homeValue: home.passingYardsPerGame, homeRank: home.passingYardsRank },
      { key: "rush-for", label: "Rushing yards / game", awayValue: away.rushingYardsPerGame, awayRank: away.rushingYardsRank, homeValue: home.rushingYardsPerGame, homeRank: home.rushingYardsRank },
    ] as StatRow[] },
    { label: "Defensive", rows: [
      { key: "pass-allowed", label: "Passing yards allowed / game", awayValue: away.passingYardsAllowedPerGame, awayRank: away.passingYardsAllowedRank, homeValue: home.passingYardsAllowedPerGame, homeRank: home.passingYardsAllowedRank, lowerIsBetter: true },
      { key: "rush-allowed", label: "Rushing yards allowed / game", awayValue: away.rushingYardsAllowedPerGame, awayRank: away.rushingYardsAllowedRank, homeValue: home.rushingYardsAllowedPerGame, homeRank: home.rushingYardsAllowedRank, lowerIsBetter: true },
      { key: "turnover-diff", label: "Turnover differential", awayValue: away.turnoverDifferential, awayRank: away.turnoverDifferentialRank, homeValue: home.turnoverDifferential, homeRank: home.turnoverDifferentialRank, suffix: " signed" },
    ] as StatRow[] },
  ];
}

// One bar per row split into an away-share and a home-share that reflect who currently has the
// edge in that stat -- not raw magnitude (which reads as "bigger bar = better" even for stats
// like Points Allowed where a bigger number is worse). `lowerIsBetter` flips the direction for
// allowed-type stats. The split is a smooth S-curve (not a hard proportion) scaled to each row's
// own magnitude, so a real 20-point gap in Points/game leans hard while a 0.3-yard gap barely
// moves off the middle -- and it's never fully empty on either side, which would misread as "no
// data" rather than "slight edge."
function awayAdvantageShare(row: StatRow): number {
  const direction = row.lowerIsBetter ? -1 : 1;
  const diff = direction * (row.awayValue - row.homeValue);
  const scale = Math.max(Math.abs(row.awayValue), Math.abs(row.homeValue), 1) * 0.15;
  return 0.5 + 0.5 * Math.tanh(diff / scale);
}

export function HeroMatchupBreakdown({ preview, wagerOptions }: { preview: MatchupPreview; wagerOptions?: WagerOptionsResponse | null }) {
  const { away, home } = preview;
  const awayPrimary = away.primaryColor && away.primaryColor !== "#FFFFFF" ? away.primaryColor : FALLBACK_PRIMARY;
  const homePrimary = home.primaryColor && home.primaryColor !== "#FFFFFF" ? home.primaryColor : FALLBACK_PRIMARY;
  const cardStyle = {
    "--away-primary": awayPrimary,
    "--home-primary": homePrimary,
    "--away-secondary": away.secondaryColor ?? awayPrimary,
    "--home-secondary": home.secondaryColor ?? homePrimary,
  } as CSSProperties;

  return <section className="hub-hero-breakdown" aria-label="Matchup stat comparison" style={cardStyle}>
    <div className="hub-hero-breakdown-head">
      <div className="hub-hero-breakdown-side away"><small>Away</small><strong>{away.abbr ?? away.teamName}</strong></div>
      <span>Matchup Breakdown</span>
      <div className="hub-hero-breakdown-side home"><small>Home</small><strong>{home.abbr ?? home.teamName}</strong></div>
    </div>
    <div className="hub-hero-comparison-grid">
      {statRows(away, home).map((group) => <div className="hub-hero-comparison-group" key={group.label ?? "scoring"}>
        {group.label ? <h3>{group.label}</h3> : null}
        {group.rows.map((row) => {
          const awayShare = awayAdvantageShare(row);
          const awayLeads = awayShare >= 0.5;
          return <div className="hub-hero-comparison-row" key={row.key}>
            <div className="hub-hero-comparison-figure away">
              <strong>{formatValue(row.awayValue, row.suffix)}</strong>
              <small>{rankLabel(row.awayRank)}</small>
            </div>
            <div className="hub-hero-comparison-bar">
              <span className={`away${awayLeads ? " leads" : ""}`} style={{ width: `${(awayShare * 100).toFixed(1)}%` }} />
              <span className={`home${awayLeads ? "" : " leads"}`} style={{ width: `${((1 - awayShare) * 100).toFixed(1)}%` }} />
            </div>
            <span className="hub-hero-comparison-label">{row.label}</span>
            <div className="hub-hero-comparison-figure home">
              <strong>{formatValue(row.homeValue, row.suffix)}</strong>
              <small>{rankLabel(row.homeRank)}</small>
            </div>
          </div>;
        })}
      </div>)}
    </div>
    <PositionMatchupAdvantages away={preview.away} home={preview.home} wagerOptions={wagerOptions} />
    <footer className="hub-hero-prediction">
      <span>Predicted Score</span>
      <strong>{away.abbr ?? away.teamName} {preview.prediction.predictedAwayScore} <em>–</em> {preview.prediction.predictedHomeScore} {home.abbr ?? home.teamName}</strong>
      <small>{preview.prediction.awayWinProbability}% away · {preview.prediction.homeWinProbability}% home</small>
    </footer>
  </section>;
}
