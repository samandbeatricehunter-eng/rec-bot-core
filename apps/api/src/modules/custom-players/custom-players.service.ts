import {
  REC_ARCHETYPE_CONFIG_VERSION,
  REC_BUILD_RULES_VERSION,
  REC_CUSTOM_PLAYER_COST_VERSION,
  REC_CUSTOM_PLAYER_PACKAGE_VERSION,
  REC_CUSTOM_PLAYER_POSITIONS,
  REC_DEV_TRAITS,
  REC_NAME_CORPUS_VERSION,
  REC_OVR_MODEL_VERSION,
  calculateRecAttributeCost,
  evaluateRecCustomPlayerBuild,
  generateRecPlayerName,
  getRecArchetype,
  getRecAttributeDisplayName,
  getRecCustomPlayerPackage,
  getRecEditableAttributes,
  getRecNetDevelopmentCost,
  isRecCustomPlayerPosition,
  listRecArchetypes,
  listRecCustomPlayerPackages,
  type RecGameFamily,
  type RecPackageTier,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { assertSiteAccountForEconomy } from "../subscriptions/discord-only.service.js";
import { getUserBaselineByDiscordId } from "../users/user.service.js";

type Identity = {
  firstName: string; lastName: string; jerseyNumber: number; handedness: string;
  heightInches: number; weightLbs: number; hometownCity?: string; hometownState?: string;
  college?: string;
};

function gameFamily(game: string): RecGameFamily { return game === "cfb_27" ? "CFB" : "MADDEN"; }
function gameYear(game: string): number { const match = game.match(/(\d{2})$/); return match ? Number(match[1]) : 27; }
function defaultDev(game: RecGameFamily, tier: RecPackageTier) { return tier >= 3 ? (game === "CFB" ? "impact" : "star") : "normal"; }

function validateIdentity(game: RecGameFamily, identity: Identity) {
  if (!identity.firstName?.trim() || !identity.lastName?.trim()) throw new ApiError(400, "First and last name are required.");
  if (!Number.isInteger(identity.jerseyNumber) || identity.jerseyNumber < 0 || identity.jerseyNumber > 99) throw new ApiError(400, "Jersey number must be 0-99.");
  if (!Number.isInteger(identity.heightInches) || identity.heightInches < 60 || identity.heightInches > 84) throw new ApiError(400, "Height must be 60-84 inches.");
  if (!Number.isInteger(identity.weightLbs) || identity.weightLbs < 140 || identity.weightLbs > 400) throw new ApiError(400, "Weight must be 140-400 pounds.");
  if (game === "CFB") {
    if (!identity.hometownCity?.trim() || !identity.hometownState?.trim()) throw new ApiError(400, "CFB players require a hometown and state.");
    if (identity.college) throw new ApiError(400, "CFB custom players do not use a college field.");
  }
}

function inferArchetype(game: RecGameFamily, position: string, attributes: Record<string, number>) {
  return listRecArchetypes(game, position).map((archetype) => {
    const primary = archetype.primaryAttributes.map((code) => Number(attributes[code] ?? 0));
    const secondary = archetype.secondaryAttributes.map((code) => Number(attributes[code] ?? 0));
    const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return { key: archetype.key, score: mean(primary) * .7 + mean(secondary) * .3 };
  }).sort((a, b) => b.score - a.score)[0]?.key ?? "unknown";
}

async function contextFor(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const baseline = await getUserBaselineByDiscordId(discordId);
  await assertSiteAccountForEconomy(baseline.user.id);
  const assignment = await supabase.from("rec_team_assignments").select("team_id")
    .eq("league_id", context.leagueId).eq("user_id", baseline.user.id).eq("assignment_status", "active").is("ended_at", null).limit(1).maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load your team assignment.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(403, "A linked league team is required.");
  return { context, baseline, teamId: String(assignment.data.team_id), seasonNumber: resolveSeasonNumber(context) };
}

export async function getCustomPlayerConfig(guildId: string, discordId: string) {
  const { context, baseline, teamId, seasonNumber } = await contextFor(guildId, discordId);
  const game = gameFamily(context.rec_leagues.game);
  const year = gameYear(context.rec_leagues.game);
  const config = await supabase.from("rec_league_configuration")
    .select("coin_economy_enabled,custom_players_enabled,custom_players_season_cap,purchase_deadlines")
    .eq("league_id", context.leagueId).maybeSingle();
  if (config.error) throw new ApiError(500, "Failed to load custom-player settings.", config.error);
  const builds = await supabase.from("rec_custom_player_builds").select("id", { count: "exact", head: true })
    .eq("league_id", context.leagueId).eq("user_id", baseline.user.id).eq("season_number", seasonNumber)
    .in("status", ["pending_review", "approved", "applied"]);
  const roster = await supabase.from("rec_players").select("id,full_name,first_name,last_name,position,overall_rating,dev_trait")
    .eq("league_id", context.leagueId).eq("team_id", teamId).eq("roster_status", "active").order("position");
  const wallet = Number(baseline.wallet?.wallet_balance ?? 0);
  const attributes = new Set<string>();
  for (const position of REC_CUSTOM_PLAYER_POSITIONS) for (const code of getRecEditableAttributes(game, position)) attributes.add(code);
  return {
    game, gameYear: year, teamId, seasonNumber, walletBalance: wallet,
    enabled: Boolean(config.data?.coin_economy_enabled && config.data?.custom_players_enabled),
    seasonCap: Number(config.data?.custom_players_season_cap ?? 0), seasonUsed: builds.count ?? 0,
    purchaseDeadlines: config.data?.purchase_deadlines ?? {},
    packages: listRecCustomPlayerPackages(game, year), positions: REC_CUSTOM_PLAYER_POSITIONS,
    devTraits: REC_DEV_TRAITS[game],
    archetypes: Object.fromEntries(REC_CUSTOM_PLAYER_POSITIONS.map((position) => [position, listRecArchetypes(game, position)])),
    attributes: [...attributes].sort().map((code) => ({ code, displayName: getRecAttributeDisplayName(code) })),
    replacementPlayers: roster.data ?? [],
    contractNotice: game === "MADDEN" ? "The outgoing player may be at any position. Your custom player receives the game's lowest available salary and bonus on a 3-year contract." : "The outgoing player may be at any position and is deleted from this league roster only. Choose a replacement player whose in-game appearance matches your physical preferences.",
    versions: { package: REC_CUSTOM_PLAYER_PACKAGE_VERSION, cost: REC_CUSTOM_PLAYER_COST_VERSION, archetype: REC_ARCHETYPE_CONFIG_VERSION, rules: REC_BUILD_RULES_VERSION, ovr: REC_OVR_MODEL_VERSION, names: REC_NAME_CORPUS_VERSION },
  };
}

export function generateCustomPlayerName(seed: string) { return generateRecPlayerName(seed); }

export function evaluateCustomPlayer(input: { game: RecGameFamily; packageTier: RecPackageTier; position: string; archetypeKey: string; developmentTrait: string; attributes: Record<string, number>; mode?: "preview" | "submit" }) {
  if (!isRecCustomPlayerPosition(input.position)) throw new ApiError(400, "Unsupported custom-player position. Kicker and punter are not eligible.");
  getRecArchetype(input.game, input.position, input.archetypeKey);
  const netDevelopmentCost = getRecNetDevelopmentCost(input.game, input.packageTier, input.developmentTrait);
  const evaluation = evaluateRecCustomPlayerBuild({ ...input, netDevelopmentCost, mode: input.mode ?? "preview" });
  return { ...evaluation, inferredArchetypeKey: inferArchetype(input.game, input.position, input.attributes) };
}

export async function submitCustomPlayer(input: {
  guildId: string; discordId: string; idempotencyKey: string; packageTier: RecPackageTier;
  position: string; archetypeKey: string; developmentTrait: string; identity: Identity;
  attributes: Record<string, number>; replacementPlayerId: string;
}) {
  const { context, baseline, teamId, seasonNumber } = await contextFor(input.guildId, input.discordId);
  const game = gameFamily(context.rec_leagues.game); const year = gameYear(context.rec_leagues.game);
  validateIdentity(game, input.identity);
  const config = await getCustomPlayerConfig(input.guildId, input.discordId);
  if (!config.enabled) throw new ApiError(400, "Custom-player purchases are disabled for this league.");
  if (config.seasonCap > 0 && config.seasonUsed >= config.seasonCap) throw new ApiError(409, "You have reached this season's custom-player cap.");
  const evaluation = evaluateCustomPlayer({ game, packageTier: input.packageTier, position: input.position, archetypeKey: input.archetypeKey, developmentTrait: input.developmentTrait, attributes: input.attributes, mode: "submit" });
  if (!evaluation.valid) throw new ApiError(400, evaluation.violations.map((violation) => violation.message).join(" "));
  const pkg = getRecCustomPlayerPackage(game, input.packageTier, year);
  if (config.walletBalance < pkg.coinPrice) throw new ApiError(400, `Insufficient wallet balance. This package costs ${pkg.coinPrice} coins.`);
  const replacement = await supabase.from("rec_players").select("*").eq("id", input.replacementPlayerId)
    .eq("league_id", context.leagueId).eq("team_id", teamId).eq("roster_status", "active").maybeSingle();
  if (replacement.error || !replacement.data) throw new ApiError(400, "Select an active player from your roster to replace.");
  const existing = await supabase.from("rec_custom_player_builds").select("*").eq("league_id", context.leagueId)
    .eq("user_id", baseline.user.id).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (existing.data) return { build: existing.data, duplicate: true };
  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  const purchase = await supabase.from("rec_purchases").insert({ league_id: context.leagueId, season_id: seasonId, season_number: seasonNumber,
    user_id: baseline.user.id, team_id: teamId, discord_id: input.discordId, purchase_type: "custom_player", cost: pkg.coinPrice,
    details: { packageTier: input.packageTier, position: input.position, archetypeKey: input.archetypeKey }, status: "pending", already_deducted: false }).select("*").single();
  if (purchase.error) throw new ApiError(500, "Failed to create the purchase.", purchase.error);
  const refundCoins = Math.ceil(evaluation.pointsRemaining * .5);
  const build = await supabase.from("rec_custom_player_builds").insert({ purchase_id: purchase.data.id, league_id: context.leagueId, season_id: seasonId,
    season_number: seasonNumber, user_id: baseline.user.id, team_id: teamId, replacement_player_id: input.replacementPlayerId,
    replacement_player_snapshot: replacement.data,
    game_family: game, game_year: year, package_tier: input.packageTier, package_key: pkg.key, position: input.position.toUpperCase(),
    selected_archetype_key: input.archetypeKey, inferred_archetype_key: evaluation.inferredArchetypeKey, development_trait: input.developmentTrait,
    identity: input.identity, attributes: input.attributes, evaluation, coin_price: pkg.coinPrice, creation_point_budget: evaluation.creationPoints,
    attribute_points_spent: evaluation.attributeCost, development_points_spent: evaluation.netDevelopmentCost, creation_points_spent: evaluation.totalCost,
    creation_points_remaining: evaluation.pointsRemaining, unused_cp_refund_coins: refundCoins, estimated_ovr_raw: evaluation.rawOverall,
    estimated_ovr: evaluation.displayOverall, linear_score: evaluation.linearScore, model_confidence: evaluation.confidence,
    raw_ovr_cap: evaluation.rawOverallCap, support_indexes: {}, package_configuration_version: REC_CUSTOM_PLAYER_PACKAGE_VERSION,
    cost_configuration_version: REC_CUSTOM_PLAYER_COST_VERSION, archetype_configuration_version: REC_ARCHETYPE_CONFIG_VERSION,
    build_rules_version: REC_BUILD_RULES_VERSION, ovr_model_version: REC_OVR_MODEL_VERSION, name_corpus_version: REC_NAME_CORPUS_VERSION,
    idempotency_key: input.idempotencyKey }).select("*").single();
  if (build.error) { await supabase.from("rec_purchases").delete().eq("id", purchase.data.id); throw new ApiError(500, "Failed to save the custom-player build.", build.error); }
  const ledger = await supabase.rpc("add_to_wallet", { p_user_id: baseline.user.id, p_amount: -pkg.coinPrice, p_league_id: context.leagueId,
    p_description: `${pkg.displayName} custom player`, p_transaction_type: "purchase_debit", p_source: "purchase", p_source_reference: { customPlayerBuildId: build.data.id } });
  if (ledger.error) { await supabase.from("rec_custom_player_builds").delete().eq("id", build.data.id); await supabase.from("rec_purchases").delete().eq("id", purchase.data.id); throw new ApiError(500, "Failed to charge the wallet.", ledger.error); }
  await Promise.all([
    supabase.from("rec_custom_player_builds").update({ debit_ledger_id: ledger.data }).eq("id", build.data.id),
    supabase.from("rec_purchases").update({ debit_ledger_id: ledger.data, already_deducted: true }).eq("id", purchase.data.id),
    supabase.from("rec_custom_player_audit_log").insert({ build_id: build.data.id, action: "submitted", actor_user_id: baseline.user.id, actor_discord_id: input.discordId, next_status: "pending_review", details: { evaluation } }),
  ]);
  const attributeRows = Object.entries(input.attributes).filter(([, rating]) => rating > 0).map(([code, rating]) => ({ build_id: build.data.id, attribute_key: code,
    rating, points_spent: Array.from({ length: rating }, (_, index) => calculateRecAttributeCost(game, input.position, input.archetypeKey, code, index + 1)).reduce((a, b) => a + b, 0),
    per_point_cost_ledger: Array.from({ length: rating }, (_, index) => calculateRecAttributeCost(game, input.position, input.archetypeKey, code, index + 1)) }));
  if (attributeRows.length) await supabase.from("rec_custom_player_build_attributes").insert(attributeRows);
  return { build: { ...build.data, debit_ledger_id: ledger.data }, duplicate: false, walletBalance: config.walletBalance - pkg.coinPrice };
}

export async function listCustomPlayerBuilds(guildId: string, discordId: string, manage = false) {
  const { context, baseline } = await contextFor(guildId, discordId);
  let query = supabase.from("rec_custom_player_builds").select("*").eq("league_id", context.leagueId).order("submitted_at", { ascending: false });
  if (!manage) query = query.eq("user_id", baseline.user.id);
  const result = await query; if (result.error) throw new ApiError(500, "Failed to load custom players.", result.error);
  return { builds: result.data ?? [] };
}

export async function reviewCustomPlayer(input: { guildId: string; buildId: string; action: "approve" | "reject"; reviewerDiscordId: string; note?: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const loaded = await supabase.from("rec_custom_player_builds").select("*").eq("id", input.buildId).eq("league_id", context.leagueId).maybeSingle();
  if (loaded.error || !loaded.data) throw new ApiError(404, "Custom-player build not found.");
  const build: any = loaded.data; if (build.status !== "pending_review") throw new ApiError(409, `Build is already ${build.status}.`);
  if (input.action === "reject") {
    const refund = await supabase.rpc("add_to_wallet", { p_user_id: build.user_id, p_amount: build.coin_price, p_league_id: build.league_id,
      p_description: "Rejected custom-player refund", p_transaction_type: "purchase_refund", p_source: "purchase", p_source_reference: { customPlayerBuildId: build.id, rejected: true } });
    if (refund.error) throw new ApiError(500, "Failed to refund the rejected build.", refund.error);
    await Promise.all([supabase.from("rec_custom_player_builds").update({ status: "rejected", rejected_at: new Date().toISOString(), reviewed_by_discord_id: input.reviewerDiscordId, review_note: input.note ?? null }).eq("id", build.id),
      supabase.from("rec_purchases").update({ status: "rejected", refund_ledger_id: refund.data, denied_reason: input.note ?? "Rejected by commissioner" }).eq("id", build.purchase_id),
      supabase.from("rec_custom_player_audit_log").insert({ build_id: build.id, action: "rejected", actor_discord_id: input.reviewerDiscordId, previous_status: build.status, next_status: "rejected", details: { note: input.note } })]);
    return { status: "rejected", refunded: build.coin_price };
  }
  const reevaluated = evaluateCustomPlayer({ game: build.game_family, packageTier: build.package_tier, position: build.position, archetypeKey: build.selected_archetype_key, developmentTrait: build.development_trait, attributes: build.attributes, mode: "submit" });
  if (!reevaluated.valid) throw new ApiError(409, "The saved build no longer passes authoritative validation.");
  const identity = build.identity as Identity;
  await supabase.from("rec_players").delete().eq("id", build.replacement_player_id).eq("league_id", build.league_id).eq("team_id", build.team_id);
  const madden = build.game_family === "MADDEN";
  const player = await supabase.from("rec_players").insert({ league_id: build.league_id, team_id: build.team_id, madden_player_id: null,
    first_name: identity.firstName.trim(), last_name: identity.lastName.trim(), full_name: `${identity.firstName.trim()} ${identity.lastName.trim()}`,
    position: build.position, height_inches: identity.heightInches, weight_lbs: identity.weightLbs, hometown_city: madden ? null : identity.hometownCity,
    hometown_state: madden ? null : identity.hometownState, college: madden ? identity.college ?? null : null, jersey_number: identity.jerseyNumber,
    handedness: identity.handedness, dev_trait: build.development_trait, overall_rating: build.estimated_ovr, archetype: build.inferred_archetype_key,
    attributes: build.attributes, raw_payload: { customPlayer: true, buildId: build.id }, player_source: "custom_player", custom_player_build_id: build.id,
    contract_years_left: madden ? 3 : null, contract_salary: madden ? 0 : null, contract_bonus: madden ? 0 : null, is_xfactor: madden ? build.development_trait === "xfactor" : null,
    ability_count: null, roster_status: "active", is_default_player: false }).select("*").single();
  if (player.error) throw new ApiError(500, "Failed to apply the custom player.", player.error);
  let cpRefundLedgerId: string | null = null;
  if (build.unused_cp_refund_coins > 0) {
    const cpRefund = await supabase.rpc("add_to_wallet", { p_user_id: build.user_id, p_amount: build.unused_cp_refund_coins, p_league_id: build.league_id,
      p_description: "Unused custom-player creation point refund", p_transaction_type: "custom_player_unused_cp_refund", p_source: "purchase", p_source_reference: { customPlayerBuildId: build.id, unusedCp: build.creation_points_remaining } });
    if (cpRefund.error) throw new ApiError(500, "Player applied, but the unused-CP refund failed.", cpRefund.error);
    cpRefundLedgerId = cpRefund.data;
  }
  await Promise.all([supabase.from("rec_custom_player_builds").update({ status: "applied", approved_at: new Date().toISOString(), applied_at: new Date().toISOString(), created_player_id: player.data.id, unused_cp_refund_ledger_id: cpRefundLedgerId, reviewed_by_discord_id: input.reviewerDiscordId, review_note: input.note ?? null }).eq("id", build.id),
    supabase.from("rec_purchases").update({ status: "fulfilled", approved_at: new Date().toISOString(), fulfilled_at: new Date().toISOString() }).eq("id", build.purchase_id),
    supabase.from("rec_custom_player_audit_log").insert({ build_id: build.id, action: "approved_and_applied", actor_discord_id: input.reviewerDiscordId, previous_status: build.status, next_status: "applied", details: { createdPlayerId: player.data.id, unusedCpRefundCoins: build.unused_cp_refund_coins } })]);
  return { status: "applied", player: player.data, unusedCpRefundCoins: build.unused_cp_refund_coins };
}
