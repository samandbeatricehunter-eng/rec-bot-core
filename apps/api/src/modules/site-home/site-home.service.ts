import { CAREER_BADGES, GAME_BADGES, SEASON_BADGES } from "../box-score-intelligence/badge-rules.js";
import { randomUUID } from "node:crypto";
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { inspectStreamVideo, streamPlaybackUrls } from "../../lib/cloudflare-stream.js";
import { supabase } from "../../lib/supabase.js";
import { letterGradeForRating } from "../league-week/ratings.service.js";
import { computeUserRatings } from "../league-week/ratings.service.js";
import { requireLinkedRecUser } from "../site-leagues/site-leagues.service.js";
import { aggregateBoxScoreStats, formatTeamDisplayName, loadCareerBoxScoreStats, resolveTeamSchool } from "../users/user-profile-stats.service.js";
import { getUserPowerRank } from "../rankings/rankings.service.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";

const SPOTLIGHT_LIKE_COINS = 25;
const POSITIVE_REACTION_KEYS = ["like", "love"] as const;
const DEAD_HIGHLIGHT_PENDING_MAX_MS = 24 * 60 * 60 * 1000;
let lastHighlightPruneDay = "";
let highlightPrunePromise: Promise<{ removed: string[] }> | null = null;

function recordText(row: { wins?: number | null; losses?: number | null; ties?: number | null } | null | undefined) {
  const wins = Number(row?.wins ?? 0);
  const losses = Number(row?.losses ?? 0);
  const ties = Number(row?.ties ?? 0);
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function playbackFor(highlight: {
  cloudflare_stream_uid?: string | null;
  storage_provider?: string | null;
  playback_url?: string | null;
  media_status?: string | null;
  content?: string | null;
}) {
  const streamUid = highlight.cloudflare_stream_uid ? String(highlight.cloudflare_stream_uid) : null;
  if (streamUid && (highlight.storage_provider === "cloudflare_stream" || highlight.playback_url)) {
    if (highlight.media_status && highlight.media_status !== "ready") {
      return { videoUrl: null as string | null, streamUid, iframeUrl: null as string | null };
    }
    const urls = streamPlaybackUrls(streamUid);
    return {
      videoUrl: highlight.playback_url ?? urls.hls,
      streamUid,
      iframeUrl: urls.iframe,
    };
  }
  const content = String(highlight.content ?? "");
  const match = content.match(/https?:\/\/\S+\.(?:mp4|mov|webm|mkv)(?:\?\S*)?/i);
  return { videoUrl: match?.[0] ?? null, streamUid: null, iframeUrl: null };
}

async function resolveGuildForLeague(leagueId: string): Promise<string | null> {
  const link = await supabase
    .from("rec_server_league_links")
    .select("server_id")
    .eq("league_id", leagueId)
    .eq("is_primary", true)
    .maybeSingle();
  if (link.error || !link.data?.server_id) return null;
  const server = await supabase
    .from("rec_discord_servers")
    .select("guild_id")
    .eq("id", link.data.server_id)
    .maybeSingle();
  if (server.error || !server.data?.guild_id) return null;
  return String(server.data.guild_id);
}

export async function getSiteHomeCard(input: { authUserId: string }) {
  const user = await requireLinkedRecUser(input.authUserId);

  const [globalRecordRow, discordRow, assignmentRow, extras, recentBadgeRow, streak] = await Promise.all([
    supabase.from("rec_global_user_records").select("*").eq("user_id", user.recUserId).maybeSingle(),
    supabase.from("rec_discord_accounts").select("discord_id,first_seen_at").eq("user_id", user.recUserId).order("first_seen_at", { ascending: true }).limit(1).maybeSingle(),
    supabase
      .from("rec_team_assignments")
      .select("league_id,league:rec_leagues(game)")
      .eq("user_id", user.recUserId)
      .eq("assignment_status", "active")
      .is("ended_at", null)
      .limit(1)
      .maybeSingle(),
    getPgPool().query(
      `
        select
          u.created_at as user_created_at,
          (
            select count(distinct badge_key)::int from rec_badge_ownership where user_id = $1
          ) as badge_count,
          (
            select count(distinct league_id)::int from rec_league_memberships
            where user_id = $1 and status = 'active'
          ) as active_leagues,
          (
            select count(distinct league_id)::int from rec_league_memberships
            where user_id = $1 and status = 'active' and role in ('head', 'co')
          ) as commissioner_of,
          (
            (select count(*)::int from rec_award_winners where winner_user_id = $1)
            +
            (select count(*)::int from rec_eos_award_polls where winner_user_id = $1 and status = 'settled')
            +
            (select count(*)::int from rec_manual_award_credits where user_id = $1)
          ) as career_awards_won
        from rec_users u
        where u.id = $1
      `,
      [user.recUserId],
    ),
    supabase
      .from("rec_badge_ownership")
      .select("badge_key,badge_scope,tier,updated_at")
      .eq("user_id", user.recUserId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadCareerBoxScoreStats(user.recUserId).then(
      (stats) => stats.activeStreak,
      () => "—",
    ),
  ]);

  if (globalRecordRow.error) throw new ApiError(500, "Failed to load global record.", globalRecordRow.error);
  if (discordRow.error) throw new ApiError(500, "Failed to load Discord link.", discordRow.error);
  if (assignmentRow.error) throw new ApiError(500, "Failed to load team assignment.", assignmentRow.error);
  if (recentBadgeRow.error) throw new ApiError(500, "Failed to load most recent badge.", recentBadgeRow.error);

  const globalRecord = globalRecordRow.data ?? {
    wins: 0, losses: 0, ties: 0, playoff_wins: 0, playoff_losses: 0,
    superbowl_wins: 0, superbowl_losses: 0, point_differential: 0, avg_point_differential: 0, games_played: 0,
  };
  const extrasRow = extras.rows[0] ?? {};
  let userRating: {
    rating: number;
    grade: string;
    displayAsGrade: boolean;
  } | null = null;

  const discordId = discordRow.data?.discord_id ? String(discordRow.data.discord_id) : null;
  const leagueId = assignmentRow.data?.league_id ? String(assignmentRow.data.league_id) : null;
  const currentGame = (assignmentRow.data as any)?.league?.game ? String((assignmentRow.data as any).league.game) : null;
  if (discordId && leagueId) {
    const guildId = await resolveGuildForLeague(leagueId);
    if (guildId) {
      try {
        const ratings = await computeUserRatings(guildId, discordId);
        const mine = ratings.users.find((row) => row.userId === user.recUserId);
        if (mine) {
          userRating = {
            rating: mine.rating,
            grade: mine.grade,
            displayAsGrade: ratings.displayAsGrade,
          };
        }
      } catch {
        // Rating is optional on the home card when league context is incomplete.
      }
    }
  }

  const [dynastyPowerRank, compPowerRank] = await Promise.all([
    getUserPowerRank({ game: currentGame, scope: "dynasty", userId: user.recUserId }).catch(() => null),
    getUserPowerRank({ game: currentGame, scope: "comp", userId: user.recUserId }).catch(() => null),
  ]);

  if (!userRating) {
    const wins = Number(globalRecord.wins ?? 0);
    const losses = Number(globalRecord.losses ?? 0);
    const ties = Number(globalRecord.ties ?? 0);
    const played = wins + losses + ties;
    const winPct = played > 0 ? (wins + ties * 0.5) / played : 0.5;
    const rating = Math.round((50 + winPct * 50) * 10) / 10;
    userRating = {
      rating,
      grade: letterGradeForRating(rating),
      displayAsGrade: true,
    };
  }

  const descByKey = new Map<string, string>();
  const labelByKey = new Map<string, string>();
  for (const badge of [...GAME_BADGES, ...SEASON_BADGES, ...CAREER_BADGES]) {
    descByKey.set(badge.key, badge.description);
    labelByKey.set(badge.key, badge.label);
  }
  const recentBadge = recentBadgeRow.data
    ? {
        key: String(recentBadgeRow.data.badge_key),
        label: labelByKey.get(String(recentBadgeRow.data.badge_key)) ?? String(recentBadgeRow.data.badge_key).replaceAll("_", " "),
        scope: String(recentBadgeRow.data.badge_scope ?? "game"),
        tier: recentBadgeRow.data.tier ?? null,
        earnedAt: recentBadgeRow.data.updated_at,
      }
    : null;

  // "Member since" reflects REC league tenure (first seen by the Discord bot), not the
  // site-registration date — nearly everyone registered the site account this week, so that
  // date isn't meaningful, while first_seen_at traces back to actual league history.
  const memberSince = discordRow.data?.first_seen_at ?? extrasRow.user_created_at ?? null;

  return {
    displayName: user.username ?? user.displayName,
    username: user.username,
    memberSince,
    globalRecord: {
      wins: Number(globalRecord.wins ?? 0),
      losses: Number(globalRecord.losses ?? 0),
      ties: Number(globalRecord.ties ?? 0),
      text: recordText(globalRecord),
    },
    performanceRecord: {
      playoffWins: Number((globalRecord as any).playoff_wins ?? 0),
      playoffLosses: Number((globalRecord as any).playoff_losses ?? 0),
      superbowlWins: Number((globalRecord as any).superbowl_wins ?? 0),
      superbowlLosses: Number((globalRecord as any).superbowl_losses ?? 0),
      pointDifferential: Number((globalRecord as any).point_differential ?? 0),
      avgPointDifferential: Number((globalRecord as any).avg_point_differential ?? 0),
      gamesPlayed: Number((globalRecord as any).games_played ?? 0),
      currentStreak: streak,
    },
    userRating,
    currentGame,
    dynastyPowerRank,
    compPowerRank,
    badgeCount: Number(extrasRow.badge_count ?? 0),
    recentBadge,
    careerAwardsWon: Number(extrasRow.career_awards_won ?? 0),
    leaguesActivity: {
      activeLeagues: Number(extrasRow.active_leagues ?? 0),
      commissionerOf: Number(extrasRow.commissioner_of ?? 0),
    },
  };
}

export async function listSiteAnnouncements() {
  const now = new Date().toISOString();
  const rows = await supabase
    .from("rec_site_announcements")
    .select("id,title,body,href,sort_order,starts_at,ends_at,created_at")
    .eq("published", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(20);
  if (rows.error) throw new ApiError(500, "Failed to load announcements.", rows.error);

  const announcements = (rows.data ?? []).filter((row) => {
    if (row.starts_at && String(row.starts_at) > now) return false;
    if (row.ends_at && String(row.ends_at) < now) return false;
    return true;
  });

  return { announcements };
}

export async function refreshSpotlightReel() {
  await pruneDeadHighlightsOnceDaily();
  // Positive reaction score from league highlight reactions across active leagues
  // (leagues that currently have at least one active team assignment).
  const activeLeagueIdsResult = await supabase
    .from("rec_team_assignments")
    .select("league_id")
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (activeLeagueIdsResult.error) {
    throw new ApiError(500, "Failed to load active leagues.", activeLeagueIdsResult.error);
  }
  const activeLeagueIds = [
    ...new Set((activeLeagueIdsResult.data ?? []).map((row) => String(row.league_id)).filter(Boolean)),
  ];
  if (!activeLeagueIds.length) {
    await supabase.from("rec_spotlight_reel").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    return { selected: [], refreshedAt: new Date().toISOString() };
  }

  const highlights = await supabase
    .from("rec_highlight_posts")
    .select("id")
    .in("league_id", activeLeagueIds)
    .eq("hub_visible", true)
    .eq("media_status", "ready");
  if (highlights.error) throw new ApiError(500, "Failed to load highlight candidates.", highlights.error);
  const ids = (highlights.data ?? []).map((row) => String(row.id));
  if (!ids.length) {
    await supabase.from("rec_spotlight_reel").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    return { selected: [], refreshedAt: new Date().toISOString() };
  }

  const reactions = await supabase
    .from("rec_highlight_reactions")
    .select("highlight_post_id,reaction_key")
    .in("highlight_post_id", ids)
    .in("reaction_key", [...POSITIVE_REACTION_KEYS]);
  if (reactions.error) throw new ApiError(500, "Failed to load highlight reactions.", reactions.error);

  const score = new Map<string, number>();
  for (const id of ids) score.set(id, 0);
  for (const row of reactions.data ?? []) {
    const id = String(row.highlight_post_id);
    score.set(id, (score.get(id) ?? 0) + 1);
  }

  const top = [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);

  const cleared = await supabase
    .from("rec_spotlight_reel")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (cleared.error) throw new ApiError(500, "Failed to clear spotlight reel.", cleared.error);

  if (top.length) {
    const inserted = await supabase.from("rec_spotlight_reel").insert(
      top.map(([highlightPostId, likeCount], index) => ({
        id: randomUUID(),
        highlight_post_id: highlightPostId,
        rank: index + 1,
        like_count: likeCount,
        selected_at: new Date().toISOString(),
      })),
    );
    if (inserted.error) throw new ApiError(500, "Failed to write spotlight reel.", inserted.error);
  }

  return {
    selected: top.map(([highlightPostId, likeCount], index) => ({
      highlightPostId,
      rank: index + 1,
      likeCount,
    })),
    refreshedAt: new Date().toISOString(),
  };
}

async function urlIsPlayable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    return response.ok || response.status === 206;
  } catch {
    return false;
  }
}

export async function pruneDeadHighlightsOnceDaily(): Promise<{ removed: string[] }> {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (lastHighlightPruneDay === day) return { removed: [] };
  if (highlightPrunePromise) return highlightPrunePromise;

  highlightPrunePromise = (async () => {
    const rows = await supabase
      .from("rec_highlight_posts")
      .select("id,cloudflare_stream_uid,storage_provider,playback_url,media_status,content,created_at")
      .eq("hub_visible", true);
    if (rows.error) throw new ApiError(500, "Failed to load highlights for cleanup.", rows.error);

    // Each row's liveness check is an independent network call (up to a 20s Cloudflare
    // timeout, or 12s for a playback HEAD request) — run them in parallel instead of one
    // at a time, or a handful of slow/unresponsive lookups can push total request time
    // well past the platform's HTTP timeout and fail the whole cron run even though every
    // individual check is itself guarded against throwing.
    const results = await Promise.all(
      (rows.data ?? []).map(async (row) => {
        const uid = String(row.cloudflare_stream_uid ?? "").trim();
        if (uid) {
          try {
            const inspected = await inspectStreamVideo(uid);
            if (!inspected.exists) return String(row.id);
            if (
              !inspected.ready &&
              Date.now() - new Date(String(row.created_at)).getTime() > DEAD_HIGHLIGHT_PENDING_MAX_MS
            ) return String(row.id);
          } catch {
            // A transient Cloudflare API failure must never delete a valid clip.
          }
          return null;
        }
        const playback = playbackFor(row);
        if (!playback.videoUrl || !(await urlIsPlayable(playback.videoUrl))) {
          return String(row.id);
        }
        return null;
      }),
    );
    const deadIds = results.filter((id): id is string => id !== null);

    if (deadIds.length) {
      const removed = await supabase.from("rec_highlight_posts").delete().in("id", deadIds);
      if (removed.error) throw new ApiError(500, "Failed to prune dead highlights.", removed.error);
    }
    lastHighlightPruneDay = day;
    return { removed: deadIds };
  })().finally(() => {
    highlightPrunePromise = null;
  });
  return highlightPrunePromise;
}

export async function getSpotlightReel(input: { authUserId: string | null }) {
  // Non-fatal — a Cloudflare Stream liveness-check hiccup here must never take down the
  // whole home page load. Worst case, dead highlights linger an extra day.
  await pruneDeadHighlightsOnceDaily().catch((error) => {
    console.error("[ERROR] pruneDeadHighlightsOnceDaily failed (non-fatal):", error);
  });
  let reel = await supabase
    .from("rec_spotlight_reel")
    .select("id,highlight_post_id,rank,like_count,selected_at")
    .order("rank", { ascending: true });
  if (reel.error) throw new ApiError(500, "Failed to load spotlight reel.", reel.error);

  const selectedAt = (reel.data ?? [])[0]?.selected_at
    ? new Date(String((reel.data ?? [])[0]?.selected_at))
    : null;
  const selectedDay = selectedAt
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(selectedAt)
    : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  if ((reel.data ?? []).length < 5 || selectedDay !== today) {
    // Also non-fatal — if today's refresh throws (e.g. a slow/failed Stream check), fall
    // back to serving yesterday's reel instead of a hard failure with nothing to show.
    try {
      await refreshSpotlightReel();
      reel = await supabase
        .from("rec_spotlight_reel")
        .select("id,highlight_post_id,rank,like_count,selected_at")
        .order("rank", { ascending: true });
      if (reel.error) throw new ApiError(500, "Failed to load spotlight reel.", reel.error);
    } catch (error) {
      console.error("[ERROR] refreshSpotlightReel failed, serving stale reel (non-fatal):", error);
    }
  }

  const highlightIds = (reel.data ?? []).map((row) => String(row.highlight_post_id));
  if (!highlightIds.length) {
    return { items: [], selectedAt: null as string | null };
  }

  const posts = await supabase
    .from("rec_highlight_posts")
    .select(
      "id,league_id,user_id,team_id,season_number,week_number,season_stage,message_url,content,cloudflare_stream_uid,storage_provider,media_status,playback_url,created_at,user:rec_users(display_name,username),team:rec_teams(name,abbreviation,display_city,display_nick,is_relocated),league:rec_leagues(name,game)",
    )
    .in("id", highlightIds);
  if (posts.error) throw new ApiError(500, "Failed to load spotlight highlights.", posts.error);

  const [spotlightReactions, comments, games] = await Promise.all([
    supabase
      .from("rec_highlight_reactions")
      .select("highlight_post_id,user_id,reaction_key")
      .in("highlight_post_id", highlightIds)
      .in("reaction_key", ["like", "dislike"]),
    supabase
      .from("rec_highlight_comments")
      .select("id,highlight_post_id,user_id,body,created_at,user:rec_users(display_name,username)")
      .in("highlight_post_id", highlightIds)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("rec_games")
      .select("league_id,week_number,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(name,abbreviation,display_city,display_nick,is_relocated)")
      .in("league_id", [...new Set((posts.data ?? []).map((post: any) => String(post.league_id)))])
      .order("week_number", { ascending: false }),
  ]);
  if (spotlightReactions.error) {
    throw new ApiError(500, "Failed to load spotlight reactions.", spotlightReactions.error);
  }
  if (comments.error) throw new ApiError(500, "Failed to load highlight comments.", comments.error);
  if (games.error) throw new ApiError(500, "Failed to load highlight matchups.", games.error);

  let viewerUserId: string | null = null;
  if (input.authUserId) {
    try {
      const linked = await requireLinkedRecUser(input.authUserId);
      viewerUserId = linked.recUserId;
    } catch {
      viewerUserId = null;
    }
  }

  const spotlightGameUserIds = [...new Set((games.data ?? []).flatMap((game: any) => [game.home_user_id, game.away_user_id]).filter(Boolean))];
  const spotlightGameUsers = spotlightGameUserIds.length
    ? await supabase.from("rec_users").select("id,username,display_name").in("id", spotlightGameUserIds)
    : { data: [], error: null };
  if (spotlightGameUsers.error) throw new ApiError(500, "Failed to load spotlight matchup participants.", spotlightGameUsers.error);
  const spotlightGameUserNameById = new Map<string, string>((spotlightGameUsers.data ?? []).map((u: any) => [u.id, String(u.username ?? u.display_name ?? "REC Member")]));

  const postById = new Map<string, any>((posts.data ?? []).map((row: any) => [String(row.id), row]));
  const gameByLeagueId = new Map<string, string>((posts.data ?? []).map((post: any) => [String(post.league_id), String(post.league?.game ?? "")]));
  const reelTeamName = (leagueId: string, team: any, fallback: string) =>
    gameByLeagueId.get(leagueId) === "cfb_27"
      ? resolveTeamSchool(team) ?? team?.name ?? team?.abbreviation ?? fallback
      : formatTeamDisplayName(team) ?? team?.name ?? team?.abbreviation ?? fallback;
  const matchupByTeamWeek = new Map<string, { label: string; participants: { away: string; home: string } | null }>();
  for (const game of games.data ?? []) {
    const awayName = reelTeamName(String(game.league_id), (game as any).away_team, "Away");
    const homeName = reelTeamName(String(game.league_id), (game as any).home_team, "Home");
    const label = `${awayName} VS ${homeName}`;
    const participants = game.home_user_id && game.away_user_id
      ? { away: spotlightGameUserNameById.get(game.away_user_id) ?? "REC Member", home: spotlightGameUserNameById.get(game.home_user_id) ?? "REC Member" }
      : null;
    const entry = { label, participants };
    if (game.away_team_id) matchupByTeamWeek.set(`${game.league_id}:${game.week_number}:${game.away_team_id}`, entry);
    if (game.home_team_id) matchupByTeamWeek.set(`${game.league_id}:${game.week_number}:${game.home_team_id}`, entry);
  }
  const items = (reel.data ?? [])
    .map((slot) => {
      const post = postById.get(String(slot.highlight_post_id)) as any | undefined;
      if (!post) return null;
      const play = playbackFor(post);
      // Skip dead / not-ready clips so the carousel never lands on a black player.
      if (!play.iframeUrl && !play.videoUrl) return null;
      const rows = (spotlightReactions.data ?? []).filter(
        (reaction) => String(reaction.highlight_post_id) === String(post.id),
      );
      const itemComments = (comments.data ?? [])
        .filter((comment) => String(comment.highlight_post_id) === String(post.id))
        .map((comment: any) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.created_at,
          author: {
            displayName: comment.user?.username ?? comment.user?.display_name ?? "REC Member",
            username: comment.user?.username ?? null,
          },
        }));
      return {
        id: post.id,
        rank: slot.rank,
        selectedAt: slot.selected_at,
        selectionScore: slot.like_count,
        league: {
          id: post.league_id,
          name: post.league?.name ?? "League",
          game: post.league?.game ?? null,
        },
        seasonNumber: post.season_number,
        weekNumber: post.week_number,
        seasonStage: post.season_stage,
        author: {
          userId: post.user_id,
          displayName: post.user?.username ?? post.user?.display_name ?? "REC Member",
          username: post.user?.username ?? null,
        },
        team: post.team
          ? { name: post.team.name, abbreviation: post.team.abbreviation }
          : null,
        matchupLabel:
          post.team_id && post.week_number != null
            ? matchupByTeamWeek.get(`${post.league_id}:${post.week_number}:${post.team_id}`)?.label ?? null
            : null,
        matchupParticipants:
          post.team_id && post.week_number != null
            ? matchupByTeamWeek.get(`${post.league_id}:${post.week_number}:${post.team_id}`)?.participants ?? null
            : null,
        videoUrl: play.videoUrl,
        streamUid: play.streamUid,
        iframeUrl: play.iframeUrl,
        messageUrl: post.message_url,
        reactionCounts: {
          like: rows.filter((row) => row.reaction_key === "like").length,
          dislike: rows.filter((row) => row.reaction_key === "dislike").length,
        },
        myReaction: viewerUserId
          ? (rows.find((row) => String(row.user_id) === viewerUserId)?.reaction_key ?? null)
          : null,
        comments: itemComments,
      };
    })
    .filter(Boolean);

  return {
    items,
    selectedAt: (reel.data ?? [])[0]?.selected_at ?? null,
  };
}

