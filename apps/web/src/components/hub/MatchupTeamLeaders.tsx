import { useEffect, useMemo, useState } from "react";
import { formatStatValue, getStatShortLabel } from "@rec/shared";
import { recApi } from "../../lib/rec-api-client.js";
import { PlayerPhoto } from "./PlayerPhoto.js";

type StatsPlayer = Awaited<ReturnType<typeof recApi.getLeagueStats>>["players"][number];

const SCORE_KEYS = [
  "pass_yards",
  "rush_yards",
  "receiving_yards",
  "pass_tds",
  "rush_tds",
  "receiving_tds",
  "tackles",
  "sacks",
  "interceptions",
] as const;

function productionScore(player: StatsPlayer) {
  return SCORE_KEYS.reduce((sum, key) => sum + (Number(player.stats[key]) || 0), 0);
}

function headlineLine(player: StatsPlayer): string {
  const ordered = SCORE_KEYS
    .map((key) => ({ key, value: Number(player.stats[key]) || 0 }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  if (!ordered.length) return "No production logged";
  return ordered
    .slice(0, 2)
    .map((row) => `${formatStatValue(row.key, row.value)} ${getStatShortLabel(row.key)}`)
    .join(" · ");
}

function TeamColumn({
  label,
  teamName,
  players,
}: {
  label: string;
  teamName: string;
  players: StatsPlayer[];
}) {
  const top = useMemo(
    () => [...players].sort((a, b) => productionScore(b) - productionScore(a)).slice(0, 3),
    [players],
  );

  return (
    <article className="hub-matchup-team-leaders-col">
      <header>
        <span>{label}</span>
        <strong>{teamName}</strong>
      </header>
      {!top.length ? (
        <p className="hub-matchup-team-leaders-empty">No player stats yet.</p>
      ) : (
        <ol>
          {top.map((player, index) => (
            <li key={player.id}>
              <em>#{index + 1}</em>
              <PlayerPhoto
                photoUrl={player.photoUrl}
                loading="lazy"
                className="hub-matchup-team-leaders-photo"
                fallback={<span className="hub-matchup-team-leaders-fallback">{player.position ?? "—"}</span>}
              />
              <div>
                <strong>{player.fullName}</strong>
                <span>{player.position ?? "—"} · {headlineLine(player)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/** Top 3 producers for each side of a matchup (season scope). */
export function MatchupTeamLeaders({
  guildId,
  awayTeamId,
  homeTeamId,
  awayTeamName,
  homeTeamName,
}: {
  guildId: string;
  awayTeamId: string | null;
  homeTeamId: string | null;
  awayTeamName: string;
  homeTeamName: string;
}) {
  const [away, setAway] = useState<StatsPlayer[] | null>(null);
  const [home, setHome] = useState<StatsPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setAway(null);
    setHome(null);

    const load = async (teamId: string | null) => {
      if (!teamId) return [] as StatsPlayer[];
      const result = await recApi.getLeagueStats({ guildId, teamId, scope: "season" });
      return result.players;
    };

    Promise.all([load(awayTeamId), load(homeTeamId)])
      .then(([awayPlayers, homePlayers]) => {
        if (cancelled) return;
        setAway(awayPlayers);
        setHome(homePlayers);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load team leaders.");
      });

    return () => {
      cancelled = true;
    };
  }, [guildId, awayTeamId, homeTeamId]);

  if (error) {
    return (
      <section className="hub-matchup-team-leaders">
        <p className="hub-matchup-team-leaders-empty">{error}</p>
      </section>
    );
  }

  if (away === null || home === null) {
    return (
      <section className="hub-matchup-team-leaders">
        <p className="hub-matchup-team-leaders-empty">Loading each team's top players…</p>
      </section>
    );
  }

  return (
    <section className="hub-matchup-team-leaders" aria-label="Top players">
      <header className="hub-matchup-team-leaders-head">
        <span>Top players</span>
        <small>Season production · top 3 per team</small>
      </header>
      <div className="hub-matchup-team-leaders-grid">
        <TeamColumn label="Away" teamName={awayTeamName} players={away} />
        <TeamColumn label="Home" teamName={homeTeamName} players={home} />
      </div>
    </section>
  );
}
