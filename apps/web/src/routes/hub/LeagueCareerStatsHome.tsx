import { useReadyAuth } from "../../lib/auth-context.js";
import { PageHeader } from "../../components/ui/PageHeader.js";

// This deliberately does not reuse LeagueStatsHome wholesale — that page bundles Power
// Rankings/Leaders/Resources chrome for the Season Stats destination. Career Stats is its own
// nav destination (LeagueRow3's Stats dropdown) and only needs the team browser, permanently
// pinned to scope="career" (the API already sums across every season for that scope — see
// league-stats.service.ts — so no new backend work was needed here). No category/team pill
// switcher here either, for the same reason Season Stats dropped it: Stats by Team (with an
// All Teams option and sortable columns) replaced Stats by Category outright.
import { TeamStatsView } from "./LeagueStatsHome.js";

export function LeagueCareerStatsHome() {
  const { guildId } = useReadyAuth();

  return (
    <div className="hub-section">
      <PageHeader title="Career Stats" subtitle="All-time player production across every season logged in this league." />
      <TeamStatsView guildId={guildId} scope="career" />
    </div>
  );
}
