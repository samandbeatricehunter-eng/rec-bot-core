import { priceForPurchaseWithConfig, REC_PURCHASE_TYPE_LABELS, REC_DEV_TIER_LABELS, formatCoins, devTierOrderForGame, getRecAttributeDisplayName, isCfb, type RecPurchaseType, type RecDevTier } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { assertSiteAccountForEconomy } from "../subscriptions/discord-only.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { getUserBaselineByDiscordId } from "../users/user.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { assertPurchaseDeadlineOpen } from "./purchase-deadlines.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { getGlobalEconomyConfig } from "../economy/global-economy-config.service.js";

// purchase_type → the rec_league_configuration columns that gate it. seasonCap null means the
// type uses a more specific cap model handled elsewhere (attributes use per-attribute caps).
// Player trait purchases were retired app-wide — the type/column stay defined elsewhere
// (unused) rather than a destructive drop, but no purchase config below references them.
const PURCHASE_CONFIG: Partial<Record<RecPurchaseType, { enabled: string; seasonCap: string | null }>> = {
  age_reset: { enabled: "age_resets_enabled", seasonCap: "age_resets_season_cap" },
  dev_upgrade: { enabled: "dev_upgrades_enabled", seasonCap: "dev_upgrades_season_cap" },
  contract: { enabled: "contract_adjustment_purchases_enabled", seasonCap: "contract_purchases_season_cap" },
  attribute: { enabled: "attribute_purchases_enabled", seasonCap: null },
  legend: { enabled: "legends_enabled", seasonCap: "legends_season_cap" },
  custom_player: { enabled: "custom_players_enabled", seasonCap: "custom_players_season_cap" },
};

// Statuses that count as "active or successful" toward a season cap / all-time metric.
const ACTIVE_STATUSES = ["pending", "approved", "fulfilled"] as const;

// CFB 27's configured store does not open until Season 2. Madden has no such restriction.
const CFB_SEASON_ONE_LOCKED_PURCHASE_TYPES: RecPurchaseType[] = ["custom_player", "legend", "dev_upgrade", "attribute", "age_reset", "contract"];

function purchaseLabel(type: RecPurchaseType) {
  return REC_PURCHASE_TYPE_LABELS[type] ?? "Purchase";
}

function devTierLabel(tier: unknown): string {
  return REC_DEV_TIER_LABELS[tier as RecDevTier] ?? String(tier ?? "");
}

async function fetchTeamName(leagueId: string, teamId: string | null | undefined): Promise<string | null> {
  if (!teamId) return null;
  const { data } = await supabase.from("rec_teams").select("name").eq("id", teamId).eq("league_id", leagueId).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

// Pending-purchase notifications used to say only "Purchase: <label> — coins" with a bare
// "requested by <@user>" summary, so commissioners couldn't tell WHO/WHAT the purchase was
// for without opening it. Every player-targeting type now leads with the player, position
// and team, and spells out the exact change being requested (age → 21, per-attribute
// prior → +points → final, dev tier current → next) in the card AND the review modal,
// which both render this same header/summary.
// Exported so the notifications read side can rebuild this copy for pending rows written
// before the enrichment shipped (same pattern as the trade enrichment).
export function buildPurchaseInboxCopy(input: {
  purchaseType: RecPurchaseType;
  label: string;
  price: number;
  details: Record<string, unknown>;
  teamName: string | null;
  discordId: string;
}): { header: string; summary: string } {
  const d = input.details as Record<string, unknown> & {
    playerName?: string; playerPosition?: string; position?: string;
    fromTier?: string; toTier?: string; legendName?: string; name?: string; buildName?: string;
    allocations?: Array<Record<string, unknown>>;
  };
  const playerName = String(d.playerName ?? "");
  const playerPosition = String(d.playerPosition ?? d.position ?? "");
  const team = input.teamName;
  const who = [playerName, playerPosition ? `(${playerPosition})` : null, team ? `— ${team}` : null].filter(Boolean).join(" ");
  const requester = `<@${input.discordId}>`;

  switch (input.purchaseType) {
    case "age_reset":
      return {
        header: `Age Reset — ${who || input.label}`,
        summary: `${who || input.label} should be set to age 21. Requested by ${requester}.`,
      };
    case "attribute": {
      const lines = (d.allocations ?? []).map((allocation) => {
        const code = String(allocation.code ?? "");
        const points = Math.max(0, Number(allocation.points) || 0);
        const priorValue = allocation.priorValue;
        const finalValue = allocation.finalValue;
        const name = getRecAttributeDisplayName(code) || code;
        const change = typeof priorValue === "number"
          ? `${priorValue} → +${points} → ${typeof finalValue === "number" ? finalValue : priorValue + points}`
          : `+${points} points`;
        return `${name}: ${change}`;
      });
      return {
        header: `Attribute Purchase — ${who || input.label}`,
        summary: [who ? `${who}:` : null, ...lines, `Requested by ${requester}.`].filter(Boolean).join("\n"),
      };
    }
    case "dev_upgrade":
      return {
        header: `Dev Trait Upgrade — ${who || input.label}`,
        summary: `${who || input.label}: ${devTierLabel(d.fromTier)} → ${devTierLabel(d.toTier)}. Requested by ${requester}.`,
      };
    case "contract":
      return {
        header: `Contract Adjustment — ${who || input.label}`,
        summary: `Adjust the contract for ${who || input.label}. Requested by ${requester}.`,
      };
    case "legend":
      return {
        header: `Legend Purchase — ${String(d.legendName ?? d.name ?? "") || input.label}`,
        summary: `${d.legendName ?? d.name ?? "Legend"} requested by ${requester}.`,
      };
    case "custom_player":
      return {
        header: `Custom Player — ${String(d.buildName ?? d.playerName ?? "") || input.label}`,
        summary: `${String(d.buildName ?? d.playerName ?? "") || "Custom player"} requested by ${requester}.`,
      };
    default:
      return {
        header: `Purchase: ${input.label} — ${formatCoins(input.price)}`,
        summary: `${input.label} requested by ${requester}.`,
      };
  }
}

// rec_legend_catalog.attributes is keyed by the same full display names shown in the
// purchase-review notification (e.g. "Throwing Power"); rec_players.attributes (what the
// roster viewer's spreadsheet columns read) is keyed by the snake_case codes every other
// player source uses (e.g. throw_power). "Long Snap" has no equivalent in our 53-attribute
// set and is dropped. Exhaustive — verified against every key actually stored on a legend row.
const LEGEND_ATTRIBUTE_NAME_TO_KEY: Record<string, string> = {
  "Press": "press", "Speed": "speed", "Injury": "injury", "Agility": "agility", "Jumping": "jumping",
  "Pursuit": "pursuit", "Release": "release", "Stamina": "stamina", "Carrying": "carrying",
  "Catching": "catching", "Strength": "strength", "Tackling": "tackle", "Trucking": "trucking",
  "Awareness": "awareness", "BC Vision": "bc_vision", "Hit Power": "hit_power", "Juke Move": "juke_move",
  "Spin Move": "spin_move", "Stiff Arm": "stiff_arm", "Toughness": "toughness", "Break Sack": "break_sack",
  "Lead Block": "lead_block", "Play Action": "play_action", "Power Moves": "power_moves",
  "Acceleration": "acceleration", "Break Tackle": "break_tackle", "Man Coverage": "man_coverage",
  "Run Blocking": "run_block", "Deep Accuracy": "throw_accuracy_deep", "Finesse Moves": "finesse_moves",
  "Kicking Power": "kick_power", "Pass Blocking": "pass_block", "Zone Coverage": "zone_coverage",
  "Block Shedding": "block_shedding", "Short Accuracy": "throw_accuracy_short", "Throwing Power": "throw_power",
  "Impact Blocking": "impact_blocking", "Medium Accuracy": "throw_accuracy_mid", "Run Block Power": "run_block_power",
  "Catch in Traffic": "catch_in_traffic", "Kick/Punt Return": "kick_return", "Kicking Accuracy": "kick_accuracy",
  "Pass Block Power": "pass_block_power", "Play Recognition": "play_recognition", "Throw on the Run": "throw_on_the_run",
  "Run Block Finesse": "run_block_finesse", "Spectacular Catch": "spectacular_catch", "Deep Route Running": "route_running_deep",
  "Pass Block Finesse": "pass_block_finesse", "Change of Direction": "change_of_direction",
  "Short Route Running": "route_running_short", "Medium Route Running": "route_running_medium",
  "Throw Under Pressure": "throw_under_pressure",
};

// rec_legend_catalog.height is a formatted string like 6'9" — parse to total inches for
// rec_players.height_inches (which every other player source stores as a plain integer).
function parseLegendHeightInches(height: string | null | undefined): number | null {
  const match = /^(\d+)'(\d+)"?$/.exec(String(height ?? "").trim());
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]);
}

