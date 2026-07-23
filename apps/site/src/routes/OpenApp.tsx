import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { safeInternalNext } from "../lib/safe-next.js";
import { siteApi } from "../lib/site-api.js";

export function OpenApp() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const handoff = params.get("handoff")?.trim() || "";
  const dest = params.get("dest")?.trim() || "";
  const [error, setError] = useState<string | null>(null);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== "signed-in" || !handoff) return;
    let cancelled = false;
    setError(null);
    setSetupMessage(null);
    siteApi
      .exchangeAppHandoff(handoff)
      .then((result) => {
        if (cancelled) return;
        if (result.status === "ready") {
          let path = result.sitePath;
          if (
            dest === "mgmt" &&
            path.startsWith("/l/") &&
            path.endsWith("/buzz")
          ) {
            path = path.replace(/\/buzz$/, "/mgmt");
          }
          navigate(path, { replace: true });
          return;
        }
        setSetupMessage(result.message);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not open your league.");
      });
    return () => {
      cancelled = true;
    };
  }, [auth.status, handoff, dest, navigate]);

  if (!handoff) {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Missing league link</h1>
          <p className="site-muted">
            Run <strong>/app</strong> in your league Discord and tap Open my league.
          </p>
          <Link className="site-btn site-btn-primary" to="/signup">
            Create account
          </Link>
        </div>
      </div>
    );
  }

  if (auth.status === "loading") {
    return <div className="site-page site-loading">Opening your league…</div>;
  }

  if (auth.status === "signed-out") {
    const nextPath = `/open-app?handoff=${encodeURIComponent(handoff)}${dest ? `&dest=${encodeURIComponent(dest)}` : ""}`;
    const next = safeInternalNext(nextPath) ?? "/signup";
    return <Navigate to={`/signup?next=${encodeURIComponent(next)}`} replace />;
  }

  if (setupMessage) {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Finish account setup</h1>
          <p>{setupMessage}</p>
          <Link className="site-btn site-btn-primary" to="/account">
            Go to Account
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Could not open league</h1>
          <p className="site-auth-error">{error}</p>
          <Link className="site-btn site-btn-ghost" to="/account">
            Account
          </Link>
        </div>
      </div>
    );
  }

  return <div className="site-page site-loading">Opening your league…</div>;
}