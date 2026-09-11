// Canonical tweet/media identity roster -- single source of truth for the /tweets command's
// persona choices, replacing the old hand-typed array in discord-commands.ts (which included
// Jalen Cross, retired from the roster entirely per product decision). Content payload lives in
// ./config/tweet_personalities.json and ./config/random_fan_hater_accounts.json, same pattern as
// packages/shared/src/immortality/config/*.json + config.ts.
import tweetPersonalitiesJson from "./config/tweet_personalities.json" with { type: "json" };
import randomFanHaterJson from "./config/random_fan_hater_accounts.json" with { type: "json" };

export type TweetFixedAccountKey =
  | "marcus" | "vaughn" | "elliot" | "darius"
  | "rec_insider" | "nfl_front_office" | "gridiron_gospel" | "tmz";

export type TweetFixedAccountKind = "headline_personality" | "reporter_account";

export type TweetFixedAccount = {
  key: TweetFixedAccountKey;
  display: string;
  correspondentName: string;
  kind: TweetFixedAccountKind;
  handle: string;
  verified: boolean;
  headshotCatalogKey: string;
  outlet: string;
  role: string;
  coreBelief: string;
  primaryBeats: string[];
};

type RawFixedAccount = {
  key: string;
  display: string;
  correspondent_name: string;
  kind: string;
  handle: string;
  verified: boolean;
  headshot_catalog_key: string;
  outlet: string;
  role: string;
  core_belief: string;
  primary_beats: string[];
};

/** The 8 fixed REC Universe media identities (Jalen Cross intentionally excluded). */
export function tweetFixedAccounts(): TweetFixedAccount[] {
  return (tweetPersonalitiesJson.fixed_accounts as RawFixedAccount[]).map((row) => ({
    key: row.key as TweetFixedAccountKey,
    display: row.display,
    correspondentName: row.correspondent_name,
    kind: row.kind as TweetFixedAccountKind,
    handle: row.handle,
    verified: row.verified,
    headshotCatalogKey: row.headshot_catalog_key,
    outlet: row.outlet,
    role: row.role,
    coreBelief: row.core_belief,
    primaryBeats: row.primary_beats,
  }));
}

export function tweetFixedAccountByKey(key: string): TweetFixedAccount | undefined {
  return tweetFixedAccounts().find((account) => account.key === key);
}

/** The 4 headline personalities (marcus/vaughn/elliot/darius) that auto-react to game results. */
export function tweetReactiveHostKeys(): TweetFixedAccountKey[] {
  return tweetFixedAccounts().filter((a) => a.kind === "headline_personality").map((a) => a.key);
}

/**
 * Discord slash-command choices for /tweets: the 8 fixed accounts plus the two random-account
 * slots (Random Hater / Random Fan) -- exactly the "ten canonical slots" TWEETS_SETUP.md
 * describes. "Custom handle" is deliberately not included here; callers append it themselves
 * since it isn't a catalog identity.
 */
export function discordTweetPersonaChoices(): Array<{ name: string; value: string }> {
  return [
    ...tweetFixedAccounts().map((account) => ({ name: account.display, value: account.key })),
    { name: "Random Hater", value: "random_hater" },
    { name: "Random Fan", value: "random_fan" },
  ];
}

export type RandomCommunityAccount = { handle: string; voice: string; verified: false; headshot: null };

function randomAccountPool(kind: "fan" | "hater"): RandomCommunityAccount[] {
  const raw = (kind === "fan" ? randomFanHaterJson.fan_accounts : randomFanHaterJson.hater_accounts) as Array<{
    handle: string; voice: string; verified: boolean; headshot: string | null;
  }>;
  return raw.map((row) => ({ handle: row.handle, voice: row.voice, verified: false, headshot: null }));
}

/** Deterministic pick from the persistent fan/hater pool, seeded so the same seed always resolves
 *  to the same account (full persistent per-league/season assignment is a later phase). */
export function pickRandomCommunityAccount(kind: "fan" | "hater", seed: number): RandomCommunityAccount {
  const pool = randomAccountPool(kind);
  const index = ((seed % pool.length) + pool.length) % pool.length;
  return pool[index]!;
}
