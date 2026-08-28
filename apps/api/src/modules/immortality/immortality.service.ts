import {
  allCharacteristicCatalogs,
  applyIqOverlay,
  applyRiseToImmortalityLockedSettings,
  assignProspectPairs,
  canAdvanceIqQuestion,
  canConvertToTeamXp,
  canTransition,
  characteristicCatalog,
  chapterForState,
  combinedModifiers,
  convertPlayerXpToTeamXp,
  DEFAULT_CREATION_POINT_BUDGET,
  DEV_OVR_CEILING,
  displayOvrFor,
  ledgerXpBalance,
  draftValueFromProfile,
  FORMULA_VERSIONS,
  gradeIqSubmission,
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
  playstyleQuestionsForGroup,
  positionGroupFor,
  publicPersonaQuestions,
  publicPlaystyleQuestions,
  projectedRoundFromRank,
  rejectSelfVote,
  RISE_TO_IMMORTALITY_HIGHLIGHT_PAYOUT,
  RISE_TO_IMMORTALITY_LEAGUE_TYPE,
  riseHubUnlocked,
  rankDraftClass,
  completePairUserIds,
  seedFranchisePickOrder,
  type DraftGradeSnapshot,
  abilityById,
  canSelectAbility,
  playerArchetypes,
  rtiAbilitiesForPosition,
  matchingAbilityGate,
  MAX_EQUIPPED_ABILITIES,
  scoreIqAttempt,
  scorePersonaInterview,
  scorePlaystyleInterview,
  scorePerformanceContract,
  shouldApplyRiseToImmortality,
  spendAttributePlusOne,
  spendCreationPoints,
  startingDevTrait,
  toPublicIqQuestion,
  validateCharacteristicSelection,
  MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY,
  NFL_TEAMS,
  type ImmortalityDefensePosition,
  type ImmortalityOffensePosition,
  type ImmortalityState,
  type ImmortalityPosition,
  type RiseToImmortalityTeamPool,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext, isSiteOnlyDiscordId, recUserIdFromSiteOnlyDiscordId, siteOnlyDiscordId } from "../league-context/league-context.service.js";
import { linkUserToTeam } from "../team-ownership/team-ownership.service.js";

async function recUserIdFromDiscordId(discordId: string): Promise<string> {
  if (isSiteOnlyDiscordId(discordId)) {
    const userId = recUserIdFromSiteOnlyDiscordId(discordId);
    if (!userId) throw new ApiError(401, "Could not resolve your REC profile.");
    return userId;
  }
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error || !account.data?.user_id) throw new ApiError(401, "Link your REC profile before continuing.");
  return String(account.data.user_id);
}

async function discordIdForRecUser(userId: string): Promise<string> {
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
    fantasyDraftStatus: "not_applicable",
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

const ORIGINS_STEPS = ["identity", "iq", "persona", "playstyle", "characteristics", "creation"] as const;

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
  const resolvedLeagueId = recLeagueId ?? String(immortality.data?.league_id ?? "");
  if (resolvedLeagueId) await ensureDraftOrders(immortalityLeagueId, resolvedLeagueId);
  return { grades, frozen: false };
}

async function ensureDraftOrders(immortalityLeagueId: string, leagueId: string) {
  const teams = await supabase.from("rec_teams").select("id").eq("league_id", leagueId);
  const existing = await supabase.from("rec_immortality_draft_orders").select("team_id,pick_order").eq("immortality_league_id", immortalityLeagueId);
  const have = new Set((existing.data ?? []).map((row) => String(row.team_id)));
  const missing = (teams.data ?? []).map((row) => String(row.id)).filter((id) => !have.has(id));
  if (!missing.length) return;
  const maxOrder = (existing.data ?? []).reduce((max, row) => Math.max(max, Number(row.pick_order ?? 0)), 0);
  const seeded = seedFranchisePickOrder(leagueId, missing);
  const inserted = await supabase.from("rec_immortality_draft_orders").insert(
    seeded.map((row, index) => ({
      immortality_league_id: immortalityLeagueId,
      team_id: row.teamId,
      pick_order: maxOrder + index + 1,
      participating: false,
    })),
  );
  if (inserted.error) throw new ApiError(500, "Could not seed franchise draft order.", inserted.error);
}

