import { Link } from "react-router-dom";

// Rendered on every main (non-league) page — never inside a league scope, where footer
// clutter would fight the hub's own chrome. See SiteShell (renders this when !isLeague)
// and the standalone marketing pages (Landing, Pricing) that sit outside SiteShell.
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="site-footer-links">
        <Link to="/help">Help / FAQ</Link>
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/terms">Terms of Service</Link>
      </div>
      <p className="site-footer-copyright">© {year} REC Leagues eSports. All rights reserved.</p>
      <p className="site-footer-disclaimer">
        REC Leagues eSports is an independent, fan-operated league management platform and is not
        affiliated with, endorsed by, or sponsored by Electronic Arts Inc., EA Sports, the National
        Football League, NFL Players Association, the NCAA, or any conference, team, or player
        referenced within the service. "Madden NFL," "EA Sports College Football," and all related
        names, logos, and trademarks are the property of their respective owners and are used here
        solely for descriptive and statistical purposes. Discord and the Discord logo are trademarks
        of Discord Inc.; REC Leagues eSports is not affiliated with or endorsed by Discord Inc.
        In-app coins are a virtual scorekeeping feature with no cash value, cannot be redeemed for
        money or prizes, and wagers between league members are for entertainment purposes only.
      </p>
    </footer>
  );
}
