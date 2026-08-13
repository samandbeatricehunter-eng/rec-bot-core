import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getKeepLoggedIn, setKeepLoggedIn, sitePublicUrl, supabase } from "./supabase-client.js";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session; user: User };

type AuthContextValue = AuthState & {
  signUp: (email: string, password: string, next?: string) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signIn: (
    email: string,
    password: string,
    keepLoggedIn?: boolean,
  ) => Promise<{ error: string | null }>;
  signInWithDiscord: (nextPath?: string, keepLoggedIn?: boolean) => Promise<{ error: string | null }>;
  linkDiscord: (nextPath?: string) => Promise<{ error: string | null }>;
  pickDiscordGuild: (leagueId?: string | null, nextPath?: string | null) => Promise<{ error: string | null }>;
  discordGuildOAuthUrl: () => Promise<{ url: string | null; error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function configureSessionPersistence(keepLoggedIn: boolean) {
  setKeepLoggedIn(keepLoggedIn);
  // Remove only Supabase auth state from the opposite store. Clearing all session storage
  // would also erase OAuth-adjacent state such as a pending promo code.
  try {
    const oppositeStore = keepLoggedIn ? sessionStorage : localStorage;
    for (const key of Object.keys(oppositeStore)) {
      if (key.startsWith("sb-") && key.includes("auth")) oppositeStore.removeItem(key);
    }
  } catch {
    /* ignore storage-restricted browsers */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState(
        data.session
          ? { status: "signed-in", session: data.session, user: data.session.user }
          : { status: "signed-out" },
      );
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: "signed-in", session, user: session.user } : { status: "signed-out" });
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signUp(email: string, password: string, next = "/account") {
    const emailRedirectTo = `${sitePublicUrl() || window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });
    if (error) return { error: error.message, needsEmailConfirmation: false };
    const needsEmailConfirmation = data.user != null && data.session == null;
    return { error: null, needsEmailConfirmation };
  }

  async function signIn(email: string, password: string, keepLoggedIn = false) {
    configureSessionPersistence(keepLoggedIn);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signInWithDiscord(nextPath = "/account", keepLoggedIn = false) {
    // This must be selected before the OAuth redirect: Supabase stores the PKCE verifier now,
    // then the callback stores the exchanged refresh session in the same backing store.
    configureSessionPersistence(keepLoggedIn);
    const redirectTo = `${sitePublicUrl() || window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo,
        scopes: "identify email",
      },
    });
    return { error: error?.message ?? null };
  }

  // Adds a Discord identity onto the *currently signed-in* account (email/password users
  // linking Discord later from My Account) rather than starting a fresh OAuth sign-in —
  // signInWithOAuth here would risk landing on a different auth user's session entirely.
  // Requires "Manual linking" enabled in Supabase Auth settings. The rec_link=discord marker
  // lets AuthCallback tell a linking round-trip apart from an email confirmation so a silent
  // Supabase-side link failure can be surfaced instead of "nothing happening".
  async function linkDiscord(nextPath = "/account") {
    const redirectTo = `${sitePublicUrl() || window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}&rec_link=discord`;
    const { error } = await supabase.auth.linkIdentity({
      provider: "discord",
      options: {
        redirectTo,
        scopes: "identify email",
      },
    });
    return { error: error?.message ?? null };
  }

  // A fresh Discord OAuth round-trip specifically to read the "guilds" list — not identity
  // linking. Supabase only hands back session.provider_token (the short-lived Discord access
  // token the guild picker needs) right when an OAuth flow completes, so this always re-runs
  // sign-in with prompt=consent to force Discord to re-issue one, even if Discord was already
  // linked ages ago. Safe to use signInWithOAuth (not linkIdentity) here even for an
  // already-linked account: the same Discord identity resolves back to the same site account.
  async function pickDiscordGuild(leagueId?: string | null, nextPath?: string | null) {
    const callback = new URL("/discord-guild-picker", sitePublicUrl() || window.location.origin);
    if (leagueId) callback.searchParams.set("leagueId", leagueId);
    if (nextPath) callback.searchParams.set("next", nextPath);
    const redirectTo = callback.toString();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo,
        scopes: "identify guilds",
        queryParams: { prompt: "consent" },
      },
    });
    return { error: error?.message ?? null };
  }

  // Same "guilds"-scoped OAuth round-trip as pickDiscordGuild, but returns the Discord
  // authorization URL instead of redirecting this tab. Used by the league-creation wizard to
  // open Discord in a popup (see /discord-guild-token), keep all wizard state intact, and
  // receive the short-lived provider_token back via postMessage for the server dropdown.
  async function discordGuildOAuthUrl() {
    const redirectTo = `${sitePublicUrl() || window.location.origin}/discord-guild-token`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo,
        scopes: "identify guilds",
        queryParams: { prompt: "consent" },
        skipBrowserRedirect: true,
      },
    });
    return { url: data?.url ?? null, error: error?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setKeepLoggedIn(false);
  }

  return (
    <AuthContext.Provider value={{ ...state, signUp, signIn, signInWithDiscord, linkDiscord, pickDiscordGuild, discordGuildOAuthUrl, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be within AuthProvider");
  return context;
}

export { getKeepLoggedIn };
