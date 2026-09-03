import type { PersonaDimension } from "@rec/shared";
import { publishTransitionStory } from "../hub/story-publishing.js";
import { INTERVIEW_HEADLINE_TEMPLATES, pickLine } from "./headline-bank.js";

function fill(line: string, vars: Record<string, string>): string {
  return line.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

/** Publishes a one-off "player speaks out" headline story for an interview answer authored with
 * contentTrigger: "headline" (Media Day matchup interviews and stage interviews both feed this).
 * Reuses publishTransitionStory for the actual insert/Discord-post so this stays consistent with
 * every other non-game-attached headline in the codebase (contract signings, recruiting, transfer
 * portal) -- season/week/season_stage stamping included. Best-effort: an interview answer must
 * never fail to save because a headline post hiccuped. */
export async function postInterviewQuoteHeadline(input: {
  guildId: string;
  prospectFirstName: string | null;
  prospectLastName: string | null;
  teamName: string;
  personaDim: PersonaDimension | null;
  questionText: string;
  quoteText: string;
}): Promise<void> {
  try {
    const dim: PersonaDimension = input.personaDim ?? "Composure";
    const bank = INTERVIEW_HEADLINE_TEMPLATES[dim] ?? INTERVIEW_HEADLINE_TEMPLATES.Composure;
    const first = (input.prospectFirstName ?? "").trim() || "The prospect";
    const last = (input.prospectLastName ?? "").trim();
    const vars = { first, last, team: input.teamName };

    const headline = fill(pickLine(bank.titles), vars);
    const wrapper = fill(pickLine(bank.wrappers), vars);
    const body = `${wrapper}\n\nAsked "${input.questionText}," ${first} didn't hesitate: "${input.quoteText}"`;

    await publishTransitionStory({
      guildId: input.guildId,
      headline,
      body,
      primaryAngle: "rti_interview_headline",
      storyType: "headline",
    });
  } catch (err) {
    console.error("[ERROR] Failed to post RTI interview quote headline (non-fatal):", err);
  }
}
