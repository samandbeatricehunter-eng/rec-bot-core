import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getTeamByAbbreviation, NFL_TEAM_PRIMARY_COLORS } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { resolveTeamLogoAbbr } from "../../lib/team-logos.js";
import { recApi } from "../../lib/rec-api-client.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { TeamLogo } from "../../components/ui/TeamLogo.js";

type HubResponse = Awaited<ReturnType<typeof recApi.getHub>>;
type PowerRankingTeam = NonNullable<HubResponse["powerRankings"]>["teams"][number];
type SosTeam = NonNullable<HubResponse["sos"]>["teams"][number];
type StandingsView = "division" | "power" | "sos";

const NFL_DIVISION_ORDER = ["East", "North", "South", "West"] as const;

const STANDINGS_NAV: Array<{
  id: StandingsView | "bracket";
  top: string;
  bottom: string;
}> = [
  { id: "division", top: "Division", bottom: "Standings" },
  { id: "power", top: "Power", bottom: "Rankings" },
  { id: "sos", top: "Strength of", bottom: "Schedule" },
  { id: "bracket", top: "Playoff", bottom: "Bracket" },
];

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

function teamIdentity(team: PowerRankingTeam): { city: string; nick: string } {
  const abbr = resolveTeamLogoAbbr(team.abbr);
  const catalog = abbr ? getTeamByAbbreviation(abbr) : undefined;
  let nick = team.nick?.trim() || "";
  let city = team.city?.trim() || "";
  if ((!nick || !city) && catalog?.name) {
    const parts = catalog.name.trim().split(/\s+/);
    if (!nick) nick = parts[parts.length - 1] ?? "";
    if (!city) city = parts.slice(0, -1).join(" ");
  }
  if ((!nick || !city) && team.teamName) {
    const parts = team.teamName.trim().split(/\s+/);
    if (!nick) nick = parts[parts.length - 1] ?? team.teamName;
    if (!city && parts.length > 1) city = parts.slice(0, -1).join(" ");
  }
  return { city: city || team.abbr || "", nick: nick || team.teamName };
}

function sortStandings(a: PowerRankingTeam, b: PowerRankingTeam) {
  return winPct(b) - winPct(a) || b.wins - a.wins || a.teamName.localeCompare(b.teamName);
}

function sortPower(a: PowerRankingTeam, b: PowerRankingTeam) {
  return a.rank - b.rank || a.teamName.localeCompare(b.teamName);
}

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

function useDivisionBoard(
  teams: PowerRankingTeam[],
  view: StandingsView,
  sosByTeam: Map<string, SosTeam>,
) {
  return useMemo(() => {
    const sorter = view === "power"
      ? sortPower
      : view === "sos"
        ? (a: PowerRankingTeam, b: PowerRankingTeam) => {
          const aSos = sosByTeam.get(a.teamId)?.sosRemaining ?? -1;
          const bSos = sosByTeam.get(b.teamId)?.sosRemaining ?? -1;
          return bSos - aSos || a.teamName.localeCompare(b.teamName);
        }
        : sortStandings;
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
    for (const list of buckets.values()) list.sort(sorter);
    return {
      NFC: NFL_DIVISION_ORDER.map((division) => ({
        division,
        label: division.toUpperCase(),
        teams: buckets.get(`NFC|${division}`) ?? [],
      })),
      AFC: NFL_DIVISION_ORDER.map((division) => ({
        division,
        label: division.toUpperCase(),
        teams: buckets.get(`AFC|${division}`) ?? [],
      })),
    };
  }, [teams, view, sosByTeam]);
}

function fitLabelToWidth(el: HTMLElement, maxPx: number, minPx: number) {
  let size = maxPx;
  el.style.fontSize = `${size}px`;
  // Leave a small gutter so 3D black accents / last glyph aren't clipped by overflow.
  const gutter = 6;
  while (el.scrollWidth > el.clientWidth - gutter && size > minPx) {
    size -= 0.5;
    el.style.fontSize = `${size}px`;
  }
  return size;
}

/** City is always capped below the nick size so long cities never visually outrank short nicks. */
const CITY_TO_NICK_RATIO = 0.55;

function StandingIdentity({ city, nick }: { city: string; nick: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cityRef = useRef<HTMLElement | null>(null);
  const nickRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const cityEl = cityRef.current;
    const nickEl = nickRef.current;
    if (!wrap || !nickEl) return;
    let cancelled = false;

    const fit = () => {
      if (cancelled) return;
      // Long nicks (Commanders / Buccaneers) need to go smaller than the previous floor.
      const nickSize = fitLabelToWidth(nickEl, 20, 8);
      if (cityEl) {
        const cityMax = Math.min(11, nickSize * CITY_TO_NICK_RATIO);
        fitLabelToWidth(cityEl, cityMax, Math.min(cityMax, 5.5));
      }
    };

    fit();
    void document.fonts?.ready?.then(() => { if (!cancelled) fit(); });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(wrap);
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [city, nick]);

  return (
    <div className="hub-div-standing-identity" ref={wrapRef}>
      {city ? <small ref={(node) => { cityRef.current = node; }} className="hub-div-standing-city">{city}</small> : null}
      <strong ref={(node) => { nickRef.current = node; }} className="hub-div-standing-nick">{nick}</strong>
    </div>
  );
}