export async function toggleSpotlightReaction(input: {
  authUserId: string;
  highlightId: string;
  reactionKey: "like" | "dislike";
}) {
  const user = await requireLinkedRecUser(input.authUserId);
  const onReel = await supabase
    .from("rec_spotlight_reel")
    .select("id")
    .eq("highlight_post_id", input.highlightId)
    .maybeSingle();
  if (onReel.error) throw new ApiError(500, "Failed to verify spotlight clip.", onReel.error);
  if (!onReel.data) throw new ApiError(404, "This clip is not on the Spotlight Reel.");

  const highlight = await supabase
    .from("rec_highlight_posts")
    .select("id,user_id,league_id,season_number")
    .eq("id", input.highlightId)
    .maybeSingle();
  if (highlight.error) throw new ApiError(500, "Failed to load highlight.", highlight.error);
  if (!highlight.data) throw new ApiError(404, "Highlight not found.");

  const existing = await supabase
    .from("rec_highlight_reactions")
    .select("id,reaction_key")
    .eq("highlight_post_id", input.highlightId)
    .eq("user_id", user.recUserId)
    .in("reaction_key", ["like", "dislike"])
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to read spotlight reaction.", existing.error);

  const posterId = String(highlight.data.user_id);
  const canPayPoster = posterId !== user.recUserId;

  async function payPoster(amount: number, description: string, reference: Record<string, unknown>) {
    if (!canPayPoster || amount === 0) return;
    // Note: "highlight" is the closest valid rec_source_type enum member — there is no
    // dedicated "spotlight" value (the prior "spotlight" literal here would have made every
    // one of these coin adjustments fail with an invalid-enum-value error).
    await creditOrBacklog({
      leagueId: highlight.data!.league_id,
      seasonNumber: highlight.data!.season_number,
      userId: posterId,
      amount,
      description,
      transactionType: "spotlight_like",
      source: "highlight",
      sourceReference: reference,
    });
  }

  if (existing.data?.reaction_key === input.reactionKey) {
    const removed = await supabase.from("rec_highlight_reactions").delete().eq("id", existing.data.id);
    if (removed.error) throw new ApiError(500, "Failed to remove reaction.", removed.error);
    if (input.reactionKey === "like") {
      await payPoster(-SPOTLIGHT_LIKE_COINS, "Spotlight Reel like removed", {
        highlightPostId: input.highlightId,
        fromUserId: user.recUserId,
        action: "unlike",
      });
    }
  } else if (existing.data) {
    const wasLike = existing.data.reaction_key === "like";
    const removed = await supabase.from("rec_highlight_reactions").delete().eq("id", existing.data.id);
    if (removed.error) throw new ApiError(500, "Failed to update reaction.", removed.error);
    const inserted = await supabase.from("rec_highlight_reactions").insert({
      id: randomUUID(),
      highlight_post_id: input.highlightId,
      user_id: user.recUserId,
      reaction_key: input.reactionKey,
      created_at: new Date().toISOString(),
    });
    if (inserted.error) throw new ApiError(500, "Failed to update reaction.", inserted.error);
    if (wasLike && input.reactionKey === "dislike") {
      await payPoster(-SPOTLIGHT_LIKE_COINS, "Spotlight Reel like removed", {
        highlightPostId: input.highlightId,
        fromUserId: user.recUserId,
        action: "switch_to_dislike",
      });
    } else if (!wasLike && input.reactionKey === "like") {
      await payPoster(SPOTLIGHT_LIKE_COINS, "Spotlight Reel like", {
        highlightPostId: input.highlightId,
        fromUserId: user.recUserId,
        action: "like",
      });
    }
  } else {
    const inserted = await supabase.from("rec_highlight_reactions").insert({
      id: randomUUID(),
      highlight_post_id: input.highlightId,
      user_id: user.recUserId,
      reaction_key: input.reactionKey,
      created_at: new Date().toISOString(),
    });
    if (inserted.error) throw new ApiError(500, "Failed to save reaction.", inserted.error);
    if (input.reactionKey === "like") {
      await payPoster(SPOTLIGHT_LIKE_COINS, "Spotlight Reel like", {
        highlightPostId: input.highlightId,
        fromUserId: user.recUserId,
        action: "like",
      });
    }
  }

  return getSpotlightReel({ authUserId: input.authUserId });
}

