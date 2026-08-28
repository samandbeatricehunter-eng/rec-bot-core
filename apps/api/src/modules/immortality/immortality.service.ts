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
  displayOvrFor,
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
  RISE_TO_IMMORTALITY_LEAGUE_TYPE,
  scoreIqAttempt,
  scorePersonaInterview,
  scorePlaystyleInterview,
  scorePerformanceContract,
  shouldApplyRiseToImmortality,
  spendCreationPoints,
  startingDevTrait,
  toPublicIqQuestion,
  validateCharacteristicSelection,
  type ImmortalityDefensePosition,
  type ImmortalityOffensePosition,
  type ImmortalityState,
  type ImmortalityPosition,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext, isSiteOnlyDiscordId, recUserIdFromSiteOnlyDiscordId } from "../league-context/league-context.service.js";
import { MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY } from "@rec/shared";

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

export async function getImmortalityHub(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  const userId = await recUserIdFromDiscordId(discordId);
  const prospects = await supabase
    .from("rec_immortality_prospects")
    .select("*")
    .eq("immortality_league_id", league.id)
    .eq("user_id", userId);
  if (prospects.error) throw new ApiError(500, "Could not load prospects.", prospects.error);
  return {
    league: {
      id: league.id,
      leagueId: context.leagueId,
      chapterState: league.chapter_state,
      chapter: chapterForState(league.chapter_state as ImmortalityState),
      offensePosition: league.offense_position,
      defensePosition: league.defense_position,
      creationPointBudget: league.creation_point_budget,
      originsOpen: originsOpen(league.chapter_state as ImmortalityState),
    },
    prospects: prospects.data ?? [],
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
  return {
    remaining: spent.remaining,
    spentPoints: spent.spentPoints,
    attributes: spent.attributes,
    estimatedOvr: ovr,
    startingDev: startingDevTrait(modifiers),
    build: saved.data,
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

export async function solveRookieDraft(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const league = await requireImmortalityLeague(context.leagueId);
  if (!canTransition(league.chapter_state as ImmortalityState, "ROOKIE_DRAFT_PREP")
    && league.chapter_state !== "ORIGINS_COMPLETE"
    && league.chapter_state !== "ROOKIE_DRAFT_PREP") {
    throw new ApiError(400, "The rookie draft cannot be solved yet.");
  }
  const userId = await recUserIdFromDiscordId(discordId);
  const prospects = await supabase.from("rec_immortality_prospects").select("id,user_id,side").eq("immortality_league_id", league.id);
  const builds = await supabase.from("rec_immortality_creation_builds").select("prospect_id,draft_value,projected_round,estimated_ovr");
  const teams = await supabase.from("rec_teams").select("id").eq("league_id", context.leagueId);
  const users = [...new Set((prospects.data ?? []).map((row) => String(row.user_id)))];
  const franchises = (teams.data ?? []).slice(0, users.length).map((team, index) => ({ teamId: String(team.id), pickOrder: index + 1 }));
  const draftProspects = (prospects.data ?? []).map((row) => {
    const build = (builds.data ?? []).find((item) => item.prospect_id === row.id);
    return {
      userId: String(row.user_id),
      prospectId: String(row.id),
      side: row.side as "offense" | "defense",
      draftValue: Number(build?.draft_value ?? 50),
      projectedRound: Number(build?.projected_round ?? 4),
    };
  });
  const assigned = assignProspectPairs({ prospects: draftProspects, franchises });
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
  await supabase.from("rec_immortality_audit_log").insert({
    immortality_league_id: league.id,
    actor_user_id: userId,
    event_type: "draft_solved",
    payload: { users: users.length, franchises: franchises.length },
  });
  return { assignments: assigned };
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
