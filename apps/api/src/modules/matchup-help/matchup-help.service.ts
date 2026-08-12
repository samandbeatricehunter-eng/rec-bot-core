// Request Help: Force Win / AutoPilot / Report Matchup Issue. Notification-only — this creates
// a commissioners_inbox case and notifies commissioners; it does not touch standings, payouts,
// or game state. A commissioner resolves the actual outcome manually through existing tools.
import { bestEffort, bestEffortVoid } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { resolveChatAuthor } from "../../lib/chat-identity.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { getGameChannelByGameId } from "../game-channels/game-channels.service.js";
import { postGameChatSystemMessage } from "../game-chat/game-chat.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { sendPushToUsers } from "../push/push.service.js";

export type MatchupHelpKind = "force_win" | "autopilot" | "matchup_issue";

const QUEUE_TYPE_BY_KIND: Record<MatchupHelpKind, string> = {
  force_win: "force_win_request",
  autopilot: "autopilot_request",
  matchup_issue: "matchup_issue_report",
};

const HEADER_BY_KIND: Record<MatchupHelpKind, string> = {
  force_win: "Force Win requested",
  autopilot: "Opponent AutoPilot requested",
  matchup_issue: "Matchup issue reported",
};

export async function submitMatchupHelpRequest(input: {
  guildId: string;
  discordId: string;
  gameId: string;
  kind: MatchupHelpKind;
  message: string;
}) {
  const trimmed = input.message.trim();
  if (!trimmed) throw new ApiError(400, "A description is required.");
  if (trimmed.length > 500) throw new ApiError(400, "Description is too long (500 characters max).");

  const context = await getCurrentLeagueContext(input.guildId);
  const game = await supabase
    .from("rec_games")
    .select(
      "id,league_id,week_number,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(name),away_team:rec_teams!rec_games_away_team_id_fkey(name)",
    )
    .eq("id", input.gameId)
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (game.error) throw new ApiError(500, "Failed to load matchup.", game.error);
  if (!game.data) throw new ApiError(404, "Matchup not found.");

  const author = await resolveChatAuthor(input.discordId);
  const involvesMe = author.userId != null && (game.data.home_user_id === author.userId || game.data.away_user_id === author.userId);
  if (!involvesMe) throw new ApiError(403, "Only a participant in this matchup can request help.");

  const homeTeamName = (Array.isArray(game.data.home_team) ? game.data.home_team[0] : game.data.home_team)?.name ?? "Home";
  const awayTeamName = (Array.isArray(game.data.away_team) ? game.data.away_team[0] : game.data.away_team)?.name ?? "Away";
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);

  const { error: insertError } = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: context.leagueId,
    season_number: seasonNumber,
    week_number: game.data.week_number,
    queue_type: QUEUE_TYPE_BY_KIND[input.kind],
    status: "pending",
    priority: 0,
    header: HEADER_BY_KIND[input.kind],
    summary: `${author.displayName} requested ${HEADER_BY_KIND[input.kind].toLowerCase()} for ${awayTeamName} @ ${homeTeamName}: "${trimmed}"`,
    requester_discord_id: input.discordId,
    requester_user_id: author.userId,
    amount: null,
    source_table: "rec_games",
    source_id: input.gameId,
    payload: { gameId: input.gameId, kind: input.kind, message: trimmed, homeTeamName, awayTeamName },
  });
  if (insertError) throw new ApiError(500, "Failed to submit request.", insertError);

  void notifyLeagueCommissionersOfPendingItem(context.leagueId);

  const gameChannel = await bestEffort("matchup_help.load_game_channel", () => getGameChannelByGameId(input.gameId), { leagueId: context.leagueId, entityId: input.gameId }) ?? null;
  if (gameChannel) {
    await postGameChatSystemMessage({
      gameChannelId: gameChannel.id,
      leagueId: context.leagueId,
      gameId: input.gameId,
      body: `${author.displayName} submitted a request: ${HEADER_BY_KIND[input.kind]}. A commissioner has been notified.`,
    }).catch((error) => console.error("[ERROR] Failed to post matchup-help confirmation to game chat (non-fatal):", error));
  }

  // Private confirmation to the requester — the game-chat system message above is visible to
  // both participants, but the requester specifically needs their own status notification per
  // spec (a spectator/opponent seeing the system message isn't the same as the requester
  // knowing their own request was actually received).
  if (author.userId) {
    const title = `${HEADER_BY_KIND[input.kind]} — request received`;
    const body = `Your request for ${awayTeamName} @ ${homeTeamName} was sent to the commissioner team. You'll be notified when it's resolved.`;
    const href = `/matchups/${input.gameId}`;
    bestEffortVoid("notification.matchup_help_submitted", createSiteNotification({ userId: author.userId, leagueId: context.leagueId, kind: "matchup_help_submitted", title, body, href }), { leagueId: context.leagueId, userId: author.userId, entityId: input.gameId });
    bestEffortVoid("push.matchup_help_submitted", sendPushToUsers([author.userId], { title, body, url: href }), { leagueId: context.leagueId, userId: author.userId, entityId: input.gameId });
  }

  return { ok: true as const };
}