export async function addHighlightComment(input: {
  authUserId: string;
  highlightId: string;
  body: string;
}) {
  const user = await requireLinkedRecUser(input.authUserId);
  const body = input.body.trim();
  if (body.length < 1 || body.length > 1000) {
    throw new ApiError(400, "Comment must be 1–1000 characters.");
  }

  const onReel = await supabase
    .from("rec_spotlight_reel")
    .select("id")
    .eq("highlight_post_id", input.highlightId)
    .maybeSingle();
  if (onReel.error) throw new ApiError(500, "Failed to verify spotlight clip.", onReel.error);
  if (!onReel.data) throw new ApiError(404, "This clip is not on the Spotlight Reel.");

  const inserted = await supabase
    .from("rec_highlight_comments")
    .insert({
      id: randomUUID(),
      highlight_post_id: input.highlightId,
      user_id: user.recUserId,
      body,
      created_at: new Date().toISOString(),
    })
    .select("id,highlight_post_id,user_id,body,created_at")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to post comment.", inserted.error);

  return {
    comment: {
      id: inserted.data.id,
      body: inserted.data.body,
      createdAt: inserted.data.created_at,
      author: {
        displayName: user.displayName,
        username: user.username,
      },
    },
  };
}

export async function listUserBadges(input: { authUserId: string }) {
  const user = await requireLinkedRecUser(input.authUserId);
  return badgesForUser(user.recUserId);
}

