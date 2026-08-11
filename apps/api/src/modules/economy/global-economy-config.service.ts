import {
  DEFAULT_REC_GLOBAL_ECONOMY_CONFIG,
  mergeGlobalEconomyConfig,
  type RecGlobalEconomyConfig,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";

let cached: { value: RecGlobalEconomyConfig; expiresAt: number } | null = null;
const CACHE_MS = 60_000;

function assertValid(config: RecGlobalEconomyConfig) {
  const visit = (value: unknown, path: string) => {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
      throw new ApiError(400, `${path} must be a non-negative number.`);
    }
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, child]) => visit(child, `${path}.${key}`));
  };
  visit(config, "economy");
  if (!Number.isInteger(config.version) || config.version < 1) throw new ApiError(400, "Economy configuration version must be a positive integer.");
  if (!config.eos.length) throw new ApiError(400, "At least one EOS payout definition is required.");
  for (const definition of config.eos) {
    if (!definition.key || !definition.label || !definition.statKey || !definition.tiers.length) {
      throw new ApiError(400, "Every EOS category requires a key, label, stat key, and at least one tier.");
    }
  }
}

export async function getGlobalEconomyConfig(options?: { fresh?: boolean }): Promise<RecGlobalEconomyConfig> {
  if (!options?.fresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const row = await supabase.from("rec_global_economy_config").select("config, version").eq("config_key", "global").maybeSingle();
  if (row.error) {
    // Safe rollout fallback while the migration reaches an environment.
    if (row.error.code === "42P01") return structuredClone(DEFAULT_REC_GLOBAL_ECONOMY_CONFIG);
    throw new ApiError(500, "Failed to load global economy values.", row.error);
  }
  const value = mergeGlobalEconomyConfig(row.data?.config);
  value.version = Number(row.data?.version ?? value.version);
  cached = { value, expiresAt: Date.now() + CACHE_MS };
  return value;
}

export async function updateGlobalEconomyConfig(input: unknown, actorAuthUserId: string) {
  const current = await getGlobalEconomyConfig({ fresh: true });
  const config = mergeGlobalEconomyConfig(input);
  config.version = current.version + 1;
  assertValid(config);
  const updated = await supabase.from("rec_global_economy_config").upsert({
    config_key: "global",
    config,
    version: config.version,
    updated_at: new Date().toISOString(),
  }, { onConflict: "config_key" }).select("config, version").single();
  if (updated.error) throw new ApiError(500, "Failed to save global economy values.", updated.error);
  cached = null;
  await writeAuditLog({
    action: "global_economy.updated",
    entityType: "rec_global_economy_config",
    entityId: "global",
    previousValue: current as unknown as Record<string, unknown>,
    newValue: config,
    reason: `Updated by auth user ${actorAuthUserId}`,
    source: "admin_correction",
  }).catch(() => undefined);
  return config;
}
