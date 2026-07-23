import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { getKeepLoggedIn, useAuth } from "../lib/auth-context.js";
import { safeInternalNext } from "../lib/safe-next.js";

export function LogIn() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const next = safeInternalNext(params.get("next")) ?? "/account";
  const signupHref = next === "/account" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keepLoggedIn, setKeepLoggedInChecked] = useState(() => getKeepLoggedIn());
  const [busy, setBusy] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.status === "signed-in") return <Navigate to={next} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await auth.signIn(email, password, keepLoggedIn);
    setBusy(false);
    if (result.error) setError(result.error);
  }

  async function handleDiscord() {
    setError(null);
    setDiscordBusy(true);
    const result = await auth.signInWithDiscord(next);
    setDiscordBusy(false);
    if (result.error) setError(result.error);
  }

  return (
    <div className="site-page site-auth-page">
      <form className="site-auth-card" onSubmit={handleSubmit}>
        <h1>Log in</h1>
        {error && <p className="site-auth-error">{error}</p>}
        <button
          className="site-btn site-btn-primary site-btn-lg"
          type="button"
          disabled={discordBusy || busy}
          onClick={() => void handleDiscord()}
        >
          {discordBusy ? "Opening Discord…" : "Continue with Discord"}
        </button>
        <p className="site-muted" style={{ textAlign: "center", margin: "12px 0" }}>or use email</p>
        <label className="site-field">
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="site-field">
          <span>Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="site-field site-field-checkbox">
          <input
            type="checkbox"
            checked={keepLoggedIn}
            onChange={(e) => setKeepLoggedInChecked(e.target.checked)}
          />
          <span>Keep me logged in</span>
        </label>
        <p className="site-muted">
          Leave unchecked to sign out when you close the browser or app.
        </p>
        <button className="site-btn site-btn-ghost site-btn-lg" type="submit" disabled={busy || discordBusy}>
          {busy ? "Logging in…" : "Log in with email"}
        </button>
        <p className="site-auth-switch">
          New here? <Link to={signupHref}>Create an account</Link>
        </p>
      </form>
    </div>
  );
}