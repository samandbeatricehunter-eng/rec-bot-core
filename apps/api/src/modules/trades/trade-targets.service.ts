// "Trade Targets" — a scouting tool on top of the existing trade value model (trade-value-model.ts
// in packages/shared). The user filters the league's rosters down to players at a position who
// clear attribute thresholds they set, then for a chosen target this generates a few realistic
// offer packages built from the user's own roster/picks, scored need-aware in both directions:
// each candidate asset is valued against the OTHER team's needs (so it's actually enticing to
// them), while assets the user's OWN team is short at are deprioritized as trade chips (so the
// suggestions don't recommend giving away a piece the user's team actually needs).
import {
  computeRecTeamPositionNeeds,
  estimateRecPickTradeValue,
  estimateRecPlayerTradeValue,
  evaluateRecTradeFairness,
  type RecTradeFairnessReport,
  type RecTradePickInput,
  type RecTradePlayerInput,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { teamForUser, teamPositionNeeds, userIdFromDiscord } from "./trades.service.js";

async function assertMaddenLeague(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  if (!String(context.league.game).startsWith("madden")) throw new ApiError(400, "Trade Targets is available for Madden leagues only.");
  return context;
}

export type TradeTargetFilter = { code: string; min: number };

export type TradeTargetPlayer = {
  id: string;
  fullName: string;
  position: string;
  overallRating: number | null;
  devTrait: string | null;
  teamId: string;
  teamName: string;
  attributes: Array<{ code: string; value: number }>;
};

export async function searchTradeTargets(guildId: string, discordId: string, input: { position: string; filters: TradeTargetFilter[] }) {
  const context = await assertMaddenLeague(guildId);
  const userId = await userIdFromDiscord(discordId);
  if (!userId) throw new ApiError(403, "Link your REC account before searching Trade Targets.");
  const myTeamId = await teamForUser(context.leagueId, userId);

  const roster = await supabase.from("rec_players")
    .select("id,full_name,position,overall_rating,dev_trait,team_id,attributes")
    .eq("league_id", context.leagueId).eq("position", input.position).eq("roster_status", "active")
    .not("team_id", "is", null).neq("team_id", myTeamId);
  if (roster.error) throw new ApiError(500, "We couldn't search the league's rosters. Please try again.", roster.error);

  const teams = await supabase.from("rec_teams").select("id,name,display_abbr,abbreviation").eq("league_id", context.leagueId);
  if (teams.error) throw new ApiError(500, "We couldn't load teams. Please try again.", teams.error);
  const teamNameById = new Map((teams.data ?? []).map((t: any) => [t.id, t.name ?? t.display_abbr ?? t.abbreviation ?? "A team"]));

  const filters = input.filters.filter((f) => f.code);
  const players: TradeTargetPlayer[] = (roster.data ?? [])
    .filter((p: any) => filters.every((f) => Number(p.attributes?.[f.code] ?? 0) >= f.min))
    .map((p: any) => ({
      id: p.id, fullName: p.full_name, position: p.position, overallRating: p.overall_rating, devTrait: p.dev_trait,
      teamId: p.team_id, teamName: teamNameById.get(p.team_id) ?? "A team",
      attributes: filters.map((f) => ({ code: f.code, value: Number(p.attributes?.[f.code] ?? 0) })),
    }))
    .sort((a, b) => (b.overallRating ?? 0) - (a.overallRating ?? 0));

  return { players };
}

type Chip = {
  kind: "player" | "pick";
  id: string;
  label: string;
  chipScore: number;
  playerInput?: RecTradePlayerInput;
  pickInput?: RecTradePickInput;
};

export type TradeOfferSuggestion = {
  label: string;
  legs: Array<{ type: "player"; playerId: string } | { type: "pick"; draftPickId: string }>;
  verdict: RecTradeFairnessReport["verdict"];
  deltaPct: number;
  iGive: number;
  iGet: number;
};

export async function suggestTradeOffers(guildId: string, discordId: string, targetPlayerId: string) {
  const context = await assertMaddenLeague(guildId);
  const userId = await userIdFromDiscord(discordId);
  if (!userId) throw new ApiError(403, "Link your REC account before requesting trade offers.");
  const myTeamId = await teamForUser(context.leagueId, userId);

  const target = await supabase.from("rec_players")
    .select("id,full_name,position,team_id,overall_rating,dev_trait,years_pro,contract_years_left,cap_hit")
    .eq("id", targetPlayerId).eq("league_id", context.leagueId).eq("roster_status", "active").maybeSingle();
  if (target.error || !target.data) throw new ApiError(404, "That player is no longer available.");
  const otherTeamId = target.data.team_id as string | null;
  if (!otherTeamId) throw new ApiError(400, "That player isn't currently on a team roster.");
  if (otherTeamId === myTeamId) throw new ApiError(400, "Pick a player from another team.");

  const [myRoster, myPicks, teamsCount, myTeamNeeds, otherTeamNeeds] = await Promise.all([
    supabase.from("rec_players").select("id,full_name,position,overall_rating,dev_trait,years_pro,contract_years_left,cap_hit")
      .eq("league_id", context.leagueId).eq("team_id", myTeamId).eq("roster_status", "active"),
    supabase.from("rec_draft_picks").select("id,season_number,round,pick_number").eq("league_id", context.leagueId).eq("current_team_id", myTeamId),
    supabase.from("rec_teams").select("id", { count: "exact", head: true }).eq("league_id", context.leagueId),
    teamPositionNeeds(context.leagueId, myTeamId),
    teamPositionNeeds(context.leagueId, otherTeamId),
  ]);
  if (myRoster.error) throw new ApiError(500, "We couldn't load your roster. Please try again.", myRoster.error);
  if (myPicks.error) throw new ApiError(500, "We couldn't load your draft picks. Please try again.", myPicks.error);
  const teamsInLeague = teamsCount.count ?? 32;

  const targetInput: RecTradePlayerInput = {
    id: target.data.id, position: target.data.position, overallRating: target.data.overall_rating,
    devTrait: target.data.dev_trait, yearsPro: target.data.years_pro,
    contractYearsLeft: target.data.contract_years_left, capHit: target.data.cap_hit,
  };

  // Rank my tradeable chips: high value to the other team's needs, discounted if I'm also
  // short at that position (don't recommend trading away a hole I actually need filled).
  const playerChips: Chip[] = (myRoster.data ?? [])
    .filter((p: any) => p.id !== target.data.id)
    .map((p: any) => {
      const playerInput: RecTradePlayerInput = {
        id: p.id, position: p.position, overallRating: p.overall_rating, devTrait: p.dev_trait,
        yearsPro: p.years_pro, contractYearsLeft: p.contract_years_left, capHit: p.cap_hit,
      };
      const valueToThem = estimateRecPlayerTradeValue(playerInput, otherTeamNeeds).needAdjustedValue;
      const myOwnNeed = myTeamNeeds[String(p.position ?? "").toUpperCase()] ?? 0.5;
      return { kind: "player" as const, id: p.id, label: `${p.position} ${p.full_name}`, chipScore: valueToThem * (1.15 - myOwnNeed * 0.6), playerInput };
    });
  const pickChips: Chip[] = (myPicks.data ?? []).map((pk: any) => {
    const pickInput: RecTradePickInput = { id: pk.id, round: pk.round, pickNumber: pk.pick_number, teamsInLeague };
    const value = estimateRecPickTradeValue(pickInput);
    return { kind: "pick" as const, id: pk.id, label: `Round ${pk.round} Pick (S${pk.season_number})`, chipScore: value * 0.9, pickInput };
  });

  const rankedPlayerChips = [...playerChips].sort((a, b) => b.chipScore - a.chipScore);
  const rankedPickChips = [...pickChips].sort((a, b) => b.chipScore - a.chipScore);
  const cheapestPick = [...pickChips].sort((a, b) => a.chipScore - b.chipScore)[0];

  function scoreVerdict(report: RecTradeFairnessReport) {
    // deltaPct > 0 favors the proposing side (me) — a lopsided ask the other team is unlikely
    // to accept. deltaPct near 0 or slightly negative (generous toward them) is realistic and
    // scores best; being very stingy is penalized harder than being a little generous.
    return report.deltaPct >= 0 ? report.deltaPct * 1.5 : Math.abs(report.deltaPct) * 0.5;
  }

  const candidates: Array<{ label: string; chips: Chip[]; report: RecTradeFairnessReport }> = [];
  function tryCandidate(chips: Chip[], label: string) {
    if (!chips.length || candidates.some((c) => c.label === label)) return;
    const players = chips.filter((c) => c.kind === "player").map((c) => c.playerInput!);
    const picks = chips.filter((c) => c.kind === "pick").map((c) => c.pickInput!);
    const report = evaluateRecTradeFairness({
      proposingPlayers: players, proposingPicks: picks, proposingCoins: 0,
      receivingPlayers: [targetInput], receivingPicks: [], receivingCoins: 0,
      proposingTeamNeeds: otherTeamNeeds, receivingTeamNeeds: myTeamNeeds,
    });
    // Skip asks so lopsided in my favor the other team would obviously reject them.
    if (report.deltaPct > 25) return;
    candidates.push({ label, chips, report });
  }

  if (rankedPlayerChips[0]) tryCandidate([rankedPlayerChips[0]], "Headliner swap");
  if (rankedPlayerChips[1]) tryCandidate([rankedPlayerChips[1]], "Alternate headliner");
  if (rankedPlayerChips[0] && cheapestPick && cheapestPick.id !== rankedPlayerChips[0].id) {
    tryCandidate([rankedPlayerChips[0], cheapestPick], "Player + pick sweetener");
  }
  if (rankedPlayerChips[1] && rankedPlayerChips[2]) tryCandidate([rankedPlayerChips[1], rankedPlayerChips[2]], "Two-for-one");
  if (rankedPickChips[0]) tryCandidate([rankedPickChips[0]], "Picks only");

  const offers: TradeOfferSuggestion[] = candidates
    .sort((a, b) => scoreVerdict(a.report) - scoreVerdict(b.report))
    .slice(0, 3)
    .map((c) => ({
      label: c.label,
      legs: c.chips.map((chip) => chip.kind === "player" ? { type: "player" as const, playerId: chip.id } : { type: "pick" as const, draftPickId: chip.id }),
      verdict: c.report.verdict, deltaPct: c.report.deltaPct,
      iGive: c.report.proposing.needAdjustedTotal, iGet: c.report.receiving.needAdjustedTotal,
    }));

  return {
    target: { id: target.data.id, fullName: target.data.full_name, position: target.data.position, overallRating: target.data.overall_rating, teamId: otherTeamId },
    myTeamId, otherTeamId,
    offers,
    noRealisticOffer: offers.length === 0,
  };
}
