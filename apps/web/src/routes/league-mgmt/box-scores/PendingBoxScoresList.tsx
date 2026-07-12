import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { PendingBoxScore } from "../../../types/api.js";

export function PendingBoxScoresList() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<PendingBoxScore[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    recApi
      .listPendingBoxScores(guildId)
      .then((res) => setSubmissions(res.submissions))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load pending submissions."));
  }

  useEffect(load, [guildId]);

  return (
    <div>
      <h2>Pending Box Scores</h2>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!submissions && !error && <p>Loading…</p>}
      {submissions && submissions.length === 0 && <p>No submissions awaiting review.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {submissions?.map((sub) => (
          <li key={sub.id}>
            <button
              onClick={() => navigate(`/league-mgmt/box-scores/${sub.id}`)}
              style={{ width: "100%", textAlign: "left", padding: 8, marginBottom: 4, cursor: "pointer" }}
            >
              Week {sub.week_number ?? "?"}: {sub.team1_abbr ?? "?"} {sub.away_score ?? "-"} @ {sub.team2_abbr ?? "?"} {sub.home_score ?? "-"}
            </button>
          </li>
        ))}
      </ul>
      <Link to="/league-mgmt">← League Mgmt</Link>
    </div>
  );
}
