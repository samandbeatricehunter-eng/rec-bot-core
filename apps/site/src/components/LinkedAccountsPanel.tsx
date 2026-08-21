import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth-context.js";
import {
  siteApi,
  type LinkProfileResponse,
  type StreamPlatform,
  type StreamingAccount,
  type StreamingAccountsResponse,
} from "../lib/site-api.js";

const STREAMING_PLATFORMS: Array<{
  id: StreamPlatform;
  name: string;
  hint: string;
  usernameLabel: string;
  placeholder: string;
}> = [
  {
    id: "twitch",
    name: "Twitch",
    hint: "Save your Twitch username so Share Stream can post twitch.tv/you without pasting a URL.",
    usernameLabel: "Twitch username",
    placeholder: "yourchannel",
  },
  {
    id: "youtube",
    name: "YouTube",
    hint: "Save the YouTube handle you livestream from. Share Stream posts youtube.com/@you/live.",
    usernameLabel: "YouTube handle",
    placeholder: "@yourchannel",
  },
  {
    id: "tiktok",
    name: "TikTok",
    hint: "Save your TikTok username so Share Stream can post your TikTok Live URL.",
    usernameLabel: "TikTok username",
    placeholder: "@yourname",
  },
];

function accountFor(accounts: StreamingAccount[], platform: StreamPlatform) {
  return accounts.find((row) => row.platform === platform) ?? null;
}

function platformConfigured(
  configured: StreamingAccountsResponse["configured"] | undefined,
  platform: StreamPlatform,
) {
  if (platform === "twitch") return Boolean(configured?.twitch);
  if (platform === "youtube") return Boolean(configured?.youtube);
  return Boolean(configured?.tiktokOAuth);
}

