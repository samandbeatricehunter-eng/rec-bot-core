import { HashRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth-context.js";
import { AppShell } from "./components/shell/AppShell.js";
import { MainMenu } from "./routes/MainMenu.js";
import { LeagueMgmtHome } from "./routes/league-mgmt/LeagueMgmtHome.js";
import { TeamPicker } from "./routes/league-mgmt/schedule/TeamPicker.js";
import { TeamScheduleForm } from "./routes/league-mgmt/schedule/TeamScheduleForm.js";
import { TeamOwnershipTable } from "./routes/league-mgmt/teams/TeamOwnershipTable.js";
import { LinkTeamForm } from "./routes/league-mgmt/teams/LinkTeamForm.js";
import { PendingBoxScoresList } from "./routes/league-mgmt/box-scores/PendingBoxScoresList.js";
import { BoxScoreDetail } from "./routes/league-mgmt/box-scores/BoxScoreDetail.js";

// HashRouter (not BrowserRouter) — Discord routes this app through URL Mappings, and a
// hash-based route never needs the proxy to understand app-internal paths, which a
// history-API route would require server-side rewrite rules for.
function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (auth.status === "loading") return <p>Signing you in…</p>;
  if (auth.status === "error") return <p>Couldn't sign in: {auth.message}</p>;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AuthGate>
          <AppShell>
            <Routes>
              <Route path="/" element={<MainMenu />} />
              <Route path="/league-mgmt" element={<LeagueMgmtHome />} />
              <Route path="/league-mgmt/schedule" element={<TeamPicker />} />
              <Route path="/league-mgmt/schedule/:teamId" element={<TeamScheduleForm />} />
              <Route path="/league-mgmt/teams" element={<TeamOwnershipTable />} />
              <Route path="/league-mgmt/teams/link" element={<LinkTeamForm />} />
              <Route path="/league-mgmt/box-scores" element={<PendingBoxScoresList />} />
              <Route path="/league-mgmt/box-scores/:submissionId" element={<BoxScoreDetail />} />
            </Routes>
          </AppShell>
        </AuthGate>
      </HashRouter>
    </AuthProvider>
  );
}