export async function getImmortalityHub(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(discordId);
  const board = await refreshImmortalityDraftBoard(String(league.id), context.leagueId);
  const prospects = await supabase
    .from("rec_immortality_prospects")
    .select("*")
    .eq("immortality_league_id", league.id)
    .eq("user_id", userId);
  if (prospects.error) throw new ApiError(500, "Could not load prospects.", prospects.error);
  const prospectIds = (prospects.data ?? []).map((row) => String(row.id));
  const [builds, ledgers, traits, draftClass, hallNominees, classProspects, playstyles, equippedAbilities] = await Promise.all([
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
      ? supabase.from("rec_immortality_prospect_abilities").select("prospect_id,ability_id,ability_name,kind").in("prospect_id", prospectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const xpByProspect = new Map<string, { playerXp: number; teamXp: number }>();
  for (const id of prospectIds) {
    const rows = (ledgers.data ?? []).filter((row) => row.prospect_id === id);
    xpByProspect.set(id, ledgerXpBalance(rows));
  }
  const chapterState = league.chapter_state as ImmortalityState;
  const [poolMembers, linkedAssignments, storedGrades] = await Promise.all([
    supabase.from("rec_league_memberships").select("user_id,role").eq("league_id", context.leagueId).eq("status", "active"),
    supabase.from("rec_team_assignments").select("user_id").eq("league_id", context.leagueId).eq("assignment_status", "active").is("ended_at", null),
    supabase.from("rec_immortality_draft_grades").select("*").eq("immortality_league_id", league.id),
  ]);
  const nameByProspect = new Map<string, { firstName: string; lastName: string; position: string }>((classProspects.data ?? []).map((row) => [String(row.id), {
    firstName: row.first_name ? String(row.first_name) : "",
    lastName: row.last_name ? String(row.last_name) : "",
    position: String(row.position ?? ""),
  }]));
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
    pool: {
      registeredCount: (poolMembers.data ?? []).length,
      linkedCount: (linkedAssignments.data ?? []).length,
    },
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
    hallNominees: hallNominees.data ?? [],
    draftStatus: draftClass.data?.status ?? null,
    abilities: Object.fromEntries((prospects.data ?? []).map((row) => {
      const id = String(row.id);
      const position = row.position as ImmortalityPosition;
      const build = (builds.data ?? []).find((item) => String(item.prospect_id) === id);
      const playstyle = (playstyles.data ?? []).find((item) => String(item.prospect_id) === id);
      const estimatedOvr = Number(build?.estimated_ovr ?? 0);
      const archetypes = playerArchetypes(
        playstyle ? String(playstyle.primary_archetype) : null,
        playstyle?.secondary_archetype ? String(playstyle.secondary_archetype) : null,
      );
      const equippedRows = (equippedAbilities.data ?? []).filter((item) => String(item.prospect_id) === id);
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
          equippedCount: equipped.length,
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
        slots: equipped.length,
        maxEquipped: MAX_EQUIPPED_ABILITIES,
        equipped,
        eligible,
      }];
    })),
    catalogs: {
      characteristics: {
        offense: characteristicCatalog(positionGroupFor(league.offense_position as ImmortalityPosition)).map(({ key, displayName, positionGroup, slotCost, effect, tags }) => ({
          key, displayName, positionGroup, slotCost, effect, tags,
        })),
        defense: characteristicCatalog(positionGroupFor(league.defense_position as ImmortalityPosition)).map(({ key, displayName, positionGroup, slotCost, effect, tags }) => ({
          key, displayName, positionGroup, slotCost, effect, tags,
        })),
      },
      persona: {
        offense: publicPersonaQuestions("offense"),
        defense: publicPersonaQuestions("defense"),
      },
      playstyle: {
        offense: publicPlaystyleQuestions(positionGroupFor(league.offense_position as ImmortalityPosition)),
        defense: publicPlaystyleQuestions(positionGroupFor(league.defense_position as ImmortalityPosition)),
      },
    },
  };
}

