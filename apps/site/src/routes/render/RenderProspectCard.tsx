import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ProspectCard } from "@rec/hub-ui";
import { siteApi, type ProspectCardRenderData } from "../../lib/site-api.js";

// Chromeless page Playwright screenshots for the Rise to Immortality player-card Discord post's
// image (apps/api/src/lib/prospect-card-render.ts) -- no SiteShell/nav, no auth, just the card.
// Same pattern as RenderPlayerOfWeek.tsx.
import "../../../../web/src/styles/tokens.css";
import "../../../../web/src/styles/themes/cfb27.css";
import "../../../../web/src/styles/themes/madden27.css";
import "../../../../web/src/styles/typography.css";
import "../../../../web/src/styles/surfaces.css";
import "../../../../web/src/styles/football-components.css";
import "../../../../web/src/styles/hub.css";

export function RenderProspectCard() {
  const { prospectId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [data, setData] = useState<ProspectCardRenderData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!prospectId || !token) {
      setError("Missing prospectId or token.");
      return;
    }
    siteApi.getProspectCardRenderData(prospectId, token)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load prospect card."));
  }, [prospectId, token]);

  if (error) return <div style={{ padding: 24, color: "#fff", fontFamily: "sans-serif" }}>{error}</div>;
  if (!data) return null;

  return (
    <div style={{ width: 1200, padding: 24, background: "#0b0d10" }}>
      <ProspectCard data={data} />
    </div>
  );
}
