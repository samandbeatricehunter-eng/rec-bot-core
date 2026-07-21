import { createClient } from "@supabase/supabase-js";

// This is the ONLY Supabase client in the whole monorepo that uses the anon/publishable
// key — every other client (apps/api/src/lib/supabase.ts) uses the service role key and
// intentionally bypasses RLS. This client runs in the browser, so it can only ever do what
// RLS policies explicitly allow. Do not import the service role key here, ever.
const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — copy apps/site/.env.example to apps/site/.env and fill in the values.");
}

export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