export async function upsertProspectIdentity(input: {
  guildId: string;
  discordId: string;
  side: "offense" | "defense";
  identity: {
    firstName: string;
    lastName: string;
    age: number;
    hometown?: string;
    hometownState?: string;
    college?: string | null;
    jerseyNumber: number;
    heightInches: number;
    weightLbs: number;
    bodyType?: string;
  };
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  if (!originsOpen(league.chapter_state as ImmortalityState) && league.chapter_state !== "REGISTRATION") {
    throw new ApiError(400, "Origins is closed.");
  }
  const userId = await recUserIdFromDiscordId(input.discordId);
  const position = input.side === "offense" ? league.offense_position : league.defense_position;
  if (input.identity.age === 18 && input.identity.college) {
    throw new ApiError(400, "Age 18 prospects cannot choose a college.");
  }
  const existing = await loadProspectForUser(league.id, userId, input.side);
  const payload = {
    immortality_league_id: league.id,
    user_id: userId,
    side: input.side,
    position,
    first_name: input.identity.firstName,
    last_name: input.identity.lastName,
    age: input.identity.age,
    hometown: input.identity.hometown ?? null,
    hometown_state: input.identity.hometownState ?? null,
    college: input.identity.age === 18 ? null : (input.identity.college ?? null),
    jersey_number: input.identity.jerseyNumber,
    height_inches: input.identity.heightInches,
    weight_lbs: input.identity.weightLbs,
    body_type: input.identity.bodyType ?? null,
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
  }).select("*").single();
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
  }).select("*").single();
  if (saved.error) throw new ApiError(500, "Could not save playstyle results.", saved.error);
  await bumpOriginsStep(String(prospect.id), prospect.origins_step, "playstyle");
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
  const [iq, playstyle, traits] = await Promise.all([
    supabase.from("rec_immortality_iq_attempts").select("*").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_playstyle_results").select("*").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.id),
  ]);
  if (!iq.data?.completed_at) throw new ApiError(400, "Finish the IQ test first.");
  if (!playstyle.data) throw new ApiError(400, "Finish the playstyle interview first.");
  const group = positionGroupFor(prospect.position as ImmortalityPosition);
  const catalog = characteristicCatalog(group);
  const selected = catalog.filter((item) => (traits.data ?? []).some((row) => row.characteristic_key === item.key));
  const modifiers = combinedModifiers(selected);
  const dataset = await supabase.from("rec_madden_roster_datasets").select("id").eq("game_title", "madden_27").eq("is_active", true).maybeSingle();
  let baseline: Record<string, number> = {};
  if (dataset.data?.id) {
    const players = await supabase
      .from("rec_madden_baseline_players")
      .select("*")
      .eq("dataset_id", dataset.data.id)
      .eq("position", prospect.position === "MIKE" ? "MLB" : prospect.position)
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
    const primary = deriveBaselineTemplate({
      position: prospect.position as ImmortalityPosition,
      archetype: String(playstyle.data.primary_archetype),
      pool,
    });
    const secondary = deriveBaselineTemplate({
      position: prospect.position as ImmortalityPosition,
      archetype: String(playstyle.data.secondary_archetype),
      pool,
    });
    baseline = hybridBaseline({
      primary: primary.template,
      secondary: secondary.template,
      blend: playstyle.data.blend as { primaryWeight: number; secondaryWeight: number; kind: "dominant" | "clear" | "near_tie" },
      awareness: Number(iq.data.awareness_result),
      playRecognition: Number(iq.data.play_recognition_result),
      position: prospect.position as ImmortalityPosition,
    });
  } else {
    baseline = applyIqOverlay({
      position: prospect.position as ImmortalityPosition,
      attributes: { SPD: 82, ACC: 82, AGI: 80, AWR: Number(iq.data.awareness_result) },
      awareness: Number(iq.data.awareness_result),
      playRecognition: Number(iq.data.play_recognition_result),
    });
  }
  const spent = spendCreationPoints({
    baseline,
    spent: input.spent,
    budget: Number(league.creation_point_budget ?? DEFAULT_CREATION_POINT_BUDGET),
    discounts: modifiers.creationDiscounts,
  });
  if (!spent.ok) throw new ApiError(400, spent.error);
  const ovr = displayOvrFor(prospect.position as ImmortalityPosition, spent.attributes);
  const saved = await supabase.from("rec_immortality_creation_builds").upsert({
    prospect_id: prospect.id,
    baseline_attributes: baseline,
    spent_attributes: input.spent,
    final_attributes: spent.attributes,
    creation_points_spent: spent.spentPoints,
    creation_points_budget: Number(league.creation_point_budget ?? DEFAULT_CREATION_POINT_BUDGET),
    estimated_ovr: ovr,
    draft_value: draftValueFromProfile({ ovr, iq: Number(iq.data.iq_score), classRank: 16 }),
    projected_round: projectedRoundFromRank(16, 32),
    formula_version: FORMULA_VERSIONS.creationPoints,
    updated_at: new Date().toISOString(),
  }).select("*").single();
  if (saved.error) throw new ApiError(500, "Could not save creation build.", saved.error);
  await bumpOriginsStep(String(prospect.id), prospect.origins_step, "creation");
  const board = await refreshImmortalityDraftBoard(league.id, context.leagueId);
  const grade = board.grades.find((row) => row.prospectId === String(prospect.id));
  return {
    remaining: spent.remaining,
    spentPoints: spent.spentPoints,
    attributes: spent.attributes,
    estimatedOvr: ovr,
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
  const [build, playstyle, equipped] = await Promise.all([
    supabase.from("rec_immortality_creation_builds").select("estimated_ovr").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_playstyle_results").select("primary_archetype,secondary_archetype").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_prospect_abilities").select("ability_id").eq("prospect_id", prospect.id),
  ]);
  const estimatedOvr = Number(build.data?.estimated_ovr ?? 0);
  const archetypes = playerArchetypes(
    playstyle.data ? String(playstyle.data.primary_archetype) : null,
    playstyle.data?.secondary_archetype ? String(playstyle.data.secondary_archetype) : null,
  );
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

