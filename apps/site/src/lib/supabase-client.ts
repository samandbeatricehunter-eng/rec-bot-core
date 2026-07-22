import { createClient, type SupportedStorage } from "@supabase/supabase-js";

const KEEP_LOGGED_IN_KEY = "rec-site-keep-logged-in";
const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — copy apps/site/.env.example to apps/site/.env and fill in the values.",
  );
}

export function setKeepLoggedIn(keep: boolean) {
  try {
    if (keep) localStorage.setItem(KEEP_LOGGED_IN_KEY, "1");
    else localStorage.removeItem(KEEP_LOGGED_IN_KEY);
  } catch {
    /* ignore */
  }
}

export function getKeepLoggedIn(): boolean {
  try {
    return localStorage.getItem(KEEP_LOGGED_IN_KEY) === "1";
  } catch {
    return false;
  }
}

function activeStore(): Storage {
  return getKeepLoggedIn() ? localStorage : sessionStorage;
}

const authStorage: SupportedStorage = {
  getItem: (key) => {
    try {
      return activeStore().getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      activeStore().setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: authStorage,
  },
});
