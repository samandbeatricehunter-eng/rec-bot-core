import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth-context.js";
import { Landing } from "./routes/Landing.js";
import { SignUp } from "./routes/SignUp.js";
import { LogIn } from "./routes/LogIn.js";
import { Account } from "./routes/Account.js";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (auth.status === "loading") return <div className="site-page site-loading">Loading…</div>;
  if (auth.status === "signed-out") return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Routed() {
  const auth = useAuth();
  if (auth.status === "loading") return <div className="site-page site-loading">Loading…</div>;
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/login" element={<LogIn />} />
      <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routed />
      </AuthProvider>
    </BrowserRouter>
  );
}
