import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import {
  exchangeEaAuthCode,
  getEaLoginUrl,
  type RecEaConsole
} from "./ea-companion-client.js";

export type EaConnectStatusInput = {
  discordId: string;
  console?: RecEaConsole;
};

export type EaConnectCompleteInput = {
  discordId: string;
  code: string;
  console?: RecEaConsole;
};

async function loadRecUserIdForDiscordId(discordId: string) {
  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (account.error) {
    throw new ApiError(500, "Failed to load Discord account for EA connect.", account.error);
  }

  if (!account.data?.user_id) {
    throw new ApiError(404, "Discord account was not found in REC Core. Open /menu once before connecting EA.");
  }

  return account.data.user_id as string;
}

function getDefaultConsole() {
  return (env.EA_MCA_DEFAULT_CONSOLE ?? "pc") as RecEaConsole;
}

function hasUsableToken(account: Record<string, any> | null | undefined) {
  return Boolean(account?.access_token && account?.refresh_token && account?.expires_at && account?.blaze_id);
}

function publicAccount(account: Record<string, any> | null | undefined) {
  if (!account) return null;

  return {
    id: account.id,
    userId: account.user_id,
    eaPersonaName: account.ea_persona_name,
    gamertag: account.gamertag,
    platform: account.platform,
    blazeId: account.blaze_id,
    verifiedAt: account.verified_at,
    updatedAt: account.updated_at,
    hasToken: hasUsableToken(account)
  };
}

export async function getEaConnectStatus(input: EaConnectStatusInput) {
  const userId = await loadRecUserIdForDiscordId(input.discordId);

  let query = supabase
    .from("rec_ea_accounts")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (input.console) query = query.eq("platform", input.console);

  const accounts = await query.limit(1);

  if (accounts.error) {
    throw new ApiError(500, "Failed to load EA account connection status.", accounts.error);
  }

  const account = accounts.data?.[0] ?? null;

  return {
    userId,
    account: publicAccount(account),
    connected: hasUsableToken(account),
    loginUrl: getEaLoginUrl(),
    defaultConsole: getDefaultConsole()
  };
}

export async function completeEaConnect(input: EaConnectCompleteInput) {
  const userId = await loadRecUserIdForDiscordId(input.discordId);
  const console = input.console ?? getDefaultConsole();
  const exchanged = await exchangeEaAuthCode({ code: input.code.trim(), console });
  const now = new Date().toISOString();

  const payload = {
    user_id: userId,
    platform: console,
    blaze_id: exchanged.token.blazeId,
    access_token: exchanged.token.accessToken,
    refresh_token: exchanged.token.refreshToken,
    expires_at: exchanged.token.expiry.toISOString(),
    source: "ea_oauth",
    verified_at: now,
    updated_at: now,
    raw_payload: exchanged.raw
  };

  const saved = await supabase
    .from("rec_ea_accounts")
    .upsert(payload, { onConflict: "user_id,platform" })
    .select("*")
    .single();

  if (saved.error) {
    throw new ApiError(500, "Failed to save EA account connection.", saved.error);
  }

  return {
    userId,
    account: publicAccount(saved.data),
    connected: true,
    message: "EA account connected. Franchise discovery can continue."
  };
}
