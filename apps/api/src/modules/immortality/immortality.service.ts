import {
  allCharacteristicCatalogs,
  attributeCodesFor,
  applyBranchingDeltas,
  applyIqOverlay,
  applyRiseToImmortalityLockedSettings,
  branchingPlaystyleGroup,
  canAdvanceIqQuestion,
  canConvertToTeamXp,
  canTransition,
  characteristicCatalog,
  chapterForState,
  combinedModifiers,
  convertPlayerXpToTeamXp,
  DEFAULT_CREATION_POINT_BUDGET,
  DEV_OVR_CEILING,
  FIXED_RTI_BASELINES,
  hasFixedRtiBaseline,
  ledgerXpBalance,
  draftValueFromProfile,
  FORMULA_VERSIONS,
  gradeIqSubmission,
  heightOverageCreationPointCost,
  hybridBaseline,
  IMMORTALITY_DEFENSE_POSITIONS,
  IMMORTALITY_OFFENSE_POSITIONS,
  iqBankForSide,
  isImmortalityDefensePosition,
  isImmortalityOffensePosition,
  isIqTimedOut,
  IQ_QUESTION_COUNT,
  IQ_SECONDS_PER_QUESTION,
  nextQuestionExpiresAt,
  originsOpen,
  personaQuestionsForSide,
  personaQuestionsForOwner,
  playstyleQuestionsForGroup,
  positionGroupFor,
  publicPersonaQuestions,
  publicPersonaQuestionsForOwner,
  publicPlaystyleQuestions,
  projectedRoundFromRank,
  rejectSelfVote,
  RISE_TO_IMMORTALITY_HIGHLIGHT_PAYOUT,
  RISE_TO_IMMORTALITY_LEAGUE_TYPE,
  riseHubUnlocked,
  rankDraftClass,
  completePairUserIds,
  type DraftGradeSnapshot,
  abilityById,
  canSelectAbility,
  playerArchetypes,
  rtiAbilitiesForPosition,
  matchingAbilityGate,
  MAX_EQUIPPED_ABILITIES,
  scoreIqAttempt,
  scorePersonaInterview,
  scoreBranchingPlaystyleInterview,
  scorePlaystyleInterview,
  scorePerformanceContract,
  shouldApplyRiseToImmortality,
  spendAttributePlusOne,
  spendCreationPoints,
  startingDevTrait,
  toPublicIqQuestion,
  validateCharacteristicSelection,
  MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY,
  MADDEN_ATTRIBUTE_BY_CODE,
  MADDEN_ATTRIBUTE_DEFINITIONS,
  rosterAttributeValueForCode,
  type MaddenAttributeCode,
  matchupInterviewPool,
  selectMatchupInterviewQuestion,
  selectMatchupInterviewQuestions,
  buildReactiveMatchupInterviewQuestion,
  REACTIVE_MATCHUP_QUESTION_ID_BASE,
  evaluateMatchupInterviewClaim,
  scoreMatchupInterviewAnswer,
  resolvePersona,
  addPersonaPoints,
  emptyPersonaScores,
  type PersonaScores,
  issuedWeeklyChallenges,
  XP_POINTS_PER_LEVEL,
  RISE_TO_IMMORTALITY_MEDIA_DAY_PAYOUT,
  RISE_TO_IMMORTALITY_COMMISSIONER_BONUS_AMOUNT,
  personaDnaQuestions,
  personaDnaCatalog,
  mindsetFocusCatalog,
  publicPersonaDnaQuestions,
  scorePersonaDnaInterview,
  playerTraitQuestions,
  playerTraitCatalog,
  publicPlayerTraitQuestions,
  scorePlayerTraitInterview,
  type PlayerTraitPositionGroup,
  type ImmortalityDefensePosition,
  type ImmortalityOffensePosition,
  type ImmortalityState,
  type ImmortalityPosition,
  type RiseToImmortalityTeamPool,
  buildProspectBackstory,
  type PersonaDimension,
  stageInterviewPool,
  stageInterviewGroupFor,
  selectStageInterviewQuestion,
  scoreStageInterviewAnswer,
  type StageInterviewQuestion,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext, isSiteOnlyDiscordId, recUserIdFromSiteOnlyDiscordId, siteOnlyDiscordId, findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { linkUserToTeam } from "../team-ownership/team-ownership.service.js";
import { applyLeagueTeamIdentityOverrides, type LeagueTeamIdentityOverride } from "../team-identities/team-identities.service.js";
import { postDiscordChannelMessage, postDiscordChannelMessageWithFile, editDiscordMessageWithFile, setGuildMemberNickname, sendDiscordDirectMessage } from "../../lib/discord-guild.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { kickLeagueUser } from "../moderation/moderation.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { renderProspectCardPng } from "../../lib/prospect-card-render.js";
import { uploadImageToCloudflare } from "../../lib/cloudflare-images.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { leagueWeekGamesQuery, leagueSeasonGamesQuery } from "../league-context/league-games.query.js";
import { postInterviewQuoteHeadline } from "./interview-headline.js";
import { gameplaySeasonStages } from "@rec/shared";

const HEADSHOT_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEADSHOT_MAX_BYTES = 5 * 1024 * 1024;

export async function recUserIdFromDiscordId(discordId: string): Promise<string> {
  if (isSiteOnlyDiscordId(discordId)) {
    const userId = recUserIdFromSiteOnlyDiscordId(discordId);
    if (!userId) throw new ApiError(401, "Could not resolve your REC profile.");
    return userId;
  }
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error || !account.data?.user_id) throw new ApiError(401, "Link your REC profile before continuing.");
  return String(account.data.user_id);
}

export async function discordIdForRecUser(userId: string): Promise<string> {
  const accounts = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", userId);
  const real = (accounts.data ?? []).find((row) => row.discord_id && !isSiteOnlyDiscordId(String(row.discord_id)));
  if (real?.discord_id) return String(real.discord_id);
  return siteOnlyDiscordId(userId);
}

function membershipAuthority(role: unknown): "member" | "commissioner" | "co_commissioner" {
  const value = String(role ?? "").toLowerCase();
  if (value === "co_commissioner") return "co_commissioner";
  if (value === "commissioner" || value === "head_commissioner") return "commissioner";
  return "member";
}

export async function loadImmortalityLeague(leagueId: string) {
  const row = await supabase.from("rec_immortality_leagues").select("*").eq("league_id", leagueId).maybeSingle();
  if (row.error) throw new ApiError(500, "Could not load Rise to Immortality.", row.error);
  return row.data;
}

export async function requireImmortalityLeague(leagueId: string) {
  const league = await loadImmortalityLeague(leagueId);
  if (!league) throw new ApiError(404, "This is not a Rise to Immortality league.");
  return league;
}

export async function createImmortalityLeagueRow(input: {
  leagueId: string;
  offensePosition: ImmortalityOffensePosition;
  defensePosition: ImmortalityDefensePosition;
  actorUserId?: string | null;
  teamPool?: RiseToImmortalityTeamPool;
}) {
  if (!isImmortalityOffensePosition(input.offensePosition)) {
    throw new ApiError(400, "Pick a universal offensive position: QB, HB, WR, or TE.");
  }
  if (!isImmortalityDefensePosition(input.defensePosition)) {
    throw new ApiError(400, "Pick a universal defensive position: CB, FS, SS, or MIKE.");
  }
  const inserted = await supabase.from("rec_immortality_leagues").insert({
    league_id: input.leagueId,
    chapter_state: "REGISTRATION",
    offense_position: input.offensePosition,
    defense_position: input.defensePosition,
    team_pool: input.teamPool === "custom_32" ? "custom_32" : "default_nfl",
    creation_point_budget: DEFAULT_CREATION_POINT_BUDGET,
    formula_versions: FORMULA_VERSIONS,
    intro_video_url: DEFAULT_RTI_INTRO_VIDEO_URL,
  }).select("*").single();
  if (inserted.error) throw new ApiError(500, "Could not create Rise to Immortality settings.", inserted.error);
  await supabase.from("rec_immortality_state_history").insert({
    immortality_league_id: inserted.data.id,
    from_state: "SETUP",
    to_state: "REGISTRATION",
    actor_user_id: input.actorUserId ?? null,
    note: "League created",
  });
  await supabase.from("rec_immortality_audit_log").insert({
    immortality_league_id: inserted.data.id,
    actor_user_id: input.actorUserId ?? null,
    event_type: "league_created",
    payload: { offensePosition: input.offensePosition, defensePosition: input.defensePosition },
  });
  return inserted.data;
}

export function immortalityCreateOverrides(input: Record<string, unknown>): Record<string, unknown> {
  if (!shouldApplyRiseToImmortality({
    game: String(input.game ?? ""),
    leagueType: String(input.leagueType ?? ""),
    templateId: input.templateId ? String(input.templateId) : null,
  })) {
    return input;
  }
  return applyRiseToImmortalityLockedSettings({
    ...input,
    leagueType: RISE_TO_IMMORTALITY_LEAGUE_TYPE,
  });
}

