// Claim-first generation eligibility layer -- see SOCIAL_SYSTEM_ARCHITECTURE.md's "Claim-first
// generation" section. A `social_claim_plan` (event type, subject, stance/move, story arc) is
// built from a verified event BEFORE any wording is generated; this module exposes the
// event-type catalog (41 types) and per-(event_type, persona) eligibility policy the uploaded
// package defines, distilled from its 1,968-entry `tweet_blueprints_contextual.json` down to the
// 328 unique (event_type, persona) combinations -- that source data is a bank of LLM prompt
// templates (see `voice_move_count`), not literal fill-in-the-blank strings, so only the
// structural eligibility fields (required/optional placeholders, generation policy) are
// consumed here. The literal wording layer is `root-post-fragments.ts`, a hand-authored
// deterministic fragment catalog, not this bank's prose.
import contextualBlueprintPolicyJson from "./config/contextual_blueprint_policy.json" with { type: "json" };
import socialEventPlaybooksJson from "./config/social_event_playbooks.json" with { type: "json" };
import socialRelationshipMatrixJson from "./config/social_relationship_matrix.json" with { type: "json" };

export type SocialEventType =
  | "media_statement" | "media_receipt_fulfilled" | "media_receipt_missed"
  | "challenge_success" | "challenge_failure"
  | "well_rounded" | "complete_team_performance" | "potw" | "league_leader"
  | "gotw_pregame" | "gotw_result"
  | "rivalry_pregame" | "rivalry_result" | "rivalry_streak"
  | "upset" | "blowout" | "close_game" | "win_streak" | "loss_streak"
  | "trade_block" | "trade_completed" | "trade_rejected" | "trade_value_followup"
  | "acquisition_breakout" | "acquisition_struggle"
  | "free_agent_signed" | "fa_statement_fulfilled" | "fa_statement_missed"
  | "contract_demand" | "contract_extension" | "cap_pressure"
  | "player_hot_streak" | "player_cold_streak"
  | "playoff_clinch" | "playoff_elimination" | "championship" | "record_watch"
  | "rti_prospect_breakout" | "rti_prospect_struggle" | "rti_pair_story" | "rti_owner_receipt";

/** The six stances/discourse moves every playbook makes available (identical set across all 41
 *  event types in the source bank -- see SOCIAL_SYSTEM_ARCHITECTURE.md's claim_plan `stance`
 *  field, of which this is the concrete enum actually shipped in the content). */
export type SocialClaimMove = "report" | "interpret" | "compare" | "question" | "receipt" | "project";

export type SocialEventPlaybook = {
  eventType: SocialEventType;
  focus: string;
  allowedMoves: SocialClaimMove[];
  requiredGrounding: string;
  threadFollowups: string[];
  avoid: string[];
};

type RawPlaybook = {
  focus: string;
  allowed_moves: string[];
  required_grounding: string;
  thread_followups: string[];
  avoid: string[];
};

const PLAYBOOKS = socialEventPlaybooksJson as Record<string, RawPlaybook>;

export function socialEventTypes(): SocialEventType[] {
  return Object.keys(PLAYBOOKS) as SocialEventType[];
}

export function socialEventPlaybook(eventType: SocialEventType): SocialEventPlaybook | undefined {
  const raw = PLAYBOOKS[eventType];
  if (!raw) return undefined;
  return {
    eventType,
    focus: raw.focus,
    allowedMoves: raw.allowed_moves as SocialClaimMove[],
    requiredGrounding: raw.required_grounding,
    threadFollowups: raw.thread_followups,
    avoid: raw.avoid,
  };
}

export type ContextualBlueprintPolicy = {
  eventType: SocialEventType;
  persona: string;
  personaName: string;
  requiredPlaceholders: string[];
  optionalPlaceholders: string[];
  generationPolicy: {
    mustIncludeEventFact: boolean;
    mustResolveAllRenderedPlaceholders: boolean;
    claimPlanRequired: boolean;
    maxThreadTurnsDefault: number;
    noGenericReplyWithoutNewMove: boolean;
    noInventedPrivateInformation: boolean;
  };
};

