import { useEffect, useState } from "react";
import { americanFromDecimal } from "@rec/shared";
import { useHub } from "../lib/hub-context.js";
import { siteApi, type SiteAnnouncement, type SiteLeagueTickerItem } from "../lib/site-api.js";

const LEAGUE_POLL_MS = 20_000;
const ANNOUNCEMENT_POLL_MS = 60_000;

function matchupSegment(item: SiteLeagueTickerItem): string {
  const line = `${item.awayTeamName} at ${item.homeTeamName}`;
  if (item.isFinal && item.awayScore != null && item.homeScore != null) {
    return `${line} — FINAL ${item.awayScore}-${item.homeScore}`;
  }
  if (item.isLive && item.awayScore != null && item.homeScore != null) {
    return `● LIVE — ${line} ${item.awayScore}-${item.homeScore}`;
  }
  if (item.isLive) {
    return `● LIVE — ${line}`;
  }
  // Odds only ever come through pre-game (server omits them once a game is live/final).
  if (item.odds) {
    const ml = `ML ${item.awayTeamName} ${americanFromDecimal(item.odds.awayMoneyline)} / ${item.homeTeamName} ${americanFromDecimal(item.odds.homeMoneyline)}`;
    const ou = item.odds.overUnder != null ? ` · O/U ${item.odds.overUnder}` : "";
    return `${line} — ${ml}${ou}`;
  }
  return line;
}

function useLeagueTickerSegments(leagueId: string): string[] {
  const [items, setItems] = useState<SiteLeagueTickerItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    function load() {
      siteApi
        .getLeagueTicker(leagueId)
        .then((res) => { if (!cancelled) setItems(res.items); })
        .catch(() => { if (!cancelled) setItems([]); });
    }
    load();
    const interval = window.setInterval(load, LEAGUE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [leagueId]);

  if (items.length === 0) return ["No matchups scheduled this week."];
  return items.map(matchupSegment);
}

function useAnnouncementSegments(): string[] {
  const [announcements, setAnnouncements] = useState<SiteAnnouncement[]>([]);

  useEffect(() => {
    let cancelled = false;
    function load() {
      siteApi
        .listSiteAnnouncements()
        .then((res) => { if (!cancelled) setAnnouncements(res.announcements); })
        .catch(() => { if (!cancelled) setAnnouncements([]); });
    }
    load();
    const interval = window.setInterval(load, ANNOUNCEMENT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  if (announcements.length === 0) return ["Welcome to REC Leagues."];
  return announcements.map((a) => (a.body ? `${a.title} — ${a.body}` : a.title));
}

function TickerTrack({ segments }: { segments: string[] }) {
  // Render the segment list twice back-to-back so a 50%-width translate loops seamlessly.
  return (
    <div className="site-ticker-track">
      {[0, 1].map((copy) => (
        <div className="site-ticker-copy" key={copy} aria-hidden={copy === 1}>
          {segments.map((text, index) => (
            <span className="site-ticker-item" key={`${copy}-${index}`}>
              {text}
              <span className="site-ticker-sep" aria-hidden="true">★</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SiteTicker() {
  const hub = useHub();

  if (hub.scope.kind === "league") {
    return <LeagueTicker leagueId={hub.scope.leagueId} />;
  }
  return <AnnouncementTicker />;
}

function LeagueTicker({ leagueId }: { leagueId: string }) {
  const segments = useLeagueTickerSegments(leagueId);
  return (
    <div className="site-ticker" role="region" aria-label="League matchup ticker">
      <TickerTrack segments={segments} />
    </div>
  );
}

function AnnouncementTicker() {
  const segments = useAnnouncementSegments();
  return (
    <div className="site-ticker" role="region" aria-label="Site announcements ticker">
      <TickerTrack segments={segments} />
    </div>
  );
}
