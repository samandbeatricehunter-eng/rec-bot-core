import { isRegularSeasonWeek } from "@rec/shared";
import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { findCurrentLeagueContext } from "../league-context/league-context.service.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";
import { getLeagueConfigAsDraft } from "../setup/setup.service.js";
import { formatLeagueGameLabel, getLeagueUserIdentities } from "../users/user.service.js";
import { getGameChannelByDiscordId } from "./game-channels.service.js";

type LeagueMatchupContext = {
  leagueId: string;
  league: any;
  game: string;
  season: number;
  routes: any;
  draft: any;
  identityByUser: Map<string, any>;
  rankByTeam: Map<string, number>;
};

// League-wide pieces (identities, power-ranking ranks, config) that are identical
// for every matchup in the league. Loaded ONCE so building N matchups at channel
// creation costs one set of heavy queries instead of N.
async function loadLeagueMatchupContext(guildId: string): Promise<LeagueMatchupContext> {
  const context = await findCurrentLeagueContext(guildId);
  if (!context) throw new ApiError(404, "No current REC league is linked to this server.");
  const league: any = context.rec_leagues ?? {};

  const [identitiesResult, powerResult, draftResult] = await Promise.all([
    getLeagueUserIdentities(guildId).catch(() => ({ identities: [] as any[] })),
    computePowerRankings(guildId).catch(() => ({ teams: [] as any[] })),
    bestEffort("game_channel_matchup.league_config_draft", () => getLeagueConfigAsDraft(guildId), { guildId }).then((v) => v ?? null),
  ]);

  const identityByUser = new Map<string, any>(
    ((identitiesResult as any)?.identities ?? []).filter((i: any) => i.userId).map((i: any) => [i.userId, i]),
  );
  const rankByTeam = new Map<string, number>(
    ((powerResult as any)?.teams ?? []).map((t: any) => [t.teamId, t.rank]),
  );

  return {
    leagueId: context.leagueId,
    league,
    game: String(league.game ?? "madden_26"),
    season: Number(league.season_number ?? league.display_season_number ?? 1),
    routes: context.routes ?? {},
    draft: (draftResult as any)?.draft ?? draftResult ?? null,
    identityByUser,
    rankByTeam,
  };
}

// Per-user extras (all-time game record) fetched in bulk for every user across
// all matchups — one query regardless of how many channels there are.
async function loadPerUserData(game: string, userIds: string[]) {
  const gameRecordByUser = new Map<string, any>();
  if (!userIds.length) return { gameRecordByUser };

  const gameRecordResult = await supabase.from("rec_global_user_game_records").select("*").eq("game", game).in("user_id", userIds);

  for (const r of (gameRecordResult as any)?.data ?? []) {
    gameRecordByUser.set(r.user_id, r);
  }
  return { gameRecordByUser };
}

function buildSide(
  ctx: LeagueMatchupContext,
  gameRecordByUser: Map<string, any>,
  teamId: string | null,
  userId: string | null,
) {
  const identity = userId ? ctx.identityByUser.get(userId) : null;
  const stats = identity?.seasonStats ?? null;
  const wins = Number(stats?.wins ?? 0);
  const losses = Number(stats?.losses ?? 0);
  const ties = Number(stats?.ties ?? 0);
  const gr = userId ? gameRecordByUser.get(userId) : null;
  return {
    teamId,
    teamName: identity?.teamName ?? "Team",
    rank: teamId ? ctx.rankByTeam.get(teamId) ?? null : null,
    userId,
    discordId: identity?.discordId ?? null,
    displayName: identity?.displayName ?? "Coach",
    record: { wins, losses, ties, text: `${wins}-${losses}-${ties}` },
    stats,
    identity: identity
      ? {
          label: identity.identityLabel ?? "Unscouted Coach",
          confidence: Number(identity.confidence ?? 0),
          summary: identity.summary ?? null,
          evidence: identity.evidence ?? [],
          primary: identity.primary ?? null,
          secondary: identity.secondary ?? null,
          accent: identity.accent ?? null,
        }
      : null,
    allTimeGameRecord: {
      label: formatLeagueGameLabel(ctx.game),
      wins: Number(gr?.wins ?? 0),
      losses: Number(gr?.losses ?? 0),
      ties: Number(gr?.ties ?? 0),
      text: `${Number(gr?.wins ?? 0)}-${Number(gr?.losses ?? 0)}-${Number(gr?.ties ?? 0)}`,
      playoffText: `${Number(gr?.playoff_wins ?? 0)}-${Number(gr?.playoff_losses ?? 0)}`,
      superbowlWins: Number(gr?.superbowl_wins ?? 0),
    },
  };
}

function buildMatchupPayload(
  ctx: LeagueMatchupContext,
  row: any,
  gameRecordByUser: Map<string, any>,
) {
  return {
    league: { name: ctx.league.name ?? null, game: ctx.game, gameLabel: formatLeagueGameLabel(ctx.game) },
    season: ctx.season,
    week: Number(row.week_number ?? ctx.league.current_week ?? 1),
    stage: ctx.league.season_stage ?? "regular_season",
    isPlayoff: !isRegularSeasonWeek(Number(row.week_number ?? 0), ctx.game),
    draft: ctx.draft,
    routes: {
      boxScoresChannelId: ctx.routes.box_scores_channel_id ?? null,
      streamsChannelId: ctx.routes.streams_channel_id ?? null,
      highlightsChannelId: ctx.routes.highlights_channel_id ?? null,
    },
    away: buildSide(ctx, gameRecordByUser, row.away_team_id, row.away_user_id),
    home: buildSide(ctx, gameRecordByUser, row.home_team_id, row.home_user_id),
  };
}

/**
 * Everything the five game-channel pages need for one matchup, reconstructed
 * purely from the Discord channel id (via rec_game_channels). Used for page
 * flips — one call per button press.
 */
export async function getGameChannelMatchup(guildId: string, discordChannelId: string) {
  const ctx = await loadLeagueMatchupContext(guildId);
  const row = await getGameChannelByDiscordId(discordChannelId);
  if (!row || row.league_id !== ctx.leagueId || row.status === "deleted") {
    throw new ApiError(404, "No tracked game-channel matchup for this channel.");
  }
  const userIds = [row.away_user_id, row.home_user_id].filter(Boolean) as string[];
  const { gameRecordByUser } = await loadPerUserData(ctx.game, userIds);
  return buildMatchupPayload(ctx, row, gameRecordByUser);
}

/**
 * All active game-channel matchups for the league, keyed by Discord channel id.
 * Computes the league-wide pieces once and the per-user extras in one bulk
 * query, so the bot can render every freshly created channel from a single
 * API call instead of one call per channel.
 */
export async function getGameChannelMatchupsForGuild(guildId: string) {
  const ctx = await loadLeagueMatchupContext(guildId);
  const { data: rows, error } = await supabase
    .from("rec_game_channels")
    .select("*")
    .eq("league_id", ctx.leagueId)
    .eq("status", "active");
  if (error) throw new ApiError(500, "Failed to load active game channels.", error);

  const allUserIds = [
    ...new Set((rows ?? []).flatMap((r) => [r.away_user_id, r.home_user_id]).filter(Boolean) as string[]),
  ];
  const { gameRecordByUser } = await loadPerUserData(ctx.game, allUserIds);

  const matchups: Record<string, any> = {};
  for (const row of rows ?? []) {
    if (!row.discord_channel_id) continue;
    matchups[row.discord_channel_id] = buildMatchupPayload(ctx, row, gameRecordByUser);
  }
  return { matchups };
}
