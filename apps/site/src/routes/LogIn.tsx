import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";

export function LogIn() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.status === "signed-in") return <Navigate to="/account" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await auth.signIn(email, password);
    setBusy(false);
    if (result.error) setError(result.error);
  }

  return (
    <div className="site-page site-auth-page">
      <form className="site-auth-card" onSubmit={handleSubmit}>
        <h1>Log in</h1>
        {error && <p className="site-auth-error">{error}</p>}
        <label className="site-field">
          <span>Email</span>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="site-field">
          <span>Password</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="site-btn site-btn-primary site-btn-lg" type="submit" disabled={busy}>{busy ? "Logging in…" : "Log In"}</button>
        <p className="site-auth-switch">New here? <Link to="/signup">Create an account</Link></p>
      </form>
    </div>
  );
}
