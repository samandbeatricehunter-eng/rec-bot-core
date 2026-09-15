import type { CSSProperties } from "react";
import { PlayerPhoto } from "./PlayerPhoto.js";
import { TeamLogo } from "../ui/TeamLogo.js";

export type ProTrackerPlayerLine = {
  playerId: string;
  playerName: string;
  position: string | null;
  headshotUrl: string | null;
  teamName: string;
  teamAbbr: string | null;
  teamLogoUrl: string | null;
  teamPrimaryColor: string | null;
  teamSecondaryColor: string | null;
  weekLines: string[];
  seasonLines: string[];
  positionRank: number | null;
  positionCount: number | null;
};

function Panel({ player }: { player: ProTrackerPlayerLine | null }) {
  if (!player) {
    return <div className="protracker-panel protracker-panel-empty">No player linked</div>;
  }
  const style = {
    "--protracker-primary": player.teamPrimaryColor ?? "#333",
    "--protracker-secondary": player.teamSecondaryColor ?? "#111",
  } as CSSProperties;
  return (
    <div className="protracker-panel" style={style}>
      <div className="protracker-panel-head">
        <PlayerPhoto
          photoUrl={player.headshotUrl}
          alt={player.playerName}
          className="protracker-photo"
          fallback={<div className="protracker-photo-fallback">{player.playerName.slice(0, 1)}</div>}
        />
        <div className="protracker-panel-name">
          {player.position ? <small>{player.position}</small> : null}
          <strong>{player.playerName}</strong>
          <span className="protracker-team-name">{player.teamName}</span>
        </div>
        <TeamLogo abbreviation={player.teamAbbr} logoUrl={player.teamLogoUrl} alt={player.teamName} className="protracker-team-logo" priority />
      </div>
      <div className="protracker-panel-stats">
        <div className="protracker-stat-block">
          <h4>Last Week</h4>
          {player.weekLines.map((line) => <span key={line}>{line}</span>)}
        </div>
        <div className="protracker-stat-block">
          <h4>Season</h4>
          {player.seasonLines.map((line) => <span key={line}>{line}</span>)}
        </div>
      </div>
      {player.positionRank && player.positionCount ? (
        <div className="protracker-rank">#{player.positionRank} of {player.positionCount} {player.position ?? ""} in the league</div>
      ) : null}
    </div>
  );
}

export function ProTrackerCard({ seasonNumber, weekNumber, offense, defense }: {
  seasonNumber: number;
  weekNumber: number;
  offense: ProTrackerPlayerLine | null;
  defense: ProTrackerPlayerLine | null;
}) {
  return (
    <div className="protracker-card" data-pro-tracker-render>
      <header className="protracker-header">Pro Tracker &middot; Season {seasonNumber}, Week {weekNumber}</header>
      <div className="protracker-grid">
        <Panel player={offense} />
        <Panel player={defense} />
      </div>
    </div>
  );
}
