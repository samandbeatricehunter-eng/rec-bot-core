import { useEffect, useState, type ReactNode } from "react";
import { americanFromDecimal } from "@rec/shared";
import { useHub } from "../lib/hub-context.js";
import { siteApi, type SiteAnnouncement, type SiteLeagueTickerItem } from "../lib/site-api.js";

const LEAGUE_POLL_MS = 60_000;
const ANNOUNCEMENT_POLL_MS = 5 * 60_000;

// Logo assets only exist for the 32 standard Madden teams (apps/web/public/assets/team-logos,
// mirrored onto the site's own public/assets at build time) -- null abbreviation (CFB schools,
// relocated/custom teams) just renders no image.
function TickerLogo({ abbreviation, alt }: { abbreviation: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!abbreviation || failed) return null;
  return <img src={`/assets/team-logos/${abbreviation.toUpperCase()}.png`} alt={alt} className="site-ticker-logo" onError={() => setFailed(true)} />;
}

function matchupSegment(item: SiteLeagueTickerItem): ReactNode {
  const away = <><TickerLogo abbreviation={item.awayTeamAbbr} alt={item.awayTeamName} />{item.awayTeamAbbr ?? item.awayTeamName}</>;
  const home = <><TickerLogo abbreviation={item.homeTeamAbbr} alt={item.homeTeamName} />{item.homeTeamAbbr ?? item.homeTeamName}</>;
  if (item.isFinal && item.awayScore != null && item.homeScore != null) {
    return <>{away} {item.awayScore} — {item.homeScore} {home} <span className="site-ticker-final">FINAL</span></>;
  }
  if (item.isLive && item.awayScore != null && item.homeScore != null) {
    return <><span className="site-ticker-live">● LIVE</span> {away} {item.awayScore} — {item.homeScore} {home}</>;
  }
  if (item.isLive) {
    return <><span className="site-ticker-live">● LIVE</span> {away} at {home}</>;
  }
  // Odds only ever come through pre-game (server omits them once a game is live/final).
  if (item.odds) {
    const ou = item.odds.overUnder != null ? ` · O/U ${item.odds.overUnder}` : "";
    return <>{away} at {home} — ML {americanFromDecimal(item.odds.awayMoneyline)}/{americanFromDecimal(item.odds.homeMoneyline)}{ou}</>;
  }
  return <>{away} at {home}</>;
}

function useLeagueTickerSegments(leagueId: string): ReactNode[] {
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
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") load(); };
    const interval = window.setInterval(refreshWhenVisible, LEAGUE_POLL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [leagueId]);

  if (items.length === 0) return ["No matchups scheduled this week."];
  return items.map(matchupSegment);
}

function useAnnouncementSegments(): ReactNode[] {
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
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") load(); };
    const interval = window.setInterval(refreshWhenVisible, ANNOUNCEMENT_POLL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, []);

  if (announcements.length === 0) return ["Welcome to REC Leagues."];
  return announcements.map((a) => (a.body ? `${a.title} — ${a.body}` : a.title));
}

function TickerTrack({ segments }: { segments: ReactNode[] }) {
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
