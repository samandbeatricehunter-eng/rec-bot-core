import { HashRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth-context.js";
import { AppShell } from "./components/shell/AppShell.js";
import { LeagueMgmtHome } from "./routes/league-mgmt/LeagueMgmtHome.js";
import { TeamPicker } from "./routes/league-mgmt/schedule/TeamPicker.js";
import { TeamScheduleForm } from "./routes/league-mgmt/schedule/TeamScheduleForm.js";
import { TeamOwnershipTable } from "./routes/league-mgmt/teams/TeamOwnershipTable.js";
import { LinkTeamForm } from "./routes/league-mgmt/teams/LinkTeamForm.js";
import { NotificationsHome } from "./routes/league-mgmt/notifications/NotificationsHome.js";
import { DeleteLeagueHome } from "./routes/league-mgmt/delete-league/DeleteLeagueHome.js";
import { RolesHome } from "./routes/league-mgmt/roles/RolesHome.js";
import { SettingsHome } from "./routes/league-mgmt/settings/SettingsHome.js";
import { FirstTimeSetupHome } from "./routes/league-mgmt/first-time-setup/FirstTimeSetupHome.js";

// This dashboard is only ever reached one way: an authorized user clicks "Open Web
// Dashboard" in Discord's League Mgmt panel, which opens this app in a normal browser tab
// with a signed session token in the URL — so League Mgmt IS the root route, not a tile
// behind some other landing page.
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
              <Route path="/" element={<LeagueMgmtHome />} />
              <Route path="/league-mgmt/notifications" element={<NotificationsHome />} />
              <Route path="/league-mgmt/schedule" element={<TeamPicker />} />
              <Route path="/league-mgmt/schedule/:teamId" element={<TeamScheduleForm />} />
              <Route path="/league-mgmt/teams" element={<TeamOwnershipTable />} />
              <Route path="/league-mgmt/teams/link" element={<LinkTeamForm />} />
              <Route path="/league-mgmt/delete-league" element={<DeleteLeagueHome />} />
              <Route path="/league-mgmt/roles" element={<RolesHome />} />
              <Route path="/league-mgmt/settings" element={<SettingsHome />} />
              <Route path="/league-mgmt/first-time-setup" element={<FirstTimeSetupHome />} />
            </Routes>
          </AppShell>
        </AuthGate>
      </HashRouter>
    </AuthProvider>
  );
}
