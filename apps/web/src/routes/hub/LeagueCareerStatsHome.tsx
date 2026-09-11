import { useReadyAuth } from "../../lib/auth-context.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { StatsMiniNav } from "../../components/hub/StatsMiniNav.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";

// This deliberately does not reuse LeagueStatsHome wholesale — that page bundles Leaders /
// Season / Team as separate mini-nav destinations. Career Stats is its own nav destination
// and only needs the team browser, permanently pinned to scope="career".
import { TeamStatsView } from "./LeagueStatsHome.js";

export function LeagueCareerStatsHome() {
  const { guildId } = useReadyAuth();
  const { currentLeague } = useHubChrome();

  return (
    <div className="hub-section">
      {currentLeague?.id ? <StatsMiniNav active="career" leagueId={currentLeague.id} /> : null}
      <PageHeader title="Career Stats" subtitle="All-time player production across every season logged in this league." />
      <TeamStatsView guildId={guildId} scope="career" />
    </div>
  );
}
