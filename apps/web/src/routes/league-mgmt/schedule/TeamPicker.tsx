import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { ScheduleTeam } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { SearchInput } from "../../../components/ui/SearchInput.js";
import { Card } from "../../../components/ui/Card.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

export function TeamPicker() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [teams, setTeams] = useState<ScheduleTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    recApi
      .listScheduleTeams(guildId)
      .then((res) => setTeams(res.teams))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load teams."));
  }, [guildId]);

  const filtered = useMemo(() => {
    if (!teams) return [];
    const q = query.trim().toLowerCase();
    return q ? teams.filter((t) => t.name.toLowerCase().includes(q)) : teams;
  }, [teams, query]);

  return (
    <div>
      <PageHeader title="Schedule" subtitle="Pick the team whose schedule you're entering." />
      {error && <ErrorState message={error} />}
      {!teams && !error && <LoadingState label="Loading teams…" />}
      {teams && (
        <Card>
          <SearchInput
            placeholder="Search teams…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginBottom: "var(--space-4)" }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {filtered.map((team) => (
              <button
                key={team.id}
                onClick={() => navigate(`/league-mgmt/schedule/${team.id}`)}
                className="btn btn-secondary"
                style={{ justifyContent: "space-between", width: "100%", textAlign: "left" }}
              >
                <span>
                  {team.name} {team.conference ? <span style={{ color: "var(--text-secondary)" }}>({team.conference})</span> : ""}
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            {filtered.length === 0 && <p style={{ color: "var(--text-secondary)" }}>No teams match.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
