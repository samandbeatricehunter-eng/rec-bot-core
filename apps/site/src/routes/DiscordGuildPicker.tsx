import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { safeInternalNext } from "../lib/safe-next.js";
import { siteApi } from "../lib/site-api.js";
import { supabase } from "../lib/supabase-client.js";

type DiscordGuild = { id: string; name: string; icon: string | null };

/**
 * Replaces the old "invite a generic bot link, hope you pick the right server" flow: a fresh
 * Discord OAuth round-trip (see auth.pickDiscordGuild) grants "guilds" scope just long enough
 * to list the servers this user can install the bot into, so they pick the right one from a
 * dropdown instead. The final /claim-league step in Discord still happens — that's the
 * server-owner-only security check — this only removes the guesswork before it.
 */
export function DiscordGuildPicker() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const leagueId = params.get("leagueId");
  const next = safeInternalNext(params.get("next")) ?? "/leagues?tab=mine";

  const [phase, setPhase] = useState<"intro" | "loading" | "picking" | "connecting" | "done" | "error">("intro");
  const [error, setError] = useState<string | null>(null);
  const [guilds, setGuilds] = useState<DiscordGuild[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState("");
  const [connectResult, setConnectResult] = useState<{ inviteUrl: string; token: string } | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    // No ?code means the OAuth redirect came back in the URL fragment (#access_token=…) — the
    // supabase client picks that up during initialization, so poll for the resulting session
    // (same handling as the /discord-guild-token popup).
    if (!code && !url.hash) return;

    let cancelled = false;
    setPhase("loading");
    (async () => {
      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }
        let session = null;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (data.session) {
            session = data.session;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!session) throw new Error("Discord didn't return a permission grant — try again.");

        const expectedUid = sessionStorage.getItem("rec_guild_picker_expected_uid");
        sessionStorage.removeItem("rec_guild_picker_expected_uid");
        if (expectedUid && session.user.id !== expectedUid) {
          throw new Error(
            "This Discord account is linked to a different REC account. Sign back into your original account and try again.",
          );
        }

        const providerToken = session.provider_token;
        if (!providerToken) {
          throw new Error("Discord didn't return a fresh permission grant — try again.");
        }
        const result = await siteApi.listDiscordGuilds(providerToken);
        if (cancelled) return;
        if (!result.guilds.length) {
          setError("No Discord servers found where you're the owner or have Manage Server permission.");
          setPhase("error");
          return;
        }
        setGuilds(result.guilds);
        setSelectedGuildId(result.guilds[0].id);
        setPhase("picking");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load your Discord servers.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startPicker() {
    setError(null);
    // If this Discord account happens to already be linked to a *different* REC account (an
    // edge case the "claim identity" flow is meant to prevent, but not impossible), Supabase's
    // OAuth sign-in would land the browser on that other session instead. Stash who we expect
    // to still be signed in as, so the return trip can catch that rather than silently acting
    // on the wrong account.
    if (auth.status === "signed-in") sessionStorage.setItem("rec_guild_picker_expected_uid", auth.user.id);
    const returnPath = `/discord-guild-picker?leagueId=${encodeURIComponent(leagueId ?? "")}&next=${encodeURIComponent(next)}`;
    const result = await auth.pickDiscordGuild(returnPath);
    if (result.error) setError(result.error);
  }

  async function connectToLeague() {
    if (!leagueId || !selectedGuildId) return;
    setPhase("connecting");
    setError(null);
    try {
      const [enabled, invite] = await Promise.all([
        siteApi.enableLeagueBot(leagueId),
        siteApi.getBotInviteUrl(selectedGuildId),
      ]);
      setConnectResult({ inviteUrl: invite.inviteUrl, token: enabled.league.discord_bot_invite_token ?? "" });
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable the Discord bot.");
      setPhase("picking");
    }
  }

  if (!leagueId) {
    return (
      <div className="site-page site-auth-page">
        <div className="site-auth-card">
          <h1>Missing league</h1>
          <p>Open this from a league's "Connect a Discord Server" action.</p>
          <Link className="site-btn site-btn-ghost" to="/leagues">Back to Leagues</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="site-page site-auth-page">
      <div className="site-auth-card">
        <h1>Connect a Discord Server</h1>
        {error && <p className="site-auth-error">{error}</p>}

        {phase === "intro" && (
          <>
            <p className="site-muted">
              Grant a one-time permission so we can show only the Discord servers you own or manage —
              no more guessing which invite link goes where.
            </p>
            <button className="site-btn site-btn-primary site-btn-lg" type="button" onClick={() => void startPicker()}>
              Continue with Discord
            </button>
          </>
        )}

        {phase === "loading" && <p className="site-muted">Loading your Discord servers…</p>}

        {phase === "picking" && (
          <>
            <label className="site-field">
              <span>Server</span>
              <select className="site-select" value={selectedGuildId} onChange={(e) => setSelectedGuildId(e.target.value)}>
                {guilds.map((guild) => (
                  <option key={guild.id} value={guild.id}>{guild.name}</option>
                ))}
              </select>
            </label>
            <button className="site-btn site-btn-primary site-btn-lg" type="button" onClick={() => void connectToLeague()}>
              Use this server
            </button>
          </>
        )}

        {phase === "connecting" && <p className="site-muted">Setting things up…</p>}

        {phase === "done" && connectResult && (
          <>
            <p className="site-muted">Finish linking this league to your Discord server:</p>
            <ol className="site-muted">
              <li>
                <a href={connectResult.inviteUrl} target="_blank" rel="noreferrer">Invite the REC bot</a> — the server is
                already pre-selected, just confirm the permissions.
              </li>
              <li>In that server, run <code>/claim-league</code> and paste this token when prompted:</li>
            </ol>
            <code className="site-league-card-token">{connectResult.token}</code>
            <p className="site-muted">Only that server's owner can run /claim-league — anyone else running it will be rejected.</p>
            <Link className="site-btn site-btn-ghost" to={next}>Back to Leagues</Link>
          </>
        )}

        {phase === "error" && (
          <button className="site-btn site-btn-ghost" type="button" onClick={() => void startPicker()}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
