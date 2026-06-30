import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { GLOBAL_BADGES, SEASON_BADGES, WEEKLY_BADGES } from "../box-score-intelligence/badge-rules.js";
import { findCurrentLeagueContext } from "../league-context/league-context.service.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";
import { getLeagueConfigAsDraft } from "../setup/setup.service.js";
import { formatLeagueGameLabel, getLeagueUserIdentities } from "../users/user.service.js";
import { getGameChannelByDiscordId } from "./game-channels.service.js";

const BADGE_LABEL = new Map<string, string>(
  [...WEEKLY_BADGES, ...SEASON_BADGES, ...GLOBAL_BADGES].map((b) => [b.key, b.label]),
);

function mapBadge(row: any) {
  return {
    key: row.badge_key,
    label: BADGE_LABEL.get(row.badge_key) ?? row.badge_key,
    tier: row.tier && row.tier !== "normal" ? String(row.tier).toUpperCase() : null,
    earnedCount: Number(row.earned_count ?? 1),
  };
}

/**
 * Everything the five game-channel pages need for one matchup, reconstructed
 * purely from the Discord channel id (via rec_game_channels). Self-contained so
 * the bot can render any page — and re-render on page flips, including after a
 * restart — from a single call. Heavy league-wide lookups (identities, power
 * rankings, config) are reused as-is rather than re-implemented.
 */
export async function getGameChannelMatchup(guildId: string, discordChannelId: string) {
  const context = await findCurrentLeagueContext(guildId);
  if (!context) throw new ApiError(404, "No current REC league is linked to this server.");
  const leagueId = context.leagueId;
  const league: any = context.rec_leagues ?? {};
  const game = String(league.game ?? "madden_26");
  const season = Number(league.season_number ?? league.display_season_number ?? 1);
  const routes: any = context.routes ?? {};

  const row = await getGameChannelByDiscordId(discordChannelId);
  if (!row || row.league_id !== leagueId || row.status === "deleted") {
    throw new ApiError(404, "No tracked game-channel matchup for this channel.");
  }

  const userIds = [row.away_user_id, row.home_user_id].filter(Boolean) as string[];

  const [identitiesResult, powerResult, draftResult, badgeResult, gameRecordResult] = await Promise.all([
    getLeagueUserIdentities(guildId).catch(() => ({ identities: [] as any[] })),
    computePowerRankings(guildId).catch(() => ({ teams: [] as any[] })),
    getLeagueConfigAsDraft(guildId).catch(() => null),
    userIds.length
      ? supabase
          .from("rec_badge_ownership")
          .select("badge_key,badge_scope,tier,earned_count,user_id,season")
          .eq("league_id", leagueId)
          .in("user_id", userIds)
          .or(`season.eq.${season},season.is.null`)
      : Promise.resolve({ data: [] as any[] }),
    userIds.length
      ? supabase.from("rec_global_user_game_records").select("*").eq("game", game).in("user_id", userIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const identityByUser = new Map<string, any>(
    ((identitiesResult as any)?.identities ?? []).filter((i: any) => i.userId).map((i: any) => [i.userId, i]),
  );
  const rankByTeam = new Map<string, number>(
    ((powerResult as any)?.teams ?? []).map((t: any) => [t.teamId, t.rank]),
  );
  const badgesByUser = new Map<string, any[]>();
  for (const b of (badgeResult as any)?.data ?? []) {
    if (!b.user_id) continue;
    const arr = badgesByUser.get(b.user_id) ?? [];
    arr.push(b);
    badgesByUser.set(b.user_id, arr);
  }
  const gameRecordByUser = new Map<string, any>(
    ((gameRecordResult as any)?.data ?? []).map((r: any) => [r.user_id, r]),
  );

  const draft = (draftResult as any)?.draft ?? draftResult ?? null;

  const buildSide = (teamId: string | null, userId: string | null) => {
    const identity = userId ? identityByUser.get(userId) : null;
    const stats = identity?.seasonStats ?? null;
    const wins = Number(stats?.wins ?? 0);
    const losses = Number(stats?.losses ?? 0);
    const ties = Number(stats?.ties ?? 0);
    const badges = userId ? badgesByUser.get(userId) ?? [] : [];
    const gr = userId ? gameRecordByUser.get(userId) : null;
    return {
      teamId,
      teamName: identity?.teamName ?? "Team",
      rank: teamId ? rankByTeam.get(teamId) ?? null : null,
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
        label: formatLeagueGameLabel(game),
        wins: Number(gr?.wins ?? 0),
        losses: Number(gr?.losses ?? 0),
        ties: Number(gr?.ties ?? 0),
        text: `${Number(gr?.wins ?? 0)}-${Number(gr?.losses ?? 0)}-${Number(gr?.ties ?? 0)}`,
        playoffText: `${Number(gr?.playoff_wins ?? 0)}-${Number(gr?.playoff_losses ?? 0)}`,
        superbowlWins: Number(gr?.superbowl_wins ?? 0),
      },
      weeklyBadges: badges.filter((b) => b.badge_scope === "weekly").map(mapBadge),
      seasonBadges: badges.filter((b) => b.badge_scope === "season").map(mapBadge),
    };
  };

  return {
    league: { name: league.name ?? null, game, gameLabel: formatLeagueGameLabel(game) },
    season,
    week: Number(row.week_number ?? league.current_week ?? 1),
    stage: league.season_stage ?? "regular_season",
    isPlayoff: Number(row.week_number ?? 0) >= 19,
    draft,
    routes: {
      boxScoresChannelId: routes.box_scores_channel_id ?? null,
      streamsChannelId: routes.streams_channel_id ?? null,
      highlightsChannelId: routes.highlights_channel_id ?? null,
    },
    away: buildSide(row.away_team_id, row.away_user_id),
    home: buildSide(row.home_team_id, row.home_user_id),
  };
}