function mapLegendAttributes(raw: Record<string, number> | null | undefined): Record<string, number> {
  const mapped: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    const key = LEGEND_ATTRIBUTE_NAME_TO_KEY[name];
    if (key) mapped[key] = value;
  }
  return mapped;
}

/** Fires once a CFB legend purchase is approved — creates the actual rec_players row with
 * the legend's full mapped attributes and photo, and updates the designated replacement
 * player's row in place. CFB-only: CFB has no live franchise-import cycle to defer to, so
 * approval is the only moment the swap can happen. Madden legends are deferred instead — see
 * reconcileApprovedMaddenPurchases — because the commissioner recreates the legend inside the
 * actual Madden save, and the next EA import naturally pulls that identity in under the
 * replaced player's real EA id; applying it here too would just get overwritten (or fight)
 * with that import. */
async function applyApprovedLegendPurchase(purchase: Record<string, unknown>) {
  const details = (purchase.details ?? {}) as Record<string, any>;
  const leagueId = purchase.league_id as string;
  const teamId = details.purchasingTeamId as string | null;
  if (!teamId) return; // buyer had no team at purchase time — nothing to attach the player to

  const legend = await supabase.from("rec_legend_catalog").select("photo_url").eq("id", details.legendId).maybeSingle();
  const photoUrl = legend.data?.photo_url ?? null;

  const replacementPlayerId: string | null =
    details.finalReplaceTarget?.playerId ?? details.replaceTarget?.playerId ?? null;
  if (!replacementPlayerId) throw new ApiError(400, "A CFB legend must have a selected added/recruited player to replace.");

  const found = await supabase.from("rec_players").select("id,position")
    .eq("id", replacementPlayerId).eq("league_id", leagueId).eq("team_id", teamId)
    .in("roster_status", ["active", "transferred_in"]).eq("is_default_player", false).maybeSingle();
  if (!found.data) throw new ApiError(409, "The selected CFB replacement player is no longer available. Reject and refund this purchase.");

  const nameParts = String(details.name ?? "").trim().split(/\s+/);
  const firstName = nameParts[0] ?? details.name;
  const lastName = nameParts.slice(1).join(" ") || details.name;

  const playerRow = {
    first_name: firstName,
    last_name: lastName,
    full_name: details.name,
    position: found.data.position,
    height_inches: parseLegendHeightInches(details.height),
    weight_lbs: details.weight ?? null,
    handedness: details.hand ?? null,
    jersey_number: details.jerseyNumber ?? null,
    college: null,
    dev_trait: null,
    // rec_legend_catalog.est_ovr is numeric with a decimal (e.g. 88.3); rec_players.overall_rating
    // is an integer column — round it, or the write fails outright with a Postgres type error.
    overall_rating: details.estOvr != null ? Math.round(Number(details.estOvr)) : null,
    archetype: details.archetype ?? null,
    attributes: mapLegendAttributes(details.attributes),
    abilities: [],
    photo_url: photoUrl,
    is_free_agent: false,
    is_default_player: false,
    roster_status: "active",
    player_source: "legend",
    raw_payload: { legend: true, legendId: details.legendId, purchaseId: purchase.id },
  };

  const updated = await supabase.from("rec_players").update(playerRow)
    .eq("id", replacementPlayerId).eq("league_id", leagueId).eq("team_id", teamId).select("id").maybeSingle();
  if (updated.error || !updated.data) throw new ApiError(500, "The legend purchase was approved, but we couldn't add the player to the roster. Please try again.", updated.error);
}

/** Madden-only. Approved legend purchases and approved (not-yet-applied) custom-player builds
 * sit waiting for the commissioner to actually recreate the player inside the Madden save on
 * the designated roster slot. Runs after every EA roster import: if the designated player's
 * row (or, failing that, any freshly-imported row on the buying team) now carries a name
 * matching the purchase, the purchase/build is marked fulfilled — informational only, since
 * the import itself already wrote the real data. Never mutates rec_players. */
