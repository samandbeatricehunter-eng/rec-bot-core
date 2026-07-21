import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";

// Public marketing home — the future root of the site once Discord auth is retired. Kept
// deliberately minimal for now: this is the phase-1 shell to prove Supabase Auth end to
// end. Real content/branching pages come once this foundation is confirmed working.
export function Landing() {
  const auth = useAuth();
  return (
    <div className="site-page site-landing">
      <header className="site-nav">
        <span className="site-wordmark">REC League</span>
        <nav>
          {auth.status === "signed-in"
            ? <Link className="site-btn site-btn-primary" to="/account">My Account</Link>
            : <>
                <Link className="site-btn site-btn-ghost" to="/login">Log In</Link>
                <Link className="site-btn site-btn-primary" to="/signup">Sign Up</Link>
              </>}
        </nav>
      </header>
      <main className="site-hero">
        <h1>Run your league. All in one place.</h1>
        <p>Matchups, stats, standings, wagers, and more — the REC League hub is moving off Discord and onto the web. This is an early preview.</p>
        {auth.status !== "signed-in" && <Link className="site-btn site-btn-primary site-btn-lg" to="/signup">Create your account</Link>}
      </main>
    </div>
  );
}