export async function badgesForUser(recUserId: string) {
  const rows = await supabase
    .from("rec_badge_ownership")
    .select(
      "badge_key,badge_scope,polarity,tier,earned_count,last_earned_week,created_at,updated_at,league_id,season,week,league:rec_leagues(game)",
    )
    .eq("user_id", recUserId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (rows.error) throw new ApiError(500, "Failed to load badges.", rows.error);

  const descByKey = new Map<string, string>();
  const labelByKey = new Map<string, string>();
  for (const badge of [...GAME_BADGES, ...SEASON_BADGES, ...CAREER_BADGES]) {
    descByKey.set(badge.key, badge.description);
    labelByKey.set(badge.key, badge.label);
  }

  const grouped = new Map<string, {
    badge_key: string;
    badge_label: string;
    badge_scope: string;
    polarity: string | null;
    tier: string | null;
    earned_count: number;
    description: string;
    earnedByGame: Record<string, number>;
  }>();

  for (const row of rows.data ?? []) {
    const key = String(row.badge_key);
    const game = String((row as any).league?.game ?? "global");
    const count = Number(row.earned_count ?? 1);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        badge_key: key,
        badge_label: labelByKey.get(key) ?? key.replaceAll("_", " "),
        badge_scope: String(row.badge_scope ?? "game"),
        polarity: row.polarity ?? null,
        tier: row.tier ?? null,
        earned_count: count,
        description: descByKey.get(key) ?? key.replaceAll("_", " "),
        earnedByGame: { [game]: count },
      });
    } else {
      existing.earned_count += count;
      existing.earnedByGame[game] = (existing.earnedByGame[game] ?? 0) + count;
    }
  }

  const badges = [...grouped.values()];
  return { badges, count: badges.length };
}

