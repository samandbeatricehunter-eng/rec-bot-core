import { supabase } from "./supabase-client.js";

const ORIGINAL_SESSION_KEY = "rec-admin-original-session";
const TARGET_USERNAME_KEY = "rec-admin-impersonation-target";

export async function startImpersonation(input: {
  accessToken: string;
  refreshToken: string;
  targetUsername: string | null;
}): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    sessionStorage.setItem(
      ORIGINAL_SESSION_KEY,
      JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }),
    );
  }
  sessionStorage.setItem(TARGET_USERNAME_KEY, input.targetUsername ?? "this user");
  const { error } = await supabase.auth.setSession({
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
  });
  if (error) throw error;
}

export function isImpersonating(): boolean {
  try {
    return sessionStorage.getItem(ORIGINAL_SESSION_KEY) != null;
  } catch {
    return false;
  }
}

export function impersonationTargetName(): string | null {
  try {
    return sessionStorage.getItem(TARGET_USERNAME_KEY);
  } catch {
    return null;
  }
}

export async function endImpersonation(): Promise<void> {
  const raw = sessionStorage.getItem(ORIGINAL_SESSION_KEY);
  sessionStorage.removeItem(ORIGINAL_SESSION_KEY);
  sessionStorage.removeItem(TARGET_USERNAME_KEY);
  if (!raw) return;
  const original = JSON.parse(raw) as { access_token: string; refresh_token: string };
  await supabase.auth.setSession(original);
}
