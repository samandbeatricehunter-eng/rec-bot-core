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
            ? <>
                <Link className="site-btn site-btn-ghost" to="/pricing">Pricing</Link>
                <Link className="site-btn site-btn-primary" to="/home">Go to Home</Link>
              </>
            : <>
                <Link className="site-btn site-btn-ghost" to="/pricing">Pricing</Link>
                <Link className="site-btn site-btn-ghost" to="/login">Log In</Link>
                <Link className="site-btn site-btn-primary" to="/signup">Sign Up</Link>
              </>}
        </nav>
      </header>
      <main className="site-hero">
        <h1>Manage your leagues and find new ones for CFB and Madden. All in one place, right at your fingertips.</h1>
        <p>
          Keep your matchups organized, bring your leagues to life with auto and custom headlines and interviews,
          Game of the Week, Game of the Year and Play of the Year voting. For platinum members, a discord bot
          (The REC Scout) is available if you prefer to manage your leagues through Discord. Track all-time stats
          across leagues and games, see where you rank amongst your comp and the world. Find H2H opponents that are
          also REC League members to track your stats and build your rep. This is your world - your league - at the
          tip of your fingers. Time to lock in.
        </p>
        {auth.status !== "signed-in" && (
          <div className="site-profile-actions">
            <Link className="site-btn site-btn-primary site-btn-lg" to="/signup">Create your account</Link>
            <Link className="site-btn site-btn-ghost site-btn-lg" to="/pricing">View plans</Link>
          </div>
        )}
      </main>
    </div>
  );
}