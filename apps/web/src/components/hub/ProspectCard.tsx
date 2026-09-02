import { PlayerPhoto } from "./PlayerPhoto.js";
import { TeamLogo } from "../ui/TeamLogo.js";

export type ProspectCardData = {
  firstName: string;
  lastName: string;
  position: string;
  side: "offense" | "defense";
  jerseyNumber: number | null;
  age: number | null;
  hometown: string | null;
  hometownState: string | null;
  college: string | null;
  heightInches: number | null;
  weightLbs: number | null;
  bodyType: string | null;
  headshotUrl: string | null;
  backstory: string;
  teamName: string;
  teamAbbr: string | null;
  teamLogoUrl: string | null;
};

function formatHeight(inches: number | null): string | null {
  if (!inches) return null;
  const feet = Math.floor(inches / 12);
  const remainder = inches % 12;
  return `${feet}'${remainder}"`;
}

export function ProspectCard({ data }: { data: ProspectCardData }) {
  const name = `${data.firstName} ${data.lastName}`.trim();
  const home = data.hometown ? `${data.hometown}${data.hometownState ? `, ${data.hometownState}` : ""}` : null;
  const height = formatHeight(data.heightInches);
  const details: string[] = [];
  if (data.age) details.push(`Age ${data.age}`);
  if (height) details.push(height);
  if (data.weightLbs) details.push(`${data.weightLbs} lbs`);
  if (data.bodyType) details.push(data.bodyType);

  return (
    <div className="prospect-card" data-prospect-card-render>
      <header className={`prospect-card-header ${data.side}`}>
        <span className="prospect-card-position">{data.position}</span>
        <span className="prospect-card-side">{data.side === "offense" ? "Offense" : "Defense"}</span>
      </header>
      <div className="prospect-card-body">
        <PlayerPhoto
          photoUrl={data.headshotUrl}
          alt={name}
          className="prospect-card-photo"
          fallback={<div className="prospect-card-photo-fallback">{data.firstName[0]}{data.lastName[0]}</div>}
        />
        <div className="prospect-card-info">
          <h2>{name}{data.jerseyNumber !== null ? <span className="prospect-card-jersey">#{data.jerseyNumber}</span> : null}</h2>
          {details.length ? <div className="prospect-card-details">{details.join(" · ")}</div> : null}
          {home || data.college ? (
            <div className="prospect-card-origin">
              {home ? <span>{home}</span> : null}
              {home && data.college ? <span className="prospect-card-dot">•</span> : null}
              {data.college ? <span>{data.college}</span> : null}
            </div>
          ) : null}
        </div>
        <TeamLogo abbreviation={data.teamAbbr} logoUrl={data.teamLogoUrl} alt={data.teamName} className="prospect-card-team-logo" priority />
      </div>
      <p className="prospect-card-backstory">{data.backstory}</p>
      <footer className="prospect-card-footer">{data.teamName}</footer>
    </div>
  );
}
