import { useReadyAuth, useHubChrome } from "@rec/hub-ui";
import { PageHeader } from "../../../../../web/src/components/ui/PageHeader.js";
import { LoadingState } from "../../../../../web/src/components/ui/LoadingState.js";
import { ImportDataModal } from "./manage-league/ImportDataModal.js";

/** Games tile destination — data import wizard as the page body. */
export function ImportGamesPage() {
  const { guildId } = useReadyAuth();
  const chrome = useHubChrome();
  const leagueId = chrome.currentLeague?.id ?? null;

  if (!leagueId) return <LoadingState label="Loading league…" />;

  return (
    <div>
      <PageHeader
        title="Import Scores"
        subtitle="Pull schedule and scores from EA or companion, or close this wizard when you're done."
      />
      <div className="advance-card advance-card-primary">
        <ImportDataModal guildId={guildId} leagueId={leagueId} embedded onClose={() => undefined} />
      </div>
    </div>
  );
}
