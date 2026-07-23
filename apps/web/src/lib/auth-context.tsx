import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setAuthToken, setHubGuildId } from "./rec-api-client.js";

function decodeJwtPayload<T>(token: string): T {
  const [, payload] = token.split(".");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  return JSON.parse(atob(base64)) as T;
}

type AuthState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; discordId: string; guildId: string };

const AuthContext = createContext<AuthState>({ status: "loading" });

function readTokenFromUrl(): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get("token");
  if (fromSearch) return fromSearch;
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const qIndex = hash.indexOf("?");
  if (qIndex >= 0) return new URLSearchParams(hash.slice(qIndex + 1)).get("token");
  return null;
}

function sitePublicUrl() {
  return (import.meta.env.VITE_SITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, "")
    || "https://rec-leagues.com";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const token = readTokenFromUrl();
    if (!token) {
      const siteUrl = sitePublicUrl();
      try {
        if (new URL(siteUrl).origin === window.location.origin) {
          // Public domain is still serving the Discord hub app (miswired deploy).
          setState({
            status: "error",
            message: "This host is serving the Discord activity shell instead of the REC Leagues site. Open https://rec-leagues.com once the site service is attached to that domain.",
          });
          return;
        }
      } catch {
        // fall through
      }
      window.location.replace(siteUrl);
      const failsafe = window.setTimeout(() => {
        setState((current) =>
          current.status === "loading"
            ? {
                status: "error",
                message: `Could not reach the REC Leagues site. Try ${siteUrl} directly.`,
              }
            : current,
        );
      }, 2500);
      return () => window.clearTimeout(failsafe);
    }
    try {
      const payload = decodeJwtPayload<{ discordId: string; guildId: string; exp: number }>(token);
      if (payload.exp * 1000 < Date.now()) {
        setState({ status: "error", message: "This Discord app link has expired — run /app again, or open rec-leagues.com." });
        return;
      }
      setAuthToken(token);
      setHubGuildId(payload.guildId);
      setState({ status: "ready", discordId: payload.discordId, guildId: payload.guildId });
    } catch {
      setState({ status: "error", message: "This Discord app link is invalid — run /app again, or open rec-leagues.com." });
    }
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

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
  useEffect(() => {
    setAuthToken(accessToken);
    setHubGuildId(guildId);
    return () => {
      setAuthToken(null);
      setHubGuildId(null);
    };
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