const GAME_LABELS_FOR_STATS: Record<string, string> = {
  madden_26: "Madden 26",
  madden_27: "Madden 27",
  cfb_27: "CFB 27",
};

// rec_user_box_score_profile_stats (a materialized per-game-type snapshot) has no writer
// anywhere in apps/api or apps/bot — it has always been empty, for every user, on every
// deployment. Compute career stats live from rec_team_game_stats instead (the same source
// loadCareerBoxScoreStats/aggregateBoxScoreStats already use elsewhere), grouped by game
// type. A deleted league's rows survive (rec_delete_league doesn't touch this table) but its
// league_id now dangles, so those games fall into a synthetic "legacy" bucket instead of
// being silently dropped by the game-type join.
export async function listUserCareerStatsByGame(input: { authUserId: string }) {
  const user = await requireLinkedRecUser(input.authUserId);
  return careerStatsByGameForUser(user.recUserId);
}

export async function careerStatsByGameForUser(recUserId: string) {
  const statRows = await supabase.from("rec_team_game_stats").select("*").eq("user_id", recUserId);
  if (statRows.error) throw new ApiError(500, "Failed to load career stats.", statRows.error);
  const rows = statRows.data ?? [];

  const leagueIds = [...new Set(rows.map((row: any) => row.league_id).filter(Boolean))];
  const leaguesResult = leagueIds.length
    ? await supabase.from("rec_leagues").select("id,game").in("id", leagueIds)
    : { data: [], error: null };
  if (leaguesResult.error) throw new ApiError(500, "Failed to load leagues for career stats.", leaguesResult.error);
  const gameByLeagueId = new Map<string, string>((leaguesResult.data ?? []).map((row: any) => [row.id, String(row.game)]));

  const rowsByGame = new Map<string, any[]>();
  for (const row of rows) {
    const game = gameByLeagueId.get(row.league_id) ?? "legacy";
    const bucket = rowsByGame.get(game) ?? [];
    bucket.push(row);
    rowsByGame.set(game, bucket);
  }

  const games = [...rowsByGame.entries()].map(([game, gameRows]) => {
    const stats = aggregateBoxScoreStats(gameRows);
    return {
      game,
      gameLabel: GAME_LABELS_FOR_STATS[game] ?? (game === "legacy" ? "Deleted/legacy leagues" : game),
      gamesLogged: stats.gamesLogged,
      passingYards: stats.passingYards,
      rushingYards: stats.rushingYards,
      totalYards: stats.totalYards,
      firstDowns: stats.firstDowns,
      turnoversGenerated: stats.turnoversGenerated,
      turnoversCommitted: stats.turnoversCommitted,
      turnoverDifferential: stats.turnoverDifferential,
    };
  });

  return { games: games.sort((a, b) => a.gameLabel.localeCompare(b.gameLabel)) };
}
