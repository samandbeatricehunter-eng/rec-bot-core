import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getTeamByAbbreviation, NFL_TEAM_PRIMARY_COLORS } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { resolveTeamLogoAbbr } from "../../lib/team-logos.js";
import { recApi } from "../../lib/rec-api-client.js";
import { readStandingsBoardCache, writeStandingsBoardCache, type StandingsBoardResponse } from "../../lib/standings-board-cache.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { TeamLogo } from "../../components/ui/TeamLogo.js";

type PowerRankingTeam = NonNullable<StandingsBoardResponse["powerRankings"]>["teams"][number];
type SosTeam = NonNullable<StandingsBoardResponse["sos"]>["teams"][number];
type StandingsView = "division" | "power" | "sos";

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
  // Wait until layout has a real width — shrinking against 0/tiny widths collapses names.
  if (el.clientWidth < 48) {
    el.style.fontSize = `${maxPx}px`;
    el.style.transform = "";
    return maxPx;
  }
  const gutter = 1;
  // Was a linear 0.5px-at-a-time scan -- each iteration forces a synchronous layout read
  // (scrollWidth) right after a style write, and this runs per team row (city + nick label,
  // called up to 3x each for font-load/resize timing) on every Standings/Power Rankings/SOS
  // page load. At up to ~32 rows that's easily 1000+ forced reflows blocking the very first
  // paint. A coarser step size was tried here first, but with ~32 rows all running this same
  // effect within one React commit, cross-row layout timing noise could land on a visibly
  // different rounded size on different passes (the 3 invocations of `fit` below), producing
  // visible size-glitching between them. Binary search removes that risk entirely: it's an
  // EXACT equivalent of the original scan (same 0.5px-quantized precision, same final answer
  // for identical inputs), just O(log n) forced-layout reads instead of O(n).
  const steps = Math.round((maxPx - minPx) / 0.5);
  const sizeAtStep = (step: number) => Math.max(minPx, maxPx - step * 0.5);
  const fitsAtStep = (step: number) => {
    el.style.fontSize = `${sizeAtStep(step)}px`;
    return el.scrollWidth <= el.clientWidth - gutter;
  };
  let bestStep: number;
  if (fitsAtStep(0)) {
    bestStep = 0;
  } else if (!fitsAtStep(steps)) {
    bestStep = steps;
  } else {
    let lo = 0;
    let hi = steps;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (fitsAtStep(mid)) hi = mid; else lo = mid + 1;
    }
    bestStep = lo;
  }
  const size = sizeAtStep(bestStep);
  el.style.fontSize = `${size}px`;
  el.style.transform = "";
  // If still overflowing at the floor, keep the readable size and compress horizontally.
  if (el.scrollWidth > el.clientWidth - gutter && el.clientWidth > 0) {
    const scale = Math.max(0.72, (el.clientWidth - gutter) / el.scrollWidth);
    el.style.transform = `scaleX(${scale})`;
    el.style.transformOrigin = "left center";
  }
  return size;
}

/** City is always capped below the nick size so long cities never visually outrank short nicks. */
const CITY_TO_NICK_RATIO = 0.52;

function StandingIdentity({ city, nick, rank, eaUsername }: { city: string; nick: string; rank: number | null; eaUsername: string | null }) {
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
      const nickSize = fitLabelToWidth(nickEl, 26, 16);
      if (cityEl) {
        const cityMax = Math.min(14, nickSize * CITY_TO_NICK_RATIO);
        fitLabelToWidth(cityEl, cityMax, Math.min(cityMax, 8));
      }
    };

    fit();
    requestAnimationFrame(fit);
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
      <span className="hub-div-standing-nick-row">
        <strong ref={(node) => { nickRef.current = node; }} className="hub-div-standing-nick">{nick}</strong>
        {rank != null ? <span className="hub-div-standing-rank">(#{rank})</span> : null}
      </span>
      {eaUsername ? <small className="hub-div-standing-ea">{eaUsername}</small> : null}
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

  // SoS is no longer its own page (see StatsMiniNav) -- surfaced as a hover tooltip on the
  // card instead, appended to the existing team-name title.
  const sosTitle = sos ? ` · SoS ${sos.sosFull.toFixed(2)} (remaining ${sos.sosRemaining.toFixed(2)})` : "";

  return (
    <article
      className={`hub-div-standing-team${showPlayoff && (team.playoffMarker === "Y" || team.playoffMarker === "Z") ? " is-division-leader" : ""}`}
      style={{ ["--team-color" as string]: color, ["--team-ink" as string]: ink }}
      title={`${team.teamName}${sosTitle}`}
    >
      <TeamLogo abbreviation={team.abbr} alt="" className="hub-div-standing-logo" priority />
      <StandingIdentity city={city} nick={nick} rank={team.rank ?? null} eaUsername={team.eaUsername ?? null} />
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
  const [board, setBoard] = useState<StandingsBoardResponse | null>(() => readStandingsBoardCache(guildId));
  const [hubError, setHubError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !readStandingsBoardCache(guildId));
  // Power Rankings and Strength of Schedule are no longer separate destinations (see
  // StatsMiniNav) -- this is always the division view now; power rank shows inline per team
  // and SoS is a hover tooltip. StandingsView/the power/sos branches below are harmless dead
  // paths kept so an old bookmarked ?view=power/sos link still renders instead of erroring.
  const view: StandingsView = "division";

  useEffect(() => {
    let cancelled = false;
    const cached = readStandingsBoardCache(guildId);
    if (cached) {
      setBoard(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setHubError(null);

    recApi.getStandingsBoard(guildId)
      .then((next) => {
        if (cancelled) return;
        writeStandingsBoardCache(guildId, next);
        setBoard(next);
      })
      .catch((cause) => {
        if (cancelled) return;
        if (!readStandingsBoardCache(guildId)) {
          setHubError(cause instanceof Error ? cause.message : "Could not load standings.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [guildId]);

  const teams = board?.powerRankings?.teams ?? [];
  const sosByTeam = useMemo(() => {
    const map = new Map<string, SosTeam>();
    for (const team of board?.sos?.teams ?? []) map.set(team.teamId, team);
    return map;
  }, [board?.sos?.teams]);

  const boardTitle = "Division Standings";

  return (
    <div className="hub-section hub-standings-page">
      {hubError ? <ErrorState message={hubError} /> : loading && !board ? <LoadingState label="Loading standings…" /> : !board ? null : (
        <div className="hub-standings-board-wrap">
          <h2>{boardTitle}</h2>
          {view === "division" ? <PlayoffMarkerKey className="hub-standings-key" /> : null}
          <DivisionStandingsBoard teams={teams} view={view} sosByTeam={sosByTeam} />
        </div>
      )}
    </div>
  );
}
