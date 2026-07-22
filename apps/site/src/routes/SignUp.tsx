import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { safeInternalNext } from "../lib/safe-next.js";

export function SignUp() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const next = safeInternalNext(params.get("next")) ?? "/account";
  const loginHref = next === "/account" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  if (auth.status === "signed-in") return <Navigate to={next} replace />;

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
        <button className="site-btn site-btn-primary site-btn-lg" type="submit" disabled={busy}>{busy ? "Creating account…" : "Sign Up"}</button>
        <p className="site-auth-switch">Already have an account? <Link to={loginHref}>Log in</Link></p>
        <p className="site-auth-switch">See <Link to="/pricing">pricing</Link> before you join.</p>
      </form>
    </div>
  );
}