export async function reconcileApprovedMaddenPurchases(leagueId: string): Promise<{ legendsFulfilled: number; customPlayersApplied: number }> {
  const now = new Date().toISOString();

  async function findMatch(teamId: string, name: string, targetId: string | null): Promise<string | null> {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return null;
    if (targetId) {
      const row = await supabase.from("rec_players").select("id,full_name").eq("id", targetId).eq("league_id", leagueId).eq("team_id", teamId).maybeSingle();
      if (row.data && String(row.data.full_name ?? "").trim().toLowerCase() === normalized) return row.data.id;
    }
    // No exact-slot match — the query builder has no case-insensitive LIKE, so pull the
    // team's non-REC-created players and compare in JS. Team rosters are small (~50-70), so
    // this stays cheap.
    const roster = await supabase.from("rec_players").select("id,full_name,player_source").eq("league_id", leagueId).eq("team_id", teamId);
    const match = (roster.data ?? []).find((p: any) =>
      p.player_source !== "legend" && p.player_source !== "custom_player" && String(p.full_name ?? "").trim().toLowerCase() === normalized);
    return match?.id ?? null;
  }

  const pendingLegends = await supabase.from("rec_purchases").select("id,user_id,details")
    .eq("league_id", leagueId).eq("purchase_type", "legend").eq("status", "approved");
  if (pendingLegends.error) throw new ApiError(500, "We couldn't load approved legend purchases to reconcile.", pendingLegends.error);
  let legendsFulfilled = 0;
  for (const purchase of pendingLegends.data ?? []) {
    const details = (purchase.details ?? {}) as Record<string, any>;
    const teamId = details.purchasingTeamId as string | null;
    if (!teamId) continue;
    const targetId = details.finalReplaceTarget?.playerId ?? details.replaceTarget?.playerId ?? null;
    const matchedId = await findMatch(teamId, String(details.name ?? ""), targetId);
    if (!matchedId) continue;
    await supabase.from("rec_purchases").update({ status: "fulfilled", fulfilled_at: now, updated_at: now }).eq("id", purchase.id);
    await createSiteNotification({
      userId: purchase.user_id, leagueId, kind: "legend_fulfilled",
      title: `${details.name} is live on your roster`, body: `${details.name} was detected in your latest EA import and is now officially part of your team.`, href: "/app",
    }).catch((err) => console.error("[WARN] Failed to notify purchaser of legend fulfillment:", err));
    legendsFulfilled++;
  }

  const pendingBuilds = await supabase.from("rec_custom_player_builds").select("id,user_id,league_id,team_id,identity,replacement_player_id,purchase_id")
    .eq("league_id", leagueId).eq("game_family", "MADDEN").eq("status", "approved");
  if (pendingBuilds.error) throw new ApiError(500, "We couldn't load approved custom-player builds to reconcile.", pendingBuilds.error);
  let customPlayersApplied = 0;
  for (const build of pendingBuilds.data ?? []) {
    const identity = (build.identity ?? {}) as Record<string, any>;
    const fullName = `${identity.firstName ?? ""} ${identity.lastName ?? ""}`.trim();
    if (!build.team_id) continue;
    const matchedId = await findMatch(build.team_id, fullName, build.replacement_player_id ?? null);
    if (!matchedId) continue;
    await supabase.from("rec_custom_player_builds").update({ status: "applied", applied_at: now, created_player_id: matchedId, updated_at: now }).eq("id", build.id);
    if (build.purchase_id) await supabase.from("rec_purchases").update({ status: "fulfilled", fulfilled_at: now, updated_at: now }).eq("id", build.purchase_id);
    await createSiteNotification({
      userId: build.user_id, leagueId, kind: "custom_player_fulfilled",
      title: `${fullName} is live on your roster`, body: `${fullName} was detected in your latest EA import and is now officially part of your team.`, href: "/app",
    }).catch((err) => console.error("[WARN] Failed to notify purchaser of custom-player fulfillment:", err));
    customPlayersApplied++;
  }

  return { legendsFulfilled, customPlayersApplied };
}

type AttributeAllocation = { code: string; points: number; core: boolean };

// Re-derive each allocation's core flag from the league's configured core attribute set so
// price and caps are computed from trusted config, not client input.
function normalizeAttributeAllocations(details: Record<string, unknown>, cfgRow: Record<string, unknown>): Record<string, unknown> {
  const coreSet = new Set(Array.isArray(cfgRow.core_attributes) ? (cfgRow.core_attributes as unknown[]).map(String) : []);
  const raw = Array.isArray((details as any).allocations) ? ((details as any).allocations as any[]) : [];
  const allocations: AttributeAllocation[] = raw
    .map((a) => ({ code: String(a.code), points: Math.max(0, Math.floor(Number(a.points) || 0)), core: coreSet.has(String(a.code)) }))
    .filter((a) => a.points > 0);
  if (!allocations.length) throw new ApiError(400, "Select at least one attribute and a point amount.");
  return { ...details, allocations };
}

// Enforce points-per-user-per-season caps. Every cap is additive, not either/or: a purchase
// must clear BOTH its own attribute's individual cap (override, else the group default) AND
// its group's pooled total. 0 on any cap ⇒ that particular constraint is unlimited.
async function enforceAttributeCaps(args: {
  leagueId: string;
  userId: string;
  seasonNumber: number;
  allocations: AttributeAllocation[];
  defaultCoreCap: number;
  coreGroupCap: number;
  coreOverrides: Record<string, number>;
  nonCoreGroupCap: number;
  nonCoreOverrides: Record<string, number>;
}) {
  const existing = await supabase
    .from("rec_purchases")
    .select("details")
    .eq("league_id", args.leagueId)
    .eq("user_id", args.userId)
    .eq("purchase_type", "attribute")
    .eq("season_number", args.seasonNumber)
    .in("status", ACTIVE_STATUSES as unknown as string[]);
  if (existing.error) throw new ApiError(500, "We couldn't check attribute purchase limits. Please try again.", existing.error);

  const usedByCode: Record<string, number> = {};
  let usedCore = 0;
  let usedNonCore = 0;
  for (const row of existing.data ?? []) {
    const allocs = ((row as any).details?.allocations as any[]) ?? [];
    for (const a of allocs) {
      const pts = Math.max(0, Number(a.points) || 0);
      usedByCode[a.code] = (usedByCode[a.code] ?? 0) + pts;
      if (a.core) usedCore += pts;
      else usedNonCore += pts;
    }
  }

  let requestedCore = 0;
  let requestedNonCore = 0;
  for (const a of args.allocations) {
    if (a.core) {
      const cap = Number(args.coreOverrides[a.code] ?? args.defaultCoreCap ?? 0);
      if (cap > 0 && (usedByCode[a.code] ?? 0) + a.points > cap) {
        throw new ApiError(409, `${a.code} is capped at ${cap} points per season — you've already used ${usedByCode[a.code] ?? 0}.`);
      }
      requestedCore += a.points;
    } else {
      const cap = Number(args.nonCoreOverrides[a.code] ?? 0);
      if (cap > 0 && (usedByCode[a.code] ?? 0) + a.points > cap) {
        throw new ApiError(409, `${a.code} is capped at ${cap} points per season — you've already used ${usedByCode[a.code] ?? 0}.`);
      }
      requestedNonCore += a.points;
    }
  }
  if (args.coreGroupCap > 0 && usedCore + requestedCore > args.coreGroupCap) {
    throw new ApiError(409, `Core attribute points are capped at ${args.coreGroupCap} total per season — you've already used ${usedCore}.`);
  }
  if (args.nonCoreGroupCap > 0 && usedNonCore + requestedNonCore > args.nonCoreGroupCap) {
    throw new ApiError(409, `Non-core attribute points are capped at ${args.nonCoreGroupCap} total per season — you've already used ${usedNonCore}.`);
  }
}

// Shared for every player-targeting purchase type (dev upgrades, attribute points, age
// resets, contract adjustments): resolves the target to a real, active player on the
// buyer's own team, and enforces the CFB store's core rule that DEFAULT SEEDED players
// can't be purchased on at all — only players the coach added (recruits, transfers,
// manual adds, legends, custom recruits) are eligible. Madden has no such restriction;
// its baseline roster is the exact pool teams are supposed to build from. The
// madden_player_id prefix check is belt-and-suspenders on top of is_default_player so
// leagues seeded before the flag was backfilled still get the guard.
async function loadAndValidatePurchaseTarget(opts: { leagueId: string; userId: string; game: string; playerId: string; label: string; includeAttributes?: boolean }) {
  const playerId = opts.playerId ?? "";
  if (!playerId) throw new ApiError(400, "Select a player.");
  const select = ["id", "team_id", "full_name", "position", "roster_status", "is_default_player", "madden_player_id"];
  if (opts.includeAttributes) select.push("attributes");
  const player = await supabase
    .from("rec_players")
    .select(select.join(","))
    .eq("id", playerId)
    .eq("league_id", opts.leagueId)
    .maybeSingle();
  if (player.error) throw new ApiError(500, "We couldn't load that player. Please try again.", player.error);
  if (!player.data || player.data.roster_status !== "active") throw new ApiError(404, "Player not found on an active roster.");
  const assignment = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", opts.leagueId).eq("user_id", opts.userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment.data?.team_id || assignment.data.team_id !== player.data.team_id) throw new ApiError(403, "You can only make purchases for your own team's players.");

  if (isCfb(opts.game) && (player.data.is_default_player || String(player.data.madden_player_id ?? "").startsWith("cfb27:"))) {
    throw new ApiError(400, `${player.data.full_name} is part of the default seeded roster — ${opts.label} can only be purchased for players you've added (recruits, transfers, or manually added players).`);
  }
  return {
    id: player.data.id,
    fullName: player.data.full_name,
    position: String(player.data.position ?? ""),
    teamId: player.data.team_id,
    attributes: opts.includeAttributes ? ((player.data as any).attributes as Record<string, number> | null) ?? {} : undefined,
  };
}

