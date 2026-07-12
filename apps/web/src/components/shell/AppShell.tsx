import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === "/";

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        {!isHome && (
          <button onClick={() => navigate(-1)} style={{ cursor: "pointer" }}>
            ← Back
          </button>
        )}
        <Link to="/" style={{ fontWeight: 600, textDecoration: "none", color: "inherit" }}>
          REC Bot
        </Link>
      </header>
      <main>{children}</main>
    </div>
  );
}
