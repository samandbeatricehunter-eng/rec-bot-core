import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { discordSdk, ensureDiscordSdkReady } from "./discord-sdk.js";
import { recApi, setAuthToken, setUnauthorizedHandler } from "./rec-api-client.js";

type AuthState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; discordId: string; guildId: string; username: string };

const AuthContext = createContext<AuthState>({ status: "loading" });

// Discord's Embedded App SDK authorize() call, exchanged for our own short-lived JWT.
// Runs once on mount and again (silently) whenever the API returns a 401 for an expired
// token — see rec-api-client.ts's recApiFetch retry-once-on-401 wrapper.
async function runAuthSequence(): Promise<{ token: string; discordId: string; guildId: string; username: string }> {
  await ensureDiscordSdkReady();
  const guildId = discordSdk.guildId;
  if (!guildId) throw new Error("This app must be opened as a Discord Activity inside a server.");

  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: "code",
    scope: ["identify"],
  });

  const result = await recApi.exchangeActivityAuth({ code, guildId });
  return { token: result.token, discordId: result.discordId, guildId: result.guildId, username: result.username };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  // Guards against the retry handler and the initial mount both re-running the sequence
  // concurrently — recApiFetch awaits whichever run is already in flight.
  const inFlight = useRef<Promise<string | null> | null>(null);

  const reauthorize = useCallback(async (): Promise<string | null> => {
    if (!inFlight.current) {
      inFlight.current = runAuthSequence()
        .then((result) => {
          setAuthToken(result.token);
          setState({ status: "ready", discordId: result.discordId, guildId: result.guildId, username: result.username });
          return result.token;
        })
        .catch((error) => {
          setState({ status: "error", message: error instanceof Error ? error.message : "Failed to authenticate with Discord." });
          return null;
        })
        .finally(() => {
          inFlight.current = null;
        });
    }
    return inFlight.current;
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(reauthorize);
    void reauthorize();
    return () => setUnauthorizedHandler(null);
  }, [reauthorize]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

// Every screen renders only inside App.tsx's AuthGate, which already blocks rendering
// until status is "ready" — this just gives screens a non-nullable type for that fact
// instead of re-narrowing `useAuth()` in every component.
export function useReadyAuth(): { discordId: string; guildId: string; username: string } {
  const auth = useAuth();
  if (auth.status !== "ready") throw new Error("useReadyAuth() called outside AuthGate");
  return auth;
}