// Re-derives fromTier from the player's actual current dev_trait (never trust the client for
// this) and validates toTier is a real forward step on this league's game-family tier ladder.
async function normalizeDevUpgradeDetails(details: Record<string, unknown>, leagueId: string, game: string, userId: string): Promise<Record<string, unknown>> {
  const playerId = String((details as any).playerId ?? "");
  if (!playerId) throw new ApiError(400, "Select a player to upgrade.");
  const player = await supabase.from("rec_players").select("id,team_id,full_name,position,dev_trait,roster_status,is_default_player,madden_player_id").eq("id", playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "We couldn't load that player. Please try again.", player.error);
  if (!player.data || player.data.roster_status !== "active") throw new ApiError(404, "Player not found on an active roster.");
  const assignment = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment.data?.team_id || assignment.data.team_id !== player.data.team_id) throw new ApiError(403, "You can only upgrade your own team's players.");
  if (isCfb(game) && (player.data.is_default_player || String(player.data.madden_player_id ?? "").startsWith("cfb27:"))) {
    throw new ApiError(400, `${player.data.full_name} is part of the default seeded roster — dev upgrades can only be purchased for players you've added (recruits, transfers, or manually added players).`);
  }

  const order = devTierOrderForGame(game);
  const fromTier = (order.includes(player.data.dev_trait as RecDevTier) ? player.data.dev_trait : "normal") as RecDevTier;
  const toTier = String((details as any).toTier ?? "") as RecDevTier;
  if (order.indexOf(toTier) <= order.indexOf(fromTier)) {
    throw new ApiError(400, `${player.data.full_name} is already at or above that tier.`);
  }
  return { playerId, playerName: player.data.full_name, playerPosition: String(player.data.position ?? ""), teamId: player.data.team_id, fromTier, toTier };
}

// Enforces one of two league-configured cap modes for dev upgrades: a flat count of purchase
// actions per season (reuses the generic seasonCap path below), or a cap on how many DISTINCT
// players a team can upgrade in a season — once a player has an active dev_upgrade purchase
// this season they're already "in", so further purchases on that same player never consume a
// new slot (they can climb as many tiers as they want once chosen).
async function enforceDevUpgradePlayerCap(args: { leagueId: string; userId: string; seasonNumber: number; playerId: string; cap: number }) {
  if (args.cap <= 0) return;
  const existing = await supabase.from("rec_purchases").select("details")
    .eq("league_id", args.leagueId).eq("user_id", args.userId).eq("purchase_type", "dev_upgrade").eq("season_number", args.seasonNumber)
    .in("status", ACTIVE_STATUSES as unknown as string[]);
  if (existing.error) throw new ApiError(500, "We couldn't check the development upgrade limit. Please try again.", existing.error);
  const distinctPlayerIds = new Set((existing.data ?? []).map((row: any) => row.details?.playerId).filter(Boolean));
  if (distinctPlayerIds.has(args.playerId)) return;
  if (distinctPlayerIds.size >= args.cap) {
    throw new ApiError(409, `This league limits dev upgrades to ${args.cap} player(s) per team per season — you've already chosen your ${args.cap}.`);
  }
}

