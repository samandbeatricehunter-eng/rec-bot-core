import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth-context.js";

export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === "/";

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!isHome && (
            <button onClick={() => navigate(-1)} style={{ cursor: "pointer" }}>
              ← Back
            </button>
          )}
          <Link to="/" style={{ fontWeight: 600, textDecoration: "none", color: "inherit" }}>
            REC Bot
          </Link>
        </div>
        {auth.status === "ready" && <span style={{ fontSize: 13, opacity: 0.7 }}>{auth.username}</span>}
      </header>
      <main>{children}</main>
    </div>
  );
}
