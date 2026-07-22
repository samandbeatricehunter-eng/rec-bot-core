import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase-client.js";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session; user: User };

type AuthContextValue = AuthState & {
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState(data.session ? { status: "signed-in", session: data.session, user: data.session.user } : { status: "signed-out" });
    });
    // Keeps state in sync across tabs, token refresh, and the sign-up/sign-in/sign-out
    // calls below (they don't need to setState themselves — this listener catches it).
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: "signed-in", session, user: session.user } : { status: "signed-out" });
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signUp(email: string, password: string) {
    const emailRedirectTo = `${import.meta.env.VITE_SITE_URL ?? window.location.origin}/auth/callback`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });
    if (error) return { error: error.message, needsEmailConfirmation: false };
    // If email confirmation is required, Supabase returns a user but no session yet.
    const needsEmailConfirmation = data.user != null && data.session == null;
    return { error: null, needsEmailConfirmation };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return <AuthContext.Provider value={{ ...state, signUp, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