type RawBlueprintPolicy = {
  event_type: string;
  persona: string;
  persona_name: string;
  required_placeholders: string[];
  optional_placeholders: string[];
  generation_policy: {
    must_include_event_fact: boolean;
    must_resolve_all_rendered_placeholders: boolean;
    claim_plan_required: boolean;
    max_thread_turns_default: number;
    no_generic_reply_without_new_move: boolean;
    no_invented_private_information: boolean;
  };
};

const BLUEPRINT_POLICIES = contextualBlueprintPolicyJson as RawBlueprintPolicy[];

/** Eligibility/policy for one (event type, persona) pair -- e.g. which placeholders must resolve
 *  to real data before a post can be attempted. Returns undefined if that persona never
 *  comments on that event type in the source bank. */
export function contextualBlueprintPolicy(eventType: SocialEventType, persona: string): ContextualBlueprintPolicy | undefined {
  const raw = BLUEPRINT_POLICIES.find((row) => row.event_type === eventType && row.persona === persona);
  if (!raw) return undefined;
  return {
    eventType: raw.event_type as SocialEventType,
    persona: raw.persona,
    personaName: raw.persona_name,
    requiredPlaceholders: raw.required_placeholders,
    optionalPlaceholders: raw.optional_placeholders,
    generationPolicy: {
      mustIncludeEventFact: raw.generation_policy.must_include_event_fact,
      mustResolveAllRenderedPlaceholders: raw.generation_policy.must_resolve_all_rendered_placeholders,
      claimPlanRequired: raw.generation_policy.claim_plan_required,
      maxThreadTurnsDefault: raw.generation_policy.max_thread_turns_default,
      noGenericReplyWithoutNewMove: raw.generation_policy.no_generic_reply_without_new_move,
      noInventedPrivateInformation: raw.generation_policy.no_invented_private_information,
    },
  };
}

/** Story-arc types persisted in rec_media_storylines -- see SOCIAL_SYSTEM_ARCHITECTURE.md's
 *  "Story arcs" section. */
export type SocialStorylineType =
  | "rivalry" | "trade_evaluation" | "player_breakout" | "player_slump" | "contract_watch"
  | "playoff_push" | "media_day_promise" | "rti_beef" | "scheme_usage_concern" | "dev_opportunity";

/** Which storyline type (if any) a given event type feeds -- events with no entry here don't
 *  open/touch a story arc on their own. */
export const STORYLINE_TYPE_BY_EVENT: Partial<Record<SocialEventType, SocialStorylineType>> = {
  rivalry_pregame: "rivalry",
  rivalry_result: "rivalry",
  rivalry_streak: "rivalry",
  trade_completed: "trade_evaluation",
  trade_value_followup: "trade_evaluation",
  acquisition_breakout: "trade_evaluation",
  acquisition_struggle: "trade_evaluation",
  player_hot_streak: "player_breakout",
  rti_prospect_breakout: "player_breakout",
  record_watch: "player_breakout",
  player_cold_streak: "player_slump",
  rti_prospect_struggle: "player_slump",
  contract_demand: "contract_watch",
  contract_extension: "contract_watch",
  cap_pressure: "contract_watch",
  playoff_clinch: "playoff_push",
  playoff_elimination: "playoff_push",
  fa_statement_fulfilled: "media_day_promise",
  fa_statement_missed: "media_day_promise",
  media_receipt_fulfilled: "media_day_promise",
  media_receipt_missed: "media_day_promise",
  rti_pair_story: "rti_beef",
  rti_owner_receipt: "rti_beef",
};

export type SocialAccountRelationship = { baseline: string; replyBias: string };

type RawRelationship = { baseline: string; reply_bias: string };

const RELATIONSHIP_MATRIX = socialRelationshipMatrixJson as unknown as Record<string, Record<string, RawRelationship>>;

/** How one fixed account tends to engage another in a reply -- feeds thread-reply persona
 *  selection (see SOCIAL_SYSTEM_ARCHITECTURE.md's "Thread behavior"); not yet wired into a
 *  reply generator, exposed here for that follow-up. */
export function socialAccountRelationship(from: string, to: string): SocialAccountRelationship | undefined {
  const raw = RELATIONSHIP_MATRIX[from]?.[to];
  return raw ? { baseline: raw.baseline, replyBias: raw.reply_bias } : undefined;
}
