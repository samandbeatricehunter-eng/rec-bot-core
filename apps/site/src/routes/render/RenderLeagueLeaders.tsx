import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { siteApi, type LeagueLeadersRenderData } from "../../lib/site-api.js";

// Chromeless page Playwright screenshots for the Rise to Immortality "League Leaders" weekly
// Discord post's image (apps/api/src/lib/league-leaders-render.ts) -- no SiteShell/nav, no auth,
// just the board. Self-contained inline styles (no hub.css dependency), same overall pattern as
// RenderProspectCard.tsx/RenderProTracker.tsx.

const SILHOUETTE = "/assets/player-cards/player-silhouette.svg";

export function RenderLeagueLeaders() {
  const { leagueId = "", weekNumber = "" } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [data, setData] = useState<LeagueLeadersRenderData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId || !weekNumber || !token) {
      setError("Missing leagueId, weekNumber, or token.");
      return;
    }
    siteApi.getLeagueLeadersRenderData(leagueId, weekNumber, token)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load League Leaders."));
  }, [leagueId, weekNumber, token]);

  if (error) return <div style={{ padding: 24, color: "#fff", fontFamily: "sans-serif" }}>{error}</div>;
  if (!data) return null;

  return (
    <div
      data-league-leaders-render
      style={{
        width: 1200, padding: 32, background: "linear-gradient(180deg, #0b0d10 0%, #14181f 100%)",
        color: "#f4f6fb", fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 14, letterSpacing: 2, textTransform: "uppercase", color: "#8a93a6" }}>{data.leagueName}</div>
        <div style={{ fontSize: 34, fontWeight: 800 }}>League Leaders — Week {data.weekNumber}</div>
        <div style={{ fontSize: 14, color: "#8a93a6" }}>Season {data.seasonNumber}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {data.categories.map((category) => (
          <div key={category.key} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: "#e7ecf7" }}>{category.label}</div>
            {category.entries.length === 0 ? (
              <div style={{ fontSize: 13, color: "#6b7280" }}>No stats yet.</div>
            ) : (
              category.entries.map((entry, index) => (
                <div key={entry.playerId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: index === 0 ? "none" : "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ width: 18, fontSize: 13, color: "#6b7280", fontWeight: 700 }}>{index + 1}</div>
                  <img src={entry.photoUrl || SILHOUETTE} alt="" width={32} height={32} style={{ borderRadius: "50%", objectFit: "cover", background: "#222" }} />
                  {entry.teamLogoUrl ? <img src={entry.teamLogoUrl} alt="" width={20} height={20} style={{ objectFit: "contain" }} /> : null}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.playerName}</div>
                    <div style={{ fontSize: 11, color: "#8a93a6" }}>{[entry.position, entry.teamAbbr].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#2f81f7" }}>{entry.value.toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