export async function createPurchaseRequest(input: {
  guildId: string;
  discordId: string;
  purchaseType: RecPurchaseType;
  details: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  const cfg = PURCHASE_CONFIG[input.purchaseType];
  if (!cfg) throw new ApiError(400, "Unknown purchase type.");
  const label = purchaseLabel(input.purchaseType);

  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;

  const attrSelect = input.purchaseType === "attribute"
    ? ["core_attributes", "core_attribute_cap_overrides", "core_attribute_purchases_season_cap", "core_attribute_group_cap", "non_core_attribute_purchases_season_cap", "non_core_attribute_cap_overrides"]
    : input.purchaseType === "dev_upgrade"
      ? ["dev_upgrade_cap_mode", "dev_upgrades_player_cap"]
      : [];
  const selectCols = ["coin_economy_enabled", "purchase_deadlines", cfg.enabled, cfg.seasonCap, ...attrSelect].filter(Boolean).join(",");
  const config = await supabase
    .from("rec_league_configuration")
    .select(selectCols)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (config.error) throw new ApiError(500, "We couldn't load purchase settings. Please try again.", config.error);
  const cfgRow = (config.data ?? {}) as Record<string, unknown>;
  if (!cfgRow.coin_economy_enabled) throw new ApiError(400, "The coin economy is not enabled for this league.");
  // CFB dev trait progression is earned in-game, not purchased — dev upgrades are a
  // Madden-only purchase type regardless of the league's own dev_upgrades_enabled setting.
  if (input.purchaseType === "dev_upgrade" && context.rec_leagues?.game === "cfb_27") {
    throw new ApiError(400, "Dev trait upgrades aren't available in CFB leagues.");
  }
  const { assertEconomyPayoutsActive } = await import("../economy/economy-gate.js");
  await assertEconomyPayoutsActive(leagueId);
  if (!cfgRow[cfg.enabled]) throw new ApiError(400, `${label} purchases are not enabled for this league.`);
  assertPurchaseDeadlineOpen({
    purchaseType: input.purchaseType,
    deadlines: cfgRow.purchase_deadlines,
    currentStage: String(context.rec_leagues?.season_stage ?? "regular_season"),
    currentWeek: Number(context.rec_leagues?.current_week ?? 1),
  });

  const seasonNumber = resolveSeasonNumber(context);
  if (context.rec_leagues?.game === "cfb_27" && seasonNumber < 2 && CFB_SEASON_ONE_LOCKED_PURCHASE_TYPES.includes(input.purchaseType)) {
    throw new ApiError(400, `${label} purchases open in Season 2 — Season 1 rosters are locked while dynasties get established.`);
  }

  const baseline = await getUserBaselineByDiscordId(input.discordId);
  const userId = baseline.user.id;
  await assertSiteAccountForEconomy(userId);

  // A retried/duplicated submit (network hiccup, double-click) with the same client-generated
  // key returns the original request instead of creating (and charging for) a second one —
  // mirrors the same pattern custom-player builds already use.
  if (input.idempotencyKey) {
    const existing = await supabase.from("rec_purchases").select("*")
      .eq("league_id", leagueId).eq("user_id", userId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (existing.error) throw new ApiError(500, "We couldn't check for a duplicate purchase. Please try again.", existing.error);
    if (existing.data) return { purchase: existing.data, duplicate: true };
  }

  // Attributes carry an allocation list; dev upgrades carry a player + target tier — both
  // get normalized server-side (authoritative) so pricing and cap enforcement can't be
  // spoofed by client-supplied core/tier flags. Player-targeting types (attribute, age
  // reset, contract, dev upgrade) also resolve their target player server-side so team
  // ownership and the CFB default-seeded-player rule are enforced against the real row.
  let details: Record<string, unknown> = input.details ?? {};
  const game = String(context.rec_leagues?.game ?? "madden_27");
  if (input.purchaseType === "attribute") {
    details = normalizeAttributeAllocations(details, cfgRow);
    const target = await loadAndValidatePurchaseTarget({ leagueId, userId, game, playerId: String((details as any).playerId ?? ""), label, includeAttributes: true });
    // Snapshot each allocation's current value so the review shows prior -> +points -> final.
    const currentAttributes = target.attributes ?? {};
    const allocations = ((details as any).allocations as Array<Record<string, unknown>> ?? []).map((allocation) => {
      const code = String(allocation.code ?? "");
      const points = Math.max(0, Number(allocation.points) || 0);
      const priorValue = typeof currentAttributes[code] === "number" ? currentAttributes[code] as number : null;
      return { ...allocation, priorValue, finalValue: priorValue != null ? priorValue + points : null };
    });
    details = { ...details, playerId: target.id, playerName: target.fullName, playerPosition: target.position, teamId: target.teamId, allocations };
  } else if (input.purchaseType === "dev_upgrade") {
    details = await normalizeDevUpgradeDetails(details, leagueId, game, userId);
  } else if (input.purchaseType === "age_reset" || input.purchaseType === "contract") {
    const target = await loadAndValidatePurchaseTarget({ leagueId, userId, game, playerId: String((details as any).playerId ?? ""), label });
    details = { ...details, playerId: target.id, playerName: target.fullName, playerPosition: target.position, teamId: target.teamId };
  }

  const economy = await getGlobalEconomyConfig();
  const price = priceForPurchaseWithConfig(input.purchaseType, details, game, economy.store);
  if (!Number.isFinite(price) || price <= 0) {
    throw new ApiError(400, "Could not determine a price for this purchase.");
  }

  const walletBalance = Number(baseline.wallet?.wallet_balance ?? 0);
  if (walletBalance < price) {
    throw new ApiError(400, `Insufficient wallet balance. This costs ${formatCoins(price)} and you have ${formatCoins(walletBalance)}.`);
  }

  const seasonId = await resolveSeasonId(leagueId, seasonNumber);

  // Every cap here is a count/aggregate over existing rows checked, then a separate insert —
  // two concurrent requests can both pass this check against the same pre-insert snapshot and
  // both succeed, exceeding the cap. Run once now (fail fast, no wasted insert/debit for the
  // common non-racing case), and run again below AFTER the insert commits, when a concurrent
  // request's row (if any) is actually visible — that second call is the real guard.
  async function enforceCaps() {
    if (input.purchaseType === "dev_upgrade" && cfgRow.dev_upgrade_cap_mode === "players_per_season") {
      await enforceDevUpgradePlayerCap({
        leagueId, userId, seasonNumber,
        playerId: String((details as any).playerId),
        cap: Number(cfgRow.dev_upgrades_player_cap ?? 0),
      });
    } else if (input.purchaseType === "attribute") {
      await enforceAttributeCaps({
        leagueId,
        userId,
        seasonNumber,
        allocations: (details.allocations as AttributeAllocation[]) ?? [],
        defaultCoreCap: Number(cfgRow.core_attribute_purchases_season_cap ?? 0),
        coreGroupCap: Number(cfgRow.core_attribute_group_cap ?? 0),
        coreOverrides: (cfgRow.core_attribute_cap_overrides as Record<string, number>) ?? {},
        nonCoreGroupCap: Number(cfgRow.non_core_attribute_purchases_season_cap ?? 0),
        nonCoreOverrides: (cfgRow.non_core_attribute_cap_overrides as Record<string, number>) ?? {},
      });
    } else if (cfg!.seasonCap) {
      // Count-based season cap: 0/absent ⇒ unlimited (the enabled flag governs availability).
      const cap = Number(cfgRow[cfg!.seasonCap!] ?? 0);
      if (cap > 0) {
        const used = await supabase
          .from("rec_purchases")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("user_id", userId)
          .eq("purchase_type", input.purchaseType)
          .eq("season_number", seasonNumber)
          .in("status", ACTIVE_STATUSES as unknown as string[]);
        if (used.error) throw new ApiError(500, "We couldn't check the season purchase limit. Please try again.", used.error);
        if ((used.count ?? 0) >= cap) {
          throw new ApiError(409, `You have reached this season's cap (${cap}) for ${label}.`);
        }
      }
    }
  }
  await enforceCaps();

  const now = new Date().toISOString();
  const inserted = await supabase
    .from("rec_purchases")
    .insert({
      league_id: leagueId,
      season_id: seasonId,
      season_number: seasonNumber,
      user_id: userId,
      discord_id: input.discordId,
      purchase_type: input.purchaseType,
      cost: price,
      details,
      status: "pending",
      already_deducted: false,
      idempotency_key: input.idempotencyKey ?? null,
      submitted_at: now,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (inserted.error) {
    // 23505 here is either the idempotency key racing with itself (a genuinely-concurrent
    // retry) or the legend-uniqueness index (rec_purchases_legend_unique_active) firing.
    if ((inserted.error as { code?: string }).code === "23505") {
      if (input.purchaseType === "legend") throw new ApiError(409, "This legend has already been purchased in this league.");
      if (input.idempotencyKey) {
        const existing = await supabase.from("rec_purchases").select("*")
          .eq("league_id", leagueId).eq("user_id", userId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
        if (existing.data) return { purchase: existing.data, duplicate: true };
      }
    }
    throw new ApiError(500, "We couldn't create that purchase request. Please try again.", inserted.error);
  }

  // Real guard against the TOCTOU race enforceCaps() above can't fully close on its own: recount
  // with the just-inserted row now actually committed and visible. A losing concurrent request's
  // own insert is also visible to THIS recount by the time both have landed, so whichever request
  // reaches this point last is the one that (correctly) self-aborts — see enforceCaps() above.
  try {
    if (input.purchaseType === "dev_upgrade" && cfgRow.dev_upgrade_cap_mode === "players_per_season") {
      const cap = Number(cfgRow.dev_upgrades_player_cap ?? 0);
      if (cap > 0) {
        const rows = await supabase.from("rec_purchases").select("details")
          .eq("league_id", leagueId).eq("user_id", userId).eq("purchase_type", "dev_upgrade").eq("season_number", seasonNumber)
          .in("status", ACTIVE_STATUSES as unknown as string[]);
        if (rows.error) throw new ApiError(500, "We couldn't verify the development upgrade limit. Please try again.", rows.error);
        const distinctPlayerIds = new Set((rows.data ?? []).map((row: any) => row.details?.playerId).filter(Boolean));
        if (distinctPlayerIds.size > cap) {
          throw new ApiError(409, `This league limits dev upgrades to ${cap} player(s) per team per season — someone else just claimed the last slot.`);
        }
      }
    } else if (input.purchaseType === "attribute") {
      const rows = await supabase.from("rec_purchases").select("details")
        .eq("league_id", leagueId).eq("user_id", userId).eq("purchase_type", "attribute").eq("season_number", seasonNumber)
        .in("status", ACTIVE_STATUSES as unknown as string[]);
      if (rows.error) throw new ApiError(500, "We couldn't verify attribute purchase limits. Please try again.", rows.error);
      const usedByCode: Record<string, number> = {};
      let usedCore = 0, usedNonCore = 0;
      for (const row of rows.data ?? []) {
        for (const a of ((row as any).details?.allocations as any[]) ?? []) {
          const pts = Math.max(0, Number(a.points) || 0);
          usedByCode[a.code] = (usedByCode[a.code] ?? 0) + pts;
          if (a.core) usedCore += pts; else usedNonCore += pts;
        }
      }
      const coreOverrides = (cfgRow.core_attribute_cap_overrides as Record<string, number>) ?? {};
      const nonCoreOverrides = (cfgRow.non_core_attribute_cap_overrides as Record<string, number>) ?? {};
      const defaultCoreCap = Number(cfgRow.core_attribute_purchases_season_cap ?? 0);
      const coreGroupCap = Number(cfgRow.core_attribute_group_cap ?? 0);
      const nonCoreGroupCap = Number(cfgRow.non_core_attribute_purchases_season_cap ?? 0);
      for (const [code, used] of Object.entries(usedByCode)) {
        const allocation = ((details.allocations as AttributeAllocation[]) ?? []).find((a) => a.code === code);
        const isCore = allocation?.core ?? false;
        const cap = Number((isCore ? coreOverrides[code] : nonCoreOverrides[code]) ?? (isCore ? defaultCoreCap : 0));
        if (cap > 0 && used > cap) throw new ApiError(409, `${code} is capped at ${cap} points per season — someone else's request just filled it.`);
      }
      if (coreGroupCap > 0 && usedCore > coreGroupCap) throw new ApiError(409, `Core attribute points are capped at ${coreGroupCap} total per season — someone else's request just filled it.`);
      if (nonCoreGroupCap > 0 && usedNonCore > nonCoreGroupCap) throw new ApiError(409, `Non-core attribute points are capped at ${nonCoreGroupCap} total per season — someone else's request just filled it.`);
    } else if (cfg.seasonCap) {
      const cap = Number(cfgRow[cfg.seasonCap] ?? 0);
      if (cap > 0) {
        const used = await supabase
          .from("rec_purchases")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId).eq("user_id", userId).eq("purchase_type", input.purchaseType).eq("season_number", seasonNumber)
          .in("status", ACTIVE_STATUSES as unknown as string[]);
        if (used.error) throw new ApiError(500, "We couldn't verify the season purchase limit. Please try again.", used.error);
        if ((used.count ?? 0) > cap) {
          throw new ApiError(409, `You have reached this season's cap (${cap}) for ${label} — someone else's request just filled it.`);
        }
      }
    }
  } catch (capError) {
    await supabase.from("rec_purchases").delete().eq("id", inserted.data.id);
    throw capError;
  }

  // Deduct on request. If the debit fails, roll back the pending row so we never leave a
  // request without a charge.
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: userId,
    p_amount: -price,
    p_league_id: leagueId,
    p_description: `${label} purchase`,
    p_transaction_type: "purchase_debit",
    p_source: "purchase",
    p_source_reference: { purchaseId: inserted.data.id },
  });
  if (ledger.error) {
    await supabase.from("rec_purchases").delete().eq("id", inserted.data.id);
    throw new ApiError(500, "We couldn't charge your wallet for that purchase. Please try again.", ledger.error);
  }

  const finalized = await supabase
    .from("rec_purchases")
    .update({ debit_ledger_id: ledger.data, already_deducted: true, updated_at: new Date().toISOString() })
    .eq("id", inserted.data.id)
    .select("*")
    .single();
  if (finalized.error) throw new ApiError(500, "We couldn't finalize that purchase request. Please try again.", finalized.error);

  const teamName = await fetchTeamName(leagueId, (details as any).teamId ?? null);
  const copy = buildPurchaseInboxCopy({ purchaseType: input.purchaseType, label, price, details, teamName, discordId: input.discordId });
  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: leagueId,
    season_number: seasonNumber,
    week_number: null,
    queue_type: "purchase",
    status: "pending",
    priority: 0,
    header: copy.header,
    summary: copy.summary,
    requester_discord_id: input.discordId,
    requester_user_id: userId,
    amount: price,
    source_table: "rec_purchases",
    source_id: finalized.data.id,
    payload: { purchaseId: finalized.data.id, purchaseType: input.purchaseType, cost: price, details },
  });
  void notifyLeagueCommissionersOfPendingItem(leagueId);

  return {
    purchase: finalized.data,
    price,
    walletBalance: walletBalance - price,
  };
}

