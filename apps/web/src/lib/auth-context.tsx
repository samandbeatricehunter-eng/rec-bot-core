import { createContext, useContext, useEffect, type ReactNode } from "react";
import { setAuthToken, setHubGuildId } from "./rec-api-client.js";

type AuthState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; discordId: string; guildId: string };

const AuthContext = createContext<AuthState>({ status: "loading" });

/** Site shell mounts hub UI with a Supabase bearer + known Discord guild context. */
export function InjectedAuthProvider({
  discordId,
  guildId,
  accessToken,
  children,
}: {
  discordId: string;
  guildId: string;
  accessToken: string;
  children: ReactNode;
}) {
  // Set synchronously so the first child render (and Strict Mode remounts) never
  // race a cleared token — that was blanking Discord /app hub loads.
  setAuthToken(accessToken);
  setHubGuildId(guildId);

  useEffect(() => {
    setAuthToken(accessToken);
    setHubGuildId(guildId);
  }, [accessToken, guildId]);

  return (
    <AuthContext.Provider value={{ status: "ready", discordId, guildId }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function useReadyAuth(): { discordId: string; guildId: string } {
  const auth = useAuth();
  if (auth.status !== "ready") throw new Error("useReadyAuth() called outside AuthGate");
  return auth;
}