function StandingTeamBlock({
  team,
  conferenceRank,
  view,
  sos,
}: {
  team: PowerRankingTeam;
  conferenceRank: number | null;
  view: StandingsView;
  sos: SosTeam | null;
}) {
  const color = teamPrimaryColor(team);
  const ink = contrastingInk(color);
  const { city, nick } = teamIdentity(team);
  const showPlayoff = view === "division";

  let metric: ReactNode = formatRecord(team);
  if (view === "power") {
    metric = `#${team.rank}`;
  } else if (view === "sos") {
    metric = sos ? (
      <span className="hub-div-standing-sos">
        <span><small>Cur</small>{sos.sosRemaining.toFixed(2)}</span>
        <span><small>SoS</small>{sos.sosFull.toFixed(2)}</span>
      </span>
    ) : "—";
  }

  return (
    <article
      className={`hub-div-standing-team${showPlayoff && (team.playoffMarker === "Y" || team.playoffMarker === "Z") ? " is-division-leader" : ""}`}
      style={{ ["--team-color" as string]: color, ["--team-ink" as string]: ink }}
      title={team.teamName}
    >
      <TeamLogo abbreviation={team.abbr} alt="" className="hub-div-standing-logo" priority />
      <StandingIdentity city={city} nick={nick} />
      <strong className="hub-div-standing-record">{metric}</strong>
      {conferenceRank != null ? <span className="hub-div-standing-conf-rank">{conferenceRank}</span> : null}
      {showPlayoff && team.playoffMarker ? <span className="hub-div-standing-marker">{team.playoffMarker}</span> : null}
    </article>
  );
}

function DivisionColumn({
  label,
  teams,
  conferenceRanks,
  view,
  sosByTeam,
}: {
  label: string;
  teams: PowerRankingTeam[];
  conferenceRanks: Map<string, number>;
  view: StandingsView;
  sosByTeam: Map<string, SosTeam>;
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
            view={view}
            sos={sosByTeam.get(team.teamId) ?? null}
          />
        )) : <p className="hub-div-standing-empty">No teams</p>}
      </div>
    </section>
  );
}

function DivisionStandingsBoard({
  teams,
  view,
  sosByTeam,
}: {
  teams: PowerRankingTeam[];
  view: StandingsView;
  sosByTeam: Map<string, SosTeam>;
}) {
  const board = useDivisionBoard(teams, view, sosByTeam);
  const conferenceRanks = useConferenceRanks(teams);
  if (!teams.length) return <p className="form-hint">Standings will appear after the first completed slate.</p>;
  return (
    <div className="hub-div-standings-board" aria-label={view === "division" ? "Division standings" : view === "power" ? "Power rankings" : "Strength of schedule"}>
      <div className="hub-div-standings-side" data-conference="nfc">
        <p className="hub-div-standings-side-label">NFC</p>
        <div className="hub-div-standings-side-grid">
          {board.NFC.map((division) => (
            <DivisionColumn
              key={`nfc-${division.division}`}
              label={division.label}
              teams={division.teams}
              conferenceRanks={conferenceRanks}
              view={view}
              sosByTeam={sosByTeam}
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
              key={`afc-${division.division}`}
              label={division.label}
              teams={division.teams}
              conferenceRanks={conferenceRanks}
              view={view}
              sosByTeam={sosByTeam}
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

export function LeagueStandingsHome() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  const [view, setView] = useState<StandingsView>("division");

  useEffect(() => {
    recApi.getHub(guildId).then(setHub).catch((cause) => setHubError(cause instanceof Error ? cause.message : "Could not load standings."));
  }, [guildId]);

  const teams = hub?.powerRankings?.teams ?? [];
  const bracketAvailable = Number(hub?.league.weekNumber ?? 0) >= 12;
  const sosByTeam = useMemo(() => {
    const map = new Map<string, SosTeam>();
    for (const team of hub?.sos?.teams ?? []) map.set(team.teamId, team);
    return map;
  }, [hub?.sos?.teams]);

  const boardTitle = view === "division" ? "Division Standings" : view === "power" ? "Power Rankings" : "Strength of Schedule";

  return (
    <div className="hub-section hub-standings-page">
      {hubError ? <ErrorState message={hubError} /> : !hub ? <LoadingState label="Loading standings…" /> : (
        <>
          <nav className="hub-standings-mini-nav" aria-label="Standings views">
            {STANDINGS_NAV.map((item) => {
              const isBracket = item.id === "bracket";
              const selected = !isBracket && item.id === view;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={selected ? "is-selected" : undefined}
                  disabled={isBracket && !bracketAvailable}
                  title={isBracket ? (bracketAvailable ? "Open playoff bracket" : "Playoff bracket unlocks in Week 12") : undefined}
                  aria-pressed={!isBracket ? selected : undefined}
                  onClick={() => {
                    if (isBracket) {
                      navigate(`/l/${hub.league.id}/playoff-bracket`);
                      return;
                    }
                    setView(item.id);
                  }}
                >
                  <span>{item.top}</span>
                  <strong>{item.bottom}</strong>
                </button>
              );
            })}
          </nav>
          <div className="hub-standings-board-wrap">
            <h2>{boardTitle}</h2>
            {view === "division" ? <PlayoffMarkerKey className="hub-standings-key" /> : null}
            <DivisionStandingsBoard teams={teams} view={view} sosByTeam={sosByTeam} />
          </div>
        </>
      )}
    </div>
  );
}