export async function reviewPurchase(input: {
  purchaseId: string;
  leagueId?: string | null;
  action: "approve" | "deny";
  reviewedByDiscordId: string;
  deniedReason?: string | null;
  // Legend only: commissioner's roster player to permanently swap out when applying. When the
  // buyer already designated one, the UI may omit this; when they left it to "commissioner's
  // choice" (Madden), this playerId is required and becomes the authoritative replaceTarget.
  finalReplaceTarget?: { playerId: string; position?: string; firstName?: string; lastName?: string } | null;
}) {
  let purchaseQuery = supabase.from("rec_purchases").select("*").eq("id", input.purchaseId);
  if (input.leagueId) purchaseQuery = purchaseQuery.eq("league_id", input.leagueId);
  const existing = await purchaseQuery.maybeSingle();
  if (existing.error) throw new ApiError(500, "We couldn't load that purchase. Please try again.", existing.error);
  if (!existing.data) throw new ApiError(404, "Purchase was not found.");
  if (existing.data.status !== "pending") {
    return { updated: false, reason: `Purchase is already ${existing.data.status}.`, purchase: existing.data };
  }

  const label = purchaseLabel(existing.data.purchase_type as RecPurchaseType);
  const now = new Date().toISOString();

  if (input.action === "deny") {
    let refundLedgerId: string | null = null;
    const cost = Number(existing.data.cost ?? 0);
    if (existing.data.already_deducted && cost > 0) {
      const refund = await supabase.rpc("add_to_wallet", {
        p_user_id: existing.data.user_id,
        p_amount: cost,
        p_league_id: existing.data.league_id,
        p_description: `${label} purchase refund`,
        p_transaction_type: "purchase_refund",
        p_source: "purchase",
        p_source_reference: { purchaseId: existing.data.id, refund: true },
      });
      if (refund.error) throw new ApiError(500, "We couldn't refund that denied purchase. Please try again.", refund.error);
      refundLedgerId = refund.data;
    }
    const denied = await supabase
      .from("rec_purchases")
      .update({
        status: "rejected",
        denied_reason: input.deniedReason ?? "Denied by commissioner review.",
        admin_notes: input.deniedReason ?? null,
        reviewed_by_discord_id: input.reviewedByDiscordId,
        refund_ledger_id: refundLedgerId,
        updated_at: now,
      })
      .eq("id", input.purchaseId)
      .select("*")
      .single();
    if (denied.error) throw new ApiError(500, "We couldn't deny that purchase. Please try again.", denied.error);
    await supabase
      .from("rec_commissioners_inbox")
      .update({ status: "denied", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: now, review_reason: input.deniedReason ?? null })
      .eq("source_table", "rec_purchases")
      .eq("source_id", input.purchaseId);
    const denyBody = input.deniedReason ? `${input.deniedReason}${cost > 0 ? ` — ${cost} coins refunded.` : ""}` : `Your ${label.toLowerCase()} purchase was denied${cost > 0 ? ` and ${cost} coins were refunded.` : "."}`;
    await createSiteNotification({
      userId: existing.data.user_id,
      leagueId: existing.data.league_id,
      kind: `${existing.data.purchase_type}_denied`,
      title: `${label} denied`,
      body: denyBody,
      href: "/app",
    }).catch((err) => console.error("[ERROR] Failed to notify purchaser of denial (non-fatal):", err));
    return { updated: true, action: "deny" as const, purchase: denied.data, refunded: cost, buyerDiscordId: existing.data.discord_id };
  }

  const existingDetails = (existing.data.details ?? {}) as Record<string, any>;
  let nextDetails: Record<string, unknown> | undefined;

  if (existing.data.purchase_type === "legend" && input.finalReplaceTarget?.playerId) {
    const teamId = existingDetails.purchasingTeamId as string | null;
    if (!teamId) throw new ApiError(400, "This legend purchase has no purchasing team to swap a player on.");
    const found = await supabase.from("rec_players").select("id,first_name,last_name,position,overall_rating,madden_player_id")
      .eq("id", input.finalReplaceTarget.playerId)
      .eq("league_id", existing.data.league_id)
      .eq("team_id", teamId)
      .in("roster_status", ["active", "transferred_in"])
      .maybeSingle();
    if (found.error || !found.data) {
      throw new ApiError(400, "Select an active player from the buyer's roster to permanently replace.");
    }
    const replaceTarget = {
      playerId: found.data.id,
      position: found.data.position,
      firstName: found.data.first_name,
      lastName: found.data.last_name,
      overallRating: found.data.overall_rating,
    };
    nextDetails = {
      ...existingDetails,
      replaceTarget,
      finalReplaceTarget: replaceTarget,
    };
  } else if (input.finalReplaceTarget !== undefined) {
    nextDetails = { ...existingDetails, finalReplaceTarget: input.finalReplaceTarget };
  }

  // Madden legends always need a concrete roster playerId before apply — buyer pick or
  // commissioner pick from the review dropdown.
  if (existing.data.purchase_type === "legend") {
    const league = await supabase.from("rec_leagues").select("game").eq("id", existing.data.league_id).maybeSingle();
    const isMadden = String(league.data?.game ?? "").startsWith("madden");
    const effectiveReplace = (nextDetails ?? existingDetails) as Record<string, any>;
    if (isMadden && !effectiveReplace.replaceTarget?.playerId && !effectiveReplace.finalReplaceTarget?.playerId) {
      throw new ApiError(400, "Choose which of the buyer's roster players this legend permanently replaces before approving.");
    }
  }

  const approved = await supabase
    .from("rec_purchases")
    .update({
      status: "approved",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      approved_at: now,
      updated_at: now,
      ...(nextDetails ? { details: nextDetails } : {}),
    })
    .eq("id", input.purchaseId)
    .select("*")
    .single();
  if (approved.error) throw new ApiError(500, "We couldn't approve that purchase. Please try again.", approved.error);
  await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "approved", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: now })
    .eq("source_table", "rec_purchases")
    .eq("source_id", input.purchaseId);

  // CFB has no live franchise-import cycle to defer to, so approval is the only moment the
  // swap can happen — apply immediately, same as before. If that write fails, revert the
  // approval instead of leaving an unrecoverable state (purchase marked approved, inbox item
  // resolved, but no roster player ever created and no way to retry) — put the purchase and
  // inbox item back to pending so the commissioner can simply approve again once fixed.
  // Madden legends are NOT applied here — the commissioner recreates the legend inside the
  // Madden save on the designated slot, and reconcileApprovedMaddenPurchases (run after every
  // EA import) marks the purchase fulfilled once that identity shows up in imported data.
  let isCfbLegend = false;
  if (existing.data.purchase_type === "legend") {
    const league = await supabase.from("rec_leagues").select("game").eq("id", existing.data.league_id).maybeSingle();
    isCfbLegend = String(league.data?.game ?? "") === "cfb_27";
    if (isCfbLegend) {
      try {
        await applyApprovedLegendPurchase(approved.data as Record<string, unknown>);
      } catch (err) {
        await supabase.from("rec_purchases").update({
          status: "pending", reviewed_by_discord_id: null, approved_at: null, updated_at: new Date().toISOString(),
        }).eq("id", input.purchaseId);
        await supabase.from("rec_commissioners_inbox").update({
          status: "pending", reviewed_by_discord_id: null, reviewed_at: null,
        }).eq("source_table", "rec_purchases").eq("source_id", input.purchaseId);
        throw err;
      }
    }
  }

  // Nothing told the buyer their purchase actually went through — approving silently updated
  // the DB and the buyer had no way to know short of refreshing their roster on a hunch.
  const purchaseDetails = existing.data.details as Record<string, unknown>;
  const legendName = existing.data.purchase_type === "legend" ? String(purchaseDetails?.name ?? "Legend") : null;
  const approveTitle = legendName ? (isCfbLegend ? `${legendName} approved & applied` : `${legendName} approved`) : `${label} approved`;
  const approveBody = legendName
    ? (isCfbLegend
      ? `${legendName} has been added to your roster.`
      : `${legendName} is approved. Recreate them in Madden on the designated roster slot, then re-import — they'll go live on your roster automatically.`)
    : `Your ${label.toLowerCase()} purchase was approved.`;
  await createSiteNotification({
    userId: existing.data.user_id,
    leagueId: existing.data.league_id,
    kind: `${existing.data.purchase_type}_approved`,
    title: approveTitle,
    body: approveBody,
    href: "/app",
  }).catch((err) => console.error("[ERROR] Failed to notify purchaser of approval (non-fatal):", err));

  return { updated: true, action: "approve" as const, purchase: approved.data, buyerDiscordId: existing.data.discord_id };
}

