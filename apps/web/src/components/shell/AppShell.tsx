import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Trophy } from "lucide-react";
import { Button } from "../ui/Button.js";

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === "/";

  return (
    <div style={{ maxWidth: "var(--content-width)", margin: "0 auto", padding: "var(--space-5)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}>
        {!isHome && (
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ChevronLeft size={18} /> Back
          </Button>
        )}
        <Link
          to="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            fontWeight: 800,
            fontSize: "var(--text-lg)",
            textDecoration: "none",
            color: "var(--gold)",
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          <Trophy size={22} />
          REC LEAGUE
        </Link>
      </header>
      <main>{children}</main>
    </div>
  );
}
