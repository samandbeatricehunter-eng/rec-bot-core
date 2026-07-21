import { useAuth } from "../lib/auth-context.js";

// Minimal signed-in placeholder — proves the Supabase session round-trips correctly.
// This is where league-account linking / the real dashboard lands in a later phase.
export function Account() {
  const auth = useAuth();
  if (auth.status !== "signed-in") return null;
  return (
    <div className="site-page site-auth-page">
      <div className="site-auth-card">
        <h1>You're signed in</h1>
        <p>Signed in as <strong>{auth.user.email}</strong>.</p>
        <p className="site-muted">User ID: {auth.user.id}</p>
        <button className="site-btn site-btn-ghost" onClick={() => void auth.signOut()}>Log Out</button>
      </div>
    </div>
  );
}
