import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NFL_TEAM_PRIMARY_COLORS } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { resolveTeamLogoAbbr } from "../../lib/team-logos.js";
import { recApi } from "../../lib/rec-api-client.js";
import { Card } from "../../components/ui/Card.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { RankChange } from "./HubHome.js";
import { TeamLogo } from "../../components/ui/TeamLogo.js";

type HubResponse = Awaited<ReturnType<typeof recApi.getHub>>;
type PowerRankingTeam = NonNullable<HubResponse["powerRankings"]>["teams"][number];

const NFL_DIVISION_ORDER = ["East", "North", "South", "West"] as const;

function winPct(team: PowerRankingTeam) {
  const games = team.wins + team.losses + team.ties;
  return games ? (team.wins + team.ties * 0.5) / games : 0;
}

function formatRecord(team: PowerRankingTeam) {
  return team.ties ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`;
}

function normalizeConference(value: string | null | undefined): "NFC" | "AFC" | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "NFC" || raw.includes("NATIONAL")) return "NFC";
  if (raw === "AFC" || raw.includes("AMERICAN")) return "AFC";
  return null;
}

function normalizeDivision(value: string | null | undefined): (typeof NFL_DIVISION_ORDER)[number] | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const division of NFL_DIVISION_ORDER) {
    if (lower === division.toLowerCase() || lower.endsWith(` ${division.toLowerCase()}`)) return division;
  }
  return null;
}

function teamPrimaryColor(team: PowerRankingTeam) {
  const raw = typeof team.primaryColor === "string" ? team.primaryColor.trim() : "";
  if (raw && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return raw;
  const abbr = resolveTeamLogoAbbr(team.abbr);
  if (abbr && NFL_TEAM_PRIMARY_COLORS[abbr]) return NFL_TEAM_PRIMARY_COLORS[abbr];
  return "#1a1d24";
}

function contrastingInk(hex: string) {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return "#fff";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.62 ? "#111111" : "#ffffff";
}

function sortStandings(a: PowerRankingTeam, b: PowerRankingTeam) {
  return winPct(b) - winPct(a) || b.wins - a.wins || a.teamName.localeCompare(b.teamName);
}

/** Conference rank map (1 = best win pct in that conference). */
function useConferenceRanks(teams: PowerRankingTeam[]) {
  return useMemo(() => {
    const byConference = new Map<"NFC" | "AFC", PowerRankingTeam[]>();
    for (const team of teams) {
      const key = normalizeConference(team.conference);
      if (!key) continue;
      const list = byConference.get(key) ?? [];
      list.push(team);
      byConference.set(key, list);
    }
    const ranks = new Map<string, number>();
    for (const list of byConference.values()) {
      [...list].sort(sortStandings).forEach((team, index) => ranks.set(team.teamId, index + 1));
    }
    return ranks;
  }, [teams]);
}

function useDivisionBoard(teams: PowerRankingTeam[]) {
  return useMemo(() => {
    const buckets = new Map<string, PowerRankingTeam[]>();
    for (const team of teams) {
      const conference = normalizeConference(team.conference);
      const division = normalizeDivision(team.division);
      if (!conference || !division) continue;
      const key = `${conference}|${division}`;
      const list = buckets.get(key) ?? [];
      list.push(team);
      buckets.set(key, list);
    }
    for (const list of buckets.values()) list.sort(sortStandings);
    return {
      NFC: NFL_DIVISION_ORDER.map((division) => ({
        division,
        label: `NFC ${division.toUpperCase()}`,
        teams: buckets.get(`NFC|${division}`) ?? [],
      })),
      AFC: NFL_DIVISION_ORDER.map((division) => ({
        division,
        label: `AFC ${division.toUpperCase()}`,
        teams: buckets.get(`AFC|${division}`) ?? [],
      })),
    };
  }, [teams]);
}

function StandingTeamBlock({
  team,
  conferenceRank,
}: {
  team: PowerRankingTeam;
  conferenceRank: number | null;
}) {
  const color = teamPrimaryColor(team);
  const ink = contrastingInk(color);
  return (
    <article
      className={`hub-div-standing-team${team.playoffMarker === "Y" || team.playoffMarker === "Z" ? " is-division-leader" : ""}`}
      style={{ ["--team-color" as string]: color, ["--team-ink" as string]: ink }}
      title={team.teamName}
    >
      <TeamLogo abbreviation={team.abbr} alt={team.teamName} className="hub-div-standing-logo" priority />
      <strong className="hub-div-standing-record">{formatRecord(team)}</strong>
      {conferenceRank != null ? <span className="hub-div-standing-conf-rank">{conferenceRank}</span> : null}
      {team.playoffMarker ? <span className="hub-div-standing-marker">{team.playoffMarker}</span> : null}
      {!team.isHuman ? <span className="hub-div-standing-open">Open</span> : null}
    </article>
  );
}

function DivisionColumn({
  label,
  teams,
  conferenceRanks,
}: {
  label: string;
  teams: PowerRankingTeam[];
  conferenceRanks: Map<string, number>;
}) {
  return (
    <section className="hub-div-standing-card">
      <header className="hub-div-standing-card-head">
        <span />
        <h3>{label}</h3>
        <span />
      </header>
      <div className="hub-div-standing-stack">
        {teams.length ? teams.map((team) => (
          <StandingTeamBlock
            key={team.teamId}
            team={team}
            conferenceRank={conferenceRanks.get(team.teamId) ?? null}
          />
        )) : <p className="hub-div-standing-empty">No teams</p>}
      </div>
    </section>
  );
}

function DivisionStandingsBoard({ teams }: { teams: PowerRankingTeam[] }) {
  const board = useDivisionBoard(teams);
  const conferenceRanks = useConferenceRanks(teams);
  if (!teams.length) return <p className="form-hint">Standings will appear after the first completed slate.</p>;
  return (
    <div className="hub-div-standings-board" aria-label="Division standings">
      <div className="hub-div-standings-side" data-conference="nfc">
        <p className="hub-div-standings-side-label">NFC</p>
        <div className="hub-div-standings-side-grid">
          {board.NFC.map((division) => (
            <DivisionColumn
              key={division.label}
              label={division.label}
              teams={division.teams}
              conferenceRanks={conferenceRanks}
            />
          ))}
        </div>
      </div>
      <div className="hub-div-standings-divider" aria-hidden="true" />
      <div className="hub-div-standings-side" data-conference="afc">
        <p className="hub-div-standings-side-label">AFC</p>
        <div className="hub-div-standings-side-grid">
          {board.AFC.map((division) => (
            <DivisionColumn
              key={division.label}
              label={division.label}
              teams={division.teams}
              conferenceRanks={conferenceRanks}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayoffMarkerKey({ className }: { className: string }) {
  return (
    <p className={className}><span>X · Playoff berth</span><span>Y · Division secured</span><span>Z · First-round bye</span></p>
  );
}

function PowerRankingsCard({ teams }: { teams: PowerRankingTeam[] }) {
  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Power Rankings</h2>
      <div className="hub-stats-power-grid">
        {teams.map((team) => (
          <article key={team.teamId}>
            <strong>#{team.rank}</strong>
            <span className="hub-team-cell"><TeamLogo abbreviation={team.abbr} alt={team.teamName} /><span>{team.teamName}{team.playoffMarker ? ` - ${team.playoffMarker}` : ""}</span></span>
            <small>{formatRecord(team)} · <RankChange change={team.change} /></small>
          </article>
        ))}
      </div>
      {!teams.length ? <p className="form-hint">Power rankings will appear after the first completed slate.</p> : null}
      <PlayoffMarkerKey className="hub-stats-playoff-key" />
    </Card>
  );
}

export function LeagueStandingsHome() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  useEffect(() => {
    recApi.getHub(guildId).then(setHub).catch((cause) => setHubError(cause instanceof Error ? cause.message : "Could not load standings."));
  }, [guildId]);

  const teams = hub?.powerRankings?.teams ?? [];
  const bracketAvailable = Number(hub?.league.weekNumber ?? 0) >= 12;

  return (
    <div className="hub-section">
      <PageHeader title="Standings" subtitle="Division standings and power rankings." />
      {hubError ? <ErrorState message={hubError} /> : !hub ? <LoadingState label="Loading standings…" /> : (
        <>
          <div className="hub-standings-actions">
            <button type="button" onClick={() => navigate(`/l/${hub.league.id}/sos`)}><strong>S.O.S.</strong><span>Strength of Schedule</span></button>
            <button type="button" disabled={!bracketAvailable} title={bracketAvailable ? "Open playoff bracket" : "Playoff bracket unlocks in Week 12"} onClick={() => navigate(`/l/${hub.league.id}/playoff-bracket`)}><strong>Playoff Bracket</strong><span>{bracketAvailable ? "View bracket" : "Unlocks Week 12"}</span></button>
          </div>
          <PlayoffMarkerKey className="hub-standings-key" />
          <div className="hub-standings-board-wrap">
            <h2>Division Standings</h2>
            <DivisionStandingsBoard teams={teams} />
          </div>
          <PowerRankingsCard teams={teams} />
        </>
      )}
    </div>
  );
}
