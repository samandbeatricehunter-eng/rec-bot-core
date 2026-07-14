import { useEffect, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth-context.js";
import { AppShell } from "./components/shell/AppShell.js";
import { LeagueMgmtHome } from "./routes/league-mgmt/LeagueMgmtHome.js";
import { ManageLeagueHome } from "./routes/league-mgmt/manage-league/ManageLeagueHome.js";
import { TeamScheduleForm } from "./routes/league-mgmt/manage-league/TeamScheduleForm.js";
import { TeamOwnershipTable } from "./routes/league-mgmt/manage-league/TeamOwnershipTable.js";
import { LinkTeamForm } from "./routes/league-mgmt/manage-league/LinkTeamForm.js";
import { RolesHome } from "./routes/league-mgmt/manage-league/RolesHome.js";
import { PlayerStatsReview } from "./routes/league-mgmt/manage-league/PlayerStatsReview.js";
import { PendingPayoutsHome } from "./routes/league-mgmt/payouts/PendingPayoutsHome.js";
import { NotificationsHome } from "./routes/league-mgmt/notifications/NotificationsHome.js";
import { DeleteLeagueHome } from "./routes/league-mgmt/delete-league/DeleteLeagueHome.js";
import { SettingsHome } from "./routes/league-mgmt/settings/SettingsHome.js";
import { AdvanceHome } from "./routes/league-mgmt/advance/AdvanceHome.js";
import { CommissionerChatHome } from "./routes/league-mgmt/commissioner-chat/CommissionerChatHome.js";
import { PublishingHome } from "./routes/league-mgmt/publishing/PublishingHome.js";
import { RecruitingHome } from "./routes/league-mgmt/recruiting/RecruitingHome.js";
import { FirstTimeSetupHome } from "./routes/league-mgmt/first-time-setup/FirstTimeSetupHome.js";
import { HubHome } from "./routes/hub/HubHome.js";
import { recApi } from "./lib/rec-api-client.js";

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

function LeagueMgmtGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");
  useEffect(() => {
    if (auth.status !== "ready") return;
    let cancelled = false;
    recApi.getHub(auth.guildId)
      .then((hub) => { if (!cancelled) setAccess(hub.canManageLeague ? "allowed" : "denied"); })
      .catch(() => { if (!cancelled) setAccess("denied"); });
    return () => { cancelled = true; };
  }, [auth.status, auth.status === "ready" ? auth.guildId : null]);
  if (access === "loading") return <div className="hub-state"><h1>Checking league permissions…</h1></div>;
  if (access === "denied") return <div className="hub-state"><h1>League Management is restricted</h1><p>Only commissioners and co-commissioners can open this area.</p></div>;
  return <>{children}</>;
}

// LeagueMgmtGate can't be reused for First-Time Setup — it calls getHub(), which 404s
// (and so reports "denied") whenever no league is linked yet, which is exactly the
// state this page exists to fix. This checks Discord-level commissioner permission
// directly instead, independent of a league existing (same trust model
// createLeagueForServer itself already relies on server-side).
function FirstTimeSetupGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");
  useEffect(() => {
    if (auth.status !== "ready") return;
    let cancelled = false;
    recApi.getHubBootstrapStatus(auth.guildId)
      .then((status) => { if (!cancelled) setAccess(status.canSetup ? "allowed" : "denied"); })
      .catch(() => { if (!cancelled) setAccess("denied"); });
    return () => { cancelled = true; };
  }, [auth.status, auth.status === "ready" ? auth.guildId : null]);
  if (access === "loading") return <div className="hub-state"><h1>Checking permissions…</h1></div>;
  if (access === "denied") return <div className="hub-state"><h1>First-Time Setup is restricted</h1><p>Only Discord server admins or commissioners can set up a league.</p></div>;
  return <>{children}</>;
}

const managed = (page: React.ReactNode) => <LeagueMgmtGate>{page}</LeagueMgmtGate>;

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AuthGate>
          <AppShell>
            <Routes>
              <Route path="/" element={<HubHome />} />
              <Route path="/league-mgmt/first-time-setup" element={<FirstTimeSetupGate><FirstTimeSetupHome /></FirstTimeSetupGate>} />
              <Route path="/league-mgmt" element={managed(<LeagueMgmtHome />)} />
              <Route path="/league-mgmt/notifications" element={managed(<NotificationsHome />)} />
              <Route path="/league-mgmt/manage-league" element={managed(<ManageLeagueHome />)} />
              <Route path="/league-mgmt/manage-league/roles" element={managed(<RolesHome />)} />
              <Route path="/league-mgmt/manage-league/player-stats" element={managed(<PlayerStatsReview />)} />
              <Route path="/league-mgmt/payouts" element={managed(<PendingPayoutsHome />)} />
              <Route path="/league-mgmt/manage-league/teams" element={managed(<TeamOwnershipTable />)} />
              <Route path="/league-mgmt/manage-league/teams/link" element={managed(<LinkTeamForm />)} />
              <Route path="/league-mgmt/manage-league/:teamId" element={managed(<TeamScheduleForm />)} />
              <Route path="/league-mgmt/delete-league" element={managed(<DeleteLeagueHome />)} />
              <Route path="/league-mgmt/settings" element={managed(<SettingsHome />)} />
              <Route path="/league-mgmt/advance" element={managed(<AdvanceHome />)} />
              <Route path="/league-mgmt/commissioner-chat" element={managed(<CommissionerChatHome />)} />
              <Route path="/league-mgmt/publishing" element={managed(<PublishingHome />)} />
              <Route path="/league-mgmt/recruiting" element={managed(<RecruitingHome />)} />
            </Routes>
          </AppShell>
        </AuthGate>
      </HashRouter>
    </AuthProvider>
  );
}
