import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase-client.js";

/**
 * Landing page for Supabase Auth email confirmation / magic links.
 * Confirm emails must use emailRedirectTo pointing here (and this path must be
 * allowlisted in the Supabase Auth redirect URL settings).
 */
export function AuthCallback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Confirming your email…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          // Hash tokens (implicit) are picked up by detectSessionInUrl.
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) {
            throw new Error("No session found after confirmation. Try signing in.");
          }
        }
        if (cancelled) return;
        setMessage("Email confirmed. Taking you to your account…");
        navigate("/account", { replace: true });
      } catch (cause) {
        if (cancelled) return;
        setFailed(true);
        setMessage(cause instanceof Error ? cause.message : "Could not confirm email.");
      }
    }

    void finish();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="site-page site-auth-callback">
      <h1>{failed ? "Confirmation failed" : "Almost there"}</h1>
      <p>{message}</p>
      {failed ? (
        <p>
          <Link to="/login">Back to log in</Link>
          {" · "}
          <Link to="/signup">Sign up again</Link>
        </p>
      ) : null}
    </div>
  );
}
