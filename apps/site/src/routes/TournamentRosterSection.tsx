import { useEffect, useState } from "react";
import { siteApi, type SiteRosterLibraryTeam } from "../lib/site-api.js";

export function TournamentRosterSection({ libraryId }: { libraryId: string }) {
  const [teams, setTeams] = useState<SiteRosterLibraryTeam[]>([]);
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    siteApi.getRosterLibrary(libraryId)
      .then((result) => { if (!cancelled) setTeams(result.teams); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [libraryId]);

  if (loading) return null;
  if (!teams.length) return null;

  return (
    <div className="site-tournament-rosters">
      <h3>Rosters</h3>
      <div className="site-tournament-roster-grid">
        {teams.map((team) => (
          <div key={team.abbr} className="site-tournament-roster-team">
            <button
              type="button"
              className="site-btn site-btn-ghost"
              onClick={() => setOpenTeam(openTeam === team.abbr ? null : team.abbr)}
            >
              {team.name} ({team.players.length})
            </button>
            {openTeam === team.abbr ? (
              team.players.length ? (
                <ul className="site-tournament-roster-players">
                  {team.players.map((player) => (
                    <li key={player.id}>
                      {player.fullName}
                      {player.position ? ` — ${player.position}` : ""}
                      {player.overallRating != null ? ` (${player.overallRating} OVR)` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="site-muted">No roster imported for this team.</p>
              )
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
