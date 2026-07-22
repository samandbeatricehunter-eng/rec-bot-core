import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getKeepLoggedIn, setKeepLoggedIn, sitePublicUrl, supabase } from "./supabase-client.js";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session; user: User };

type AuthContextValue = AuthState & {
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signIn: (
    email: string,
    password: string,
    keepLoggedIn?: boolean,
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

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

  async function signUp(email: string, password: string) {
    const emailRedirectTo = `${sitePublicUrl() || window.location.origin}/auth/callback`;
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
    setKeepLoggedIn(keepLoggedIn);
    // Drop the opposite storage so we don't resurrect a stale session later.
    try {
      if (keepLoggedIn) sessionStorage.clear();
      else {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("sb-") && key.includes("auth")) localStorage.removeItem(key);
        }
      }
    } catch {
      /* ignore */
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setKeepLoggedIn(false);
  }

  return (
    <AuthContext.Provider value={{ ...state, signUp, signIn, signOut }}>
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