export function LinkedAccountsPanel({
  linked,
  onDiscordLinked,
}: {
  linked: LinkProfileResponse;
  onDiscordLinked?: () => void;
}) {
  const auth = useAuth();
  const [payload, setPayload] = useState<StreamingAccountsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usernameDrafts, setUsernameDrafts] = useState<Record<StreamPlatform, string>>({
    twitch: "",
    youtube: "",
    tiktok: "",
  });
  const [discordBusy, setDiscordBusy] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);

  const banner = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("streaming");
    const platform = params.get("platform");
    if (status === "linked") {
      return { kind: "success" as const, text: `${platform ? platform[0]!.toUpperCase() + platform.slice(1) : "Streaming account"} linked.` };
    }
    if (status === "error") {
      return { kind: "error" as const, text: "Could not finish linking that account. Try again." };
    }
    return null;
  }, []);

  useEffect(() => {
    if (!banner) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("streaming");
    params.delete("platform");
    params.delete("reason");
    params.set("tab", "linked");
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [banner]);

  async function refresh() {
    setLoadError(null);
    try {
      setPayload(await siteApi.getStreamingAccounts());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load linked accounts.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function startOAuth(platform: StreamPlatform) {
    setBusyPlatform(platform);
    setError(null);
    setNotice(null);
    try {
      const { url } = await siteApi.startStreamingOAuth(platform);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start linking.");
      setBusyPlatform(null);
    }
  }

  async function unlink(platform: StreamPlatform) {
    setBusyPlatform(platform);
    setError(null);
    setNotice(null);
    try {
      setPayload(await siteApi.unlinkStreamingAccount(platform));
      setNotice(`${platform[0]!.toUpperCase() + platform.slice(1)} unlinked.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlink that account.");
    } finally {
      setBusyPlatform(null);
    }
  }

  async function saveUsername(platform: StreamPlatform, name: string) {
    setBusyPlatform(platform);
    setError(null);
    setNotice(null);
    try {
      setPayload(await siteApi.linkStreamingUsername(platform, usernameDrafts[platform]));
      setUsernameDrafts((prev) => ({ ...prev, [platform]: "" }));
      setNotice(`${name} username saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not save that ${name} username.`);
    } finally {
      setBusyPlatform(null);
    }
  }

  async function linkDiscordAccount() {
    setDiscordBusy(true);
    setDiscordError(null);
    const { error: linkError } = await auth.linkDiscord("/account?tab=linked");
    if (linkError) {
      setDiscordError(linkError);
      setDiscordBusy(false);
      return;
    }
    onDiscordLinked?.();
  }

  async function unlinkDiscordAccount() {
    if (!window.confirm("Unlink Discord? Your REC profile, teams, wallet, and stats stay. You can link a new Discord afterward.")) return;
    setDiscordBusy(true);
    setDiscordError(null);
    try {
      await siteApi.unlinkDiscord();
      onDiscordLinked?.();
    } catch (err) {
      setDiscordError(err instanceof Error ? err.message : "Could not unlink Discord.");
    } finally {
      setDiscordBusy(false);
    }
  }

  async function replaceDiscordAccount() {
    if (!window.confirm("Replace Discord? You will sign in with the new Discord. Your REC profile, teams, wallet, and stats stay.")) return;
    setDiscordBusy(true);
    setDiscordError(null);
    try {
      await siteApi.unlinkDiscord();
      const { error: linkError } = await auth.linkDiscord("/account?tab=linked");
      if (linkError) {
        setDiscordError(linkError);
        setDiscordBusy(false);
      }
    } catch (err) {
      setDiscordError(err instanceof Error ? err.message : "Could not start Discord replace.");
      setDiscordBusy(false);
    }
  }

  const configured = payload?.configured;
  const accounts = payload?.accounts ?? [];
  const emailFirst = Boolean(auth.status === "signed-in" && auth.user.email) && !linked.discordUsername;

  return (
    <section className="site-account-panel">
      <h2>Linked accounts</h2>
      <p className="site-muted">
        Connect Discord and the platforms you stream on. Linked Twitch, YouTube, or TikTok
        accounts can confirm a matchup when you go live and post the stream to the game channel.
      </p>
      {banner?.kind === "success" ? <p className="site-auth-success">{banner.text}</p> : null}
      {banner?.kind === "error" ? <p className="site-auth-error">{banner.text}</p> : null}
      {loadError ? <p className="site-auth-error">{loadError}</p> : null}
      {error ? <p className="site-auth-error">{error}</p> : null}
      {notice ? <p className="site-auth-success">{notice}</p> : null}

      <div className="site-linked-account-group">
        <div className="site-linked-account-group-heading">
          <h3>Discord</h3>
          <p className="site-muted">
            {emailFirst
              ? "You signed up with email. Link Discord here to get bot DMs, join league servers, and post streams in Discord."
              : "Used for bot DMs, league servers, and stream posts in Discord."}
          </p>
        </div>
        <article className="site-linked-account-card">
          <header>
            <h4>Discord</h4>
            {linked.discordUsername ? (
              <span className="site-linked-account-status is-linked">Linked</span>
            ) : (
              <span className="site-linked-account-status">Not linked</span>
            )}
          </header>
          <p className="site-muted">
            {linked.discordUsername
              ? `Connected as ${linked.discordUsername}. If this Discord is banned or you made a new account, unlink or replace it — your teams, wallet, and stats stay.`
              : "Not required to use the site, but needed for Discord DMs and league server features."}
          </p>
          {linked.discordUsername && auth.status === "signed-in" && !auth.user.email ? (
            <p className="site-muted">
              Add an email login first so you can unlink Discord without losing site access. If you
              cannot sign in, a commissioner can relink Discord from League Tools.
            </p>
          ) : null}
          {linked.discordUsername ? (
            <div className="site-linked-account-actions">
              <button
                type="button"
                className="site-btn site-btn-primary"
                disabled={discordBusy || !auth.status || auth.status !== "signed-in" || !auth.user.email}
                onClick={() => void replaceDiscordAccount()}
              >
                {discordBusy ? "Working…" : "Replace Discord"}
              </button>
              <button
                type="button"
                className="site-btn site-btn-ghost"
                disabled={discordBusy || !auth.status || auth.status !== "signed-in" || !auth.user.email}
                onClick={() => void unlinkDiscordAccount()}
              >
                Unlink
              </button>
            </div>
          ) : (
            <div className="site-linked-account-actions">
              <button
                type="button"
                className="site-btn site-btn-primary"
                disabled={discordBusy}
                onClick={() => void linkDiscordAccount()}
              >
                {discordBusy ? "Redirecting…" : "Link Discord"}
              </button>
            </div>
          )}
          {discordError ? <p className="site-auth-error">{discordError}</p> : null}
        </article>
      </div>

      <div className="site-linked-account-group">
        <div className="site-linked-account-group-heading">
          <h3>Streaming</h3>
          <p className="site-muted">
            Save the username you go live on. Share Stream can then post without pasting a URL.
          </p>
        </div>
        <div className="site-linked-account-list">
          {STREAMING_PLATFORMS.map((platform) => {
            const account = accountFor(accounts, platform.id);
            const oauthReady = platformConfigured(configured, platform.id);
            const draft = usernameDrafts[platform.id];
            return (
              <article key={platform.id} className="site-linked-account-card">
                <header>
                  <h4>{platform.name}</h4>
                  {account ? (
                    <span className="site-linked-account-status is-linked">Linked</span>
                  ) : (
                    <span className="site-linked-account-status">Not linked</span>
                  )}
                </header>
                <p className="site-muted">{platform.hint}</p>
                {account ? (
                  <p>
                    Connected as <strong>{account.displayName || account.login}</strong>
                    {account.profileUrl ? (
                      <>
                        {" · "}
                        <a href={account.profileUrl} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <div className="site-linked-account-actions">
                  {account ? (
                    <button
                      type="button"
                      className="site-btn site-btn-ghost"
                      disabled={busyPlatform === platform.id}
                      onClick={() => void unlink(platform.id)}
                    >
                      {busyPlatform === platform.id ? "Working…" : "Unlink"}
                    </button>
                  ) : oauthReady ? (
                    <button
                      type="button"
                      className="site-btn site-btn-primary"
                      disabled={busyPlatform === platform.id}
                      onClick={() => void startOAuth(platform.id)}
                    >
                      {busyPlatform === platform.id ? "Redirecting…" : `Link ${platform.name}`}
                    </button>
                  ) : null}
                </div>
                {!account ? (
                  <div className="site-linked-account-username">
                    <label htmlFor={`${platform.id}-username`}>
                      {oauthReady ? `Or save a ${platform.usernameLabel}` : platform.usernameLabel}
                    </label>
                    <div className="site-linked-account-username-row">
                      <input
                        id={`${platform.id}-username`}
                        value={draft}
                        onChange={(event) => setUsernameDrafts((prev) => ({ ...prev, [platform.id]: event.target.value }))}
                        placeholder={platform.placeholder}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="site-btn site-btn-primary"
                        disabled={busyPlatform === platform.id || !draft.trim()}
                        onClick={() => void saveUsername(platform.id, platform.name)}
                      >
                        {busyPlatform === platform.id ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