export async function convertXp(input: { guildId: string; discordId: string; side: "offense" | "defense"; playerXp: number }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(input.discordId);
  const prospect = await loadProspectForUser(league.id, userId, input.side);
  if (!prospect) throw new ApiError(400, "Prospect not found.");
  const traits = await supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.id);
  const catalog = characteristicCatalog(positionGroupFor(prospect.position as ImmortalityPosition));
  const selected = catalog.filter((item) => (traits.data ?? []).some((row) => row.characteristic_key === item.key));
  const modifiers = combinedModifiers(selected);
  const build = await supabase.from("rec_immortality_creation_builds").select("estimated_ovr").eq("prospect_id", prospect.id).maybeSingle();
  const currentOvr = Number(build.data?.estimated_ovr ?? 70);
  const allowed = canConvertToTeamXp({ currentOvr, devTrait: startingDevTrait(modifiers), teamPlayer: modifiers.teamXpFromSeason1 });
  if (!allowed) throw new ApiError(400, "Team XP unlocks after this player reaches his current development ceiling.");
  const ledger = await supabase.from("rec_immortality_xp_ledger").select("player_xp_delta,team_xp_delta").eq("prospect_id", prospect.id);
  const available = ledgerXpBalance(ledger.data ?? []).playerXp;
  if (available < input.playerXp) throw new ApiError(400, "Not enough Player XP to convert.");
  const converted = convertPlayerXpToTeamXp(input.playerXp);
  if ("error" in converted) throw new ApiError(400, converted.error);
  const sourceId = `convert:${prospect.id}:${Date.now()}`;
  await supabase.from("rec_immortality_xp_ledger").insert({
    prospect_id: prospect.id,
    event_type: "team_xp_conversion",
    source_id: sourceId,
    player_xp_delta: -converted.playerSpent,
    team_xp_delta: converted.teamGained,
    formula_version: FORMULA_VERSIONS.xp,
  });
  return converted;
}

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
  const [traits, build, ledger] = await Promise.all([
    supabase.from("rec_immortality_prospect_characteristics").select("characteristic_key").eq("prospect_id", prospect.id),
    supabase.from("rec_immortality_creation_builds").select("*").eq("prospect_id", prospect.id).maybeSingle(),
    supabase.from("rec_immortality_xp_ledger").select("player_xp_delta,team_xp_delta").eq("prospect_id", prospect.id),
  ]);
  if (!build.data) throw new ApiError(400, "Finish Creation Points before spending Player XP.");
  const catalog = characteristicCatalog(positionGroupFor(prospect.position as ImmortalityPosition));
  const selected = catalog.filter((item) => (traits.data ?? []).some((row) => row.characteristic_key === item.key));
  const modifiers = combinedModifiers(selected);
  const attributes = { ...((build.data.final_attributes ?? {}) as Record<string, number>) };
  const currentValue = Number(attributes[code] ?? 0);
  const currentOvr = Number(build.data.estimated_ovr ?? displayOvrFor(prospect.position as ImmortalityPosition, attributes));
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
  const nextOvr = displayOvrFor(prospect.position as ImmortalityPosition, attributes);
  const sourceId = `attr:${code}:${currentValue}`;
  const inserted = await supabase.from("rec_immortality_xp_ledger").insert({
    prospect_id: prospect.id,
    event_type: "attribute_upgrade",
    source_id: sourceId,
    player_xp_delta: -result.cost,
    team_xp_delta: 0,
    formula_version: FORMULA_VERSIONS.xp,
  }).select("*").maybeSingle();
  if (inserted.error) {
    if (inserted.error.code === "23505") throw new ApiError(409, "That upgrade was already applied.");
    throw new ApiError(500, "Could not spend Player XP.", inserted.error);
  }
  await supabase.from("rec_immortality_creation_builds").update({
    final_attributes: attributes,
    estimated_ovr: nextOvr,
    updated_at: new Date().toISOString(),
  }).eq("prospect_id", prospect.id);
  if (prospect.player_id) {
    const player = await supabase.from("rec_players").select("attributes").eq("id", prospect.player_id).maybeSingle();
    const nextAttrs = { ...((player.data?.attributes ?? {}) as Record<string, unknown>), [rosterKey]: result.nextValue };
    await supabase.from("rec_players").update({ attributes: nextAttrs, overall_rating: nextOvr, updated_at: new Date().toISOString() }).eq("id", prospect.player_id);
  }
  return { attributeCode: code, nextValue: result.nextValue, cost: result.cost, estimatedOvr: nextOvr, playerXp: available - result.cost };
}

