import { randomUUID } from "node:crypto";
import { gameplaySeasonStages, IQ_MAX, type PersonaDimension } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { postGeneratedHeadlineToDiscord } from "../hub/story-publishing.js";
import { getProspectCardRenderData } from "./immortality.service.js";
import { HEADLINE_TEMPLATES, OWNER_INTRO_LINES, PROSPECT_QUOTE_LINES, pickLine } from "./headline-bank.js";

function fill(line: string, vars: Record<string, string>): string {
  return line.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

function capitalize(text: string): string {
  return text.length ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function highlightsFor(iqScore: number | null, devTrait: string | null, attributes: Array<{ name: string; value: number }>): string[] {
  const bits: string[] = [];
  if (iqScore === IQ_MAX) bits.push(`posted a perfect ${IQ_MAX} on the cognitive test`);
  else if (iqScore != null && iqScore >= 125) bits.push(`logged a ${iqScore} IQ in predraft testing`);
  if (devTrait === "star") bits.push("is already flashing Star-caliber upside");
  const top = [...attributes].sort((a, b) => b.value - a.value)[0];
  if (top && top.value >= 90) bits.push(`grades out with a ${top.value} ${top.name}`);
  return bits;
}

function prospectParagraph(opts: {
  firstName: string; lastName: string; position: string;
  personaDim: PersonaDimension | null; highlights: string[];
}): string {
  const highlightSentence = opts.highlights.length ? ` ${capitalize(opts.highlights.join(" and "))}.` : "";
  const bank = opts.personaDim ? PROSPECT_QUOTE_LINES[opts.personaDim] : null;
  const quote = bank ? ` ${fill(pickLine(bank), { first: opts.firstName })}` : "";
  return `${opts.firstName} ${opts.lastName} (${opts.position}) is locked in on the roster.${highlightSentence}${quote}`;
}

/** Best-effort headline post for a member's franchise selection -- fires once per member, right
 * after chooseImmortalityTeam finishes materializing both prospects to the new team. Publishes
 * to the site news feed (rec_game_stories) and mirrors to the guild's Headlines channel, tagging
 * the new owner by Discord mention (renders as their nickname) alongside @everyone. The dialog
 * is inferred from persona data already captured during Origins -- not user-authored. */
export async function postFranchiseSelectionHeadline(input: {
  guildId: string;
  recLeagueId: string;
  immortalityLeagueId: string;
  userId: string;
  discordId: string;
  teamId: string;
  offenseProspectId: string;
  defenseProspectId: string;
}): Promise<void> {
  try {
    const existing = await supabase.from("rec_game_stories").select("id,headline,body,image_url,posted_message_id")
      .eq("league_id", input.recLeagueId)
      .eq("author_user_id", input.userId)
      .eq("primary_angle", "rti_franchise_selection")
      .limit(1);
    const existingStory = existing.data?.[0];
    if (existingStory?.posted_message_id) return;
    if (existingStory) {
      await postGeneratedHeadlineToDiscord({
        leagueId: input.recLeagueId,
        storyId: String(existingStory.id),
        headline: String(existingStory.headline ?? "New Franchise Ownership"),
        body: String(existingStory.body ?? ""),
        image_url: existingStory.image_url ? String(existingStory.image_url) : undefined,
        mentionDiscordId: input.discordId,
      });
      return;
    }

    const [context, offenseCard, defenseCard, iqRows, personaRows, devTraitRows, team] = await Promise.all([
      getCurrentLeagueContext(input.guildId),
      getProspectCardRenderData(input.offenseProspectId),
      getProspectCardRenderData(input.defenseProspectId),
      supabase.from("rec_immortality_iq_attempts").select("prospect_id,iq_score").in("prospect_id", [input.offenseProspectId, input.defenseProspectId]),
      supabase.from("rec_immortality_persona_results").select("prospect_id,primary_dimension").in("prospect_id", [input.offenseProspectId, input.defenseProspectId]),
      supabase.from("rec_players").select("madden_player_id,dev_trait").in("madden_player_id", [`rti:${input.offenseProspectId}`, `rti:${input.defenseProspectId}`]),
      supabase.from("rec_teams").select("name,display_city,display_nick,is_relocated,logo_url").eq("id", input.teamId).maybeSingle(),
    ]);

    const ownerRow = await supabase.from("rec_immortality_owners").select("id,first_name,last_name")
      .eq("immortality_league_id", input.immortalityLeagueId).eq("user_id", input.userId).maybeSingle();
    const ownerPersona = ownerRow.data?.id
      ? await supabase.from("rec_immortality_owner_persona_results").select("primary_dimension").eq("owner_id", ownerRow.data.id).maybeSingle()
      : { data: null as { primary_dimension?: string } | null };

    const iqByProspect = new Map<string, number | null>((iqRows.data ?? []).map((row) => [String(row.prospect_id), row.iq_score != null ? Number(row.iq_score) : null]));
    const personaByProspect = new Map<string, PersonaDimension>((personaRows.data ?? []).map((row) => [String(row.prospect_id), row.primary_dimension as PersonaDimension]));
    const devTraitByPlayer = new Map<string, string | null>((devTraitRows.data ?? []).map((row) => [String(row.madden_player_id), row.dev_trait as string | null]));

    const teamFullName = team.data ? (formatTeamDisplayName(team.data) ?? team.data.name ?? "the franchise") : "the franchise";
    const teamCity = team.data?.display_city ?? teamFullName;
    const ownerFirst = ownerRow.data?.first_name ?? "The new owner";
    const ownerFull = ownerRow.data ? `${ownerRow.data.first_name ?? ""} ${ownerRow.data.last_name ?? ""}`.trim() : "The new owner";

    const ownerDim = ownerPersona.data?.primary_dimension as PersonaDimension | undefined;
    const ownerIntroLine = ownerDim && OWNER_INTRO_LINES[ownerDim]
      ? fill(pickLine(OWNER_INTRO_LINES[ownerDim]), { first: ownerFirst })
      : `"Let's get to work," ${ownerFirst} said.`;

    const offenseParagraph = prospectParagraph({
      firstName: offenseCard.firstName, lastName: offenseCard.lastName, position: String(offenseCard.position ?? "Offense"),
      personaDim: personaByProspect.get(input.offenseProspectId) ?? null,
      highlights: highlightsFor(
        iqByProspect.get(input.offenseProspectId) ?? null,
        devTraitByPlayer.get(`rti:${input.offenseProspectId}`) ?? null,
        offenseCard.attributes,
      ),
    });
    const defenseParagraph = prospectParagraph({
      firstName: defenseCard.firstName, lastName: defenseCard.lastName, position: String(defenseCard.position ?? "Defense"),
      personaDim: personaByProspect.get(input.defenseProspectId) ?? null,
      highlights: highlightsFor(
        iqByProspect.get(input.defenseProspectId) ?? null,
        devTraitByPlayer.get(`rti:${input.defenseProspectId}`) ?? null,
        defenseCard.attributes,
      ),
    });

    const headline = fill(pickLine(HEADLINE_TEMPLATES), { owner: ownerFull, team: teamFullName, city: teamCity });
    const body = [
      `${ownerFull} has officially taken the reins of the ${teamFullName}, and Rise to Immortality's next chapter starts now. ${ownerIntroLine}`,
      offenseParagraph,
      defenseParagraph,
      `The ${teamFullName} are officially open for business.`,
    ].join("\n\n");

    const season = Number(context.rec_leagues.season_number ?? 1);
    const seasonStage = String(context.rec_leagues.season_stage ?? "");
    const isGameplayStage = gameplaySeasonStages(context.rec_leagues.game).has(seasonStage);
    const week = isGameplayStage ? Number(context.rec_leagues.current_week ?? 1) : null;

    const result = await supabase.from("rec_game_stories").insert({
      id: randomUUID(), league_id: input.recLeagueId, season, week,
      season_stage: isGameplayStage ? null : seasonStage, game_id: null,
      primary_angle: "rti_franchise_selection", headline, body,
      notes: [], story_type: "headline", roundtable: null,
      image_url: team.data?.logo_url ?? null,
      author_user_id: input.userId, author_discord_id: input.discordId,
      published_by_discord_id: input.discordId, published_at: new Date().toISOString(),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).select("id").single();
    if (result.error) { console.error("[ERROR] Could not publish RTI franchise headline story:", result.error); return; }

    await postGeneratedHeadlineToDiscord({
      leagueId: input.recLeagueId, storyId: result.data.id, headline, body,
      image_url: team.data?.logo_url ?? undefined, mentionDiscordId: input.discordId,
    });
  } catch (err) {
    console.error("[ERROR] Failed to post RTI franchise selection headline (non-fatal):", err);
  }
}