function shuffleOrder(length: number, seed: string): number[] {
  const order = Array.from({ length }, (_, index) => index);
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  for (let i = order.length - 1; i > 0; i -= 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const j = hash % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

async function loadProspectForUser(immortalityLeagueId: string, userId: string, side: "offense" | "defense") {
  const row = await supabase
    .from("rec_immortality_prospects")
    .select("*")
    .eq("immortality_league_id", immortalityLeagueId)
    .eq("user_id", userId)
    .eq("side", side)
    .maybeSingle();
  if (row.error) throw new ApiError(500, "Could not load your prospect.", row.error);
  return row.data;
}

const ORIGINS_STEPS = ["identity", "iq", "persona", "playstyle", "persona_dna", "player_traits", "characteristics", "creation"] as const;

// Cloudflare Stream direct-download URL for the RTI intro video (uid 2b3a896893abc70e280844d7929601eb),
// uploaded 2026-09-01. Every new RTI league starts with this set; the commissioner can still
// change or clear it later from Origins' Commissioner panel.
const DEFAULT_RTI_INTRO_VIDEO_URL = "https://customer-9rnlzt96rd7anlvm.cloudflarestream.com/2b3a896893abc70e280844d7929601eb/downloads/default.mp4";

async function bumpOriginsStep(prospectId: string, current: unknown, next: (typeof ORIGINS_STEPS)[number]) {
  const from = ORIGINS_STEPS.indexOf(String(current ?? "identity") as (typeof ORIGINS_STEPS)[number]);
  const to = ORIGINS_STEPS.indexOf(next);
  if (to < 0 || to <= from) return;
  await supabase.from("rec_immortality_prospects").update({
    origins_step: next,
    updated_at: new Date().toISOString(),
  }).eq("id", prospectId);
}

export async function refreshImmortalityDraftBoardForLeague(leagueId: string) {
  const league = await loadImmortalityLeague(leagueId);
  if (!league) return { grades: [] as ReturnType<typeof rankDraftClass> };
  return refreshImmortalityDraftBoard(String(league.id), String(league.league_id));
}

function snapshotFromGradeRow(row: Record<string, unknown>): DraftGradeSnapshot {
  return {
    prospectId: String(row.prospect_id ?? row.prospectId),
    userId: String(row.user_id ?? row.userId),
    side: (row.side === "defense" ? "defense" : "offense"),
    rawScore: Number(row.raw_score ?? row.rawScore ?? 0),
    stageScores: (row.stage_scores ?? row.stageScores ?? {}) as DraftGradeSnapshot["stageScores"],
    draftValue: Number(row.draft_value ?? row.draftValue ?? 0),
    classRank: Number(row.class_rank ?? row.classRank ?? 1),
    classSize: Number(row.class_size ?? row.classSize ?? 1),
    projectedRound: Number(row.projected_round ?? row.projectedRound ?? 4),
    preferredMin: Number(row.preferred_min ?? row.preferredMin ?? 3),
    preferredMax: Number(row.preferred_max ?? row.preferredMax ?? 5),
    gradeLabel: String(row.grade_label ?? row.gradeLabel ?? "B"),
    stock: (String(row.stock ?? "new") as DraftGradeSnapshot["stock"]),
    ready: Boolean(row.ready),
  };
}

export async function refreshImmortalityDraftBoard(immortalityLeagueId: string, recLeagueId?: string): Promise<{ grades: DraftGradeSnapshot[]; frozen: boolean }> {
  const draftClass = await supabase.from("rec_immortality_draft_classes").select("status").eq("immortality_league_id", immortalityLeagueId).maybeSingle();
  if (draftClass.data?.status === "solved") {
    const frozen = await supabase.from("rec_immortality_draft_grades").select("*").eq("immortality_league_id", immortalityLeagueId);
    return { grades: (frozen.data ?? []).map((row) => snapshotFromGradeRow(row as Record<string, unknown>)), frozen: true };
  }
  const prospects = await supabase.from("rec_immortality_prospects").select("id,user_id,side,first_name,last_name,position,origins_step").eq("immortality_league_id", immortalityLeagueId);
  if (prospects.error) throw new ApiError(500, "Could not load the draft class.", prospects.error);
  const rows = prospects.data ?? [];
  const ids = rows.map((row) => String(row.id));
  const [iq, persona, playstyle, traits, builds, previous, leagueRow] = await Promise.all([
    ids.length ? supabase.from("rec_immortality_iq_attempts").select("prospect_id,completed_at,iq_score").in("prospect_id", ids) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ids.length ? supabase.from("rec_immortality_persona_results").select("prospect_id").in("prospect_id", ids) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ids.length ? supabase.from("rec_immortality_playstyle_results").select("prospect_id,blend").in("prospect_id", ids) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ids.length ? supabase.from("rec_immortality_prospect_characteristics").select("prospect_id,characteristic_key,slot_cost").in("prospect_id", ids) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ids.length ? supabase.from("rec_immortality_creation_builds").select("prospect_id,estimated_ovr").in("prospect_id", ids) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    supabase.from("rec_immortality_draft_grades").select("prospect_id,class_rank,draft_value").eq("immortality_league_id", immortalityLeagueId),
    recLeagueId
      ? Promise.resolve({ data: { league_id: recLeagueId } })
      : supabase.from("rec_immortality_leagues").select("league_id,offense_position,defense_position").eq("id", immortalityLeagueId).maybeSingle(),
  ]);
  const iqBy = new Map<string, Record<string, unknown>>((iq.data ?? []).map((row) => [String((row as Record<string, unknown>).prospect_id), row as Record<string, unknown>]));
  const personaBy = new Set((persona.data ?? []).map((row) => String((row as Record<string, unknown>).prospect_id)));
  const playstyleBy = new Map<string, Record<string, unknown>>((playstyle.data ?? []).map((row) => [String((row as Record<string, unknown>).prospect_id), row as Record<string, unknown>]));
  const traitsBy = new Map<string, Array<{ characteristic_key: string; slot_cost: number }>>();
  for (const row of traits.data ?? []) {
    const list = traitsBy.get(String(row.prospect_id)) ?? [];
    list.push({ characteristic_key: String(row.characteristic_key), slot_cost: Number(row.slot_cost ?? 0) });
    traitsBy.set(String(row.prospect_id), list);
  }
  const buildBy = new Map<string, Record<string, unknown>>((builds.data ?? []).map((row) => [String((row as Record<string, unknown>).prospect_id), row as Record<string, unknown>]));
  const prevBy = new Map<string, Record<string, unknown>>((previous.data ?? []).map((row) => [String((row as Record<string, unknown>).prospect_id), row as Record<string, unknown>]));
  const immortality = recLeagueId
    ? await supabase.from("rec_immortality_leagues").select("offense_position,defense_position,league_id").eq("id", immortalityLeagueId).maybeSingle()
    : { data: leagueRow.data as { offense_position?: string; defense_position?: string; league_id?: string } | null };
  const inputs = rows.map((row) => {
    const selectedKeys = (traitsBy.get(String(row.id)) ?? []).map((item) => item.characteristic_key);
    const catalog = characteristicCatalog(positionGroupFor((row.position ?? (row.side === "offense" ? immortality.data?.offense_position : immortality.data?.defense_position)) as ImmortalityPosition));
    const selected = catalog.filter((item) => selectedKeys.includes(item.key));
    const modifiers = combinedModifiers(selected);
    const blend = (playstyleBy.get(String(row.id))?.blend ?? null) as { kind?: "dominant" | "clear" | "near_tie" } | null;
    const prev = prevBy.get(String(row.id));
    const ovr = buildBy.get(String(row.id))?.estimated_ovr;
    return {
      prospectId: String(row.id),
      userId: String(row.user_id),
      side: row.side as "offense" | "defense",
      firstName: row.first_name ? String(row.first_name) : null,
      lastName: row.last_name ? String(row.last_name) : null,
      iqCompleted: Boolean(iqBy.get(String(row.id))?.completed_at),
      iqScore: iqBy.get(String(row.id))?.iq_score != null ? Number(iqBy.get(String(row.id))?.iq_score) : null,
      personaCompleted: personaBy.has(String(row.id)),
      playstyleBlendKind: blend?.kind ?? null,
      characteristicSlotCost: (traitsBy.get(String(row.id)) ?? []).reduce((sum, item) => sum + item.slot_cost, 0),
      startDevStar: Boolean(modifiers.startDevStar),
      estimatedOvr: ovr == null ? null : Number(ovr),
      previousClassRank: prev?.class_rank != null ? Number(prev.class_rank) : null,
      previousDraftValue: prev?.draft_value != null ? Number(prev.draft_value) : null,
    };
  });
  const grades = rankDraftClass(inputs);
  if (grades.length) {
    const upserted = await supabase.from("rec_immortality_draft_grades").upsert(grades.map((grade) => {
      const prev = prevBy.get(grade.prospectId);
      return {
        prospect_id: grade.prospectId,
        immortality_league_id: immortalityLeagueId,
        user_id: grade.userId,
        side: grade.side,
        raw_score: grade.rawScore,
        stage_scores: grade.stageScores,
        draft_value: grade.draftValue,
        class_rank: grade.classRank,
        class_size: grade.classSize,
        projected_round: grade.projectedRound,
        preferred_min: grade.preferredMin,
        preferred_max: grade.preferredMax,
        grade_label: grade.gradeLabel,
        stock: grade.stock,
        ready: grade.ready,
        previous_class_rank: prev?.class_rank ?? null,
        previous_draft_value: prev?.draft_value ?? null,
        updated_at: new Date().toISOString(),
      };
    }), { onConflict: "prospect_id" });
    if (upserted.error) throw new ApiError(500, "Could not update draft stock.", upserted.error);
    for (const grade of grades) {
      if (!buildBy.has(grade.prospectId)) continue;
      await supabase.from("rec_immortality_creation_builds").update({
        draft_value: grade.draftValue,
        projected_round: grade.projectedRound,
      }).eq("prospect_id", grade.prospectId);
    }
  }
  return { grades, frozen: false };
}

export async function getImmortalityHub(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(discordId);
  // Repairs commissioners from leagues created before the RTI franchise-claim flow existed.
  // Their ordinary team assignment is already valid, but without the mirrored RTI claim the
  // presentation screen loops them back into team selection and never publishes their players.
  await finalizePreassignedImmortalityOwner({
    guildId,
    recLeagueId: context.leagueId,
    immortalityLeagueId: String(league.id),
    userId,
    discordId,
  }).catch((error) => console.error("[WARN] Could not backfill preassigned RTI owner (non-fatal):", error));
  const board = await refreshImmortalityDraftBoard(String(league.id), context.leagueId);
  const prospects = await supabase
    .from("rec_immortality_prospects")
    .select("*")
    .eq("immortality_league_id", league.id)
    .eq("user_id", userId);
  if (prospects.error) throw new ApiError(500, "Could not load prospects.", prospects.error);
  const prospectIds = (prospects.data ?? []).map((row) => String(row.id));
  const [builds, ledgers, traits, draftClass, hallNominees, classProspects, playstyles, branchingPlaystyles, equippedAbilities, abilityGrants, personaDnaRows, playerTraitRows, contractRows] = await Promise.all([
    prospectIds.length
      ? supabase.from("rec_immortality_creation_builds").select("*").in("prospect_id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
    prospectIds.length
      ? supabase.from("rec_immortality_xp_ledger").select("prospect_id,player_xp_delta,team_xp_delta,event_type,created_at").in("prospect_id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
    prospectIds.length
      ? supabase.from("rec_immortality_prospect_characteristics").select("prospect_id,characteristic_key").in("prospect_id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("rec_immortality_draft_classes").select("id,status").eq("immortality_league_id", league.id).maybeSingle(),
    league.chapter_state === "IMMORTALITY_VOTING" || league.chapter_state === "IMMORTALITY_REVEAL"
      ? supabase.from("rec_immortality_prospects").select("id,user_id,side,first_name,last_name,position").eq("immortality_league_id", league.id)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("rec_immortality_prospects").select("id,first_name,last_name,position").eq("immortality_league_id", league.id),
    prospectIds.length
      ? supabase.from("rec_immortality_playstyle_results").select("prospect_id,primary_archetype,secondary_archetype").in("prospect_id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
    prospectIds.length
      ? supabase.from("rec_immortality_branching_playstyle_results").select("prospect_id,primary_archetype,secondary_archetype").in("prospect_id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
    prospectIds.length
      ? supabase.from("rec_immortality_prospect_abilities").select("prospect_id,ability_id,ability_name,kind").in("prospect_id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
    prospectIds.length
      ? supabase.from("rec_immortality_ability_grants").select("prospect_id,slots").in("prospect_id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
    prospectIds.length
      ? supabase.from("rec_immortality_prospect_persona_dna").select("prospect_id,trait_key").in("prospect_id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
    prospectIds.length
      ? supabase.from("rec_immortality_prospect_player_traits").select("prospect_id,trait_key").in("prospect_id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
    prospectIds.length
      ? supabase.from("rec_immortality_contracts").select("id,prospect_id,contract_number,start_season,end_season,coins_per_season,player_xp_payout,coins_payout,band,offer_status,signed_at").in("prospect_id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const xpByProspect = new Map<string, { playerXp: number; teamXp: number }>();
  for (const id of prospectIds) {
    const rows = (ledgers.data ?? []).filter((row) => row.prospect_id === id);
    xpByProspect.set(id, ledgerXpBalance(rows));
  }
  // Real OVR, not the pre-import Creation Points estimate -- once a real EA roster import
  // reconciles this prospect's synthetic "rti:" madden_player_id onto its real EA id (see
  // ea-direct-writer.ts's placeholder adoption), rec_players carries the actual in-game rating.
  // Before that first import, overall_rating is null and nothing OVR-gated is available yet.
  const materializedPlayerIds = (prospects.data ?? []).map((row) => row.player_id).filter((id): id is string => Boolean(id));
  const realPlayers = materializedPlayerIds.length
    ? await supabase.from("rec_players").select("id,overall_rating").in("id", materializedPlayerIds)
    : { data: [] as Array<{ id: string; overall_rating: number | null }> };
  const realOvrByPlayerId = new Map<string, number | null>((realPlayers.data ?? []).map((row) => [String(row.id), row.overall_rating == null ? null : Number(row.overall_rating)]));
  const chapterState = league.chapter_state as ImmortalityState;
  const [poolMembers, linkedAssignments, storedGrades, teamIdentities, ownerRow, allFranchiseClaims, introView] = await Promise.all([
    supabase.from("rec_league_memberships").select("user_id,role").eq("league_id", context.leagueId).eq("status", "active"),
    supabase.from("rec_team_assignments").select("user_id,team_id").eq("league_id", context.leagueId).eq("assignment_status", "active").is("ended_at", null),
    supabase.from("rec_immortality_draft_grades").select("*").eq("immortality_league_id", league.id),
    supabase.from("rec_league_team_identities").select("*").eq("league_id", context.leagueId).order("conference").order("division").order("default_abbreviation"),
    supabase.from("rec_immortality_owners").select("*").eq("immortality_league_id", league.id).eq("user_id", userId).maybeSingle(),
    supabase.from("rec_immortality_user_team_assignments").select("team_id,user_id").eq("immortality_league_id", league.id),
    supabase.from("rec_immortality_intro_views").select("completed_at").eq("immortality_league_id", league.id).eq("user_id", userId).maybeSingle(),
  ]);
  // Own child-row lookup, not a reverse-relation embed on the query above -- the Supabase shim's
  // generic relation resolver only supports forward FK embeds (see the day-of streaming prompts
  // crash fixed in 00672681 for the same footgun).
  const ownerPersona = ownerRow.data
    ? await supabase.from("rec_immortality_owner_persona_results").select("label,primary_dimension,secondary_dimension").eq("owner_id", ownerRow.data.id).maybeSingle()
    : { data: null };
  const teamDisplayById = new Map((teamIdentities.data ?? []).map((row) => [String(row.team_id), {
    name: row.display_team_name ?? row.default_team_name,
    city: row.display_city ?? row.default_city,
    abbreviation: row.display_abbreviation ?? row.default_abbreviation,
  }]));
  const nameByProspect = new Map<string, { firstName: string; lastName: string; position: string }>((classProspects.data ?? []).map((row) => [String(row.id), {
    firstName: row.first_name ? String(row.first_name) : "",
    lastName: row.last_name ? String(row.last_name) : "",
    position: String(row.position ?? ""),
  }]));
  const myFranchiseClaim = (allFranchiseClaims.data ?? []).find((row) => String(row.user_id) === userId);
  const franchiseTeam = myFranchiseClaim
    ? (teamIdentities.data ?? []).find((row) => String(row.team_id) === String(myFranchiseClaim.team_id))
    : null;
  const franchiseTeamName = (() => {
    if (!franchiseTeam) return null;
    const city = String(franchiseTeam.display_city ?? franchiseTeam.default_city ?? "").trim();
    const name = String(franchiseTeam.display_team_name ?? franchiseTeam.default_team_name ?? "").trim();
    return city && !name.toLowerCase().startsWith(city.toLowerCase()) ? `${city} ${name}`.trim() : name || city || null;
  })();
  const ownerDisplayName = ownerRow.data
    ? `${ownerRow.data.first_name ?? ""} ${ownerRow.data.last_name ?? ""}`.trim() || null
    : null;
  const contractViews = (contractRows.data ?? []).map((row) => {
    const prospect = (prospects.data ?? []).find((item) => String(item.id) === String(row.prospect_id));
    return {
      id: String(row.id),
      prospectId: String(row.prospect_id),
      side: prospect?.side ?? null,
      playerName: `${prospect?.first_name ?? ""} ${prospect?.last_name ?? ""}`.trim(),
      position: prospect?.position ?? null,
      headshotUrl: prospect?.headshot_url ? String(prospect.headshot_url) : null,
      ownerName: ownerDisplayName,
      teamName: franchiseTeamName,
      teamLogoUrl: franchiseTeam?.primary_logo_url ? String(franchiseTeam.primary_logo_url) : null,
      teamAbbr: franchiseTeam ? String(franchiseTeam.display_abbreviation ?? franchiseTeam.default_abbreviation ?? "") || null : null,
      contractNumber: Number(row.contract_number),
      startSeason: Number(row.start_season),
      endSeason: Number(row.end_season),
      playerXp: Number(row.player_xp_payout ?? 0),
      coins: Number(row.coins_payout ?? row.coins_per_season ?? 0),
      band: row.band ? String(row.band) : null,
      status: String(row.offer_status ?? "offered"),
      signedAt: row.signed_at ? String(row.signed_at) : null,
    };
  });
  const publicGrades = (storedGrades.data ?? []).map((row) => {
    const name = nameByProspect.get(String(row.prospect_id));
    return {
      prospectId: String(row.prospect_id),
      userId: String(row.user_id),
      side: String(row.side),
      firstName: name?.firstName ?? "",
      lastName: name?.lastName ?? "",
      position: name?.position ?? "",
      classRank: Number(row.class_rank),
      classSize: Number(row.class_size),
      projectedRound: Number(row.projected_round),
      preferredMin: Number(row.preferred_min),
      preferredMax: Number(row.preferred_max),
      gradeLabel: String(row.grade_label),
      stock: String(row.stock),
      draftValue: Number(row.draft_value),
      ready: Boolean(row.ready),
      mine: String(row.user_id) === userId,
    };
  }).sort((a, b) => a.projectedRound - b.projectedRound || a.classRank - b.classRank);
  const readyUserIds = completePairUserIds(publicGrades.map((row) => ({
    userId: row.userId,
    side: row.side as "offense" | "defense",
    ready: row.ready,
  })));
  return {
    league: {
      id: league.id,
      leagueId: context.leagueId,
      chapterState: league.chapter_state,
      chapter: chapterForState(chapterState),
      offensePosition: league.offense_position,
      defensePosition: league.defense_position,
      creationPointBudget: league.creation_point_budget,
      originsOpen: originsOpen(chapterState),
      riseHubUnlocked: riseHubUnlocked(chapterState),
      teamPool: league.team_pool ?? "default_nfl",
      highlightPayout: RISE_TO_IMMORTALITY_HIGHLIGHT_PAYOUT,
    },
    introVideo: {
      url: league.intro_video_url ?? null,
      // No video set at all means there's nothing to gate on -- treat as already watched.
      watched: !league.intro_video_url || Boolean(introView.data),
    },
    pool: {
      registeredCount: (poolMembers.data ?? []).length,
      linkedCount: (linkedAssignments.data ?? []).length,
    },
    teamIdentities: teamIdentities.data ?? [],
    owner: ownerRow.data ? {
      id: ownerRow.data.id,
      firstName: ownerRow.data.first_name,
      lastName: ownerRow.data.last_name,
      headshotUrl: ownerRow.data.headshot_url,
      originsStep: ownerRow.data.origins_step,
      personaLabel: ownerPersona.data?.label ?? null,
      personaPrimary: ownerPersona.data?.primary_dimension ?? null,
      personaSecondary: ownerPersona.data?.secondary_dimension ?? null,
    } : null,
    franchiseOptions: (() => {
      const claimedTeamIds = new Set<string>([
        ...(linkedAssignments.data ?? []).map((row) => String(row.team_id)),
        ...(allFranchiseClaims.data ?? []).map((row) => String(row.team_id)),
      ]);
      const myClaim = (allFranchiseClaims.data ?? []).find((row) => String(row.user_id) === userId);
      const myProspects = prospects.data ?? [];
      const offenseProspect = myProspects.find((row: any) => row.side === "offense");
      const defenseProspect = myProspects.find((row: any) => row.side === "defense");
      const buildByProspectId = new Set((builds.data ?? []).map((row: any) => String(row.prospect_id)));
      // Commissioner review no longer gates team selection -- a finished Creation Points build
      // is approved immediately (see submitProspectForReview). The commissioner inbox item that
      // still gets created exists only so they can log the build for in-game recreation; if a
      // build is genuinely unacceptable they reject it, which removes the member from the league
      // entirely (reviewImmortalityProspect) rather than leaving them stuck here.
      let reason: string | null = null;
      let needsAttentionSide: "offense" | "defense" | null = null;
      if (!offenseProspect || !defenseProspect) {
        reason = "Finish Origins for both your offense and defense players first.";
        needsAttentionSide = !offenseProspect ? "offense" : "defense";
      } else {
        const offenseMissing = !buildByProspectId.has(String(offenseProspect.id));
        const defenseMissing = !buildByProspectId.has(String(defenseProspect.id));
        if (offenseMissing || defenseMissing) {
          const missingName = (side: "offense" | "defense") => {
            const row = side === "offense" ? offenseProspect : defenseProspect;
            const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
            return name || `your ${side} player`;
          };
          reason = offenseMissing && defenseMissing
            ? "Finish Creation Points for both players first."
            : `Finish Creation Points for ${missingName(offenseMissing ? "offense" : "defense")} (${offenseMissing ? "offense" : "defense"}) first.`;
          needsAttentionSide = offenseMissing ? "offense" : "defense";
        } else if (ownerRow.data?.origins_step !== "complete") {
          reason = "Create your owner and finish their interview first.";
        }
      }
      return {
        eligible: !myClaim && reason == null,
        reason: myClaim ? null : reason,
        needsAttentionSide: myClaim ? null : needsAttentionSide,
        chosenTeamId: myClaim ? String(myClaim.team_id) : null,
        teams: (teamIdentities.data ?? []).map((row: any) => ({
          teamId: String(row.team_id),
          name: row.display_team_name ?? row.default_team_name,
          city: row.display_city ?? row.default_city,
          abbreviation: row.display_abbreviation ?? row.default_abbreviation,
          conference: row.conference ?? null,
          division: row.division ?? null,
          logoUrl: row.primary_logo_url ?? null,
          open: !claimedTeamIds.has(String(row.team_id)),
        })),
      };
    })(),
    draftBoard: {
      frozen: board.frozen === true,
      readyPairCount: readyUserIds.length,
      poolCount: (poolMembers.data ?? []).length,
      offense: publicGrades.filter((row) => row.side === "offense"),
      defense: publicGrades.filter((row) => row.side === "defense"),
      mine: {
        offense: publicGrades.find((row) => row.mine && row.side === "offense") ?? null,
        defense: publicGrades.find((row) => row.mine && row.side === "defense") ?? null,
      },
    },
    prospects: prospects.data ?? [],
    builds: builds.data ?? [],
    xp: Object.fromEntries(prospectIds.map((id) => [id, xpByProspect.get(id) ?? { playerXp: 0, teamXp: 0 }])),
    traits: traits.data ?? [],
    personaDna: personaDnaRows.data ?? [],
    playerTraits: playerTraitRows.data ?? [],
    contracts: contractViews,
    hallNominees: hallNominees.data ?? [],
    draftStatus: draftClass.data?.status ?? null,
    abilities: Object.fromEntries((prospects.data ?? []).map((row) => {
      const id = String(row.id);
      const position = row.position as ImmortalityPosition;
      const playstyle = (branchingPlaystyles.data ?? []).find((item) => String(item.prospect_id) === id)
        ?? (playstyles.data ?? []).find((item) => String(item.prospect_id) === id);
      const realOvr = row.player_id ? realOvrByPlayerId.get(String(row.player_id)) ?? null : null;
      const estimatedOvr = realOvr ?? 0; // null (not yet imported) -> 0, so every OVR-gated ability reads as locked.
      const archetypes = playerArchetypes(
        playstyle ? String(playstyle.primary_archetype) : null,
        playstyle?.secondary_archetype ? String(playstyle.secondary_archetype) : null,
      );
      const equippedRows = (equippedAbilities.data ?? []).filter((item) => String(item.prospect_id) === id);
      const earnedSlots = Math.min(MAX_EQUIPPED_ABILITIES, (abilityGrants.data ?? [])
        .filter((item) => String(item.prospect_id) === id)
        .reduce((sum, item) => sum + Number(item.slots ?? 0), 0));
      const equipped = equippedRows.map((item) => {
        const ability = abilityById(String(item.ability_id));
        const gate = ability ? matchingAbilityGate({ ability, position, archetypes, estimatedOvr }) : null;
        return {
          id: String(item.ability_id),
          name: String(item.ability_name),
          kind: String(item.kind),
          description: ability?.description ?? "",
          ovrMin: gate?.ovrMin ?? ability?.gates.find((entry) => entry.position === position)?.ovrMin ?? null,
          archetypes: gate?.archetypes ?? ability?.gates.find((entry) => entry.position === position)?.archetypes ?? [],
          maddenArchetype: gate?.maddenArchetype ?? null,
          upgradesWith: ability?.upgradesWith ?? null,
          confidence: ability?.confidence ?? null,
        };
      });
      const eligible = rtiAbilitiesForPosition(position).map((ability) => {
        const check = canSelectAbility({
          ability,
          position,
          archetypes,
          estimatedOvr,
          equippedCount: equipped.length + (MAX_EQUIPPED_ABILITIES - earnedSlots),
          alreadyEquipped: equipped.some((row) => row.id === ability.id),
        });
        const posGate = ability.gates.find((entry) => entry.position === position);
        return {
          id: ability.id,
          name: ability.name,
          description: ability.description,
          kind: ability.kind,
          ovrMin: (check.ok ? check.gate.ovrMin : posGate?.ovrMin) ?? null,
          archetypes: (check.ok ? check.gate.archetypes : posGate?.archetypes) ?? [],
          maddenArchetype: (check.ok ? check.gate.maddenArchetype : posGate?.maddenArchetype) ?? null,
          upgradesWith: ability.upgradesWith,
          confidence: ability.confidence,
          selectable: check.ok,
          blockedReason: check.ok ? null : check.error,
        };
      });
      return [id, {
        estimatedOvr,
        archetype: archetypes[0] ?? null,
        archetypes,
        slots: earnedSlots,
        maxEquipped: earnedSlots,
        equipped,
        eligible,
      }];
    })),
    catalogs: {
      characteristics: {
        offense: characteristicCatalog(positionGroupFor(league.offense_position as ImmortalityPosition)).map((item) => ({
          key: item.key, displayName: item.displayName, positionGroup: item.positionGroup, slotCost: item.slotCost, effect: item.effect, tags: item.tags,
          attributeCodes: attributeCodesFor(item),
        })),
        defense: characteristicCatalog(positionGroupFor(league.defense_position as ImmortalityPosition)).map((item) => ({
          key: item.key, displayName: item.displayName, positionGroup: item.positionGroup, slotCost: item.slotCost, effect: item.effect, tags: item.tags,
          attributeCodes: attributeCodesFor(item),
        })),
      },
      persona: {
        offense: publicPersonaQuestions("offense"),
        defense: publicPersonaQuestions("defense"),
        owner: publicPersonaQuestionsForOwner(),
      },
      playstyle: {
        offense: publicPlaystyleQuestions(positionGroupFor(league.offense_position as ImmortalityPosition)),
        defense: publicPlaystyleQuestions(positionGroupFor(league.defense_position as ImmortalityPosition)),
      },
      playstyleBranching: {
        offense: hasFixedRtiBaseline(league.offense_position as ImmortalityPosition)
          ? branchingPlaystyleGroup(league.offense_position as "QB" | "MIKE") : null,
        defense: hasFixedRtiBaseline(league.defense_position as ImmortalityPosition)
          ? branchingPlaystyleGroup(league.defense_position as "QB" | "MIKE") : null,
      },
      personaDna: {
        questions: publicPersonaDnaQuestions(),
        catalog: personaDnaCatalog(),
        mindsetFocus: mindsetFocusCatalog(),
      },
      playerTraits: {
        offense: hasFixedRtiBaseline(league.offense_position as ImmortalityPosition)
          ? { questions: publicPlayerTraitQuestions(league.offense_position as PlayerTraitPositionGroup), catalog: playerTraitCatalog(league.offense_position as PlayerTraitPositionGroup) }
          : null,
        defense: hasFixedRtiBaseline(league.defense_position as ImmortalityPosition)
          ? { questions: publicPlayerTraitQuestions(league.defense_position as PlayerTraitPositionGroup), catalog: playerTraitCatalog(league.defense_position as PlayerTraitPositionGroup) }
          : null,
      },
    },
  };
}

/** Enrollment gate for a brand-new prospect: Origins never closes on a league-wide clock --
 * a member can start (or keep working on) their prospect at any point in the league's life, as
 * long as a franchise is still actually open for them to eventually claim. Someone editing a
 * prospect they already started is never blocked by this, even if every team fills up in the
 * meantime -- only starting a NEW one requires a team still being open. */
async function hasOpenImmortalityFranchiseTeam(immortalityLeagueId: string, recLeagueId: string): Promise<boolean> {
  const [teamIdentities, linkedAssignments, franchiseClaims] = await Promise.all([
    supabase.from("rec_league_team_identities").select("team_id").eq("league_id", recLeagueId),
    supabase.from("rec_team_assignments").select("team_id").eq("league_id", recLeagueId).eq("assignment_status", "active").is("ended_at", null),
    supabase.from("rec_immortality_user_team_assignments").select("team_id").eq("immortality_league_id", immortalityLeagueId),
  ]);
  const claimed = new Set<string>([
    ...(linkedAssignments.data ?? []).map((row: any) => String(row.team_id)),
    ...(franchiseClaims.data ?? []).map((row: any) => String(row.team_id)),
  ]);
  return (teamIdentities.data ?? []).some((row: any) => !claimed.has(String(row.team_id)));
}

export async function upsertProspectIdentity(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  identity: {
    firstName: string;
    lastName: string;
    hometown?: string;
    hometownState?: string;
    college?: string | null;
    jerseyNumber: number;
    heightInches: number;
    weightLbs: number;
    bodyType?: string;
    headshotUrl?: string | null;
  };
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const position = input.side === "offense" ? league.offense_position : league.defense_position;
  const existing = await loadProspectForUser(league.id, userId, input.side);
  if (!existing && !(await hasOpenImmortalityFranchiseTeam(league.id, context.leagueId))) {
    throw new ApiError(400, "Origins is closed -- every franchise in this league has already been claimed.");
  }
  const payload = {
    immortality_league_id: league.id,
    user_id: userId,
    side: input.side,
    position,
    first_name: input.identity.firstName,
    last_name: input.identity.lastName,
    age: 21, // Every RTI prospect is hard-wired to 21 -- no age slider, no college-lock branch.
    hometown: input.identity.hometown ?? null,
    hometown_state: input.identity.hometownState ?? null,
    college: input.identity.college ?? null,
    jersey_number: input.identity.jerseyNumber,
    height_inches: input.identity.heightInches,
    weight_lbs: input.identity.weightLbs,
    body_type: input.identity.bodyType ?? null,
    headshot_url: input.identity.headshotUrl ?? null,
    origins_step: "identity",
    updated_at: new Date().toISOString(),
  };
  const result = existing
    ? await supabase.from("rec_immortality_prospects").update(payload).eq("id", existing.id).select("*").single()
    : await supabase.from("rec_immortality_prospects").insert(payload).select("*").single();
  if (result.error) throw new ApiError(500, "Could not save prospect identity.", result.error);
  await bumpOriginsStep(String(result.data.id), existing?.origins_step, "identity");
  await refreshImmortalityDraftBoard(league.id, context.leagueId);
  return result.data;
}

/** Custom headshot upload for a prospect, mirroring roster.service.ts's uploadPlayerPhoto --
 * uploads to Cloudflare Images keyed by the prospect's own id, so a re-upload replaces the same
 * image instead of accumulating orphans. */
export async function uploadProspectHeadshot(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  contentType: string;
  imageBuffer: Buffer;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  if (!HEADSHOT_ALLOWED_TYPES.has(input.contentType)) throw new ApiError(400, "Headshot must be a JPEG, PNG, or WebP image.");
  if (input.imageBuffer.length === 0 || input.imageBuffer.length > HEADSHOT_MAX_BYTES) throw new ApiError(400, "Headshot must be between 1 byte and 5 MB.");

  const uploaded = await uploadImageToCloudflare({
    buffer: input.imageBuffer,
    contentType: input.contentType,
    imageId: `rti-prospect-${prospect.id}`,
    meta: { leagueId: context.leagueId, prospectId: String(prospect.id) },
  });
  const updated = await supabase.from("rec_immortality_prospects")
    .update({ headshot_url: uploaded.url, updated_at: new Date().toISOString() })
    .eq("id", prospect.id).select("headshot_url").single();
  if (updated.error) throw new ApiError(500, "Could not save that headshot.", updated.error);
  return { headshotUrl: updated.data.headshot_url };
}

/** QB only -- every other offense/defense position has no throwing motion to pick. */
export async function submitThrowingMotion(input: { guildId: string; discordId: string; side: "offense" | "defense"; motionKey: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  if (String(prospect.position ?? "").toUpperCase() !== "QB") throw new ApiError(400, "Throwing motion only applies to QB prospects.");
  const updated = await supabase.from("rec_immortality_prospects").update({
    throwing_motion_key: input.motionKey, updated_at: new Date().toISOString(),
  }).eq("id", prospect.id).select("throwing_motion_key").single();
  if (updated.error) throw new ApiError(500, "Could not save throwing motion.", updated.error);
  return { throwingMotionKey: updated.data.throwing_motion_key };
}

export async function startIqAttempt(input: { guildId: string; discordId: string; side: "offense" | "defense" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity before the IQ test.");
  const existing = await supabase.from("rec_immortality_iq_attempts").select("*").eq("prospect_id", prospect.id).maybeSingle();
  if (existing.error) throw new ApiError(500, "Could not load IQ attempt.", existing.error);
  const now = new Date();
  if (existing.data?.completed_at) {
    return publicIqState(existing.data, prospect.side);
  }
  if (existing.data) {
    if (isIqTimedOut(existing.data.question_expires_at, now.toISOString()) && !existing.data.completed_at) {
      await autoAdvanceTimedOutQuestion(existing.data, prospect.side);
      const refreshed = await supabase.from("rec_immortality_iq_attempts").select("*").eq("id", existing.data.id).single();
      return publicIqState(refreshed.data, prospect.side);
    }
    return publicIqState(existing.data, prospect.side);
  }
  const startedAt = now.toISOString();
  const created = await supabase.from("rec_immortality_iq_attempts").insert({
    prospect_id: prospect.id,
    side: prospect.side,
    started_at: startedAt,
    current_question: 1,
    question_started_at: startedAt,
    question_expires_at: nextQuestionExpiresAt(startedAt),
    test_version: FORMULA_VERSIONS.iq,
  }).select("*").single();
  if (created.error) throw new ApiError(500, "Could not start the IQ test.", created.error);
  return publicIqState(created.data, prospect.side);
}

async function autoAdvanceTimedOutQuestion(attempt: { id: string; prospect_id: string; current_question: number; question_started_at: string; question_expires_at: string }, side: string) {
  const questionNumber = attempt.current_question;
  const bank = iqBankForSide(side as "offense" | "defense");
  const question = bank.find((item) => item.number === questionNumber);
  if (!question) return;
  const order = shuffleOrder(question.options.length, `${attempt.id}:${questionNumber}`);
  await supabase.from("rec_immortality_iq_answers").upsert({
    attempt_id: attempt.id,
    question_id: questionNumber,
    presented_option_order: order,
    selected_option: null,
    timed_out: true,
    submitted_at: attempt.question_expires_at,
    response_ms: IQ_SECONDS_PER_QUESTION * 1000,
    correct: false,
  }, { onConflict: "attempt_id,question_id" });
  await finishOrAdvance(attempt.id, questionNumber);
}

async function finishOrAdvance(attemptId: string, submittedQuestion: number) {
  const answers = await supabase.from("rec_immortality_iq_answers").select("question_id,correct").eq("attempt_id", attemptId);
  if (answers.error) throw new ApiError(500, "Could not score IQ answers.", answers.error);
  const scored = scoreIqAttempt({
    answers: (answers.data ?? []).map((row) => ({ questionNumber: Number(row.question_id), correct: Boolean(row.correct) })),
  });
  const now = new Date().toISOString();
  if (submittedQuestion >= IQ_QUESTION_COUNT) {
    const updated = await supabase.from("rec_immortality_iq_attempts").update({
      current_question: IQ_QUESTION_COUNT,
      completed_at: now,
      correct_count: scored.correctCount,
      iq_score: scored.iqScore,
      awareness_result: scored.awareness,
      play_recognition_result: scored.playRecognition,
    }).eq("id", attemptId).is("completed_at", null).select("*").maybeSingle();
    if (updated.error) throw new ApiError(500, "Could not complete IQ test.", updated.error);
    const prospectId = updated.data?.prospect_id ? String(updated.data.prospect_id) : null;
    if (prospectId) {
      const prospect = await supabase.from("rec_immortality_prospects").select("id,immortality_league_id,origins_step").eq("id", prospectId).maybeSingle();
      if (prospect.data) {
        await bumpOriginsStep(String(prospect.data.id), prospect.data.origins_step, "iq");
        await refreshImmortalityDraftBoard(String(prospect.data.immortality_league_id));
      }
    }
    return;
  }
  await supabase.from("rec_immortality_iq_attempts").update({
    current_question: submittedQuestion + 1,
    question_started_at: now,
    question_expires_at: nextQuestionExpiresAt(now),
    correct_count: scored.correctCount,
  }).eq("id", attemptId).eq("current_question", submittedQuestion);
}

function publicIqState(attempt: Record<string, unknown>, side: string) {
  const currentQuestion = Number(attempt.current_question ?? 1);
  const completed = Boolean(attempt.completed_at);
  const bank = iqBankForSide(side as "offense" | "defense");
  const question = bank.find((item) => item.number === currentQuestion);
  const order = question ? shuffleOrder(question.options.length, `${attempt.id}:${currentQuestion}`) : [];
  return {
    attemptId: attempt.id,
    currentQuestion,
    questionExpiresAt: attempt.question_expires_at,
    completed,
    iqScore: completed ? attempt.iq_score : null,
    awareness: completed ? attempt.awareness_result : null,
    playRecognition: completed ? attempt.play_recognition_result : null,
    question: completed || !question ? null : toPublicIqQuestion(question, order),
    optionOrder: completed ? [] : order,
  };
}

export async function submitIqAnswer(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  questionNumber: number;
  selectedPresentedIndex: number | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity before the IQ test.");
  const attemptRow = await supabase.from("rec_immortality_iq_attempts").select("*").eq("prospect_id", prospect.id).maybeSingle();
  if (attemptRow.error || !attemptRow.data) throw new ApiError(400, "Start the IQ test first.");
  const attempt = attemptRow.data;
  if (attempt.completed_at) return publicIqState(attempt, prospect.side);
  if (!canAdvanceIqQuestion(Number(attempt.current_question), input.questionNumber)) {
    throw new ApiError(400, "You cannot go back or skip questions.");
  }
  const now = new Date().toISOString();
  const timedOut = isIqTimedOut(String(attempt.question_expires_at), now);
  const bank = iqBankForSide(prospect.side);
  const question = bank.find((item) => item.number === input.questionNumber);
  if (!question) throw new ApiError(400, "Unknown IQ question.");
  const order = shuffleOrder(question.options.length, `${attempt.id}:${input.questionNumber}`);
  const graded = gradeIqSubmission({
    question,
    optionOrder: order,
    selectedPresentedIndex: timedOut ? null : input.selectedPresentedIndex,
    timedOut,
  });
  const insert = await supabase.from("rec_immortality_iq_answers").insert({
    attempt_id: attempt.id,
    question_id: input.questionNumber,
    presented_option_order: order,
    selected_option: graded.selectedOption,
    timed_out: graded.timedOut,
    submitted_at: now,
    response_ms: Math.max(0, Date.parse(now) - Date.parse(String(attempt.question_started_at))),
    correct: graded.correct,
  });
  if (insert.error) {
    if (String(insert.error.message ?? "").includes("duplicate") || insert.error.code === "23505") {
      return publicIqState(attempt, prospect.side);
    }
    throw new ApiError(500, "Could not save that IQ answer.", insert.error);
  }
  await finishOrAdvance(String(attempt.id), input.questionNumber);
  const refreshed = await supabase.from("rec_immortality_iq_attempts").select("*").eq("id", attempt.id).single();
  return publicIqState(refreshed.data, prospect.side);
}

export async function submitPersona(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  answers: Array<{ questionNumber: number; optionIndex: number }>;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  const questions = personaQuestionsForSide(input.side);
  const result = scorePersonaInterview({ questions, answers: input.answers });
  const saved = await supabase.from("rec_immortality_persona_results").upsert({
    prospect_id: prospect.id,
    scores: result.scores,
    primary_dimension: result.primary,
    secondary_dimension: result.secondary,
    label: result.label,
    answers: input.answers,
    formula_version: result.formulaVersion,
  }, { onConflict: "prospect_id" }).select("*").single();
  if (saved.error) throw new ApiError(500, "Could not save persona results.", saved.error);
  await bumpOriginsStep(String(prospect.id), prospect.origins_step, "persona");
  await refreshImmortalityDraftBoard(league.id, context.leagueId);
  return result;
}

export async function submitPlaystyle(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  answers: Array<{ questionNumber: number; optionIndex: number }>;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  const group = positionGroupFor(prospect.position as ImmortalityPosition);
  const questions = playstyleQuestionsForGroup(group);
  const result = scorePlaystyleInterview({ questions, answers: input.answers });
  const saved = await supabase.from("rec_immortality_playstyle_results").upsert({
    prospect_id: prospect.id,
    scores: result.scores,
    primary_archetype: result.primaryArchetype,
    secondary_archetype: result.secondaryArchetype,
    blend: result.blend,
    answers: input.answers,
    formula_version: result.formulaVersion,
  }, { onConflict: "prospect_id" }).select("*").single();
  if (saved.error) throw new ApiError(500, "Could not save playstyle results.", saved.error);
  await bumpOriginsStep(String(prospect.id), prospect.origins_step, "playstyle");
  await refreshImmortalityDraftBoard(league.id, context.leagueId);
  return result;
}

/** QB and MIKE only -- Q1/Q2 lock the archetype directly instead of voting, Q3-5 accumulate
 * attribute floor/ceiling deltas applied on top of the fixed baseline in evaluateCreationBuild. */
export async function submitBranchingPlaystyle(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  answers: { q1ArchetypeIndex: number; q2ArchetypeIndex: number | null; q3OptionIndex: number; q4OptionIndex: number; q5OptionIndex: number };
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  const position = prospect.position as ImmortalityPosition;
  if (!hasFixedRtiBaseline(position)) throw new ApiError(400, "Branching Playstyle is only available for QB and MIKE right now.");
  const group = branchingPlaystyleGroup(position as "QB" | "MIKE");
  const result = scoreBranchingPlaystyleInterview({ group, answers: input.answers });
  const saved = await supabase.from("rec_immortality_branching_playstyle_results").upsert({
    prospect_id: prospect.id,
    primary_archetype: result.primaryArchetype,
    secondary_archetype: result.secondaryArchetype,
    blend: result.blend,
    attribute_deltas: result.attributeDeltas,
    answers: input.answers,
    formula_version: result.formulaVersion,
  }, { onConflict: "prospect_id" }).select("*").single();
  if (saved.error) throw new ApiError(500, "Could not save the playstyle interview.", saved.error);
  await bumpOriginsStep(String(prospect.id), prospect.origins_step, "playstyle");
  await refreshImmortalityDraftBoard(league.id, context.leagueId);
  return result;
}

export async function submitPersonaDna(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  answers: Array<{ questionNumber: number; optionIndex: number }>;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  const questions = personaDnaQuestions();
  const result = scorePersonaDnaInterview({ questions, answers: input.answers });
  await supabase.from("rec_immortality_prospect_persona_dna").delete().eq("prospect_id", prospect.id);
  if (result.equippedTraitKeys.length) {
    const inserted = await supabase.from("rec_immortality_prospect_persona_dna").insert(
      result.equippedTraitKeys.map((traitKey) => ({ prospect_id: prospect.id, trait_key: traitKey })),
    );
    if (inserted.error) throw new ApiError(500, "Could not save Persona DNA.", inserted.error);
  }
  await bumpOriginsStep(String(prospect.id), prospect.origins_step, "persona_dna");
  await refreshImmortalityDraftBoard(league.id, context.leagueId);
  return result;
}

/** QB and MIKE only -- the only two positions with a transcribed Player Traits catalog. */
export async function submitPlayerTraits(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  answers: Array<{ questionNumber: number; optionIndex: number }>;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  const position = prospect.position as ImmortalityPosition;
  if (!hasFixedRtiBaseline(position)) throw new ApiError(400, "Player Traits are only available for QB and MIKE right now.");
  const group = position as PlayerTraitPositionGroup;
  const questions = playerTraitQuestions(group);
  const result = scorePlayerTraitInterview({ positionGroup: group, questions, answers: input.answers });
  await supabase.from("rec_immortality_prospect_player_traits").delete().eq("prospect_id", prospect.id);
  if (result.equippedTraitKeys.length) {
    const inserted = await supabase.from("rec_immortality_prospect_player_traits").insert(
      result.equippedTraitKeys.map((traitKey) => ({ prospect_id: prospect.id, trait_key: traitKey, position_group: group })),
    );
    if (inserted.error) throw new ApiError(500, "Could not save Player Traits.", inserted.error);
  }
  await bumpOriginsStep(String(prospect.id), prospect.origins_step, "player_traits");
  await refreshImmortalityDraftBoard(league.id, context.leagueId);
  return result;
}

export async function selectCharacteristics(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  keys: string[];
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  const group = positionGroupFor(prospect.position as ImmortalityPosition);
  const catalog = characteristicCatalog(group);
  const validated = validateCharacteristicSelection({ positionGroup: group, catalog, keys: input.keys });
  if (!validated.ok) throw new ApiError(400, `Invalid natural characteristics: ${validated.error.replaceAll("_", " ")}.`);
  await supabase.from("rec_immortality_prospect_characteristics").delete().eq("prospect_id", prospect.id);
  if (validated.selected.length) {
    const inserted = await supabase.from("rec_immortality_prospect_characteristics").insert(
      validated.selected.map((item) => ({
        prospect_id: prospect.id,
        characteristic_key: item.key,
        slot_cost: item.slotCost,
      })),
    );
    if (inserted.error) throw new ApiError(500, "Could not save characteristics.", inserted.error);
  }
  await bumpOriginsStep(String(prospect.id), prospect.origins_step, "characteristics");
  await refreshImmortalityDraftBoard(league.id, context.leagueId);
  return { slotCost: validated.slotCost, selected: validated.selected, modifiers: combinedModifiers(validated.selected) };
}

function rosterAttributesToCodes(row: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, key] of Object.entries(MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY)) {
    const value = row[key];
    if (typeof value === "number") out[code] = value;
  }
  return out;
}

/** The rest of Origins (persona, playstyle, Persona DNA, Player Traits where applicable, and
 * Natural Characteristics) must be submitted before Creation Points -- checked via the
 * monotonic origins_step tracker (bumpOriginsStep) rather than re-querying every table, plus a
 * direct throwing_motion_key check for QB since that step isn't tracked in ORIGINS_STEPS. */
function assertOriginsCompleteForCreation(prospect: Record<string, any>): void {
  const stepIndex = ORIGINS_STEPS.indexOf(String(prospect.origins_step ?? "identity") as (typeof ORIGINS_STEPS)[number]);
  const characteristicsIndex = ORIGINS_STEPS.indexOf("characteristics");
  if (stepIndex < characteristicsIndex) {
    throw new ApiError(400, "Finish the rest of Origins (interviews and Natural Characteristics) before Creation Points.");
  }
  if (String(prospect.position ?? "").toUpperCase() === "QB" && !prospect.throwing_motion_key) {
    throw new ApiError(400, "Pick a throwing motion before Creation Points.");
  }
}

/** Loads the IQ/playstyle rows a baseline needs and computes it -- shared by the real Creation
 * Points submission (evaluateCreationBuild) and the read-only preview (getCreationBaseline) so
 * both compute the exact same numbers. Throws if IQ or the playstyle interview aren't done. */
async function loadBaselineForProspect(prospect: Record<string, any>): Promise<{
  baseline: Record<string, number>;
  iq: { iq_score: number; awareness_result: number; play_recognition_result: number };
}> {
  const position = prospect.position as ImmortalityPosition;
  const usesFixedBaseline = hasFixedRtiBaseline(position);
  const [iq, playstyle, branchingPlaystyle] = await Promise.all([
    supabase.from("rec_immortality_iq_attempts").select("*").eq("prospect_id", prospect.id).maybeSingle(),
    usesFixedBaseline ? Promise.resolve({ data: null }) : supabase.from("rec_immortality_playstyle_results").select("*").eq("prospect_id", prospect.id).maybeSingle(),
    usesFixedBaseline ? supabase.from("rec_immortality_branching_playstyle_results").select("*").eq("prospect_id", prospect.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!iq.data?.completed_at) throw new ApiError(400, "Finish the IQ test first.");
  if (usesFixedBaseline ? !branchingPlaystyle.data : !playstyle.data) throw new ApiError(400, "Finish the playstyle interview first.");

  let baseline: Record<string, number> = {};
  if (usesFixedBaseline) {
    // QB and MIKE use a permanent, hand-set baseline (see baseline.ts) instead of a live lookup
    // against real roster data -- Branching Playstyle's Q3-5 answers then pull specific
    // attributes up to a floor or down to a ceiling relative to that fixed starting point.
    const fixedBase = FIXED_RTI_BASELINES[position]!;
    const deltas = (branchingPlaystyle.data!.attribute_deltas ?? {}) as Record<string, { floor: number; ceiling: number }>;
    baseline = applyIqOverlay({
      position,
      attributes: applyBranchingDeltas(fixedBase, deltas),
      awareness: Number(iq.data.awareness_result),
      playRecognition: Number(iq.data.play_recognition_result),
    });
  } else {
    const dataset = await supabase.from("rec_madden_roster_datasets").select("id").eq("game_title", "madden_27").eq("is_active", true).maybeSingle();
    if (dataset.data?.id) {
      const players = await supabase
        .from("rec_madden_baseline_players")
        .select("*")
        .eq("dataset_id", dataset.data.id)
        .eq("position", position)
        .gte("overall_rating", 68)
        .lte("overall_rating", 72)
        .limit(400);
      const pool = (players.data ?? []).map((row) => ({
        position: String(row.position),
        archetype: row.archetype ? String(row.archetype) : null,
        overallRating: typeof row.overall_rating === "number" ? row.overall_rating : null,
        attributes: rosterAttributesToCodes(row as Record<string, unknown>),
      }));
      const { deriveBaselineTemplate } = await import("@rec/shared");
      const primary = deriveBaselineTemplate({ position, archetype: String(playstyle.data!.primary_archetype), pool });
      const secondary = deriveBaselineTemplate({ position, archetype: String(playstyle.data!.secondary_archetype), pool });
      baseline = hybridBaseline({
        primary: primary.template,
        secondary: secondary.template,
        blend: playstyle.data!.blend as { primaryWeight: number; secondaryWeight: number; kind: "dominant" | "clear" | "near_tie" },
        awareness: Number(iq.data.awareness_result),
        playRecognition: Number(iq.data.play_recognition_result),
        position,
      });
    } else {
      baseline = applyIqOverlay({
        position,
        attributes: { SPD: 82, ACC: 82, AGI: 80, AWR: Number(iq.data.awareness_result) },
        awareness: Number(iq.data.awareness_result),
        playRecognition: Number(iq.data.play_recognition_result),
      });
    }
  }
  return { baseline, iq: iq.data as { iq_score: number; awareness_result: number; play_recognition_result: number } };
}

/** Read-only preview for the Creation Points screen: the baseline attributes this prospect will
 * start from, computed from their IQ/playstyle answers exactly as evaluateCreationBuild would,
 * but with no writes -- no build upsert, no commissioner-review submission, no step bump. Gated
 * the same way evaluateCreationBuild is, so the panel can't be previewed before it's unlocked. */
export async function getCreationBaseline(input: { guildId: string; discordId: string; side: "offense" | "defense" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  assertOriginsCompleteForCreation(prospect);
  const [{ baseline }, traits] = await Promise.all([
    loadBaselineForProspect(prospect),
    supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.id),
  ]);
  const group = positionGroupFor(prospect.position as ImmortalityPosition);
  const catalog = characteristicCatalog(group);
  const selected = catalog.filter((item) => (traits.data ?? []).some((row) => row.characteristic_key === item.key));
  const modifiers = combinedModifiers(selected);
  const heightCost = heightOverageCreationPointCost(prospect.position as ImmortalityPosition, Number(prospect.height_inches ?? 0));
  const totalBudget = Number(league.creation_point_budget ?? DEFAULT_CREATION_POINT_BUDGET);
  const effectiveBudget = Math.max(0, totalBudget - heightCost);
  return { baseline, heightCost, totalBudget, effectiveBudget, discounts: modifiers.creationDiscounts };
}

export async function evaluateCreationBuild(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  spent: Record<string, number>;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  assertOriginsCompleteForCreation(prospect);
  const position = prospect.position as ImmortalityPosition;
  const traits = await supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.id);
  const { baseline, iq } = await loadBaselineForProspect(prospect);
  const group = positionGroupFor(position);
  const catalog = characteristicCatalog(group);
  const selected = catalog.filter((item) => (traits.data ?? []).some((row) => row.characteristic_key === item.key));
  const modifiers = combinedModifiers(selected);
  const heightCost = heightOverageCreationPointCost(prospect.position as ImmortalityPosition, Number(prospect.height_inches ?? 0));
  const totalBudget = Number(league.creation_point_budget ?? DEFAULT_CREATION_POINT_BUDGET);
  const effectiveBudget = Math.max(0, totalBudget - heightCost);
  const spent = spendCreationPoints({
    baseline,
    spent: input.spent,
    budget: effectiveBudget,
    discounts: modifiers.creationDiscounts,
  });
  if (!spent.ok) throw new ApiError(400, heightCost > 0 ? `${spent.error} (${heightCost} of your ${totalBudget} budget already went to your above-average height.)` : spent.error);
  // No OVR estimate for RTI, at creation or ever after -- estimateRecPlayerOverall's weights are
  // wrong for this system by design decision, not an oversight. The class board's draft value
  // is IQ + class-rank only until a real EA import gives this player a true OVR (see
  // spendPlayerXp/convertXp/ability-gating, which all read rec_players.overall_rating instead).
  const saved = await supabase.from("rec_immortality_creation_builds").upsert({
    prospect_id: prospect.id,
    baseline_attributes: baseline,
    spent_attributes: input.spent,
    final_attributes: spent.attributes,
    creation_points_spent: spent.spentPoints + heightCost,
    creation_points_budget: totalBudget,
    estimated_ovr: null,
    draft_value: draftValueFromProfile({ ovr: 0, iq: Number(iq.iq_score), classRank: 16 }),
    projected_round: projectedRoundFromRank(16, 32),
    formula_version: FORMULA_VERSIONS.creationPoints,
    updated_at: new Date().toISOString(),
  }, { onConflict: "prospect_id" }).select("*").single();
  if (saved.error) throw new ApiError(500, "Could not save creation build.", saved.error);
  await bumpOriginsStep(String(prospect.id), prospect.origins_step, "creation");
  // Genuinely best-effort now (see submitProspectForReview's doc comment) -- it only logs the
  // build for the commissioner to recreate in-game, so a failure here must never cost the player
  // their Creation Points save, which has already succeeded above.
  await submitProspectForReview({
    guildId: input.guildId, leagueId: context.leagueId, immortalityLeagueId: league.id, prospect, userId,
  }).catch((error) => console.error(`[ERROR] Failed to submit prospect ${prospect.id} for commissioner review (non-fatal):`, error));
  // The commissioner already has a franchise (picked outright at league creation) before their
  // own prospects finish Origins -- everyone else's team isn't known until they choose from
  // their post-Origins offers (chooseImmortalityTeam). finalizePreassignedImmortalityOwner
  // handles that whole pipeline (materialize, card, HOF card, contracts) and no-ops instantly
  // for anyone who isn't a preassigned commissioner (resolveExistingTeamIdForUser returns null).
  // Calling it here too -- not just from submitOwnerPersona -- covers the ordering where the
  // commissioner's owner was already done before this, their SECOND prospect's build; that
  // combination previously never re-ran the pipeline for this prospect at all.
  await finalizePreassignedImmortalityOwner({
    guildId: input.guildId, recLeagueId: context.leagueId, immortalityLeagueId: league.id,
    userId, discordId: await discordIdForRecUser(userId).catch(() => ""),
  }).catch((error) => console.error("[WARN] Could not finalize preassigned RTI owner from Creation Points (non-fatal):", error));
  const board = await refreshImmortalityDraftBoard(league.id, context.leagueId);
  const grade = board.grades.find((row) => row.prospectId === String(prospect.id));
  return {
    remaining: spent.remaining,
    spentPoints: spent.spentPoints,
    attributes: spent.attributes,
    startingDev: startingDevTrait(modifiers),
    build: saved.data,
    draftGrade: grade ? {
      gradeLabel: grade.gradeLabel,
      classRank: grade.classRank,
      classSize: grade.classSize,
      projectedRound: grade.projectedRound,
      stock: grade.stock,
    } : null,
  };
}

async function resolveExistingTeamIdForUser(immortalityLeagueId: string, recLeagueId: string, userId: string): Promise<string | null> {
  const chosen = await supabase.from("rec_immortality_user_team_assignments").select("team_id").eq("immortality_league_id", immortalityLeagueId).eq("user_id", userId).maybeSingle();
  if (chosen.data?.team_id) return String(chosen.data.team_id);
  const commissioner = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", recLeagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  return commissioner.data?.team_id ? String(commissioner.data.team_id) : null;
}

/** Turns a finished Origins prospect into a real rec_players row once their franchise is known
 * -- either right away (the commissioner, whose team is picked before Origins even starts) or
 * once they choose from their post-Origins team offers. Idempotent: re-materializing just moves
 * the existing row to the new team_id instead of duplicating the player. */
async function materializeProspectToPlayer(prospect: Record<string, any>, teamId: string, recLeagueId: string): Promise<void> {
  if (prospect.player_id) {
    await supabase.from("rec_players").update({
      team_id: teamId, is_free_agent: false, updated_at: new Date().toISOString(),
    }).eq("id", prospect.player_id);
    return;
  }
  const [build, traits] = await Promise.all([
    supabase.from("rec_immortality_creation_builds").select("estimated_ovr,final_attributes").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.id),
  ]);
  if (!build.data) return; // Creation Points not finished yet -- nothing to materialize.
  const catalog = characteristicCatalog(positionGroupFor(prospect.position as ImmortalityPosition));
  const selected = catalog.filter((item) => (traits.data ?? []).some((row) => row.characteristic_key === item.key));
  const modifiers = combinedModifiers(selected);
  const finalAttributes = (build.data.final_attributes ?? {}) as Record<string, number>;
  const rosterAttributes: Record<string, number> = {};
  for (const [code, value] of Object.entries(finalAttributes)) {
    const key = MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY[code as keyof typeof MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY];
    if (key) rosterAttributes[key] = value;
  }
  const now = new Date().toISOString();
  const inserted = await supabase.from("rec_players").insert({
    league_id: recLeagueId,
    team_id: teamId,
    madden_player_id: `rti:${prospect.id}`,
    first_name: prospect.first_name,
    last_name: prospect.last_name,
    full_name: `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim(),
    position: prospect.position,
    overall_rating: build.data.estimated_ovr ?? null,
    attributes: rosterAttributes,
    jersey_number: prospect.jersey_number,
    height_inches: prospect.height_inches,
    weight_lbs: prospect.weight_lbs,
    college: prospect.college,
    hometown_city: prospect.hometown,
    hometown_state: prospect.hometown_state,
    dev_trait: startingDevTrait(modifiers),
    is_free_agent: false,
    is_default_player: false,
    player_source: "rti_created",
    roster_status: "active",
    created_at: now,
    updated_at: now,
  }).select("id").single();
  if (inserted.error) throw new ApiError(500, "Could not create the player roster entry.", inserted.error);
  await supabase.from("rec_immortality_prospects").update({
    player_id: inserted.data.id, completed_at: now,
  }).eq("id", prospect.id);
}

// The 5 most position-relevant ratings to headline on the "get to know the player" card --
// full attribute sheets belong in the roster page, not a one-time introduction post.
const PROSPECT_CARD_HEADLINE_ATTRIBUTES: Record<string, MaddenAttributeCode[]> = {
  QB: ["AWR", "THP", "SAC", "MAC", "SPD"],
  HB: ["SPD", "AGI", "TRK", "CAR", "BCV"],
  WR: ["SPD", "CTH", "SRR", "RLS", "AGI"],
  TE: ["CTH", "RBK", "SPD", "AWR", "STR"],
  CB: ["SPD", "MCV", "ZCV", "PRS", "AWR"],
  FS: ["SPD", "ZCV", "PRC", "AWR", "TAK"],
  SS: ["TAK", "ZCV", "POW", "PRC", "SPD"],
  MIKE: ["TAK", "PRC", "POW", "PUR", "SPD"],
};

/** Backs the chromeless /render/prospect-card/:prospectId site route (Playwright screenshot
 * pipeline) and the Discord post itself -- pulls a fresh copy of the prospect row so it reflects
 * the player_id materializeProspectToPlayer just set, even though the in-memory prospect object
 * chooseImmortalityTeam is holding is stale by that point. */
export async function getProspectCardRenderData(prospectId: string) {
  const prospect = await supabase.from("rec_immortality_prospects").select("*").eq("id", prospectId).maybeSingle();
  if (prospect.error) throw new ApiError(500, "Could not load this prospect.", prospect.error);
  if (!prospect.data) throw new ApiError(404, "Prospect not found.");
  const row = prospect.data as Record<string, any>;

  const [personaResult, branchingPlaystyle, flatPlaystyle, personaDnaTraits, player, hasImportedStats] = await Promise.all([
    supabase.from("rec_immortality_persona_results").select("label").eq("prospect_id", prospectId).maybeSingle(),
    supabase.from("rec_immortality_branching_playstyle_results").select("primary_archetype").eq("prospect_id", prospectId).maybeSingle(),
    supabase.from("rec_immortality_playstyle_results").select("primary_archetype").eq("prospect_id", prospectId).maybeSingle(),
    supabase.from("rec_immortality_prospect_persona_dna").select("trait_key").eq("prospect_id", prospectId),
    row.player_id
      ? supabase.from("rec_players").select("team_id,overall_rating,attributes").eq("id", row.player_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // OVR on rec_players is set from the Creation Points estimate at materialization time --
    // real, EA-calculated OVR only exists once the league's actually imported data for this
    // player at least once. Attribute levels are shown regardless (those are the member's own
    // build choices, already "real" the moment Creation Points is submitted), only the OVR
    // badge is gated on this.
    row.player_id
      ? supabase.from("rec_player_weekly_stats").select("id", { count: "exact", head: true }).eq("player_id", row.player_id)
      : Promise.resolve({ count: 0 }),
  ]);

  const teamId = (player.data as { team_id?: string } | null)?.team_id ?? null;
  const team = teamId
    ? await supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated,abbreviation,display_abbr,logo_url").eq("id", teamId).maybeSingle()
    : { data: null as any };

  const traitCatalog = personaDnaCatalog();
  const traitNames = (personaDnaTraits.data ?? [])
    .map((t) => traitCatalog.find((c) => c.key === t.trait_key)?.name)
    .filter((name): name is string => Boolean(name));

  const playstyleArchetype = (branchingPlaystyle.data?.primary_archetype ?? flatPlaystyle.data?.primary_archetype ?? null) as string | null;

  const backstory = buildProspectBackstory({
    firstName: row.first_name ?? "", lastName: row.last_name ?? "",
    hometown: row.hometown, hometownState: row.hometown_state, college: row.college,
    personaLabel: personaResult.data?.label ?? null,
    playstyleArchetype, traitNames, seed: prospectId,
  });

  const rosterAttributes = (player.data as { attributes?: Record<string, number | null> } | null)?.attributes ?? null;
  const headlineCodes = PROSPECT_CARD_HEADLINE_ATTRIBUTES[String(row.position ?? "").toUpperCase()] ?? [];
  const attributes = headlineCodes
    .map((code) => ({
      code,
      name: MADDEN_ATTRIBUTE_BY_CODE.get(code)?.name ?? code,
      value: rosterAttributeValueForCode(rosterAttributes, code),
    }))
    .filter((attr): attr is { code: MaddenAttributeCode; name: string; value: number } => attr.value != null);

  return {
    firstName: row.first_name ?? "", lastName: row.last_name ?? "",
    position: row.position, side: row.side,
    jerseyNumber: row.jersey_number, age: row.age,
    hometown: row.hometown, hometownState: row.hometown_state, college: row.college,
    heightInches: row.height_inches, weightLbs: row.weight_lbs, bodyType: row.body_type,
    headshotUrl: row.headshot_url, backstory,
    overallRating: (hasImportedStats as { count?: number | null }).count
      ? (player.data as { overall_rating?: number | null } | null)?.overall_rating ?? null
      : null,
    attributes,
    teamName: team.data ? (formatTeamDisplayName(team.data) ?? team.data.name ?? "Team") : "Free Agent",
    teamAbbr: team.data?.display_abbr ?? team.data?.abbreviation ?? null,
    teamLogoUrl: team.data?.logo_url ?? null,
  };
}

// Best-effort Discord post for a prospect's "player card" -- fires once, right after a user's
// franchise choice materializes both prospects into rec_players (chooseImmortalityTeam). Renders
// the same ProspectCard component the site would show, screenshot via Playwright (same pattern
// as the Player of the Week post), and tags the claiming user + team in the message content.
// Records which message it posted as (card_channel_id/card_message_id) so later data --
// especially the real OVR that only exists after the league's first import -- can update this
// same post in place instead of spamming a new one (see refreshImmortalityProspectCardsForLeague).
async function postProspectCardToDiscord(input: {
  leagueId: string; prospectId: string; side: "offense" | "defense"; discordId: string;
}): Promise<void> {
  try {
    const routes = await findServerRoutesForLeague(input.leagueId);
    const channelId = (input.side === "offense"
      ? routes?.routes?.offensive_pros_channel_id
      : routes?.routes?.defensive_pros_channel_id) as string | null | undefined;
    if (!channelId) return;
    const data = await getProspectCardRenderData(input.prospectId);
    let posted: { id?: string } | null = null;
    try {
      // One retry before giving up on the real render -- a cold-container Chromium launch or a
      // slow first page load can each blow the render's own timeout on the first attempt alone,
      // which is what produced an inconsistent mix of real-render and text-fallback cards across
      // prospects posted moments apart.
      let png: Buffer;
      try {
        png = await renderProspectCardPng(input.prospectId);
      } catch (firstError) {
        console.error(`[WARN] Prospect-card render failed once for ${input.prospectId}, retrying:`, firstError);
        png = await renderProspectCardPng(input.prospectId);
      }
      posted = await postDiscordChannelMessageWithFile(
        channelId,
        {
          content: `<@${input.discordId}> · ${data.teamName}`,
          embeds: [{ title: `${data.firstName} ${data.lastName}`, color: 0x2f81f7, image: { url: "attachment://prospect-card.png" } }],
        },
        { buffer: png, name: "prospect-card.png", contentType: "image/png" },
      );
    } catch (renderError) {
      // A missing Chromium binary must not erase the actual league event. Fall back to a rich
      // native embed with the same player/team identity; a later import can still refresh it.
      console.error(`[WARN] Prospect-card image render failed twice for ${input.prospectId}; posting embed fallback:`, renderError);
      posted = await postDiscordChannelMessage(channelId, {
        content: `<@${input.discordId}> · ${data.teamName}`,
        embeds: [{
          author: data.teamLogoUrl ? { name: data.teamName, icon_url: data.teamLogoUrl } : { name: data.teamName },
          title: `${data.firstName} ${data.lastName} · ${data.position}`,
          color: 0x2f81f7,
          description: [data.backstory, ...data.attributes.map((attribute) => `**${attribute.code}** ${attribute.value}`)].join("\n"),
          ...(data.headshotUrl ? { thumbnail: { url: data.headshotUrl } } : {}),
          footer: data.teamLogoUrl ? { text: "Rise to Immortality", icon_url: data.teamLogoUrl } : { text: "Rise to Immortality" },
        }],
      });
    }
    if (posted?.id) {
      await supabase.from("rec_immortality_prospects").update({
        card_channel_id: channelId, card_message_id: posted.id,
      }).eq("id", input.prospectId);
    }
  } catch (err) {
    console.error("[ERROR] Failed to post prospect card to Discord (non-fatal):", err);
  }
}

/** Re-renders and edits every already-posted prospect card for a league in place -- called
 * best-effort after an EA import completes (see the three importEaDatasets* call sites in
 * ea-connections.service.ts/madden-ea.routes.ts) so a prospect's card picks up newly-imported
 * data (most importantly the real OVR, which only exists post-import -- see
 * getProspectCardRenderData) without reposting and spamming the pros channels. No-ops instantly
 * for non-RTI leagues and for any prospect that was never actually posted. */
async function refreshSingleProspectCard(prospectId: string, cardChannelId: string, cardMessageId: string): Promise<void> {
  try {
    const data = await getProspectCardRenderData(prospectId);
    let png: Buffer;
    try {
      png = await renderProspectCardPng(prospectId);
    } catch (firstError) {
      console.error(`[WARN] Prospect-card refresh render failed once for ${prospectId}, retrying:`, firstError);
      png = await renderProspectCardPng(prospectId);
    }
    await editDiscordMessageWithFile(
      cardChannelId,
      cardMessageId,
      { embeds: [{ title: `${data.firstName} ${data.lastName}`, color: 0x2f81f7, image: { url: "attachment://prospect-card.png" } }] },
      { buffer: png, name: "prospect-card.png", contentType: "image/png" },
    );
  } catch (err) {
    console.error(`[ERROR] Failed to refresh prospect card ${prospectId} (non-fatal):`, err);
  }
}

export async function refreshImmortalityProspectCardsForLeague(leagueId: string): Promise<void> {
  const immortalityLeague = await loadImmortalityLeague(leagueId);
  if (!immortalityLeague) return;

  const posted = await supabase.from("rec_immortality_prospects")
    .select("id,card_channel_id,card_message_id")
    .eq("immortality_league_id", immortalityLeague.id)
    .not("card_message_id", "is", null);
  if (posted.error || !posted.data?.length) return;

  for (const row of posted.data as Array<{ id: string; card_channel_id: string | null; card_message_id: string | null }>) {
    if (!row.card_channel_id || !row.card_message_id) continue;
    await refreshSingleProspectCard(row.id, row.card_channel_id, row.card_message_id);
  }
}

/** Bot-only maintenance action: forces a brand-new prospect-card post (not an edit-in-place --
 * for a prospect stuck on the old text-embed fallback, where the plan is to manually delete that
 * old message once the new one lands) and always ensures the HOF Milestones card exists too
 * (postOrRefreshHofMilestoneCard already tracks hof_channel_id/hof_message_id and edits in place,
 * so it's always safe to call regardless of whether a repost was requested). */
export async function reissueImmortalityProspectArtifacts(input: {
  guildId: string; prospectId: string; repostCard: boolean;
}): Promise<{ reposted: boolean; hofRefreshed: boolean }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const prospect = await supabase.from("rec_immortality_prospects")
    .select("id,side,user_id,player_id")
    .eq("id", input.prospectId).eq("immortality_league_id", league.id).maybeSingle();
  if (prospect.error || !prospect.data) throw new ApiError(404, "Prospect not found in this league.");
  const discordId = await discordIdForRecUser(String(prospect.data.user_id));

  let reposted = false;
  if (input.repostCard) {
    await postProspectCardToDiscord({
      leagueId: context.leagueId, prospectId: String(prospect.data.id),
      side: prospect.data.side as "offense" | "defense", discordId,
    });
    reposted = true;
  }
  let hofRefreshed = false;
  if (prospect.data.player_id) {
    const { postOrRefreshHofMilestoneCard } = await import("./hof-milestones.service.js");
    await postOrRefreshHofMilestoneCard(String(prospect.data.id));
    hofRefreshed = true;
  }
  return { reposted, hofRefreshed };
}

/** Fires every time Creation Points is (re-)submitted -- writes a rec_commissioners_inbox row
 * (queue_type "immortality_prospect", keyed on the table's existing
 * (guild_id, queue_type, source_table, source_id) partial unique index -- see the select-then-
 * insert/update below, which sidesteps the query builder's inability to target a partial index
 * via ON CONFLICT) with the full build so a commissioner can log it for in-game recreation, same
 * panel custom players already go through. This is a log, not a gate: review_status is set to
 * 'approved' immediately by the caller, and team selection never waits on it (see
 * getImmortalityHub's franchiseOptions and chooseImmortalityTeam). Re-evaluating a build before
 * its inbox item has been acted on just refreshes the same card instead of spamming a duplicate.
 * Attributes are listed in the same physical + side-specific order as CreationPanel so a MIKE
 * review shows defensive ratings instead of the global catalog's offensive-first slice.
 *
 * Everything this needs (final attributes, starting dev trait, persona/playstyle/traits) is
 * re-derivable purely from already-persisted rows, not passed in by the caller -- that's what
 * lets backfillMissingImmortalityProspectReviews call this identically for a prospect built
 * days ago as evaluateCreationBuild does the moment a build is saved. Best-effort at the call
 * site -- never blocks Creation Points itself from succeeding -- but see
 * backfillMissingImmortalityProspectReviews for how a call that fails here still eventually
 * lands instead of being lost. */
async function submitProspectForReview(input: {
  guildId: string; leagueId: string; immortalityLeagueId: string; prospect: Record<string, any>; userId: string;
}): Promise<void> {
  const { prospect } = input;
  const [personaResult, branchingPlaystyle, flatPlaystyle, personaDnaTraits, playerTraits, characteristics, build, discordId] = await Promise.all([
    supabase.from("rec_immortality_persona_results").select("label,primary_dimension,secondary_dimension").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_branching_playstyle_results").select("primary_archetype,secondary_archetype").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_playstyle_results").select("primary_archetype,secondary_archetype").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_prospect_persona_dna").select("trait_key").eq("prospect_id", prospect.id),
    supabase.from("rec_immortality_prospect_player_traits").select("trait_key").eq("prospect_id", prospect.id),
    supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.id),
    supabase.from("rec_immortality_creation_builds").select("final_attributes").eq("prospect_id", prospect.id).maybeSingle(),
    discordIdForRecUser(input.userId).catch(() => null),
  ]);
  if (build.error) throw new ApiError(500, "Failed to load creation build for review.", build.error);
  if (!build.data) throw new ApiError(400, "Creation Points must be saved before a prospect can be submitted for review.");
  const finalAttributes = (build.data.final_attributes ?? {}) as Record<string, number>;

  const position = String(prospect.position ?? "");
  const group = positionGroupFor(position as ImmortalityPosition);
  const catalog = characteristicCatalog(group);
  const selectedCharacteristics = catalog.filter((item) => (characteristics.data ?? []).some((row) => row.characteristic_key === item.key));
  const startingDev = startingDevTrait(combinedModifiers(selectedCharacteristics));
  const personaDnaNames = (personaDnaTraits.data ?? [])
    .map((t) => personaDnaCatalog().find((c) => c.key === t.trait_key)?.name)
    .filter((name): name is string => Boolean(name));
  const playerTraitGroup = position === "QB" ? "QB" : position === "MIKE" ? "MIKE" : null;
  const playerTraitNames = playerTraitGroup
    ? (playerTraits.data ?? [])
      .map((t) => playerTraitCatalog(playerTraitGroup).find((c) => c.key === t.trait_key)?.name)
      .filter((name): name is string => Boolean(name))
    : [];
  const characteristicNames = (characteristics.data ?? [])
    .map((t) => characteristicCatalog(group).find((c) => c.key === t.characteristic_key)?.displayName)
    .filter((name): name is string => Boolean(name));
  const playstyleArchetype = (branchingPlaystyle.data?.primary_archetype ?? flatPlaystyle.data?.primary_archetype ?? null) as string | null;
  const playstyleSecondary = (branchingPlaystyle.data?.secondary_archetype ?? flatPlaystyle.data?.secondary_archetype ?? null) as string | null;

  const sideCategory = prospect.side === "offense" ? "offensive" : "defensive";
  const attributeLines = MADDEN_ATTRIBUTE_DEFINITIONS
    .filter((def) => def.category === "physical" || def.category === sideCategory)
    .map((def) => ({ code: def.code, name: def.name, value: finalAttributes[def.code] ?? null }))
    .filter((attr): attr is { code: MaddenAttributeCode; name: string; value: number } => attr.value != null);

  const name = `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Unnamed Prospect";
  const summary = [
    `Position: ${position} (${prospect.side})`,
    `Age ${prospect.age ?? "?"} · ${prospect.height_inches ? `${Math.floor(prospect.height_inches / 12)}'${prospect.height_inches % 12}"` : "?"} · ${prospect.weight_lbs ?? "?"} lbs · ${prospect.body_type ?? "—"}`,
    `Hometown: ${prospect.hometown ?? "—"}${prospect.hometown_state ? `, ${prospect.hometown_state}` : ""}${prospect.college ? ` · ${prospect.college}` : ""}`,
    `Jersey #${prospect.jersey_number ?? "?"} · Starting Dev Trait: ${startingDev}`,
    prospect.throwing_motion_key ? `Throwing Motion: ${prospect.throwing_motion_key}` : null,
    "",
    `Persona: ${personaResult.data?.label ?? "—"}`,
    `Playstyle: ${playstyleArchetype ?? "—"}${playstyleSecondary ? ` / ${playstyleSecondary}` : ""}`,
    `Persona DNA: ${personaDnaNames.join(", ") || "—"}`,
    playerTraitGroup ? `Player Traits: ${playerTraitNames.join(", ") || "—"}` : null,
    `Natural Characteristics: ${characteristicNames.join(", ") || "—"}`,
    "",
    "Attributes:",
    attributeLines.map((attr) => `${attr.code} ${attr.name}: ${attr.value}`).join("\n") || "—",
  ].filter((line): line is string => line != null).join("\n");

  // rec_commissioners_inbox_source_unique_idx (guild_id, queue_type, source_table, source_id)
  // is a PARTIAL unique index (WHERE source_table/source_id IS NOT NULL) -- the query builder's
  // .upsert() emits a bare `ON CONFLICT (columns) DO UPDATE` with no WHERE clause, which Postgres
  // refuses to match against a partial index ("no unique or exclusion constraint matching the ON
  // CONFLICT specification"), so this upsert has silently thrown on every single call since the
  // review gate shipped -- every prospect that reached Creation Points got stuck at
  // review_status='pending_review' with no inbox row ever created for a commissioner to act on.
  // Select-then-insert/update sidesteps the query builder's ON CONFLICT limitation entirely.
  const existingInboxRow = await supabase
    .from("rec_commissioners_inbox")
    .select("id")
    .eq("guild_id", input.guildId)
    .eq("queue_type", "immortality_prospect")
    .eq("source_table", "rec_immortality_prospects")
    .eq("source_id", prospect.id)
    .maybeSingle();
  if (existingInboxRow.error) throw new ApiError(500, "Failed to submit prospect for review.", existingInboxRow.error);

  const inboxPayload = {
    guild_id: input.guildId,
    league_id: input.leagueId,
    queue_type: "immortality_prospect",
    status: "pending",
    priority: 0,
    header: `${prospect.side === "offense" ? "Offensive" : "Defensive"} Prospect: ${name} (${position})`,
    summary,
    requester_user_id: input.userId,
    requester_discord_id: discordId,
    source_table: "rec_immortality_prospects",
    source_id: prospect.id,
    reviewed_by_discord_id: null,
    reviewed_at: null,
    review_reason: null,
    payload: {
      prospectId: prospect.id, side: prospect.side, position, name,
      firstName: prospect.first_name ?? "", lastName: prospect.last_name ?? "",
      age: prospect.age, heightInches: prospect.height_inches, weightLbs: prospect.weight_lbs, bodyType: prospect.body_type,
      hometown: prospect.hometown, hometownState: prospect.hometown_state, college: prospect.college,
      jerseyNumber: prospect.jersey_number, startingDev, throwingMotionKey: prospect.throwing_motion_key ?? null,
      personaLabel: personaResult.data?.label ?? null, playstyleArchetype, playstyleSecondary,
      personaDnaTraits: personaDnaNames, playerTraits: playerTraitNames, characteristics: characteristicNames,
      attributes: attributeLines,
    },
    updated_at: new Date().toISOString(),
  };
  const inboxUpsert = existingInboxRow.data
    ? await supabase.from("rec_commissioners_inbox").update(inboxPayload).eq("id", existingInboxRow.data.id)
    : await supabase.from("rec_commissioners_inbox").insert(inboxPayload);
  if (inboxUpsert.error) throw new ApiError(500, "Failed to submit prospect for review.", inboxUpsert.error);

  // Approval is automatic -- Creation Points itself is the real gate (evaluateCreationBuild
  // already enforces every prior Origins step is done before this ever fires). The inbox item
  // exists purely so a commissioner can log this build to recreate the player in-game; it does
  // not block team selection. A re-submission clears any earlier rejection the same way.
  await supabase.from("rec_immortality_prospects").update({
    review_status: "approved", review_reason: null, reviewed_by_discord_id: null, reviewed_at: null,
  }).eq("id", prospect.id);

  await notifyLeagueCommissionersOfPendingItem(input.leagueId);
}

/** Guarantees every prospect that's finished Creation Points eventually gets a commissioner
 * review-log row, even when the real-time call inside evaluateCreationBuild failed (it's
 * deliberately best-effort there -- see its .catch -- so a transient DB blip must never cost a
 * player their build). Diffs this league's prospects-with-a-build against its existing
 * "immortality_prospect" inbox rows and re-runs submitProspectForReview for whatever's missing;
 * submitProspectForReview derives everything it needs (final attributes, starting dev trait,
 * persona/playstyle/traits) from already-persisted rows, so calling it here for a build from
 * days ago behaves identically to calling it the moment the build was saved. Polled from the bot
 * every few minutes for every guild (recApi.backfillImmortalityProspectReviews) -- cheap no-op
 * for a guild with no RTI league or nothing missing, so it's safe to poll broadly. */
export async function backfillMissingImmortalityProspectReviews(guildId: string): Promise<{ backfilled: number }> {
  const context = await getCurrentLeagueContext(guildId).catch(() => null);
  if (!context) return { backfilled: 0 };
  const league = await loadImmortalityLeague(context.leagueId);
  if (!league) return { backfilled: 0 };

  const prospects = await supabase.from("rec_immortality_prospects").select("*").eq("immortality_league_id", league.id);
  if (prospects.error) throw new ApiError(500, "Failed to load prospects for review backfill.", prospects.error);
  const prospectIds = (prospects.data ?? []).map((row: any) => String(row.id));
  if (!prospectIds.length) return { backfilled: 0 };

  const [builds, existingInboxRows] = await Promise.all([
    supabase.from("rec_immortality_creation_builds").select("prospect_id").in("prospect_id", prospectIds),
    supabase.from("rec_commissioners_inbox").select("source_id").eq("guild_id", guildId).eq("queue_type", "immortality_prospect").eq("source_table", "rec_immortality_prospects").in("source_id", prospectIds),
  ]);
  if (builds.error) throw new ApiError(500, "Failed to load creation builds for review backfill.", builds.error);
  if (existingInboxRows.error) throw new ApiError(500, "Failed to load existing review items for backfill.", existingInboxRows.error);

  const builtProspectIds = new Set((builds.data ?? []).map((row: any) => String(row.prospect_id)));
  const loggedProspectIds = new Set((existingInboxRows.data ?? []).map((row: any) => String(row.source_id)));
  const missing = (prospects.data ?? []).filter((row: any) => builtProspectIds.has(String(row.id)) && !loggedProspectIds.has(String(row.id)));
  if (!missing.length) return { backfilled: 0 };

  let backfilled = 0;
  for (const prospect of missing as any[]) {
    if (!prospect.user_id) continue;
    try {
      await submitProspectForReview({
        guildId, leagueId: context.leagueId, immortalityLeagueId: league.id, prospect, userId: String(prospect.user_id),
      });
      backfilled += 1;
    } catch (error) {
      console.error(`[ERROR] Backfill failed to submit prospect ${prospect.id} for review:`, error);
    }
  }
  return { backfilled };
}

/** Mark a prospect's commissioner-inbox item as "Applied in game" (approve) or reject it.
 * review_status is already 'approved' the moment Creation Points is submitted (see
 * submitProspectForReview) and team selection never waits on this -- the inbox item exists so a
 * commissioner can log the build to recreate it in-game, nothing more. "Applied in game" just
 * closes out the inbox item; there's no build state left to change. Rejecting is the actual
 * moderation action here: it requires a reason and removes the prospect's owner from the league
 * entirely (same as a commissioner /kick), since a rejected build means the submission itself
 * was unacceptable, not that the member should be left stuck mid-flow to fix and resubmit.
 * A commissioner can also correct the first/last name here before closing it out -- Madden's
 * in-game name filter sometimes blocks a name as vulgar even when it isn't, and this is the
 * point where that becomes visible. A rename is applied to the prospect immediately and
 * propagates everywhere the name is read from live (identity form, franchise headline, future
 * prospect-card renders); if this prospect was already materialized onto a roster (rec_players)
 * and/or already has a posted Discord card, those get updated and the card re-rendered in place
 * too, so a rename after the fact doesn't leave a stale name on an already-published embed. */
export async function reviewImmortalityProspect(input: {
  guildId: string; prospectId: string; action: "approve" | "reject"; reviewerDiscordId: string; note?: string;
  firstName?: string; lastName?: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const prospect = await supabase.from("rec_immortality_prospects")
    .select("id,user_id,review_status,first_name,last_name,player_id,card_channel_id,card_message_id")
    .eq("id", input.prospectId).eq("immortality_league_id", league.id).maybeSingle();
  if (prospect.error || !prospect.data) throw new ApiError(404, "Prospect not found in this league.");

  const inboxRow = await supabase.from("rec_commissioners_inbox").select("id,status")
    .eq("source_table", "rec_immortality_prospects").eq("source_id", input.prospectId).maybeSingle();
  if (inboxRow.error) throw new ApiError(500, "Could not load that review item.", inboxRow.error);
  if (inboxRow.data && inboxRow.data.status !== "pending") throw new ApiError(409, `This item is already ${inboxRow.data.status}.`);
  if (input.action === "reject" && !input.note?.trim()) throw new ApiError(400, "A reason is required to reject and remove this player from the league.");

  const nextFirstName = input.firstName?.trim() || prospect.data.first_name;
  const nextLastName = input.lastName?.trim() || prospect.data.last_name;
  const renamed = nextFirstName !== prospect.data.first_name || nextLastName !== prospect.data.last_name;

  const nextStatus = input.action === "approve" ? "approved" : "rejected";
  const updated = await supabase.from("rec_immortality_prospects").update({
    review_status: nextStatus, review_reason: input.note?.trim() ?? null,
    reviewed_by_discord_id: input.reviewerDiscordId, reviewed_at: new Date().toISOString(),
    first_name: nextFirstName, last_name: nextLastName,
  }).eq("id", input.prospectId).select("*").single();
  if (updated.error) throw new ApiError(500, "Could not save that review decision.", updated.error);

  await supabase.from("rec_commissioners_inbox").update({
    status: input.action === "approve" ? "approved" : "denied",
    reviewed_by_discord_id: input.reviewerDiscordId, reviewed_at: new Date().toISOString(),
    review_reason: input.note?.trim() ?? null,
  }).eq("source_table", "rec_immortality_prospects").eq("source_id", input.prospectId);

  if (input.action === "reject" && prospect.data.user_id) {
    const ownerDiscordId = await discordIdForRecUser(String(prospect.data.user_id));
    await kickLeagueUser({
      guildId: input.guildId, target: ownerDiscordId, scope: "league",
      reason: input.note!.trim(), actorDiscordId: input.reviewerDiscordId,
    });
  }

  if (renamed) {
    const fullName = `${nextFirstName ?? ""} ${nextLastName ?? ""}`.trim();
    if (prospect.data.player_id) {
      await supabase.from("rec_players").update({
        first_name: nextFirstName, last_name: nextLastName, full_name: fullName, updated_at: new Date().toISOString(),
      }).eq("id", prospect.data.player_id);
    }
    if (prospect.data.card_channel_id && prospect.data.card_message_id) {
      await refreshSingleProspectCard(input.prospectId, prospect.data.card_channel_id, prospect.data.card_message_id);
    }
  }

  return updated.data;
}

export async function setImmortalityIntroVideo(input: { guildId: string; discordId: string; url: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const updated = await supabase.from("rec_immortality_leagues").update({
    intro_video_url: input.url, updated_at: new Date().toISOString(),
  }).eq("id", league.id).select("intro_video_url").single();
  if (updated.error) throw new ApiError(500, "Could not save the intro video.", updated.error);
  return { introVideoUrl: updated.data.intro_video_url };
}

export async function markImmortalityIntroVideoWatched(input: { guildId: string; discordId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const saved = await supabase.from("rec_immortality_intro_views").upsert({
    immortality_league_id: league.id, user_id: userId, completed_at: new Date().toISOString(),
  }, { onConflict: "immortality_league_id,user_id" });
  if (saved.error) throw new ApiError(500, "Could not record the intro video as watched.", saved.error);
  return { ok: true };
}

export async function upsertOwnerIdentity(input: {
  guildId: string;
  discordId: string;
  identity: { firstName: string; lastName: string; headshotUrl?: string | null };
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const existing = await supabase.from("rec_immortality_owners").select("id,origins_step").eq("immortality_league_id", league.id).eq("user_id", userId).maybeSingle();
  const payload = {
    immortality_league_id: league.id,
    user_id: userId,
    first_name: input.identity.firstName,
    last_name: input.identity.lastName,
    headshot_url: input.identity.headshotUrl ?? null,
    origins_step: existing.data?.origins_step === "complete" ? "complete" : "identity",
    updated_at: new Date().toISOString(),
  };
  const result = existing.data
    ? await supabase.from("rec_immortality_owners").update(payload).eq("id", existing.data.id).select("*").single()
    : await supabase.from("rec_immortality_owners").insert(payload).select("*").single();
  if (result.error) throw new ApiError(500, "Could not save owner identity.", result.error);
  return result.data;
}

/** Custom headshot upload for an owner, mirroring uploadProspectHeadshot above. */
export async function uploadOwnerHeadshot(input: {
  guildId: string;
  discordId: string;
  contentType: string;
  imageBuffer: Buffer;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const owner = await supabase.from("rec_immortality_owners").select("id").eq("immortality_league_id", league.id).eq("user_id", userId).maybeSingle();
  if (!owner.data) throw new ApiError(400, "Create your owner first.");
  if (!HEADSHOT_ALLOWED_TYPES.has(input.contentType)) throw new ApiError(400, "Headshot must be a JPEG, PNG, or WebP image.");
  if (input.imageBuffer.length === 0 || input.imageBuffer.length > HEADSHOT_MAX_BYTES) throw new ApiError(400, "Headshot must be between 1 byte and 5 MB.");

  const uploaded = await uploadImageToCloudflare({
    buffer: input.imageBuffer,
    contentType: input.contentType,
    imageId: `rti-owner-${owner.data.id}`,
    meta: { leagueId: context.leagueId, ownerId: String(owner.data.id) },
  });
  const updated = await supabase.from("rec_immortality_owners")
    .update({ headshot_url: uploaded.url, updated_at: new Date().toISOString() })
    .eq("id", owner.data.id).select("headshot_url").single();
  if (updated.error) throw new ApiError(500, "Could not save that headshot.", updated.error);
  return { headshotUrl: updated.data.headshot_url };
}

export async function submitOwnerPersona(input: {
  guildId: string;
  discordId: string;
  answers: Array<{ questionNumber: number; optionIndex: number }>;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const owner = await supabase.from("rec_immortality_owners").select("id").eq("immortality_league_id", league.id).eq("user_id", userId).maybeSingle();
  if (!owner.data) throw new ApiError(400, "Create your owner first.");
  const questions = personaQuestionsForOwner();
  const result = scorePersonaInterview({ questions, answers: input.answers });
  const saved = await supabase.from("rec_immortality_owner_persona_results").upsert({
    owner_id: owner.data.id,
    scores: result.scores,
    primary_dimension: result.primary,
    secondary_dimension: result.secondary,
    label: result.label,
    answers: input.answers,
    formula_version: result.formulaVersion,
  }, { onConflict: "owner_id" });
  if (saved.error) throw new ApiError(500, "Could not save owner persona.", saved.error);
  await supabase.from("rec_immortality_owners").update({ origins_step: "complete", updated_at: new Date().toISOString() }).eq("id", owner.data.id);

  // The head commissioner already chose a team during league creation, so they never pass
  // through chooseImmortalityTeam (the normal member path that publishes cards, creates the RTI
  // franchise claim, and offers contracts). Finish that same pipeline when their owner is done.
  await finalizePreassignedImmortalityOwner({
    guildId: input.guildId,
    recLeagueId: context.leagueId,
    immortalityLeagueId: league.id,
    userId,
    discordId: input.discordId,
  }).catch((error) => console.error("[WARN] Could not finalize preassigned RTI owner (non-fatal):", error));
  return result;
}

async function finalizePreassignedImmortalityOwner(input: {
  guildId: string; recLeagueId: string; immortalityLeagueId: string; userId: string; discordId: string;
}): Promise<void> {
  const existingClaim = await supabase.from("rec_immortality_user_team_assignments").select("team_id")
    .eq("immortality_league_id", input.immortalityLeagueId).eq("user_id", input.userId).maybeSingle();
  const owner = await supabase.from("rec_immortality_owners").select("origins_step")
    .eq("immortality_league_id", input.immortalityLeagueId).eq("user_id", input.userId).maybeSingle();
  if (owner.data?.origins_step !== "complete") return;
  const teamId = await resolveExistingTeamIdForUser(input.immortalityLeagueId, input.recLeagueId, input.userId);
  if (!teamId) return;
  const [offenseProspect, defenseProspect] = await Promise.all([
    loadProspectForUser(input.immortalityLeagueId, input.userId, "offense"),
    loadProspectForUser(input.immortalityLeagueId, input.userId, "defense"),
  ]);
  if (!offenseProspect || !defenseProspect) return;
  const prospects = [offenseProspect, defenseProspect];
  const builds = await supabase.from("rec_immortality_creation_builds").select("prospect_id")
    .in("prospect_id", prospects.map((prospect) => String(prospect.id)));
  if ((builds.data ?? []).length !== 2) return;

  if (!existingClaim.data) {
    const claim = await supabase.from("rec_immortality_user_team_assignments").insert({
      immortality_league_id: input.immortalityLeagueId,
      user_id: input.userId,
      team_id: teamId,
      revealed_at: new Date().toISOString(),
    });
    if (claim.error) throw new ApiError(500, "Could not finalize the commissioner's franchise assignment.", claim.error);
  }

  // Preassigned commissioners never pass through chooseImmortalityTeam, which is the normal
  // member path -- this function mirrors everything else it does (claim, materialize, cards,
  // contracts) EXCEPT advancing chapter_state, which used to jump here too. That was wrong:
  // chapter_state is a whole-LEAGUE gate (controls whether Origins is open for every member,
  // not just this one), so auto-advancing it the moment the commissioner personally finished
  // slammed Origins shut for every other member still mid-creation -- confirmed live (a member
  // stuck on "Origins is closed" with real Origins steps still incomplete, while the league's
  // chapter_state had jumped straight to ROOKIE_DRAFT_COMPLETE). The commissioner's own hub
  // access no longer depends on this at all: site-leagues.service.ts's riseHubUnlocked is now
  // ORed with the viewer's own rtiOriginsComplete flag, so a member whose own two prospects have
  // signed contracts reaches their hub regardless of the league-wide chapter_state -- advancing
  // Origins for the whole league stays a deliberate commissioner action, not a side effect.

  for (const prospect of prospects) {
    if (!prospect.player_id) await materializeProspectToPlayer(prospect, teamId, input.recLeagueId);
    if (!prospect.card_message_id) {
      await postProspectCardToDiscord({
        leagueId: input.recLeagueId,
        prospectId: String(prospect.id),
        side: prospect.side as "offense" | "defense",
        discordId: input.discordId,
      });
    }
    // Preassigned commissioners skip chooseImmortalityTeam entirely (see above), which is the
    // only other place that posts this -- without it here their prospects never get an HOF
    // Milestones card, since nothing else ever calls it for them. Safe to call unconditionally:
    // postOrRefreshHofMilestoneCard already tracks hof_channel_id/hof_message_id itself and
    // edits in place once posted, so this never duplicates on a repeat run.
    await import("./hof-milestones.service.js").then(({ postOrRefreshHofMilestoneCard }) => postOrRefreshHofMilestoneCard(String(prospect.id)))
      .catch((error) => console.error(`[WARN] Could not post HOF Milestones card for preassigned prospect ${prospect.id} (non-fatal):`, error));
  }
  const existingContracts = await supabase.from("rec_immortality_contracts").select("id,prospect_id,contract_number,offer_status")
    .in("prospect_id", prospects.map((prospect) => String(prospect.id)))
    .eq("contract_number", 1);
  if ((existingContracts.data ?? []).length < 2) {
    await import("./contracts.service.js").then(({ offerRookieContracts }) => offerRookieContracts(
      prospects.map((prospect) => String(prospect.id)),
    ));
  }
  for (const contract of existingContracts.data ?? []) {
    if (contract.offer_status === "signed") {
      await import("./contracts.service.js").then(({ ensureSignedContractAnnouncement }) => ensureSignedContractAnnouncement({
        guildId: input.guildId, contractId: String(contract.id),
      })).catch((error) => console.error(`[WARN] Could not repair RTI contract headline ${contract.id} (non-fatal):`, error));
    }
  }
  await import("./franchise-headline.js").then(({ postFranchiseSelectionHeadline }) => postFranchiseSelectionHeadline({
    guildId: input.guildId,
    recLeagueId: input.recLeagueId,
    immortalityLeagueId: input.immortalityLeagueId,
    userId: input.userId,
    discordId: input.discordId,
    teamId,
    offenseProspectId: String(offenseProspect.id),
    defenseProspectId: String(defenseProspect.id),
  }));
}

/** Members browse every still-open franchise (grouped by division client-side) and pick one
 * directly -- no more random 4-team offer. Eligibility (both prospects built + approved, owner
 * complete) and openness are both re-checked here regardless of what the UI last showed, same
 * as any other claim-a-resource flow; the UNIQUE(immortality_league_id, team_id) constraint on
 * rec_immortality_user_team_assignments is the real race guard. */
export async function chooseImmortalityTeam(input: { guildId: string; discordId: string; teamId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);

  const already = await supabase.from("rec_immortality_user_team_assignments").select("team_id").eq("immortality_league_id", league.id).eq("user_id", userId).maybeSingle();
  if (already.data) throw new ApiError(400, "You already chose your franchise.");

  const [offenseProspect, defenseProspect, owner] = await Promise.all([
    loadProspectForUser(league.id, userId, "offense"),
    loadProspectForUser(league.id, userId, "defense"),
    supabase.from("rec_immortality_owners").select("origins_step").eq("immortality_league_id", league.id).eq("user_id", userId).maybeSingle(),
  ]);
  if (!offenseProspect || !defenseProspect) throw new ApiError(400, "Finish Origins for both your offense and defense players first.");
  const [offenseBuild, defenseBuild] = await Promise.all([
    supabase.from("rec_immortality_creation_builds").select("prospect_id").eq("prospect_id", offenseProspect.id).maybeSingle(),
    supabase.from("rec_immortality_creation_builds").select("prospect_id").eq("prospect_id", defenseProspect.id).maybeSingle(),
  ]);
  if (!offenseBuild.data || !defenseBuild.data) throw new ApiError(400, "Finish Creation Points for both players first.");
  if (owner.data?.origins_step !== "complete") throw new ApiError(400, "Create your owner and finish their interview first.");
  // Commissioner review no longer gates team selection -- see the matching note in
  // getImmortalityHub's franchiseOptions. A rejected build means its owner was already removed
  // from the league entirely (reviewImmortalityProspect), so there's no rejected-but-still-a-
  // member case left to check for here.

  const team = await supabase.from("rec_teams").select("id").eq("id", input.teamId).eq("league_id", context.leagueId).maybeSingle();
  if (!team.data) throw new ApiError(404, "Team not found in this league.");
  const [commissionerClaim, userClaim] = await Promise.all([
    supabase.from("rec_team_assignments").select("id").eq("league_id", context.leagueId).eq("team_id", input.teamId).eq("assignment_status", "active").is("ended_at", null).maybeSingle(),
    supabase.from("rec_immortality_user_team_assignments").select("id").eq("immortality_league_id", league.id).eq("team_id", input.teamId).maybeSingle(),
  ]);
  if (commissionerClaim.data || userClaim.data) throw new ApiError(409, "That franchise was just claimed. Pick another.");

  const assignment = await supabase.from("rec_immortality_user_team_assignments").insert({
    immortality_league_id: league.id, user_id: userId, team_id: input.teamId, revealed_at: new Date().toISOString(),
  });
  if (assignment.error) throw new ApiError(409, "That franchise was just claimed by someone else. Pick another.");

  try {
    const discordId = await discordIdForRecUser(userId);
    const membership = await supabase.from("rec_league_memberships").select("role").eq("league_id", context.leagueId).eq("user_id", userId).maybeSingle();
    await linkUserToTeam({ guildId: input.guildId, discordId, teamId: input.teamId, authority: membershipAuthority(membership.data?.role) });

    // linkUserToTeam already sets a nickname, but its shortTeamNickname() helper is deliberately
    // terse (mascot only, e.g. "Cowboys") for normal leagues -- RTI wants the full "City Nickname"
    // form (e.g. "Raleigh Reapers") since this is the member's one and only franchise identity.
    const team = await supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated").eq("id", input.teamId).maybeSingle();
    if (team.data) {
      await setGuildMemberNickname(input.guildId, discordId, formatTeamDisplayName(team.data) ?? team.data.name ?? "Team", "RTI franchise assigned")
        .catch((error) => console.error(`[WARN] Failed to set RTI nickname for ${discordId} in guild ${input.guildId} (non-fatal):`, error));
    }
  } catch (error) {
    console.error(`[WARN] Rise team choice could not link user ${userId} to team ${input.teamId}:`, error);
  }

  for (const prospect of [offenseProspect, defenseProspect]) {
    if (prospect) await materializeProspectToPlayer(prospect, input.teamId, context.leagueId);
  }

  const cardDiscordId = await discordIdForRecUser(userId).catch(() => null);
  if (cardDiscordId) {
    for (const prospect of [offenseProspect, defenseProspect]) {
      if (prospect) {
        await postProspectCardToDiscord({
          leagueId: context.leagueId, prospectId: prospect.id,
          side: prospect.side as "offense" | "defense", discordId: cardDiscordId,
        });
        await import("./hof-milestones.service.js").then(({ postOrRefreshHofMilestoneCard }) => postOrRefreshHofMilestoneCard(prospect.id))
          .catch((error) => console.error(`[WARN] Could not post HOF Milestones card for prospect ${prospect.id} (non-fatal):`, error));
      }
    }
    if (offenseProspect && defenseProspect) {
      await import("./franchise-headline.js").then(({ postFranchiseSelectionHeadline }) => postFranchiseSelectionHeadline({
        guildId: input.guildId, recLeagueId: context.leagueId, immortalityLeagueId: league.id,
        userId, discordId: cardDiscordId, teamId: input.teamId,
        offenseProspectId: offenseProspect.id, defenseProspectId: defenseProspect.id,
      })).catch((error) => console.error("[WARN] Could not queue RTI franchise headline (non-fatal):", error));
    }
  }

  // This used to auto-advance chapter_state the moment the FIRST member anywhere in the league
  // picked a franchise, on the theory that it "opens the league hub for everyone." It doesn't --
  // chapter_state is a whole-league gate that also controls whether Origins itself is open
  // (originsOpen() only allows ORIGINS/REGISTRATION), so the first member to finish and pick a
  // team was silently slamming Origins shut for every other member still mid-creation. Confirmed
  // live: one member's team pick jumped the league straight to ROOKIE_DRAFT_COMPLETE while
  // several others were still on Identity/IQ/Persona, and they got "Origins is closed" with no
  // way to finish. A member's own hub access doesn't need this: site-leagues.service.ts's
  // riseHubUnlocked is ORed with the viewer's own rtiOriginsComplete flag, so whoever just
  // finished reaches their hub regardless of the league-wide chapter_state. Advancing Origins for
  // the whole league now stays a deliberate commissioner action (transitionImmortalityState),
  // never an automatic side effect of one member finishing.

  await import("./contracts.service.js").then(({ offerRookieContracts }) => offerRookieContracts(
    [offenseProspect, defenseProspect].filter(Boolean).map((row) => String(row!.id)),
  )).catch((error) => console.error("[WARN] Could not create rookie contract offers (non-fatal):", error));

  return { teamId: input.teamId };
}

export async function setImmortalityRival(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  rivalTeamId: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const team = await supabase.from("rec_teams").select("id").eq("id", input.rivalTeamId).eq("league_id", context.leagueId).maybeSingle();
  if (!team.data) throw new ApiError(404, "That team isn't in this league.");
  const saved = await supabase.from("rec_immortality_rivals").upsert({
    immortality_league_id: league.id, user_id: userId, side: input.side, rival_team_id: input.rivalTeamId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "immortality_league_id,user_id,side" }).select("*").single();
  if (saved.error) throw new ApiError(500, "Could not save that rival.", saved.error);
  return { side: input.side, rivalTeamId: input.rivalTeamId };
}

export async function getImmortalityRivals(input: { guildId: string; discordId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const [rivals, teamIdentities] = await Promise.all([
    supabase.from("rec_immortality_rivals").select("side,rival_team_id").eq("immortality_league_id", league.id).eq("user_id", userId),
    supabase.from("rec_league_team_identities").select("team_id,display_team_name,default_team_name,display_city,default_city,display_abbreviation,default_abbreviation").eq("league_id", context.leagueId),
  ]);
  const teamById = new Map((teamIdentities.data ?? []).map((row) => [String(row.team_id), {
    name: row.display_team_name ?? row.default_team_name,
    city: row.display_city ?? row.default_city,
    abbreviation: row.display_abbreviation ?? row.default_abbreviation,
  }]));
  const bySide = new Map((rivals.data ?? []).map((row) => [String(row.side), String(row.rival_team_id)]));
  return {
    offense: bySide.has("offense") ? { teamId: bySide.get("offense")!, ...(teamById.get(bySide.get("offense")!) ?? { name: null, city: null, abbreviation: null }) } : null,
    defense: bySide.has("defense") ? { teamId: bySide.get("defense")!, ...(teamById.get(bySide.get("defense")!) ?? { name: null, city: null, abbreviation: null }) } : null,
  };
}

/** Logged matchups against this prospect's rival team, most recent first -- computed live from
 * rec_games + rec_player_weekly_stats rather than a separate log, since those already carry
 * everything needed (final score, opponent, this player's stat line for that game). */
export async function getImmortalityRivalHistory(input: { guildId: string; discordId: string; side: "offense" | "defense" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect?.player_id) return { rivalTeamId: null, games: [] };
  const [rival, player] = await Promise.all([
    supabase.from("rec_immortality_rivals").select("rival_team_id").eq("immortality_league_id", league.id).eq("user_id", userId).eq("side", input.side).maybeSingle(),
    supabase.from("rec_players").select("team_id").eq("id", prospect.player_id).maybeSingle(),
  ]);
  const rivalTeamId = rival.data?.rival_team_id ? String(rival.data.rival_team_id) : null;
  const myTeamId = player.data?.team_id ? String(player.data.team_id) : null;
  if (!rivalTeamId || !myTeamId) return { rivalTeamId, games: [] };
  const games = await supabase.from("rec_games")
    .select("id,week_number,home_team_id,away_team_id,home_score,away_score,status")
    .eq("league_id", context.leagueId)
    .eq("status", "final")
    .or(`and(home_team_id.eq.${myTeamId},away_team_id.eq.${rivalTeamId}),and(home_team_id.eq.${rivalTeamId},away_team_id.eq.${myTeamId})`)
    .order("week_number", { ascending: false });
  if (games.error) throw new ApiError(500, "Could not load rival matchup history.", games.error);
  const gameIds = (games.data ?? []).map((row) => String(row.id));
  const opponentIds = Array.from(new Set([myTeamId, rivalTeamId]));
  const [stats, identities] = await Promise.all([
    gameIds.length ? supabase.from("rec_player_weekly_stats").select("week_number,stats,stat_category").eq("player_id", prospect.player_id).in("week_number", (games.data ?? []).map((row) => row.week_number).filter((w): w is number => w != null)) : Promise.resolve({ data: [] }),
    supabase.from("rec_league_team_identities").select("team_id,display_team_name,default_team_name").in("team_id", opponentIds).eq("league_id", context.leagueId),
  ]);
  const nameByTeam = new Map((identities.data ?? []).map((row) => [String(row.team_id), row.display_team_name ?? row.default_team_name]));
  const statsByWeek = new Map<number, Record<string, unknown>>();
  for (const row of stats.data ?? []) {
    if (row.week_number != null) statsByWeek.set(Number(row.week_number), (row.stats ?? {}) as Record<string, unknown>);
  }
  return {
    rivalTeamId,
    games: (games.data ?? []).map((row) => {
      const iAmHome = String(row.home_team_id) === myTeamId;
      return {
        weekNumber: row.week_number,
        opponentName: nameByTeam.get(rivalTeamId) ?? "Rival",
        myScore: iAmHome ? row.home_score : row.away_score,
        opponentScore: iAmHome ? row.away_score : row.home_score,
        statLine: row.week_number != null ? statsByWeek.get(Number(row.week_number)) ?? null : null,
      };
    }),
  };
}

/** Deterministically picks (or returns the already-picked) media question for the current
 * week, biased toward the matchup's rivalry/result/high-stakes context when known. Answers
 * lock for the week once submitted -- resolving a flagged bonus opportunity against the
 * actual stat line is a manual commissioner call for now, the same way EOS payouts are. */
const MEDIA_DAY_SLOTS = 3;

/** True once this week's game for teamId is no longer a "pregame" opportunity -- live, its
 * scheduled kickoff has passed, or a stream got posted for it (per direction: whichever of the
 * three happens first ends the window). No game scheduled yet this week just means no game to
 * be pregame about, which isn't a closed window on its own. */
async function isMediaDayWindowClosed(gameId: string | null): Promise<boolean> {
  if (!gameId) return false;
  const [game, streamLog] = await Promise.all([
    supabase.from("rec_games").select("status,scheduled_for").eq("id", gameId).maybeSingle(),
    supabase.from("rec_stream_compliance_logs").select("id").eq("game_id", gameId).limit(1).maybeSingle(),
  ]);
  if (game.data?.status === "live") return true;
  if (game.data?.scheduled_for && new Date(String(game.data.scheduled_for)).getTime() <= Date.now()) return true;
  if (streamLog.data) return true;
  return false;
}

function marginCategory(marginAbs: number): "blowout" | "close" | null {
  if (marginAbs >= 21) return "blowout";
  if (marginAbs <= 3) return "close";
  return null;
}

async function resolveMediaDayMatchupContext(input: {
  recLeagueId: string; immortalityLeagueId: string; season: number; week: number; teamId: string | null; side: "offense" | "defense"; userId: string;
}): Promise<{
  gameId: string | null;
  lastResult: "win" | "loss" | null;
  isRivalryGame: boolean;
  opponentProspect: { id: string; user_id: string; first_name: string | null; last_name: string | null } | null;
  opponentTeamId: string | null;
  hasPlayedThisSeason: boolean;
  priorMeetingResult: "win" | "loss" | "tie" | null;
  priorMeetingMargin: "blowout" | "close" | null;
}> {
  let gameId: string | null = null;
  let lastResult: "win" | "loss" | null = null;
  let opponentTeamId: string | null = null;
  let hasPlayedThisSeason = false;
  let priorMeetingResult: "win" | "loss" | "tie" | null = null;
  let priorMeetingMargin: "blowout" | "close" | null = null;

  if (input.teamId) {
    // Every season restarts at week 1, so filtering games by week_number alone leaks in a prior
    // season's game at the same week number -- the recurring bug class this codebase has hit
    // before for GOTW/wagers/the hub hero card/etc. Route through the season-scoped helpers
    // instead of a raw week_number filter.
    const seasonId = await resolveSeasonId(input.recLeagueId, input.season);
    // Fetches every completed game for this team this season (not just the most recent) so a
    // specific prior meeting against THIS week's opponent can be found below -- "the last time
    // you played" and margin-flavored questions are about that specific head-to-head, not just
    // whatever the last game happened to be.
    const [thisWeekGame, priorGames] = await Promise.all([
      leagueWeekGamesQuery(supabase, { leagueId: input.recLeagueId, seasonId, weekNumber: input.week }, "id,home_team_id,away_team_id")
        .or(`home_team_id.eq.${input.teamId},away_team_id.eq.${input.teamId}`).maybeSingle(),
      leagueSeasonGamesQuery(supabase, { leagueId: input.recLeagueId, seasonId }, "home_team_id,away_team_id,home_score,away_score,week_number")
        .eq("status", "final").or(`home_team_id.eq.${input.teamId},away_team_id.eq.${input.teamId}`)
        .lt("week_number", input.week).order("week_number", { ascending: false }),
    ]);
    if (thisWeekGame.data) {
      gameId = String(thisWeekGame.data.id);
      opponentTeamId = String(thisWeekGame.data.home_team_id) === input.teamId
        ? (thisWeekGame.data.away_team_id ? String(thisWeekGame.data.away_team_id) : null)
        : (thisWeekGame.data.home_team_id ? String(thisWeekGame.data.home_team_id) : null);
    }
    const priorGameRows = (priorGames.data ?? []) as Array<{ home_team_id: string; away_team_id: string; home_score: number | null; away_score: number | null }>;
    hasPlayedThisSeason = priorGameRows.some((row) => row.home_score != null && row.away_score != null);
    const lastGame = priorGameRows.find((row) => row.home_score != null && row.away_score != null);
    if (lastGame) {
      const iAmHome = String(lastGame.home_team_id) === input.teamId;
      const myScore = iAmHome ? lastGame.home_score! : lastGame.away_score!;
      const theirScore = iAmHome ? lastGame.away_score! : lastGame.home_score!;
      lastResult = myScore > theirScore ? "win" : myScore < theirScore ? "loss" : null;
    }
    if (opponentTeamId) {
      const priorMeeting = priorGameRows.find((row) =>
        (String(row.home_team_id) === opponentTeamId || String(row.away_team_id) === opponentTeamId)
        && row.home_score != null && row.away_score != null);
      if (priorMeeting) {
        const iAmHome = String(priorMeeting.home_team_id) === input.teamId;
        const myScore = iAmHome ? priorMeeting.home_score! : priorMeeting.away_score!;
        const theirScore = iAmHome ? priorMeeting.away_score! : priorMeeting.home_score!;
        priorMeetingResult = myScore > theirScore ? "win" : myScore < theirScore ? "loss" : "tie";
        priorMeetingMargin = marginCategory(Math.abs(myScore - theirScore));
      }
    }
  }

  let opponentProspect: { id: string; user_id: string; first_name: string | null; last_name: string | null } | null = null;
  if (opponentTeamId) {
    // The opposing RTI prospect on the same side, via whoever currently owns that team --
    // reactive questions only ever compare same-side prospects (offense answers react to the
    // opposing offense prospect, same for defense) since that's who's actually "across from"
    // this player in the matchup narrative.
    const opponentUser = await supabase.from("rec_immortality_user_team_assignments")
      .select("user_id").eq("immortality_league_id", input.immortalityLeagueId).eq("team_id", opponentTeamId).maybeSingle();
    const opponentUserId = opponentUser.data?.user_id
      ? String(opponentUser.data.user_id)
      : (await supabase.from("rec_team_assignments").select("user_id").eq("league_id", input.recLeagueId).eq("team_id", opponentTeamId).eq("assignment_status", "active").is("ended_at", null).maybeSingle()).data?.user_id ?? null;
    if (opponentUserId) {
      const row = await supabase.from("rec_immortality_prospects")
        .select("id,user_id,first_name,last_name")
        .eq("immortality_league_id", input.immortalityLeagueId).eq("user_id", String(opponentUserId)).eq("side", input.side).maybeSingle();
      opponentProspect = row.data ?? null;
    }
  }

  const rival = await supabase.from("rec_immortality_rivals").select("rival_team_id")
    .eq("immortality_league_id", input.immortalityLeagueId).eq("side", input.side).eq("user_id", input.userId)
    .maybeSingle();
  const isRivalryGame = Boolean(rival.data?.rival_team_id) && rival.data?.rival_team_id === opponentTeamId;

  return { gameId, lastResult, isRivalryGame, opponentProspect, opponentTeamId, hasPlayedThisSeason, priorMeetingResult, priorMeetingMargin };
}

export async function getWeeklyMatchupInterview(input: { guildId: string; discordId: string; side: "offense" | "defense" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  const season = Number(context.rec_leagues.season_number ?? 1);
  const week = Number(context.rec_leagues.current_week ?? 1);
  const teamId = prospect.player_id
    ? (await supabase.from("rec_players").select("team_id").eq("id", prospect.player_id).maybeSingle()).data?.team_id ?? null
    : null;

  const existing = await supabase.from("rec_immortality_matchup_interview_answers")
    .select("*").eq("prospect_id", prospect.id).eq("week_number", week).order("slot", { ascending: true });
  if (existing.error) throw new ApiError(500, "Could not load this week's Media Day.", existing.error);
  const answered = existing.data ?? [];

  const matchup = await resolveMediaDayMatchupContext({
    recLeagueId: context.leagueId, immortalityLeagueId: league.id, season, week, teamId: teamId ? String(teamId) : null, side: input.side, userId,
  });
  const windowClosed = await isMediaDayWindowClosed(matchup.gameId);

  if (answered.length >= MEDIA_DAY_SLOTS) {
    return { season, week, questions: answered.map((row) => row.rendered_question), answers: answered, complete: true, windowClosed };
  }
  if (windowClosed) {
    return { season, week, questions: answered.map((row) => row.rendered_question), answers: answered, complete: false, windowClosed };
  }

  const answeredIds = new Set(answered.map((row) => Number(row.question_id)));
  const pool = matchupInterviewPool().filter((question) => !answeredIds.has(question.id));
  const remainingSlots = MEDIA_DAY_SLOTS - answered.length;
  const remainingStatic = selectMatchupInterviewQuestions({
    pool,
    context: {
      lastResult: matchup.lastResult, isRivalryGame: matchup.isRivalryGame,
      hasPlayedThisSeason: matchup.hasPlayedThisSeason,
      priorMeetingResult: matchup.priorMeetingResult, priorMeetingMargin: matchup.priorMeetingMargin,
    },
    seed: `${league.id}:${prospect.id}:${week}`,
    count: remainingSlots,
  });

  // Slot 1 becomes a reactive question instead of a static pick when the opponent has already
  // answered their own slot 1 for this week -- "in response to what they stated," per direction.
  let nextQuestions = remainingStatic;
  if (answered.length === 0 && matchup.opponentProspect) {
    const opponentSlot1 = await supabase.from("rec_immortality_matchup_interview_answers")
      .select("rendered_question,option_index")
      .eq("prospect_id", matchup.opponentProspect.id).eq("week_number", week).eq("slot", 1).maybeSingle();
    const opponentQuestion = opponentSlot1.data?.rendered_question as { options?: Array<{ text: string }> } | undefined;
    const opponentAnswerText = opponentQuestion?.options?.[Number(opponentSlot1.data?.option_index ?? -1)]?.text;
    if (opponentAnswerText) {
      const opponentName = `${matchup.opponentProspect.first_name ?? ""} ${matchup.opponentProspect.last_name ?? ""}`.trim() || "Your opponent";
      const opponentTeam = matchup.opponentTeamId
        ? await supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated").eq("id", matchup.opponentTeamId).maybeSingle()
        : { data: null };
      const reactive = buildReactiveMatchupInterviewQuestion({
        seed: `${league.id}:${prospect.id}:${week}:reactive`,
        opponent: { opponentName, opponentTeamName: formatTeamDisplayName(opponentTeam.data) ?? "their team", opponentAnswerText },
      });
      nextQuestions = [reactive, ...remainingStatic.slice(1)];
    }
  }

  return {
    season, week, complete: false, windowClosed: false,
    questions: [...answered.map((row) => row.rendered_question), ...nextQuestions],
    answers: answered,
  };
}

export async function submitWeeklyMatchupInterview(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  questionId: number;
  optionIndex: number;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");
  const season = Number(context.rec_leagues.season_number ?? 1);
  const week = Number(context.rec_leagues.current_week ?? 1);
  const teamRow = prospect.player_id
    ? await supabase.from("rec_players").select("team_id").eq("id", prospect.player_id).maybeSingle()
    : { data: null };
  const teamId = teamRow.data?.team_id ? String(teamRow.data.team_id) : null;

  const existing = await supabase.from("rec_immortality_matchup_interview_answers")
    .select("id,slot").eq("prospect_id", prospect.id).eq("week_number", week).order("slot", { ascending: true });
  if (existing.error) throw new ApiError(500, "Could not load this week's Media Day.", existing.error);
  const answeredCount = existing.data?.length ?? 0;
  if (answeredCount >= MEDIA_DAY_SLOTS) throw new ApiError(409, "This week's Media Day is already complete.");
  const nextSlot = answeredCount + 1;

  const matchup = await resolveMediaDayMatchupContext({
    recLeagueId: context.leagueId, immortalityLeagueId: league.id, season, week, teamId, side: input.side, userId,
  });
  if (await isMediaDayWindowClosed(matchup.gameId)) {
    throw new ApiError(400, "This week's Media Day window has closed.");
  }

  const isReactive = input.questionId >= REACTIVE_MATCHUP_QUESTION_ID_BASE;
  let question;
  if (isReactive) {
    if (nextSlot !== 1 || !matchup.opponentProspect) throw new ApiError(400, "That reactive question isn't available.");
    const opponentSlot1 = await supabase.from("rec_immortality_matchup_interview_answers")
      .select("rendered_question,option_index").eq("prospect_id", matchup.opponentProspect.id).eq("week_number", week).eq("slot", 1).maybeSingle();
    const opponentQuestion = opponentSlot1.data?.rendered_question as { options?: Array<{ text: string }> } | undefined;
    const opponentAnswerText = opponentQuestion?.options?.[Number(opponentSlot1.data?.option_index ?? -1)]?.text;
    if (!opponentAnswerText) throw new ApiError(400, "That reactive question isn't available.");
    const opponentName = `${matchup.opponentProspect.first_name ?? ""} ${matchup.opponentProspect.last_name ?? ""}`.trim() || "Your opponent";
    const opponentTeam = matchup.opponentTeamId
      ? await supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated").eq("id", matchup.opponentTeamId).maybeSingle()
      : { data: null };
    question = buildReactiveMatchupInterviewQuestion({
      seed: `${league.id}:${prospect.id}:${week}:reactive`,
      opponent: { opponentName, opponentTeamName: formatTeamDisplayName(opponentTeam.data) ?? "their team", opponentAnswerText },
    });
    if (question.id !== input.questionId) throw new ApiError(400, "That reactive question has changed. Reload and try again.");
  } else {
    const pool = matchupInterviewPool();
    const found = pool.find((item) => item.id === input.questionId);
    if (!found) throw new ApiError(404, "That question isn't in this week's pool.");
    question = found;
  }
  const result = scoreMatchupInterviewAnswer({ question, optionIndex: input.optionIndex });

  const saved = await supabase.from("rec_immortality_matchup_interview_answers").insert({
    immortality_league_id: league.id,
    prospect_id: prospect.id,
    side: input.side,
    season,
    week_number: week,
    slot: nextSlot,
    game_id: matchup.gameId,
    opponent_prospect_id: matchup.opponentProspect?.id ?? null,
    question_id: question.id,
    rendered_question: question,
    option_index: input.optionIndex,
    dna_points: result.dnaPoints,
    bonus_stat_category_hint: result.bonusOpportunity?.statCategoryHint ?? null,
    bonus_xp_pct: result.bonusOpportunity?.xpBonusPct ?? null,
    bonus_status: result.bonusOpportunity ? "pending" : "none",
    formula_version: result.formulaVersion,
  }).select("*").single();
  if (saved.error) {
    if (saved.error.code === "23505") throw new ApiError(409, "This week's interview is already answered.");
    throw new ApiError(500, "Could not save that answer.", saved.error);
  }

  await driftPersonaFromInterviewAnswer(prospect.id).catch((error) =>
    console.error(`[WARN] Persona drift failed for prospect ${prospect.id} (non-fatal):`, error));

  // A curated subset of matchup-pool answers are authored to also fire an immediate headline
  // (a combined tweet already fires automatically at week completion below regardless of this
  // tag, so only "headline" is meaningful here -- "tweet" would be a no-op).
  if (result.contentTrigger === "headline") {
    await postInterviewQuoteHeadlineForAnswer({
      guildId: input.guildId, prospect, teamId, questionText: result.question.question, quoteText: result.option.text,
    }).catch((error) => console.error(`[WARN] Could not post interview quote headline (non-fatal):`, error));
  }

  if (nextSlot >= MEDIA_DAY_SLOTS) {
    const allAnswers = [...(existing.data ?? []), saved.data].sort((a, b) => Number(a.slot) - Number(b.slot));
    await queueMediaDayPlayerTweet({
      leagueId: context.leagueId, season, week, prospect, side: input.side,
      answers: allAnswers, opponentProspect: matchup.opponentProspect,
    }).catch((error) => console.error(`[WARN] Could not queue Media Day tweet (non-fatal):`, error));
    await payMediaDayCompletionCoins({ leagueId: context.leagueId, season, week, prospect, userId })
      .catch((error) => console.error(`[WARN] Could not pay Media Day coins for prospect ${prospect.id} (non-fatal):`, error));
    await queueMediaDayRoundupTweetsIfDue(context.leagueId, league.id, season, week)
      .catch((error) => console.error("[WARN] Could not queue Media Day roundup tweets (non-fatal):", error));
  }

  return { question, answer: saved.data, slot: nextSlot, complete: nextSlot >= MEDIA_DAY_SLOTS };
}

/** Media Day's matchup-interview flow assumes a real scheduled game (opponent, week, bonus
 * claims) -- there's no matchup during preseason/training camp or any offseason stage. This is
 * the parallel single-question-per-advance flow for exactly those stages: one question drawn
 * from stageInterviewPool()'s bucket for the league's current season_stage (see STAGE_TO_GROUP
 * in stage-interview.ts), keyed on (prospect, season, season_stage, advance_index) so re-loading
 * doesn't reshuffle it and a new advance always gets a fresh question. */
export async function getStageInterview(input: { guildId: string; discordId: string; side: "offense" | "defense" }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");

  const season = Number(context.rec_leagues.season_number ?? 1);
  const seasonStage = String(context.rec_leagues.season_stage ?? "");
  if (gameplaySeasonStages(context.rec_leagues.game).has(seasonStage)) {
    throw new ApiError(400, "Stage interviews are only available outside the regular season.");
  }
  const group = stageInterviewGroupFor(seasonStage);
  if (!group) throw new ApiError(400, "No stage interview is available for this season stage yet.");
  const advanceIndex = Number(context.rec_leagues.current_week ?? 1);

  const existing = await supabase.from("rec_immortality_stage_interview_answers")
    .select("*").eq("prospect_id", prospect.id).eq("season", season).eq("season_stage", seasonStage).eq("advance_index", advanceIndex).maybeSingle();
  if (existing.error) throw new ApiError(500, "Could not load this stage's interview.", existing.error);
  const pool = stageInterviewPool();
  if (existing.data) {
    const question = pool.find((q) => q.id === Number(existing.data.question_id)) ?? null;
    return { season, seasonStage, group, complete: true, question, answer: existing.data };
  }

  const question = selectStageInterviewQuestion({
    pool, group,
    seed: `${league.id}:${prospect.id}:${season}:${seasonStage}:${advanceIndex}`,
  });
  if (!question) throw new ApiError(400, "No stage interview is available for this season stage yet.");
  return { season, seasonStage, group, complete: false, question, answer: null };
}

export async function submitStageInterview(input: {
  guildId: string; discordId: string; side: "offense" | "defense"; questionId: number; optionIndex: number;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Save identity first.");

  const season = Number(context.rec_leagues.season_number ?? 1);
  const seasonStage = String(context.rec_leagues.season_stage ?? "");
  if (gameplaySeasonStages(context.rec_leagues.game).has(seasonStage)) {
    throw new ApiError(400, "Stage interviews are only available outside the regular season.");
  }
  const group = stageInterviewGroupFor(seasonStage);
  if (!group) throw new ApiError(400, "No stage interview is available for this season stage yet.");
  const advanceIndex = Number(context.rec_leagues.current_week ?? 1);

  const question = stageInterviewPool().find((q) => q.id === input.questionId);
  if (!question || question.group !== group) throw new ApiError(404, "That question isn't available for this stage.");
  const result = scoreStageInterviewAnswer({ question, optionIndex: input.optionIndex });

  const teamRow = prospect.player_id
    ? await supabase.from("rec_players").select("team_id").eq("id", prospect.player_id).maybeSingle()
    : { data: null };
  const teamId = teamRow.data?.team_id ? String(teamRow.data.team_id) : null;

  const saved = await supabase.from("rec_immortality_stage_interview_answers").insert({
    immortality_league_id: league.id, prospect_id: prospect.id, side: input.side,
    season, season_stage: seasonStage, advance_index: advanceIndex,
    question_id: question.id, option_index: input.optionIndex, dna_points: result.dnaPoints,
  }).select("*").single();
  if (saved.error) {
    if (saved.error.code === "23505") throw new ApiError(409, "This stage's interview is already answered.");
    throw new ApiError(500, "Could not save that answer.", saved.error);
  }

  await driftPersonaFromInterviewAnswer(prospect.id).catch((error) =>
    console.error(`[WARN] Persona drift failed for prospect ${prospect.id} (non-fatal):`, error));

  // Unlike Media Day, nothing fires automatically here -- contentTrigger is the only thing that
  // makes a stage-interview answer public, since there's no weekly-completion tweet to fall back on.
  if (result.contentTrigger === "tweet") {
    await queueStageInterviewTweet({
      leagueId: context.leagueId, season, weekNumber: advanceIndex, prospect,
      questionText: question.question, quoteText: result.option.text,
    }).catch((error) => console.error(`[WARN] Could not queue stage interview tweet (non-fatal):`, error));
  } else if (result.contentTrigger === "headline") {
    await postInterviewQuoteHeadlineForAnswer({
      guildId: input.guildId, prospect, teamId, questionText: question.question, quoteText: result.option.text,
    }).catch((error) => console.error(`[WARN] Could not post interview quote headline (non-fatal):`, error));
  }

  return { question, answer: saved.data, complete: true };
}

/** Weighted-combines the original one-time Persona interview's scores with every Media Day
 * answer's dnaPoints so far this career, and flips the stored primary/secondary/label if the
 * cumulative lean has genuinely shifted -- "if the answers are contrary to the player's current
 * DNA enough over time, their personality changes accordingly." The original interview keeps a
 * strong base weight (x3) so a handful of contrary weekly answers can't flip it overnight; it
 * takes sustained pressure across many weeks, same as a real personality would. */
async function driftPersonaFromInterviewAnswer(prospectId: string): Promise<void> {
  const persona = await supabase.from("rec_immortality_persona_results").select("scores,primary_dimension,secondary_dimension").eq("prospect_id", prospectId).maybeSingle();
  if (!persona.data) return; // no baseline Persona yet -- nothing to drift
  const baseScores = (persona.data.scores ?? emptyPersonaScores()) as PersonaScores;
  const ORIGINAL_INTERVIEW_WEIGHT = 3;
  let cumulative = emptyPersonaScores();
  for (const dimension of Object.keys(cumulative) as Array<keyof PersonaScores>) {
    cumulative[dimension] = baseScores[dimension] * ORIGINAL_INTERVIEW_WEIGHT;
  }
  // The caller always inserts this answer's row before calling here, so a single pass over
  // every interview answer on record already includes the one that just triggered this --
  // adding it a second time on top would double-count it. Sums both interview systems (Media
  // Day matchup interviews + offseason stage interviews) into one career-wide drift, since both
  // represent the same prospect's ongoing personality on the record.
  const [matchupAnswers, stageAnswers] = await Promise.all([
    supabase.from("rec_immortality_matchup_interview_answers").select("dna_points").eq("prospect_id", prospectId),
    supabase.from("rec_immortality_stage_interview_answers").select("dna_points").eq("prospect_id", prospectId),
  ]);
  for (const row of matchupAnswers.data ?? []) cumulative = addPersonaPoints(cumulative, (row.dna_points ?? {}) as Partial<PersonaScores>);
  for (const row of stageAnswers.data ?? []) cumulative = addPersonaPoints(cumulative, (row.dna_points ?? {}) as Partial<PersonaScores>);

  const next = resolvePersona(cumulative);
  if (next.primary === persona.data.primary_dimension && next.secondary === persona.data.secondary_dimension) return;
  await supabase.from("rec_immortality_persona_results").update({
    primary_dimension: next.primary, secondary_dimension: next.secondary, label: next.label,
  }).eq("prospect_id", prospectId);
}

/** Resolves team name + persona dimension and hands off to interview-headline.ts -- shared by
 * both submitWeeklyMatchupInterview and submitStageInterview so the contentTrigger dispatch
 * looks the same regardless of which interview system produced the answer. */
async function postInterviewQuoteHeadlineForAnswer(input: {
  guildId: string; prospect: Record<string, any>; teamId: string | null; questionText: string; quoteText: string;
}): Promise<void> {
  const [team, persona] = await Promise.all([
    input.teamId
      ? supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated").eq("id", input.teamId).maybeSingle()
      : Promise.resolve({ data: null as any }),
    supabase.from("rec_immortality_persona_results").select("primary_dimension").eq("prospect_id", input.prospect.id).maybeSingle(),
  ]);
  await postInterviewQuoteHeadline({
    guildId: input.guildId,
    prospectFirstName: input.prospect.first_name ?? null,
    prospectLastName: input.prospect.last_name ?? null,
    teamName: formatTeamDisplayName(team.data) ?? "the franchise",
    personaDim: (persona.data?.primary_dimension as PersonaDimension | undefined) ?? null,
    questionText: input.questionText,
    quoteText: input.quoteText,
  });
}

/** A prospect's own in-fiction Twitter handle -- their player name, no spaces, "@"-prefixed --
 * per direction that Media Day should read as the player's own tweets, not a third-party
 * headline story. */
function twitterHandleForProspect(prospect: { first_name?: string | null; last_name?: string | null }): { handle: string; displayName: string } {
  const first = (prospect.first_name ?? "").trim();
  const last = (prospect.last_name ?? "").trim();
  const displayName = `${first} ${last}`.trim() || "Prospect";
  const slug = `${first}${last}`.replace(/[^A-Za-z0-9]/g, "") || "Prospect";
  return { handle: `@${slug}`, displayName };
}

const STAGE_INTERVIEW_TWEET_INTROS: Array<(name: string) => string> = [
  (name) => `${name} spoke to reporters this offseason and didn't hold back.`,
  (name) => `${name} was asked about it directly, and answered just as directly.`,
  (name) => `${name} went on the record during a quiet offseason stretch.`,
  (name) => `${name} had something to say when reporters caught up with them.`,
];

/** A single-answer version of queueMediaDayPlayerTweet for the stage-interview flow -- no
 * opponent to tag (there's no matchup during an offseason stage), and no combined multi-slot
 * quote since stage interviews are one question per advance, not three per week. */
async function queueStageInterviewTweet(input: {
  leagueId: string; season: number; weekNumber: number; prospect: Record<string, any>; questionText: string; quoteText: string;
}): Promise<void> {
  const { handle, displayName } = twitterHandleForProspect(input.prospect);
  const intro = STAGE_INTERVIEW_TWEET_INTROS[Math.floor(Math.random() * STAGE_INTERVIEW_TWEET_INTROS.length)]!(displayName);
  const body = `${intro} On "${input.questionText}" — "${input.quoteText}"`.replace(/\s+/g, " ").trim();
  await supabase.from("rec_immortality_tweet_queue").insert({
    league_id: input.leagueId, season_number: input.season, week_number: input.weekNumber,
    author_kind: "player", author_handle: handle, author_display_name: displayName,
    body, status: "pending", source: "stage_interview",
  });
}

const MEDIA_DAY_TWEET_INTROS: Array<(name: string) => string> = [
  (name) => `${name} held nothing back at Media Day this week.`,
  (name) => `${name} sat down for Media Day and let it fly.`,
  (name) => `${name} didn't dodge a single question at Media Day.`,
  (name) => `Media Day round with ${name} — a few things stood out.`,
  (name) => `${name} went on the record at Media Day this week.`,
  (name) => `${name} showed up to Media Day with plenty to say.`,
];

const MEDIA_DAY_TWEET_CLOSERS: Array<(team: string) => string> = [
  (team) => `${team} will find out soon enough if the words match the tape.`,
  (team) => `Now it's on ${team} to back it up on the field.`,
  () => `Kickoff will have the final say.`,
  (team) => `${team}'s week starts now.`,
  () => `We'll see how it holds up after Sunday.`,
  (team) => `Big talk ahead of a big week for ${team}.`,
];

/** Queues ONE combined tweet for a prospect once all 3 of a week's Media Day slots are answered
 * -- per direction, this replaced the earlier per-answer headline story (which fired up to 3
 * separate @everyone posts per player per week) with a single bulk post in the player's own
 * voice, formatted like the rest of the tweet feed. */
async function queueMediaDayPlayerTweet(input: {
  leagueId: string; season: number; week: number;
  prospect: Record<string, any>; side: "offense" | "defense";
  answers: Array<{ rendered_question: unknown; option_index: number }>;
  opponentProspect: { first_name: string | null; last_name: string | null } | null;
}): Promise<void> {
  const teamRow = input.prospect.player_id
    ? await supabase.from("rec_players").select("team_id").eq("id", input.prospect.player_id).maybeSingle()
    : { data: null };
  const team = teamRow.data?.team_id
    ? await supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated").eq("id", teamRow.data.team_id).maybeSingle()
    : { data: null };
  const teamName = formatTeamDisplayName(team.data) ?? "the franchise";
  const { handle, displayName } = twitterHandleForProspect(input.prospect);

  const quotes = input.answers.map((row) => {
    const question = row.rendered_question as { question: string; options: Array<{ text: string }> };
    return { question: question.question, answer: question.options[row.option_index]?.text ?? "" };
  }).filter((q) => q.answer);
  if (!quotes.length) return;

  const highlighted = quotes.length > 1 ? [quotes[0]!, quotes[quotes.length - 1]!] : quotes;
  const quoteLines = highlighted.map((q) => `On "${q.question}" — "${q.answer}"`).join(" ");
  const intro = MEDIA_DAY_TWEET_INTROS[Math.floor(Math.random() * MEDIA_DAY_TWEET_INTROS.length)]!(displayName);
  const closer = MEDIA_DAY_TWEET_CLOSERS[Math.floor(Math.random() * MEDIA_DAY_TWEET_CLOSERS.length)]!(teamName);
  const opponentLine = input.opponentProspect
    ? ` ${twitterHandleForProspect(input.opponentProspect).handle} is up next.`
    : "";

  const body = `${intro} ${quoteLines} ${closer}${opponentLine}`.replace(/\s+/g, " ").trim();

  await supabase.from("rec_immortality_tweet_queue").insert({
    league_id: input.leagueId, season_number: input.season, week_number: input.week,
    author_kind: "player", author_handle: handle, author_display_name: displayName,
    body, status: "pending", source: "media_day",
  });

  // A fan/hater account sometimes reacts to the loudest of the 3 answers -- gives the statement
  // somewhere to actually land in the feed instead of just sitting there as its own isolated post.
  if (Math.random() < 0.45) {
    const loudest = highlighted[highlighted.length - 1]!;
    const reactionBody = MEDIA_DAY_REACTION_TEMPLATES[Math.floor(Math.random() * MEDIA_DAY_REACTION_TEMPLATES.length)]!(displayName, loudest.answer);
    const { GENERIC_HANDLES } = await import("./tweet-bank.js");
    const seed = [...String(input.prospect.id ?? displayName)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const reactor = GENERIC_HANDLES[(seed + input.week) % GENERIC_HANDLES.length]!;
    await supabase.from("rec_immortality_tweet_queue").insert({
      league_id: input.leagueId, season_number: input.season, week_number: input.week,
      author_kind: "generic", author_handle: reactor.handle, author_display_name: reactor.displayName,
      body: reactionBody, status: "pending", source: "media_reaction",
    });
  }
}

const MEDIA_DAY_REACTION_TEMPLATES: Array<(name: string, quote: string) => string> = [
  (name, quote) => `${name} said "${quote}" at Media Day and the group chat has NOT stopped talking about it.`,
  (name, quote) => `not ${name} saying "${quote}" like it's nothing 💀`,
  (name, quote) => `${name}'s Media Day answer -- "${quote}" -- is getting replayed all week.`,
  (name, quote) => `somebody screenshot ${name} saying "${quote}" before he tries to walk it back.`,
  (name, quote) => `${name} really went on the record with "${quote}". respect the confidence.`,
  (name, quote) => `"${quote}" -- ${name} said that with his whole chest at Media Day. bold.`,
  (name, quote) => `${name} didn't have to say "${quote}" but he did anyway. love that for him.`,
];

async function payMediaDayCompletionCoins(input: {
  leagueId: string; season: number; week: number; prospect: Record<string, any>; userId: string;
}): Promise<void> {
  const { creditOrBacklog } = await import("../economy/economy-backlog.js");
  await creditOrBacklog({
    leagueId: input.leagueId,
    seasonNumber: input.season,
    userId: input.userId,
    amount: RISE_TO_IMMORTALITY_MEDIA_DAY_PAYOUT,
    description: `Rise to Immortality Media Day — Week ${input.week} interview completed`,
    transactionType: "immortality_media_day_payout",
    source: "media_day",
    sourceReference: { prospectId: input.prospect.id, week: input.week, season: input.season },
  });
}

/** Commissioner Tools' "Grant Bonus" action (RTI leagues only) -- a manual REC Coin award for a
 * member's participation in extra opportunities, not tied to any specific in-game event. Requires
 * the target to already be linked to an active team in this league (same standing every other
 * Commish Tools action assumes), and DMs them the award so it isn't a silent wallet change. */
export async function grantImmortalityCommissionerBonus(input: {
  guildId: string; targetDiscordId: string;
}): Promise<{ granted: true; teamName: string }> {
  const context = await getCurrentLeagueContext(input.guildId);
  await requireImmortalityLeague(context.leagueId);

  let targetUserId: string;
  try {
    targetUserId = await recUserIdFromDiscordId(input.targetDiscordId);
  } catch {
    throw new ApiError(400, "That member hasn't linked their REC profile yet.");
  }

  const assignment = await supabase.from("rec_team_assignments").select("team_id")
    .eq("league_id", context.leagueId).eq("user_id", targetUserId)
    .eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment.data?.team_id) throw new ApiError(400, "That member isn't linked to a team in this league.");

  const team = await supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated")
    .eq("id", assignment.data.team_id).maybeSingle();
  const teamName = formatTeamDisplayName(team.data) ?? "your team";

  const { creditOrBacklog } = await import("../economy/economy-backlog.js");
  await creditOrBacklog({
    leagueId: context.leagueId,
    seasonNumber: Number(context.rec_leagues.season_number ?? 1),
    userId: targetUserId,
    amount: RISE_TO_IMMORTALITY_COMMISSIONER_BONUS_AMOUNT,
    description: `Rise to Immortality — Commissioner bonus for ${teamName}`,
    transactionType: "immortality_commissioner_bonus",
    source: "commissioner_bonus",
    sourceReference: { targetUserId, grantedAt: new Date().toISOString() },
  });

  await sendDiscordDirectMessage(
    input.targetDiscordId,
    `You've been awarded a **${RISE_TO_IMMORTALITY_COMMISSIONER_BONUS_AMOUNT} REC Coin** bonus for ${teamName} by your league commissioner — thanks for going the extra mile!`,
  ).catch((err) => console.error(`[WARN] Could not DM commissioner bonus recipient ${input.targetDiscordId} (non-fatal):`, err));

  return { granted: true, teamName };
}

const MEDIA_DAY_ROUNDUP_HANDLE_OFFSETS = [3, 11];

/** Fires 1-2 generic roundup tweets once a meaningful chunk of the league's Media Day
 * interviews are in for the week -- capped at 2/week via the two fixed thresholds below,
 * each individually idempotent (checked against what's already queued/posted this week). */
// Idempotency key for these rows is the fixed body prefix below (same pattern
// ensureSignedContractAnnouncement uses its generated headline for) -- no dedicated "kind"
// column on rec_immortality_tweet_queue to filter on otherwise.
const MEDIA_DAY_ROUNDUP_BODY_PREFIX = "Media Day is in full swing";

async function queueMediaDayRoundupTweetsIfDue(recLeagueId: string, immortalityLeagueId: string, season: number, week: number): Promise<void> {
  const completedCount = await supabase.from("rec_immortality_matchup_interview_answers")
    .select("prospect_id", { count: "exact", head: true }).eq("immortality_league_id", immortalityLeagueId).eq("week_number", week).eq("slot", MEDIA_DAY_SLOTS);
  const totalProspects = await supabase.from("rec_immortality_prospects").select("id", { count: "exact", head: true }).eq("immortality_league_id", immortalityLeagueId);
  const completed = completedCount.count ?? 0;
  const total = totalProspects.count ?? 0;
  if (total <= 0) return;
  const pct = completed / total;

  // The query builder here doesn't support LIKE -- this league/week slice is always small, so
  // filtering the prefix match in JS after fetching is simpler than adding LIKE support for one
  // caller.
  const queuedThisWeek = await supabase.from("rec_immortality_tweet_queue")
    .select("body").eq("league_id", recLeagueId).eq("week_number", week).in("status", ["pending", "posted"]);
  const alreadyQueuedCount = (queuedThisWeek.data ?? []).filter((row: any) => String(row.body ?? "").startsWith(MEDIA_DAY_ROUNDUP_BODY_PREFIX)).length;

  const thresholds = [0.33, 0.75];
  const dueCount = thresholds.filter((t) => pct >= t).length;
  const toQueue = Math.max(0, Math.min(dueCount, MEDIA_DAY_ROUNDUP_HANDLE_OFFSETS.length) - alreadyQueuedCount);
  if (toQueue <= 0) return;

  const { GENERIC_HANDLES } = await import("./tweet-bank.js");
  const rows = MEDIA_DAY_ROUNDUP_HANDLE_OFFSETS.slice(alreadyQueuedCount, alreadyQueuedCount + toQueue).map((offset) => {
    const handle = GENERIC_HANDLES[offset % GENERIC_HANDLES.length]!;
    return {
      league_id: recLeagueId, season_number: season, week_number: week,
      author_kind: "generic" as const, author_handle: handle.handle, author_display_name: handle.displayName,
      body: `Media Day is in full swing around the league this week — ${completed} of ${total} interviews on the record so far.`,
      status: "pending" as const,
      source: "media_day_roundup",
    };
  });
  if (rows.length) await supabase.from("rec_immortality_tweet_queue").insert(rows);
}

/** Called once a specific game's real EA-imported stats are in (see the post-import hook points
 * in ea-connections.service.ts / madden-ea.routes.ts). Resolves every still-pending Media Day
 * bonus claim tied to that game: awards the flagged Player XP bonus if the claim held up,
 * otherwise fires a "backfired" tweet -- and either way marks it resolved so it's never
 * re-evaluated. No-ops instantly if nothing's pending for this game. */
/** League-wide sweep -- call from the EA-import completion hooks (ea-connections.service.ts /
 * madden-ea.routes.ts) alongside the other post-import RTI steps. Finds every game a pending
 * Media Day claim is still waiting on and resolves each; cheap no-op when nothing's pending. */
export async function resolvePendingMediaDayClaimsForLeague(leagueId: string): Promise<void> {
  const immortalityLeague = await loadImmortalityLeague(leagueId);
  if (!immortalityLeague) return;
  const pending = await supabase.from("rec_immortality_matchup_interview_answers")
    .select("game_id").eq("immortality_league_id", immortalityLeague.id).eq("bonus_status", "pending").not("game_id", "is", null);
  if (pending.error || !pending.data?.length) return;
  const gameIds: string[] = [...new Set((pending.data as Array<{ game_id: string }>).map((row) => String(row.game_id)))];
  for (const gameId of gameIds) {
    await resolvePendingMediaDayClaimsForGame(gameId).catch((error) =>
      console.error(`[ERROR] Failed to resolve Media Day claims for game ${gameId} (non-fatal):`, error));
  }
}

export async function resolvePendingMediaDayClaimsForGame(gameId: string): Promise<void> {
  const pending = await supabase.from("rec_immortality_matchup_interview_answers")
    .select("id,prospect_id,immortality_league_id,side,season,week_number,bonus_stat_category_hint,bonus_xp_pct,rendered_question,option_index")
    .eq("game_id", gameId).eq("bonus_status", "pending");
  if (pending.error || !pending.data?.length) return;

  const game = await supabase.from("rec_games").select("league_id,home_team_id,away_team_id,home_score,away_score,status").eq("id", gameId).maybeSingle();
  if (!game.data || game.data.status !== "final" || game.data.home_score == null || game.data.away_score == null) return;

  for (const row of pending.data as any[]) {
    try {
      const prospect = await supabase.from("rec_immortality_prospects").select("id,user_id,position,player_id,first_name,last_name").eq("id", row.prospect_id).maybeSingle();
      if (!prospect.data?.player_id) continue;
      const player = await supabase.from("rec_players").select("team_id").eq("id", prospect.data.player_id).maybeSingle();
      const teamId = player.data?.team_id ? String(player.data.team_id) : null;
      const iAmHome = teamId && String(game.data.home_team_id) === teamId;
      const won = teamId ? (iAmHome ? game.data.home_score > game.data.away_score : game.data.away_score > game.data.home_score) : false;
      const marginAbs = Math.abs(Number(game.data.home_score) - Number(game.data.away_score));

      const weekStats = await supabase.from("rec_player_weekly_stats").select("stats")
        .eq("league_id", game.data.league_id).eq("player_id", prospect.data.player_id).eq("week_number", row.week_number).eq("season_number", row.season).maybeSingle();
      const stats = (weekStats.data?.stats ?? {}) as Record<string, number>;
      const challenges = issuedWeeklyChallenges({ position: String(prospect.data.position ?? ""), seed: `${row.prospect_id}:${row.week_number}`, stats });
      const hadGoldWeek = challenges.some((c) => c.tier === "gold" && c.complete);

      const outcome = evaluateMatchupInterviewClaim({ hint: String(row.bonus_stat_category_hint), won, marginAbs, hadGoldWeek });
      await supabase.from("rec_immortality_matchup_interview_answers").update({
        bonus_status: outcome, resolved_at: new Date().toISOString(),
      }).eq("id", row.id);

      if (outcome === "met") {
        const traits = await supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.data.id);
        const group = positionGroupFor(String(prospect.data.position ?? "") as ImmortalityPosition);
        const catalog = characteristicCatalog(group);
        const selected = catalog.filter((item) => (traits.data ?? []).some((t) => t.characteristic_key === item.key));
        const modifiers = combinedModifiers(selected);
        const points = Math.round(XP_POINTS_PER_LEVEL * (Number(row.bonus_xp_pct ?? 0) / 100));
        if (points > 0) {
          const { creditXpPoints } = await import("./xp-awards.service.js");
          await creditXpPoints({ prospectId: row.prospect_id, eventType: "media_day_bonus", sourceId: row.id, points, season: row.season, week: row.week_number, modifiers });
        }
      } else {
        const question = row.rendered_question as { question?: string; options?: Array<{ text: string }> } | null;
        const answerText = question?.options?.[row.option_index]?.text ?? question?.question ?? "their pregame claim";
        const name = `${prospect.data.first_name ?? ""} ${prospect.data.last_name ?? ""}`.trim() || "The player";
        const { GENERIC_HANDLES } = await import("./tweet-bank.js");
        const handle = GENERIC_HANDLES[Math.abs(row.id.charCodeAt(0) + row.id.charCodeAt(row.id.length - 1)) % GENERIC_HANDLES.length]!;
        await supabase.from("rec_immortality_tweet_queue").insert({
          league_id: game.data.league_id, season_number: row.season, week_number: row.week_number,
          author_kind: "generic", author_handle: handle.handle, author_display_name: handle.displayName,
          body: `Well... ${name} said "${answerText}" before this one. Didn't age well.`,
          status: "pending",
          source: "media_day_backfire",
        });
      }
    } catch (error) {
      console.error(`[ERROR] Failed to resolve Media Day claim ${row.id} (non-fatal):`, error);
    }
  }
}

export async function creditXpEvent(input: {
  prospectId: string;
  eventType: string;
  sourceId: string;
  playerXp: number;
  season?: number;
  week?: number;
}) {
  const inserted = await supabase.from("rec_immortality_xp_ledger").insert({
    prospect_id: input.prospectId,
    season: input.season ?? null,
    week: input.week ?? null,
    event_type: input.eventType,
    source_id: input.sourceId,
    player_xp_delta: input.playerXp,
    team_xp_delta: 0,
    formula_version: FORMULA_VERSIONS.xp,
  }).select("*").maybeSingle();
  if (inserted.error) {
    if (inserted.error.code === "23505") return { duplicate: true };
    throw new ApiError(500, "Could not record XP.", inserted.error);
  }
  return { duplicate: false, row: inserted.data };
}

async function syncProspectAbilitiesToPlayer(prospect: { id: string; player_id?: string | null }) {
  if (!prospect.player_id) return;
  const equipped = await supabase.from("rec_immortality_prospect_abilities").select("ability_id,ability_name,kind").eq("prospect_id", prospect.id);
  const payload = (equipped.data ?? []).map((row) => {
    const ability = abilityById(String(row.ability_id));
    return {
      name: String(row.ability_name),
      description: ability?.description ?? "",
      type: String(row.kind),
    };
  });
  await supabase.from("rec_players").update({
    abilities: payload,
    updated_at: new Date().toISOString(),
  }).eq("id", prospect.player_id);
}

export async function selectImmortalityAbility(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  abilityId: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Prospect not found.");
  const ability = abilityById(input.abilityId);
  if (!ability) throw new ApiError(404, "Unknown Madden 27 ability.");
  const [player, playstyle, branchingPlaystyle, equipped, grants] = await Promise.all([
    prospect.player_id ? supabase.from("rec_players").select("overall_rating").eq("id", prospect.player_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("rec_immortality_playstyle_results").select("primary_archetype,secondary_archetype").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_branching_playstyle_results").select("primary_archetype,secondary_archetype").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_prospect_abilities").select("ability_id").eq("prospect_id", prospect.id),
    supabase.from("rec_immortality_ability_grants").select("slots").eq("prospect_id", prospect.id),
  ]);
  // Real OVR from the latest EA roster import, not a Creation Points estimate -- nothing
  // OVR-gated is selectable until this prospect's franchise is live and has actually imported.
  const estimatedOvr = Number(player.data?.overall_rating ?? 0);
  const archetypes = playerArchetypes(
    branchingPlaystyle.data?.primary_archetype ? String(branchingPlaystyle.data.primary_archetype) : playstyle.data ? String(playstyle.data.primary_archetype) : null,
    branchingPlaystyle.data?.secondary_archetype ? String(branchingPlaystyle.data.secondary_archetype) : playstyle.data?.secondary_archetype ? String(playstyle.data.secondary_archetype) : null,
  );
  const earnedSlots = Math.min(MAX_EQUIPPED_ABILITIES, (grants.data ?? []).reduce((sum, row) => sum + Number(row.slots ?? 0), 0));
  if ((equipped.data ?? []).length >= earnedSlots) {
    throw new ApiError(400, earnedSlots ? "All earned ability slots are already filled." : "Earn an ability slot before assigning an ability.");
  }
  const check = canSelectAbility({
    ability,
    position: prospect.position as ImmortalityPosition,
    archetypes,
    estimatedOvr,
    equippedCount: (equipped.data ?? []).length,
    alreadyEquipped: (equipped.data ?? []).some((row) => String(row.ability_id) === ability.id),
  });
  if (!check.ok) throw new ApiError(400, check.error);
  const saved = await supabase.from("rec_immortality_prospect_abilities").insert({
    prospect_id: prospect.id,
    ability_id: ability.id,
    ability_name: ability.name,
    kind: ability.kind,
  }).select("*").single();
  if (saved.error) throw new ApiError(500, "Could not equip that ability.", saved.error);
  await syncProspectAbilitiesToPlayer(prospect);
  return { equipped: saved.data, gate: check.gate };
}

export async function removeImmortalityAbility(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  abilityId: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Prospect not found.");
  const removed = await supabase.from("rec_immortality_prospect_abilities")
    .delete()
    .eq("prospect_id", prospect.id)
    .eq("ability_id", input.abilityId);
  if (removed.error) throw new ApiError(500, "Could not remove that ability.", removed.error);
  await syncProspectAbilitiesToPlayer(prospect);
  return { ok: true };
}

/** The actual Team XP conversion, only ever run once a commissioner approves the pending
 * request -- see reviewImmortalityXpRequest. Re-derives everything from fresh data rather than
 * trusting whatever was true at request time, since approval can land well after submission. */
async function applyXpConversion(prospect: Record<string, any>, playerXp: number) {
  const traits = await supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.id);
  const catalog = characteristicCatalog(positionGroupFor(prospect.position as ImmortalityPosition));
  const selected = catalog.filter((item) => (traits.data ?? []).some((row) => row.characteristic_key === item.key));
  const modifiers = combinedModifiers(selected);
  if (!prospect.player_id) throw new ApiError(400, "Team XP unlocks once this player is on a roster with real game data imported.");
  const player = await supabase.from("rec_players").select("overall_rating").eq("id", prospect.player_id).maybeSingle();
  if (player.data?.overall_rating == null) throw new ApiError(400, "Team XP unlocks once this player's first real game data is imported.");
  const currentOvr = Number(player.data.overall_rating);
  const allowed = canConvertToTeamXp({ currentOvr, devTrait: startingDevTrait(modifiers), teamPlayer: modifiers.teamXpFromSeason1 });
  if (!allowed) throw new ApiError(400, "Team XP unlocks after this player reaches his current development ceiling.");
  const converted = convertPlayerXpToTeamXp(playerXp);
  if ("error" in converted) throw new ApiError(400, converted.error);
  const sourceId = `convert:${prospect.id}:${Date.now()}`;
  const spent = await supabase.rpc("rec_immortality_spend_xp", {
    p_prospect_id: prospect.id,
    p_event_type: "team_xp_conversion",
    p_source_id: sourceId,
    p_player_xp_delta: -converted.playerSpent,
    p_team_xp_delta: converted.teamGained,
    p_formula_version: FORMULA_VERSIONS.xp,
  });
  if (spent.error) throw new ApiError(500, "Could not convert Player XP.", spent.error);
  if (!spent.data) throw new ApiError(400, "Not enough Player XP to convert.");
  return converted;
}

/** Submits a Team XP conversion request for commissioner review -- mirrors how every other
 * league's coin-store purchases go into rec_commissioners_inbox pending, rather than applying
 * immediately. Light structural validation only (materialized, dev ceiling reached); XP-balance
 * sufficiency is re-checked for real at approval time in applyXpConversion. */
export async function convertXp(input: { guildId: string; discordId: string; side: "offense" | "defense"; playerXp: number }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Prospect not found.");
  if (!Number.isFinite(input.playerXp) || input.playerXp <= 0) throw new ApiError(400, "Enter a positive amount of Player XP to convert.");
  if (!prospect.player_id) throw new ApiError(400, "Team XP unlocks once this player is on a roster with real game data imported.");

  const discordId = await discordIdForRecUser(userId).catch(() => null);
  const name = `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Unnamed Prospect";
  const inboxInsert = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId, league_id: context.leagueId, queue_type: "immortality_xp_conversion",
    status: "pending", priority: 0,
    header: `Team XP Conversion: ${name} (${prospect.position})`,
    summary: `Requesting to convert ${input.playerXp} Player XP into Team XP.`,
    requester_user_id: userId, requester_discord_id: discordId,
    source_table: "rec_immortality_prospects", source_id: prospect.id,
    payload: { prospectId: prospect.id, side: prospect.side, name, position: prospect.position, playerXp: input.playerXp },
  }).select("id").single();
  if (inboxInsert.error) throw new ApiError(500, "Could not submit that conversion for review.", inboxInsert.error);
  await notifyLeagueCommissionersOfPendingItem(context.leagueId);
  return { status: "pending_review" as const, requestId: inboxInsert.data.id };
}

/** The actual Player XP attribute spend, only ever run once a commissioner approves the pending
 * request -- see reviewImmortalityXpRequest. Re-derives everything from fresh data rather than
 * trusting whatever was true at request time. */
async function applyPlayerXpSpend(prospect: Record<string, any>, attributeCode: string) {
  const code = attributeCode.toUpperCase();
  const rosterKey = MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY[code as keyof typeof MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY];
  if (!rosterKey) throw new ApiError(400, "Unknown attribute.");
  if (!prospect.player_id) throw new ApiError(400, "Player XP unlocks once this player is on a roster with real game data imported.");
  const [traits, build, ledger, player] = await Promise.all([
    supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.id),
    supabase.from("rec_immortality_creation_builds").select("final_attributes").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_xp_ledger").select("player_xp_delta,team_xp_delta").eq("prospect_id", prospect.id),
    supabase.from("rec_players").select("attributes,overall_rating").eq("id", prospect.player_id).maybeSingle(),
  ]);
  if (!build.data) throw new ApiError(400, "Finish Creation Points before spending Player XP.");
  // Real OVR from the latest EA import, not a Creation Points estimate. No import yet means no
  // dev-trait ceiling to check against -- Player XP spend has to wait for real game data.
  if (player.data?.overall_rating == null) throw new ApiError(400, "Player XP unlocks once this player's first real game data is imported.");
  const currentOvr = Number(player.data.overall_rating);
  const catalog = characteristicCatalog(positionGroupFor(prospect.position as ImmortalityPosition));
  const selected = catalog.filter((item) => (traits.data ?? []).some((row) => row.characteristic_key === item.key));
  const modifiers = combinedModifiers(selected);
  const attributes = { ...((build.data.final_attributes ?? {}) as Record<string, number>) };
  const currentValue = Number(attributes[code] ?? 0);
  const available = ledgerXpBalance(ledger.data ?? []).playerXp;
  const result = spendAttributePlusOne({
    currentValue,
    discount: modifiers.xpDiscounts[code] ?? 0,
    currentOvr,
    ceiling: DEV_OVR_CEILING[startingDevTrait(modifiers)],
    availableXp: available,
  });
  if (!result.ok) throw new ApiError(400, result.error);
  attributes[code] = result.nextValue;
  const sourceId = `attr:${code}:${currentValue}`;
  const inserted = await supabase.rpc("rec_immortality_spend_xp", {
    p_prospect_id: prospect.id,
    p_event_type: "attribute_upgrade",
    p_source_id: sourceId,
    p_player_xp_delta: -result.cost,
    p_team_xp_delta: 0,
    p_formula_version: FORMULA_VERSIONS.xp,
  });
  if (inserted.error?.code === "23505") throw new ApiError(409, "That upgrade was already applied.");
  if (inserted.error) throw new ApiError(500, "Could not spend Player XP.", inserted.error);
  if (!inserted.data) throw new ApiError(400, "Not enough Player XP for that upgrade.");
  await supabase.from("rec_immortality_creation_builds").update({
    final_attributes: attributes,
    updated_at: new Date().toISOString(),
  }).eq("prospect_id", prospect.id);
  // Only the purchased attribute changes here -- overall_rating is never written from our side;
  // it only ever comes from the next real EA roster import reading this player's true in-game rating.
  const nextAttrs = { ...((player.data?.attributes ?? {}) as Record<string, unknown>), [rosterKey]: result.nextValue };
  await supabase.from("rec_players").update({ attributes: nextAttrs, updated_at: new Date().toISOString() }).eq("id", prospect.player_id);
  return { attributeCode: code, nextValue: result.nextValue, cost: result.cost, currentOvr, playerXp: available - result.cost };
}

/** Submits a Player XP attribute-upgrade request for commissioner review -- mirrors how every
 * other league's coin-store purchases go into rec_commissioners_inbox pending, rather than
 * applying immediately. Light structural validation only; XP-balance/OVR-ceiling sufficiency is
 * re-checked for real at approval time in applyPlayerXpSpend. */
export async function spendPlayerXp(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  attributeCode: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Prospect not found.");
  const code = input.attributeCode.toUpperCase();
  const rosterKey = MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY[code as keyof typeof MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY];
  if (!rosterKey) throw new ApiError(400, "Unknown attribute.");
  if (!prospect.player_id) throw new ApiError(400, "Player XP unlocks once this player is on a roster with real game data imported.");

  const discordId = await discordIdForRecUser(userId).catch(() => null);
  const name = `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Unnamed Prospect";
  const attrName = MADDEN_ATTRIBUTE_BY_CODE.get(code as MaddenAttributeCode)?.name ?? code;
  const inboxInsert = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId, league_id: context.leagueId, queue_type: "immortality_xp_spend",
    status: "pending", priority: 0,
    header: `Player XP Spend: ${name} (${prospect.position}) — ${attrName}`,
    summary: `Requesting a +1 Player XP upgrade to ${attrName} (${code}).`,
    requester_user_id: userId, requester_discord_id: discordId,
    source_table: "rec_immortality_prospects", source_id: prospect.id,
    payload: { prospectId: prospect.id, side: prospect.side, name, position: prospect.position, attributeCode: code, attributeName: attrName },
  }).select("id").single();
  if (inboxInsert.error) throw new ApiError(500, "Could not submit that upgrade for review.", inboxInsert.error);
  await notifyLeagueCommissionersOfPendingItem(context.leagueId);
  return { status: "pending_review" as const, requestId: inboxInsert.data.id };
}

/** Approve/reject a pending Player XP spend or Team XP conversion request. Approving actually
 * runs the spend/conversion now (re-validated against current state, see
 * applyPlayerXpSpend/applyXpConversion) -- if it fails (e.g. the balance no longer covers it),
 * the request is left pending so the commissioner can see why and follow up, rather than being
 * silently marked approved with no effect. */
export async function reviewImmortalityXpRequest(input: {
  guildId: string; requestId: string; action: "approve" | "reject"; reviewerDiscordId: string; note?: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const request = await supabase.from("rec_commissioners_inbox").select("*").eq("id", input.requestId).eq("league_id", context.leagueId).maybeSingle();
  if (request.error || !request.data) throw new ApiError(404, "Request not found in this league.");
  if (!["immortality_xp_spend", "immortality_xp_conversion"].includes(String(request.data.queue_type))) throw new ApiError(400, "That request isn't an XP purchase.");
  if (request.data.status !== "pending") throw new ApiError(409, `Request is already ${request.data.status}.`);
  if (input.action === "reject" && !input.note?.trim()) throw new ApiError(400, "A rejection reason is required.");

  const payload = (request.data.payload ?? {}) as Record<string, any>;
  let result: unknown = null;
  if (input.action === "approve") {
    const prospect = await supabase.from("rec_immortality_prospects").select("*").eq("id", payload.prospectId).eq("immortality_league_id", league.id).maybeSingle();
    if (!prospect.data) throw new ApiError(404, "This prospect no longer exists.");
    result = request.data.queue_type === "immortality_xp_spend"
      ? await applyPlayerXpSpend(prospect.data, String(payload.attributeCode))
      : await applyXpConversion(prospect.data, Number(payload.playerXp));
  }

  const updated = await supabase.from("rec_commissioners_inbox").update({
    status: input.action === "approve" ? "approved" : "denied",
    reviewed_by_discord_id: input.reviewerDiscordId, reviewed_at: new Date().toISOString(),
    review_reason: input.note?.trim() ?? null,
  }).eq("id", input.requestId).select("*").single();
  if (updated.error) throw new ApiError(500, "Could not save that review decision.", updated.error);
  return { request: updated.data, result };
}

export type ImmortalityCustomTeamSlot = LeagueTeamIdentityOverride;

export async function applyImmortalityCustomTeamSlots(leagueId: string, slots: ImmortalityCustomTeamSlot[]) {
  const result = await applyLeagueTeamIdentityOverrides(leagueId, slots);
  if (result.updated) await supabase.from("rec_immortality_leagues").update({
    team_pool: "custom_32",
    updated_at: new Date().toISOString(),
  }).eq("league_id", leagueId);
  return result;
}

export async function installImmortalityCustomTeams(input: {
  guildId: string;
  discordId: string;
  slots: ImmortalityCustomTeamSlot[];
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const result = await applyImmortalityCustomTeamSlots(context.leagueId, input.slots);
  await supabase.from("rec_immortality_audit_log").insert({
    immortality_league_id: league.id,
    actor_user_id: userId,
    event_type: "custom_teams_installed",
    payload: { count: result.updated },
  });
  return result;
}

export async function castHallVote(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  nomineeProspectId: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  if (league.chapter_state !== "IMMORTALITY_VOTING") throw new ApiError(400, "Hall voting is not open.");
  const userId = await recUserIdFromDiscordId(input.discordId);
  const nominee = await supabase.from("rec_immortality_prospects").select("id,user_id,side")
    .eq("id", input.nomineeProspectId)
    .eq("immortality_league_id", league.id)
    .maybeSingle();
  if (!nominee.data) throw new ApiError(404, "Nominee not found.");
  if (rejectSelfVote(userId, String(nominee.data.user_id))) {
    throw new ApiError(400, "You cannot vote for your own player.");
  }
  if (nominee.data.side !== input.side) throw new ApiError(400, "Vote on the matching side.");
  const saved = await supabase.from("rec_immortality_hof_votes").upsert({
    immortality_league_id: league.id,
    voter_user_id: userId,
    side: input.side,
    nominee_prospect_id: input.nomineeProspectId,
  }, { onConflict: "immortality_league_id,voter_user_id,side" }).select("*").single();
  if (saved.error) throw new ApiError(500, "Could not save that vote.", saved.error);
  return { ok: true };
}

export async function transitionImmortalityState(input: {
  guildId: string;
  discordId: string;
  toState: ImmortalityState;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const from = league.chapter_state as ImmortalityState;
  if (!canTransition(from, input.toState)) {
    throw new ApiError(400, `Cannot move from ${from} to ${input.toState}.`);
  }
  const userId = await recUserIdFromDiscordId(input.discordId);
  const updated = await supabase.from("rec_immortality_leagues").update({
    chapter_state: input.toState,
    updated_at: new Date().toISOString(),
  }).eq("id", league.id).select("*").single();
  if (updated.error) throw new ApiError(500, "Could not update league state.", updated.error);
  await supabase.from("rec_immortality_state_history").insert({
    immortality_league_id: league.id,
    from_state: from,
    to_state: input.toState,
    actor_user_id: userId,
  });
  return { league: updated.data, chapter: chapterForState(input.toState) };
}

// States chooseImmortalityTeam / finalizePreassignedImmortalityOwner used to auto-jump a league
// PAST while other members could still be mid-Origins (that auto-advance has been removed --
// see both functions' comments). Bot-only emergency repair for any league still stuck in one of
// these from before the fix. Deliberately bypasses canTransition (this is a backward repair, not
// a normal forward move) but refuses once TEAM_DRAFT or later has actually started, since
// reopening Origins after real franchise activity began would be destructive, not a repair.
const PREMATURELY_ADVANCED_STATES: ImmortalityState[] = [
  "REGISTRATION", "ORIGINS_COMPLETE", "ROOKIE_DRAFT_PREP", "ROOKIE_DRAFT_LIVE", "ROOKIE_DRAFT_COMPLETE",
];

export async function reopenImmortalityOriginsIfPrematurelyAdvanced(guildId: string): Promise<{ reverted: boolean; fromState: ImmortalityState }> {
  const context = await getCurrentLeagueContext(guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const fromState = league.chapter_state as ImmortalityState;
  if (!PREMATURELY_ADVANCED_STATES.includes(fromState)) return { reverted: false, fromState };

  const updated = await supabase.from("rec_immortality_leagues").update({
    chapter_state: "ORIGINS", updated_at: new Date().toISOString(),
  }).eq("id", league.id).eq("chapter_state", fromState).select("id").maybeSingle();
  if (updated.error) throw new ApiError(500, "Could not reopen Origins.", updated.error);
  if (updated.data) {
    await supabase.from("rec_immortality_state_history").insert({
      immortality_league_id: league.id, from_state: fromState, to_state: "ORIGINS",
      note: "Emergency repair: reverted an incorrect league-wide auto-advance that had closed Origins while members were still mid-creation",
    });
  }
  return { reverted: Boolean(updated.data), fromState };
}

export function publicCharacteristicCatalog() {
  return allCharacteristicCatalogs().map(({ key, displayName, positionGroup, slotCost, effect, tags }) => ({
    key, displayName, positionGroup, slotCost, effect, tags,
  }));
}

export { scorePerformanceContract };
export { IMMORTALITY_OFFENSE_POSITIONS, IMMORTALITY_DEFENSE_POSITIONS };
