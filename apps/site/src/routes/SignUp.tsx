import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { getKeepLoggedIn, useAuth } from "../lib/auth-context.js";
import { safeInternalNext } from "../lib/safe-next.js";

export function SignUp() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const next = safeInternalNext(params.get("next")) ?? "/account";
  const loginHref = next === "/account" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [keepLoggedIn, setKeepLoggedInChecked] = useState(() => getKeepLoggedIn());
  const [busy, setBusy] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  // A brand-new email/password account has no tier yet (we don't offer a free tier) — send
  // them to pick Gold/Platinum instead of straight into the app. This only fires if Supabase
  // Auth is configured to skip email confirmation and hands back an immediate session; the
  // confirmation-link path goes through AuthCallback, which has its own version of this check.
  if (auth.status === "signed-in") return <Navigate to="/pricing" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords don't match."); return; }
    setBusy(true);
    const result = await auth.signUp(email, password);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    if (result.needsEmailConfirmation) setConfirmationSent(true);
  }

  async function handleDiscord() {
    setError(null);
    setDiscordBusy(true);
    const result = await auth.signInWithDiscord(next, keepLoggedIn);
    setDiscordBusy(false);
    if (result.error) setError(result.error);
  }

  if (confirmationSent) {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Check your email</h1>
          <p>We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account, then come back and log in.</p>
          <Link className="site-btn site-btn-ghost" to={loginHref}>Back to log in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="site-page site-auth-page">
      <form className="site-auth-card" onSubmit={handleSubmit}>
        <h1>Create your account</h1>
        {error && <p className="site-auth-error">{error}</p>}
        <label className="site-field site-field-checkbox">
          <input
            type="checkbox"
            checked={keepLoggedIn}
            onChange={(e) => setKeepLoggedInChecked(e.target.checked)}
          />
          <span>Keep me logged in on this device</span>
        </label>
        <p className="site-muted">Leave unchecked to sign out when you close the browser or app.</p>
        <button
          className="site-btn site-btn-primary site-btn-lg"
          type="button"
          disabled={discordBusy || busy}
          onClick={() => void handleDiscord()}
        >
          {discordBusy ? "Opening Discord…" : "Continue with Discord"}
        </button>
        <p className="site-muted" style={{ textAlign: "center", margin: "12px 0" }}>
          Played REC before through Discord? Use "Continue with Discord" above — it finds your
          existing leagues and stats. Signing up with email instead creates a brand-new, empty
          account.
        </p>
        <p className="site-muted" style={{ textAlign: "center", margin: "12px 0" }}>or use email</p>
        <label className="site-field">
          <span>Email</span>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="site-field">
          <span>Password</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="site-field">
          <span>Confirm password</span>
          <input type="password" required autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </label>
        <button className="site-btn site-btn-ghost site-btn-lg" type="submit" disabled={busy || discordBusy}>{busy ? "Creating account…" : "Sign up with email"}</button>
        <p className="site-auth-switch">Already have an account? <Link to={loginHref}>Log in</Link></p>
        <p className="site-auth-switch">See <Link to="/pricing">pricing</Link> before you join. Email-only accounts need a Gold or Platinum subscription. Active REC OG (CFB 27) members get lifetime Platinum when they sign in with Discord.</p>
      </form>
    </div>
  );
}