/** Commissioner review helper — Madden legend "commissioner's choice" dropdown. */
export async function listLegendReplacementCandidates(input: {
  purchaseId: string;
  leagueId?: string | null;
}) {
  let purchaseQuery = supabase.from("rec_purchases").select("id,league_id,purchase_type,details,status").eq("id", input.purchaseId);
  if (input.leagueId) purchaseQuery = purchaseQuery.eq("league_id", input.leagueId);
  const purchase = await purchaseQuery.maybeSingle();
  if (purchase.error) throw new ApiError(500, "We couldn't load that purchase. Please try again.", purchase.error);
  if (!purchase.data) throw new ApiError(404, "Purchase was not found.");
  if (purchase.data.purchase_type !== "legend") throw new ApiError(400, "Replacement candidates are only available for legend purchases.");

  const league = await supabase.from("rec_leagues").select("game").eq("id", purchase.data.league_id).maybeSingle();
  if (league.error) throw new ApiError(500, "We couldn't load the league. Please try again.", league.error);
  const isMadden = String(league.data?.game ?? "").startsWith("madden");
  if (!isMadden) {
    return { isMadden: false, teamId: null, buyerReplaceTarget: null, replacementPlayers: [] as Array<Record<string, unknown>> };
  }

  const details = (purchase.data.details ?? {}) as Record<string, any>;
  const teamId = details.purchasingTeamId as string | null;
  const buyerReplaceTarget = details.replaceTarget?.playerId
    ? {
        playerId: String(details.replaceTarget.playerId),
        position: String(details.replaceTarget.position ?? ""),
        firstName: String(details.replaceTarget.firstName ?? ""),
        lastName: String(details.replaceTarget.lastName ?? ""),
        overallRating: details.replaceTarget.overallRating ?? null,
      }
    : null;

  if (!teamId) {
    return { isMadden: true, teamId: null, buyerReplaceTarget, replacementPlayers: [] as Array<Record<string, unknown>> };
  }

  const roster = await supabase.from("rec_players")
    .select("id,full_name,first_name,last_name,position,overall_rating,dev_trait,madden_player_id")
    .eq("league_id", purchase.data.league_id)
    .eq("team_id", teamId)
    .in("roster_status", ["active", "transferred_in"]);
  if (roster.error) throw new ApiError(500, "We couldn't load the buyer's roster. Please try again.", roster.error);
  const replacementPlayers = [...(roster.data ?? [])].sort(
    (a: any, b: any) => (a.overall_rating ?? Infinity) - (b.overall_rating ?? Infinity),
  );
  return { isMadden: true, teamId, buyerReplaceTarget, replacementPlayers };
}