export type ImmortalityCustomTeamSlot = {
  replacesAbbreviation: string;
  city: string;
  nick: string;
  abbreviation: string;
};

export async function applyImmortalityCustomTeamSlots(leagueId: string, slots: ImmortalityCustomTeamSlot[]) {
  if (!slots.length) return { updated: 0 };
  const teams = await supabase.from("rec_teams").select("id,abbreviation,original_abbreviation").eq("league_id", leagueId);
  if (teams.error) throw new ApiError(500, "Could not load teams.", teams.error);
  let updated = 0;
  for (const slot of slots) {
    const replaces = slot.replacesAbbreviation.trim().toUpperCase();
    const catalog = NFL_TEAMS.find((team) => team.abbreviation === replaces);
    if (!catalog) throw new ApiError(400, `Unknown NFL slot ${replaces}.`);
    const match = (teams.data ?? []).find((team) =>
      String(team.abbreviation).toUpperCase() === replaces
      || String(team.original_abbreviation ?? "").toUpperCase() === replaces
    );
    if (!match) continue;
    const name = [slot.city.trim(), slot.nick.trim()].filter(Boolean).join(" ") || catalog.name;
    const result = await supabase.from("rec_teams").update({
      name,
      display_city: slot.city.trim() || null,
      display_nick: slot.nick.trim() || null,
      display_abbr: slot.abbreviation.trim().toUpperCase() || null,
      is_relocated: true,
      original_abbreviation: catalog.abbreviation,
      updated_at: new Date().toISOString(),
    }).eq("id", match.id);
    if (result.error) throw new ApiError(500, `Could not install custom team for ${replaces}.`, result.error);
    updated += 1;
  }
  await supabase.from("rec_immortality_leagues").update({
    team_pool: "custom_32",
    updated_at: new Date().toISOString(),
  }).eq("league_id", leagueId);
  return { updated };
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

export async function solveRookieDraft(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const chapterState = league.chapter_state as ImmortalityState;
  if (!canTransition(chapterState, "ROOKIE_DRAFT_COMPLETE") && chapterState !== "ROOKIE_DRAFT_COMPLETE") {
    throw new ApiError(400, "The rookie draft cannot be solved yet.");
  }
  const userId = await recUserIdFromDiscordId(discordId);
  const board = await refreshImmortalityDraftBoard(league.id, context.leagueId);
  const grades = await supabase.from("rec_immortality_draft_grades").select("*").eq("immortality_league_id", league.id);
  const readyUserIds = completePairUserIds((grades.data ?? []).map((row) => ({
    userId: String(row.user_id),
    side: row.side as "offense" | "defense",
    ready: Boolean(row.ready),
  })));
  if (!readyUserIds.length) {
    throw new ApiError(400, "No one has finished both Origins players yet. The virtual draft needs complete offense + defense pairs.");
  }
  await ensureDraftOrders(league.id, context.leagueId);
  const orders = await supabase.from("rec_immortality_draft_orders").select("team_id,pick_order").eq("immortality_league_id", league.id).order("pick_order", { ascending: true });
  if (orders.error) throw new ApiError(500, "Could not load franchise pick order.", orders.error);
  const participating = (orders.data ?? []).slice(0, readyUserIds.length);
  await supabase.from("rec_immortality_draft_orders").update({ participating: false }).eq("immortality_league_id", league.id);
  if (participating.length) {
    await supabase.from("rec_immortality_draft_orders").update({ participating: true })
      .eq("immortality_league_id", league.id)
      .in("team_id", participating.map((row) => String(row.team_id)));
  }
  const franchises = participating.map((row) => ({ teamId: String(row.team_id), pickOrder: Number(row.pick_order) }));
  const readySet = new Set(readyUserIds);
  const draftProspects = (grades.data ?? [])
    .filter((row) => readySet.has(String(row.user_id)))
    .map((row) => ({
      userId: String(row.user_id),
      prospectId: String(row.prospect_id),
      side: row.side as "offense" | "defense",
      draftValue: Number(row.draft_value ?? 50),
      projectedRound: Number(row.projected_round ?? 4),
    }));
  const assigned = assignProspectPairs({ prospects: draftProspects, franchises });
  const poolCount = new Set((grades.data ?? []).map((row) => String(row.user_id))).size;
  const skipped = poolCount - readyUserIds.length;
  const draftClass = await supabase.from("rec_immortality_draft_classes").upsert({
    immortality_league_id: league.id,
    status: "solved",
    solved_at: new Date().toISOString(),
    formula_version: FORMULA_VERSIONS.draft,
  }, { onConflict: "immortality_league_id" }).select("*").single();
  if (draftClass.error) throw new ApiError(500, "Could not save the draft class.", draftClass.error);
  await supabase.from("rec_immortality_draft_assignments").delete().eq("draft_class_id", draftClass.data.id);
  const rows = assigned.flatMap((row) => row.picks.map((pick) => ({
    draft_class_id: draftClass.data.id,
    prospect_id: pick.prospectId,
    user_id: pick.userId,
    team_id: pick.teamId,
    round: pick.round,
    overall_pick: pick.overallPick,
    reveal_ownership: pick.revealOwnership,
  })));
  if (rows.length) {
    const inserted = await supabase.from("rec_immortality_draft_assignments").insert(rows);
    if (inserted.error) throw new ApiError(500, "Could not save draft assignments.", inserted.error);
  }
  for (const pair of assigned) {
    await supabase.from("rec_immortality_user_team_assignments").upsert({
      immortality_league_id: league.id,
      user_id: pair.userId,
      team_id: pair.teamId,
      revealed_at: new Date().toISOString(),
    });
  }
  const memberships = assigned.length
    ? await supabase
      .from("rec_league_memberships")
      .select("user_id,role")
      .eq("league_id", context.leagueId)
      .in("user_id", assigned.map((pair) => pair.userId))
    : { data: [] as Array<{ user_id: string; role: string | null }>, error: null };
  const roleByUser = new Map((memberships.data ?? []).map((row) => [String(row.user_id), String(row.role ?? "member")]));
  const linked: Array<{ userId: string; teamId: string; discordId: string }> = [];
  const linkFailures: Array<{ userId: string; teamId: string; error: string }> = [];
  for (const pair of assigned) {
    try {
      const discordId = await discordIdForRecUser(pair.userId);
      await linkUserToTeam({
        guildId,
        discordId,
        teamId: pair.teamId,
        authority: membershipAuthority(roleByUser.get(pair.userId)),
      });
      linked.push({ userId: pair.userId, teamId: pair.teamId, discordId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not link that user to a team.";
      console.error(`[WARN] Rise rookie draft could not link user ${pair.userId} to team ${pair.teamId}:`, error);
      linkFailures.push({ userId: pair.userId, teamId: pair.teamId, error: message });
    }
  }
  const fromState = league.chapter_state as ImmortalityState;
  if (fromState !== "ROOKIE_DRAFT_COMPLETE") {
    await supabase.from("rec_immortality_leagues").update({
      chapter_state: "ROOKIE_DRAFT_COMPLETE",
      updated_at: new Date().toISOString(),
    }).eq("id", league.id);
    await supabase.from("rec_immortality_state_history").insert({
      immortality_league_id: league.id,
      from_state: fromState,
      to_state: "ROOKIE_DRAFT_COMPLETE",
      actor_user_id: userId,
      note: "Virtual rookie draft assigned franchises",
    });
  }
  await supabase.from("rec_immortality_audit_log").insert({
    immortality_league_id: league.id,
    actor_user_id: userId,
    event_type: "draft_solved",
    payload: {
      users: readyUserIds.length,
      skipped,
      franchises: franchises.length,
      linked: linked.length,
      linkFailures: linkFailures.length,
      frozenGrades: (board.grades as unknown[]).length,
    },
  });
  return { assignments: assigned, linked, linkFailures, readyPairCount: readyUserIds.length, skippedIncompletePairs: skipped };
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
  const nominee = await supabase.from("rec_immortality_prospects").select("id,user_id,side").eq("id", input.nomineeProspectId).maybeSingle();
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

export function publicCharacteristicCatalog() {
  return allCharacteristicCatalogs().map(({ key, displayName, positionGroup, slotCost, effect, tags }) => ({
    key, displayName, positionGroup, slotCost, effect, tags,
  }));
}

export { scorePerformanceContract };
export { IMMORTALITY_OFFENSE_POSITIONS, IMMORTALITY_DEFENSE_POSITIONS };
