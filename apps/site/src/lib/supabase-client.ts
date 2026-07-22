import { createClient, type SupportedStorage } from "@supabase/supabase-js";

const KEEP_LOGGED_IN_KEY = "rec-site-keep-logged-in";

/** Public production defaults (anon/publishable only). Used when Vite env was not baked. */
const PROD_DEFAULTS = {
  VITE_SUPABASE_URL: "https://kyooxpjsxvsatrariafq.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5b294cGpzeHZzYXRyYXJpYWZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTkyMjksImV4cCI6MjA5NDg3NTIyOX0.AruGcjXxJlaRyPynMtzeCgsKkqfDJwQ2Ili-cZiSkuI",
  VITE_REC_CORE_API_URL: "https://recapi-production.up.railway.app",
  VITE_SITE_URL: "https://rec-leagues.com",
} as const;

type RuntimeConfig = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_REC_CORE_API_URL?: string;
  VITE_SITE_URL?: string;
};

declare global {
  interface Window {
    __REC_SITE_CONFIG__?: RuntimeConfig;
  }
}

function runtimeConfig(): RuntimeConfig {
  return typeof window !== "undefined" ? (window.__REC_SITE_CONFIG__ ?? {}) : {};
}

function envValue(key: keyof typeof PROD_DEFAULTS): string {
  const fromRuntime = runtimeConfig()[key]?.trim();
  if (fromRuntime) return fromRuntime;
  const baked = (import.meta.env[key] as string | undefined)?.trim();
  if (baked) return baked;
  return PROD_DEFAULTS[key];
}

const url = envValue("VITE_SUPABASE_URL");
const publishableKey = envValue("VITE_SUPABASE_PUBLISHABLE_KEY");

if (!url || !publishableKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — set production env or apps/site/.env.",
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

export function sitePublicUrl(): string {
  return envValue("VITE_SITE_URL") || (typeof window !== "undefined" ? window.location.origin : "");
}

export function siteApiBaseUrl(): string {
  return envValue("VITE_REC_CORE_API_URL");
}