export async function listPendingPurchases(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { data, error } = await supabase
    .from("rec_purchases")
    .select("*")
    .eq("league_id", context.leagueId)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });
  if (error) throw new ApiError(500, "We couldn't load pending purchases. Please try again.", error);
  return {
    purchases: data ?? [],
  };
}

// Per-type counts for the store landing: season-active (counts toward cap) and all-time
// successful (approved/fulfilled) for metrics.
export async function getUserPurchaseCounts(discordId: string, guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const baseline = await getUserBaselineByDiscordId(discordId);
  const seasonNumber = resolveSeasonNumber(context);

  const { data, error } = await supabase
    .from("rec_purchases")
    .select("purchase_type,status,season_number")
    .eq("league_id", context.leagueId)
    .eq("user_id", baseline.user.id);
  if (error) throw new ApiError(500, "We couldn't load purchase counts. Please try again.", error);

  const seasonActive: Record<string, number> = {};
  const allTimeSuccessful: Record<string, number> = {};
  for (const row of data ?? []) {
    const type = String(row.purchase_type);
    if (Number(row.season_number) === seasonNumber && (ACTIVE_STATUSES as unknown as string[]).includes(String(row.status))) {
      seasonActive[type] = (seasonActive[type] ?? 0) + 1;
    }
    if (row.status === "approved" || row.status === "fulfilled") {
      allTimeSuccessful[type] = (allTimeSuccessful[type] ?? 0) + 1;
    }
  }

  return { seasonNumber, seasonActive, allTimeSuccessful };
}

const SEASON_CAP_COLUMNS: Partial<Record<RecPurchaseType, string>> = {
  age_reset: "age_resets_season_cap",
  dev_upgrade: "dev_upgrades_season_cap",
  contract: "contract_purchases_season_cap",
  legend: "legends_season_cap",
  custom_player: "custom_players_season_cap",
};

/**
 * Everything the web Store needs to price and cap-check purchases client-side before
 * submitting — core-attribute set, per-attribute cap overrides, non-core cap, this
 * season's already-used points per attribute, and the simple count-based season caps
 * for every other purchase type. The server still re-derives and re-enforces all of
 * this authoritatively on submit (createPurchaseRequest above); this is a preview only.
 */
export async function getStorePurchaseContext(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const baseline = await getUserBaselineByDiscordId(discordId);
  const seasonNumber = resolveSeasonNumber(context);

  const config = await supabase
    .from("rec_league_configuration")
    .select("core_attributes,core_attribute_cap_overrides,core_attribute_purchases_season_cap,core_attribute_group_cap,non_core_attribute_purchases_season_cap,non_core_attribute_cap_overrides,non_core_attribute_cap_mode,age_resets_season_cap,dev_upgrades_season_cap,contract_purchases_season_cap,legends_season_cap,custom_players_season_cap")
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (config.error) throw new ApiError(500, "We couldn't load store settings. Please try again.", config.error);
  const cfgRow = (config.data ?? {}) as Record<string, unknown>;

  const [existingAttrs, counts] = await Promise.all([
    supabase
      .from("rec_purchases")
      .select("details")
      .eq("league_id", context.leagueId)
      .eq("user_id", baseline.user.id)
      .eq("purchase_type", "attribute")
      .eq("season_number", seasonNumber)
      .in("status", ACTIVE_STATUSES as unknown as string[]),
    getUserPurchaseCounts(discordId, guildId),
  ]);
  if (existingAttrs.error) throw new ApiError(500, "We couldn't load attribute purchase history. Please try again.", existingAttrs.error);

  const usedCoreByCode: Record<string, number> = {};
  const usedNonCoreByCode: Record<string, number> = {};
  let usedCore = 0;
  let usedNonCore = 0;
  for (const row of existingAttrs.data ?? []) {
    const allocs = ((row as any).details?.allocations as any[]) ?? [];
    for (const a of allocs) {
      const pts = Math.max(0, Number(a.points) || 0);
      if (a.core) { usedCoreByCode[a.code] = (usedCoreByCode[a.code] ?? 0) + pts; usedCore += pts; }
      else { usedNonCoreByCode[a.code] = (usedNonCoreByCode[a.code] ?? 0) + pts; usedNonCore += pts; }
    }
  }

  const seasonCaps: Partial<Record<RecPurchaseType, number>> = {};
  for (const [type, column] of Object.entries(SEASON_CAP_COLUMNS)) {
    seasonCaps[type as RecPurchaseType] = Number(cfgRow[column as string] ?? 0);
  }

  return {
    seasonNumber,
    wallet: Number(baseline.wallet?.wallet_balance ?? 0),
    coreAttributes: Array.isArray(cfgRow.core_attributes) ? (cfgRow.core_attributes as unknown[]).map(String) : [],
    coreAttributeDefaultCap: Number(cfgRow.core_attribute_purchases_season_cap ?? 0),
    coreAttributeCapOverrides: (cfgRow.core_attribute_cap_overrides as Record<string, number>) ?? {},
    coreAttributeGroupCap: Number(cfgRow.core_attribute_group_cap ?? 0),
    nonCoreAttributeCap: Number(cfgRow.non_core_attribute_purchases_season_cap ?? 0),
    nonCoreAttributeCapOverrides: (cfgRow.non_core_attribute_cap_overrides as Record<string, number>) ?? {},
    nonCoreAttributeCapMode: cfgRow.non_core_attribute_cap_mode === "individual" ? "individual" : "group",
    usedCoreByCode,
    usedNonCoreByCode,
    usedCore,
    usedNonCore,
    seasonCaps,
    seasonActive: counts.seasonActive,
  };
}
