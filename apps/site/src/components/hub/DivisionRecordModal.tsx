import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NFL_TEAM_PRIMARY_COLORS } from "@rec/shared";
import { recApi } from "../../lib/rec-api-client.js";
import { resolveTeamLogoAbbr } from "../../lib/team-logos.js";
import { readStandingsBoardCache, writeStandingsBoardCache, type StandingsBoardResponse } from "../../lib/standings-board-cache.js";
import { Modal } from "../ui/Modal.js";
import { Button } from "../ui/Button.js";
import { TeamLogo } from "../ui/TeamLogo.js";
import { LoadingState } from "../ui/LoadingState.js";
import { ErrorState } from "../ui/ErrorState.js";

type PowerRankingTeam = NonNullable<StandingsBoardResponse["powerRankings"]>["teams"][number];

function teamColor(team: PowerRankingTeam): string {
  const raw = typeof team.primaryColor === "string" ? team.primaryColor.trim() : "";
  if (raw && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return raw;
  const abbr = resolveTeamLogoAbbr(team.abbr);
  if (abbr && NFL_TEAM_PRIMARY_COLORS[abbr]) return NFL_TEAM_PRIMARY_COLORS[abbr];
  return "#1a1d24";
}

function contrastingInk(hex: string): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return "#fff";
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.62 ? "#111111" : "#ffffff";
}

function formatRecord(team: PowerRankingTeam): string {
  return team.ties ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`;
}

function winPct(team: PowerRankingTeam): number {
  const games = team.wins + team.losses + team.ties;
  return games ? (team.wins + team.ties * 0.5) / games : 0;
}

/** Lightweight "just my division" popup for the My Team page's Season Record / Point
 * Differential shortcuts -- replaces navigating to the full Division Standings page (every
 * division, every conference) for what's usually a "how's my group doing" glance. Reuses the
 * same cached /v1/hub/standings-board endpoint the full Standings page uses (see
 * standings-board-cache.ts), so it's typically already warm by the time this opens. */
export function DivisionRecordModal({ guildId, leagueId, myTeamId, onClose }: {
  guildId: string; leagueId: string; myTeamId: string | null; onClose: () => void;
}) {
  const navigate = useNavigate();
  const [board, setBoard] = useState<StandingsBoardResponse | null>(() => readStandingsBoardCache(guildId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    recApi.getStandingsBoard(guildId)
      .then((next) => { if (!cancelled) { writeStandingsBoardCache(guildId, next); setBoard(next); } })
      .catch((cause) => { if (!cancelled && !board) setError(cause instanceof Error ? cause.message : "Could not load your division."); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  const teams = board?.powerRankings?.teams ?? [];
  const mine = myTeamId ? teams.find((t) => t.teamId === myTeamId) : null;
  const divisionTeams = mine
    ? teams.filter((t) => t.conference === mine.conference && t.division === mine.division)
      .sort((a, b) => winPct(b) - winPct(a) || b.wins - a.wins || a.teamName.localeCompare(b.teamName))
    : [];

  return (
    <Modal title={mine ? `${(mine.conference ?? "").toUpperCase()} ${mine.division ?? ""}`.trim() : "Your Division"} onClose={onClose}>
      {error && !board ? <ErrorState message={error} /> : !board ? <LoadingState label="Loading your division…" /> : !mine ? (
        <p className="hub-empty">Standings aren't available for your team yet.</p>
      ) : (
        <>
          <div className="hub-div-standing-stack">
            {divisionTeams.map((team) => {
              const color = teamColor(team);
              const ink = contrastingInk(color);
              return (
                <article
                  key={team.teamId}
                  className={`hub-div-standing-team${team.teamId === myTeamId ? " is-division-leader" : ""}`}
                  style={{ ["--team-color" as string]: color, ["--team-ink" as string]: ink }}
                  title={team.teamName}
                >
                  <TeamLogo abbreviation={team.abbr} alt="" className="hub-div-standing-logo" priority />
                  <div className="hub-div-standing-identity">
                    {team.city ? <small className="hub-div-standing-city">{team.city}</small> : null}
                    <strong className="hub-div-standing-nick">{team.nick || team.teamName}</strong>
                  </div>
                  <strong className="hub-div-standing-record">{formatRecord(team)}</strong>
                  {team.playoffMarker ? <span className="hub-div-standing-marker">{team.playoffMarker}</span> : null}
                </article>
              );
            })}
          </div>
          <Button
            variant="primary" size="compact" style={{ width: "100%", marginTop: 12 }}
            onClick={() => { onClose(); navigate(`/l/${leagueId}/playoff-bracket`); }}
          >
            View Full Playoff Bracket
          </Button>
        </>
      )}
    </Modal>
  );
}
