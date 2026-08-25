import { useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { PageHeader } from "../../components/ui/PageHeader.js";

// This deliberately does not reuse LeagueStatsHome wholesale — that page bundles Power
// Rankings/Leaders/Resources chrome for the Season Stats destination. Career Stats is its own
// nav destination (LeagueRow3's Stats dropdown) and only needs the category/team browser,
// permanently pinned to scope="career" (the API already sums across every season for that scope
// — see league-stats.service.ts — so no new backend work was needed here).
import { CategoryStatsView, TeamStatsView } from "./LeagueStatsHome.js";

export function LeagueCareerStatsHome() {
  const { guildId } = useReadyAuth();
  const [view, setView] = useState<"category" | "team">("category");

  return (
    <div className="hub-section">
      <PageHeader title="Career Stats" subtitle="All-time player production across every season logged in this league." />
      <div className="rec-matchup-tabs" role="tablist" aria-label="Career stats view">
        <button type="button" role="tab" aria-selected={view === "category"} className={view === "category" ? "active" : ""} onClick={() => setView("category")}>Stats by Category</button>
        <button type="button" role="tab" aria-selected={view === "team"} className={view === "team" ? "active" : ""} onClick={() => setView("team")}>Stats by Team</button>
      </div>
      {view === "category" && <CategoryStatsView guildId={guildId} scope="career" />}
      {view === "team" && <TeamStatsView guildId={guildId} scope="career" />}
    </div>
  );
}
