import { HIGHLIGHT_AWARD_CATEGORY_LABELS, HIGHLIGHT_AWARD_EMOJIS, HIGHLIGHT_AWARD_KEYS, isRegularSeasonWeek } from "@rec/shared";
import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { deleteDiscordMessage, getDiscordMessage } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { leagueWeekGamesQuery } from "../league-context/league-games.query.js";
import { publishTransitionStory } from "../hub/story-publishing.js";
import { deleteStreamVideosForHighlights, maybeCreateWeeklyPayoutReview, migrateMirroredHighlightsToStream } from "../media/media.service.js";
import { isDiscordOnlyUser } from "../subscriptions/discord-only.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";
import { fetchTrustedRemoteMedia } from "../../lib/remote-media.js";
import { getGlobalEconomyConfig } from "../economy/global-economy-config.service.js";

const HIGHLIGHT_BUCKET = "rec-highlights";

function mediaExtension(url: string, contentType: string) {
  const pathname = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
  const fromPath = pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (fromPath && ["mp4", "mov", "webm", "mkv"].includes(fromPath)) return fromPath;
  if (contentType.includes("quicktime")) return "mov";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("matroska")) return "mkv";
  return "mp4";
}

export async function mirrorHighlightMedia(url: string, leagueId: string, discordMessageId: string) {
  if (!/^https?:\/\//i.test(url) || url.includes(`/storage/v1/object/public/${HIGHLIGHT_BUCKET}/`)) return url;
  const media = await fetchTrustedRemoteMedia(url, {
    maxBytes: 100 * 1024 * 1024,
    timeoutMs: 25_000,
    expectedTypePrefix: "video/",
  });
  const contentType = media.contentType;
  const body = media.buffer;
  const path = `${leagueId}/${discordMessageId}.${mediaExtension(url, contentType)}`;
  const uploaded = await supabase.storage.from(HIGHLIGHT_BUCKET).upload(path, body, { contentType, cacheControl: "31536000", upsert: true });
  if (uploaded.error) throw uploaded.error;
  return supabase.storage.from(HIGHLIGHT_BUCKET).getPublicUrl(path).data.publicUrl;
}

type RecordHighlightInput = {
  guildId: string;
  discordId: string;
  discordChannelId: string;
  discordMessageId: string;
  messageUrl?: string | null;
  content?: string | null;
  attachmentIndex?: number;
};

type ReviewHighlightPayoutInput = {
  reviewId: string;
  leagueId?: string | null;
  action: "approve" | "deny";
  reviewedByDiscordId: string;
  deniedReason?: string | null;
};

type CreateHighlightAwardReviewInput = {
  guildId: string;
  category: string;
  highlightPostId: string;
  voteCount: number;
  amount?: number | null;
};

async function getDiscordAccount(discordId: string) {
  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (account.error) throw new ApiError(500, "Failed to load Discord account.", account.error);
  if (!account.data?.user_id) throw new ApiError(404, "Discord account is not linked to a REC user.");
  return account.data;
}

async function getActiveAssignment(leagueId: string, userId: string) {
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();

  if (assignment.error) throw new ApiError(500, "Failed to load active team assignment.", assignment.error);
  return assignment.data;
}

export async function recordHighlightPost(input: RecordHighlightInput) {
  const highlightConfig = (await getGlobalEconomyConfig()).submissions;
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId);
  const assignment = await getActiveAssignment(context.leagueId, account.user_id);
  const mediaUrl = String(input.content ?? "").trim();
  if (!/^https?:\/\//i.test(mediaUrl)) throw new ApiError(400, "A highlight media URL is required.");
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const seasonStage = String(context.rec_leagues.season_stage ?? "regular_season");
  // rec_games is scoped by season_id, not season_number (the column doesn't exist on rec_games) —
  // filtering by season_number errored on every call, so this match always failed.
  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  const game = await leagueWeekGamesQuery(supabase, { leagueId: context.leagueId, seasonId, weekNumber }, "id").or(`home_user_id.eq.${account.user_id},away_user_id.eq.${account.user_id}`).limit(1).maybeSingle();
  if (game.error) throw new ApiError(500, "Failed to match the highlight to this week's game.", game.error);
  if (!game.data) throw new ApiError(403, "You do not have a matchup this week.");
  const weeklyCount = await supabase.from("rec_highlight_posts").select("id", { count: "exact", head: true })
    .eq("league_id", context.leagueId).eq("user_id", account.user_id).eq("season_number", seasonNumber).eq("week_number", weekNumber);
  if (weeklyCount.error) throw new ApiError(500, "Failed to check the weekly highlight limit.", weeklyCount.error);
  if ((weeklyCount.count ?? 0) >= highlightConfig.highlightWeeklyUploadLimit) return { recorded: false, reason: "weekly_limit", storedInCloudflare: false };
  const highlightId = crypto.randomUUID();
  const now = new Date().toISOString();
  const inserted = await supabase.from("rec_highlight_posts").insert({
    id: highlightId, league_id: context.leagueId, user_id: account.user_id, team_id: assignment?.team_id ?? null,
    season_number: seasonNumber, week_number: weekNumber, season_stage: seasonStage, game_id: game.data.id,
    message_url: input.messageUrl ?? null, content: mediaUrl, playback_url: mediaUrl,
    discord_channel_id: input.discordChannelId, discord_message_id: input.discordMessageId,
    discord_attachment_index: input.attachmentIndex ?? 0,
    storage_provider: "discord_cdn", media_status: "ready", hub_visible: true, created_at: now, updated_at: now,
  }).select("id").single();
  if (inserted.error) throw new ApiError(500, "Failed to save the Discord highlight.", inserted.error);
  await maybeCreateWeeklyPayoutReview({ leagueId: context.leagueId, highlightId, userId: account.user_id,
    teamId: assignment?.team_id ?? null, seasonNumber, weekNumber, seasonStage,
    discordChannelId: input.discordChannelId, discordMessageId: input.discordMessageId,
    game: context.rec_leagues.game ?? null, guildId: input.guildId, requesterDiscordId: input.discordId });
  const migration = await migrateMirroredHighlightsToStream({ leagueId: context.leagueId, limit: 100 });
  return { recorded: true, highlightId, storedInCloudflare: migration.results.some((row) => row.highlightId === highlightId && row.ok) };
}

// Lets a commissioner eyeball the actual clip + claimed matchup before approving a payout,
// so a highlight from the wrong week/game (or an outright fake upload) is easy to catch
// instead of trusting the submitter's word for it.
export async function getHighlightReviewDetail(input: { guildId: string; reviewId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const review = await supabase
    .from("rec_highlight_payout_reviews")
    .select("id,highlight_post_id")
    .eq("id", input.reviewId)
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (review.error) throw new ApiError(500, "Failed to load highlight review.", review.error);
  if (!review.data) throw new ApiError(404, "Highlight review not found.");

  const post = await supabase
    .from("rec_highlight_posts")
    .select(
      "id,week_number,season_stage,cloudflare_stream_uid,storage_provider,playback_url,message_url,user:rec_users(display_name,username),game:rec_games(id,week_number,home_team:rec_teams!rec_games_home_team_id_fkey(name,display_city,display_nick,abbreviation,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(name,display_city,display_nick,abbreviation,is_relocated))",
    )
    .eq("id", review.data.highlight_post_id)
    .maybeSingle();
  if (post.error) throw new ApiError(500, "Failed to load highlight.", post.error);
  if (!post.data) throw new ApiError(404, "Highlight post not found.");

  const game: any = Array.isArray(post.data.game) ? post.data.game[0] : post.data.game;
  const homeTeam: any = game ? (Array.isArray(game.home_team) ? game.home_team[0] : game.home_team) : null;
  const awayTeam: any = game ? (Array.isArray(game.away_team) ? game.away_team[0] : game.away_team) : null;
  const submitter: any = Array.isArray(post.data.user) ? post.data.user[0] : post.data.user;

  return {
    streamUid: post.data.cloudflare_stream_uid ?? null,
    videoUrl: post.data.storage_provider === "cloudflare_stream" ? null : post.data.playback_url ?? null,
    messageUrl: post.data.message_url ?? null,
    weekNumber: post.data.week_number,
    seasonStage: post.data.season_stage,
    submittedByName: submitter?.display_name ?? submitter?.username ?? null,
    matchup: game
      ? {
          weekNumber: game.week_number,
          homeTeamName: formatTeamDisplayName(homeTeam),
          awayTeamName: formatTeamDisplayName(awayTeam),
        }
      : null,
  };
}

export async function reviewHighlightPayout(input: ReviewHighlightPayoutInput) {
  let reviewQuery = supabase
    .from("rec_highlight_payout_reviews")
    .select("*,highlight_post:rec_highlight_posts(*)")
    .eq("id", input.reviewId)
  if (input.leagueId) reviewQuery = reviewQuery.eq("league_id", input.leagueId);
  const existing = await reviewQuery.maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load highlight payout review.", existing.error);
  if (!existing.data) throw new ApiError(404, "Highlight payout review was not found.");
  if (existing.data.status !== "pending") {
    return { updated: false, reason: `Review is already ${existing.data.status}.`, review: existing.data, highlight: existing.data.highlight_post };
  }

  if (input.action === "deny") {
    const reviewedAt = new Date().toISOString();
    const deniedReason = input.deniedReason ?? "Denied by commissioner review.";
    const highlightPost = existing.data.highlight_post;

    // A denied payout means the clip either isn't a real match to the claimed week/matchup
    // or otherwise doesn't qualify — delete it outright rather than leaving a hidden orphan
    // (hub_visible stays false either way, but there's no reason to keep the storage/DB row
    // around). The review row cascades with it (rec_highlight_payout_reviews.highlight_post_id
    // is ON DELETE CASCADE), so update the commissioners-inbox audit row first.
    await supabase
      .from("rec_commissioners_inbox")
      .update({
        status: "denied",
        reviewed_by_discord_id: input.reviewedByDiscordId,
        reviewed_at: reviewedAt,
        review_reason: deniedReason,
      })
      .eq("source_table", "rec_highlight_payout_reviews")
      .eq("source_id", input.reviewId);

    if (highlightPost) await deleteStreamVideosForHighlights([highlightPost]);
    const deleted = await supabase.from("rec_highlight_posts").delete().eq("id", existing.data.highlight_post_id);
    if (deleted.error) throw new ApiError(500, "Failed to delete denied highlight.", deleted.error);

    return { updated: true, action: "denied" as const, deleted: true, highlight: highlightPost };
  }

  const amount = Number(existing.data.amount ?? (await getGlobalEconomyConfig()).submissions.highlight);
  let ledgerId: string | null = null;
  if (amount > 0) {
    const credit = await creditOrBacklog({
      leagueId: existing.data.league_id,
      seasonNumber: existing.data.season_number,
      userId: existing.data.user_id,
      amount,
      description: existing.data.payout_kind === "season_award"
        ? `Play of the Year payout (${existing.data.award_category})`
        : `Highlight payout - Wk ${existing.data.week_number}`,
      transactionType: existing.data.payout_kind === "season_award" ? "highlight_award_payout" : "highlight_payout",
      source: "highlight",
      sourceReference: { reviewId: existing.data.id, highlightPostId: existing.data.highlight_post_id, awardCategory: existing.data.award_category ?? null },
    });
    ledgerId = credit.ledgerId;
  }

  const approved = await supabase
    .from("rec_highlight_payout_reviews")
    .update({
      status: "issued",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      issued_ledger_id: ledgerId,
      reviewed_at: new Date().toISOString(),
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.reviewId)
    .select("*,highlight_post:rec_highlight_posts(*)")
    .single();
  if (approved.error) throw new ApiError(500, "Failed to approve highlight payout review.", approved.error);

  const postUpdate = await supabase
    .from("rec_highlight_posts")
    .update({
      payout_issued: amount > 0,
      hub_visible: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.data.highlight_post_id);
  if (postUpdate.error) throw new ApiError(500, "Failed to mark highlight published.", postUpdate.error);

  await supabase
    .from("rec_commissioners_inbox")
    .update({
      status: "approved",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      reviewed_at: approved.data.reviewed_at,
    })
    .eq("source_table", "rec_highlight_payout_reviews")
    .eq("source_id", input.reviewId);

  const account = await supabase
    .from("rec_discord_accounts")
    .select("discord_id")
    .eq("user_id", existing.data.user_id)
    .maybeSingle();

  return {
    updated: true,
    review: approved.data,
    highlight: approved.data.highlight_post,
    amount,
    streamerDiscordId: account.data?.discord_id ?? null,
  };
}

/**
 * Season-end cleanup: hard-deletes every highlight from the completed season except
 * the ones that won a Play of the Year category (those stay for hub display until
 * the league itself is deleted). Fires one combined headline announcing every POTY
 * category winner. Call this once when the league advances into the offseason,
 * alongside the other season-end automations (EOS payouts, defense nicknames).
 */
export async function cleanupSeasonHighlights(guildId: string, leagueId: string, seasonNumber: number): Promise<{ deleted: number; winners: number }> {
  const [postsResult, winsResult] = await Promise.all([
    supabase.from("rec_highlight_posts").select("id,discord_channel_id,discord_message_id,cloudflare_stream_uid").eq("league_id", leagueId).eq("season_number", seasonNumber),
    supabase
      .from("rec_highlight_payout_reviews")
      .select("highlight_post_id,award_category,user_id,team:rec_teams!rec_highlight_payout_reviews_team_id_fkey(name,abbreviation)")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .eq("payout_kind", "season_award")
      .neq("status", "denied"),
  ]);
  if (postsResult.error) throw new ApiError(500, "Failed to load season highlights for cleanup.", postsResult.error);
  if (winsResult.error) throw new ApiError(500, "Failed to load Play of the Year winners.", winsResult.error);

  const posts = postsResult.data ?? [];
  // "Winner" = any season_award review not denied — pending counts, since this runs
  // right after settleSeasonHighlightAwards auto-creates the (still-pending, awaiting
  // commissioner approval) reviews at the same advance-into-offseason trigger. Only a
  // denied review means a highlight was reviewed and rejected as not qualifying.
  //
  // Safety: if this season had highlights but the settle step somehow produced zero
  // reviews at all (e.g. it failed, or ran with a stale finalized flag), that's a
  // strong signal something's wrong — abort rather than hard-delete everything under
  // the mistaken assumption that "no winners" means "nothing is exempt."
  if (posts.length > 0 && (winsResult.data ?? []).length === 0) {
    console.warn(`[WARN] cleanupSeasonHighlights: league ${leagueId} season ${seasonNumber} has ${posts.length} highlight(s) but no settled Play of the Year winners — skipping cleanup (POTY tallies likely haven't been run yet).`);
    return { deleted: 0, winners: 0 };
  }

  const winningHighlightIds = new Set((winsResult.data ?? []).map((row: any) => row.highlight_post_id).filter(Boolean));
  const toDelete = posts.filter((post: any) => !winningHighlightIds.has(post.id));
  const toRetain = posts.filter((post: any) => winningHighlightIds.has(post.id));

  if (toRetain.length) {
    await supabase
      .from("rec_highlight_posts")
      .update({ retained_as_poty: true, updated_at: new Date().toISOString() })
      .in("id", toRetain.map((post: any) => post.id));
  }

  await deleteStreamVideosForHighlights(toDelete);

  await Promise.all(toDelete.map(async (post: any) => {
    if (post.discord_channel_id && post.discord_message_id) {
      await bestEffort("discord.delete_highlight_message", () => deleteDiscordMessage(post.discord_channel_id, post.discord_message_id), { entityId: post.id });
    }
  }));
  if (toDelete.length) {
    const deleted = await supabase.from("rec_highlight_posts").delete().in("id", toDelete.map((post: any) => post.id));
    if (deleted.error) throw new ApiError(500, "Failed to delete non-winning season highlights.", deleted.error);
  }

  const winnerRows = winsResult.data ?? [];
  if (winnerRows.length) {
    const lines = winnerRows.map((row: any) => {
      const label = HIGHLIGHT_AWARD_CATEGORY_LABELS[row.award_category] ?? row.award_category;
      const teamName = row.team?.name ?? row.team?.abbreviation ?? "a program";
      return `**${label}:** ${teamName}`;
    });
    await publishTransitionStory({
      guildId,
      headline: "Play of the Year Winners",
      body: lines.join("\n"),
      primaryAngle: "play_of_the_year",
    }).catch((error) => console.error("[ERROR] Failed to publish Play of the Year headline (non-fatal):", error));
  }

  return { deleted: toDelete.length, winners: winnerRows.length };
}

export async function listHighlightAwardCandidates(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const { data, error } = await supabase
    .from("rec_highlight_posts")
    .select("*")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("season_stage", "regular_season")
    .eq("media_status", "ready");
  if (error) throw new ApiError(500, "Failed to load highlight award candidates.", error);

  // POTY is finalized once any season_award review exists for the season — after
  // that, emoji changes don't re-tally until the league advances to a new season.
  const existingAwards = await supabase
    .from("rec_highlight_payout_reviews")
    .select("id")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("payout_kind", "season_award")
    .limit(1);
  if (existingAwards.error) throw new ApiError(500, "Failed to check POTY finalization.", existingAwards.error);

  const highlightIds = (data ?? []).map((highlight: any) => highlight.id);
  const webReactions = highlightIds.length
    ? await supabase
        .from("rec_highlight_reactions")
        .select("highlight_post_id,user_id,reaction_key")
        .in("highlight_post_id", highlightIds)
        .in("reaction_key", [...HIGHLIGHT_AWARD_KEYS])
    : { data: [], error: null };
  if (webReactions.error) throw new ApiError(500, "Failed to load League Hub award votes.", webReactions.error);

  return {
    league: { id: context.leagueId, seasonNumber, announcementsChannelId: (context.routes as any)?.announcements_channel_id ?? null },
    highlights: (data ?? []).map((highlight: any) => ({
      ...highlight,
      webReactionCounts: Object.fromEntries(
        HIGHLIGHT_AWARD_KEYS.map((key) => [
          key,
            (webReactions.data ?? []).filter((reaction: any) => reaction.highlight_post_id === highlight.id && reaction.reaction_key === key && reaction.user_id !== highlight.user_id).length,
        ]),
      ),
    })),
    alreadyFinalized: (existingAwards.data ?? []).length > 0,
  };
}

/**
 * Auto-tallies Play of the Year: per category, combines each highlight's Discord
 * native-emoji reactions (read via REST — no live bot gateway client needed, matching
 * the rest of this app's "web/API talks to Discord directly" advance architecture)
 * with its web reaction pills, and creates a (pending, commissioner-approved)
 * award review for whichever highlight(s) lead — ties split the payout evenly.
 * Call this once when the league advances into the offseason, same trigger as the
 * other season-end automations (EOS payouts, defense nicknames, highlight cleanup —
 * which must run AFTER this, since it only preserves highlights with a season_award
 * review already on record).
 */
export async function settleSeasonHighlightAwards(guildId: string): Promise<{ winners: number; alreadyFinalized: boolean }> {
  const candidates = await listHighlightAwardCandidates(guildId);
  if (candidates.alreadyFinalized) return { winners: 0, alreadyFinalized: true };

  const leaders = new Map<string, { count: number; highlights: any[] }>();
  for (const highlight of candidates.highlights) {
    for (const category of HIGHLIGHT_AWARD_KEYS) {
      // Only an explicit POTY category submission in the Hub is a nomination.
      const count = Number(highlight.webReactionCounts?.[category] ?? 0);
      if (count <= 0) continue;
      const entry = { ...highlight };
      const current = leaders.get(category);
      if (!current || count > current.count) leaders.set(category, { count, highlights: [entry] });
      else if (count === current.count) current.highlights.push(entry);
    }
  }

  let winners = 0;
  for (const [category, { count, highlights: tied }] of leaders) {
    const splitAmount = Math.floor((await getGlobalEconomyConfig()).submissions.highlightSeasonAward / tied.length);
    for (const winner of tied) {
      await createHighlightAwardReview({ guildId, category, highlightPostId: winner.id, voteCount: count, amount: splitAmount });
      winners += 1;
    }
  }

  if (winners > 0) {
    const lines = [...leaders.entries()].map(([category, { count, highlights: tied }]) => {
      const label = HIGHLIGHT_AWARD_CATEGORY_LABELS[category] ?? category;
      const names = tied.map((h: any) => h.team?.name ?? h.user?.display_name ?? "a coach").join(", ");
      return `**${label}:** ${names}${tied.length > 1 ? " (tie — split)" : ""} — ${count} vote${count === 1 ? "" : "s"}`;
    });
    await publishTransitionStory({
      guildId,
      headline: "Play of the Year Nominees Are In",
      body: lines.join("\n"),
      primaryAngle: "play_of_the_year_nominees",
    }).catch((error) => console.error("[ERROR] Failed to publish POTY nominee headline (non-fatal):", error));
  }

  return { winners, alreadyFinalized: false };
}

export async function createHighlightAwardReview(input: CreateHighlightAwardReviewInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const highlight = await supabase
    .from("rec_highlight_posts")
    .select("*")
    .eq("id", input.highlightPostId)
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (highlight.error) throw new ApiError(500, "Failed to load award highlight.", highlight.error);
  if (!highlight.data) throw new ApiError(404, "Highlight was not found.");

  // Keyed by category + highlight so ties produce one review per tied winner. Once
  // a review exists it's locked (frozen) — re-running the tally never changes it.
  const existing = await supabase
    .from("rec_highlight_payout_reviews")
    .select("*")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .eq("payout_kind", "season_award")
    .eq("award_category", input.category)
    .eq("highlight_post_id", input.highlightPostId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load existing highlight award review.", existing.error);
  if (existing.data) {
    return {
      review: existing.data,
      highlight: highlight.data,
      commissionerRoleId: (context.routes as any)?.commissioner_role_id ?? null,
      compCommitteeRoleId: (context.routes as any)?.comp_committee_role_id ?? null,
    };
  }

  const payload = {
      highlight_post_id: highlight.data.id,
      league_id: context.leagueId,
      user_id: highlight.data.user_id,
      team_id: highlight.data.team_id,
      season_number: seasonNumber,
      week_number: highlight.data.week_number,
      payout_kind: "season_award",
      award_category: input.category,
      vote_count: input.voteCount,
      status: "pending",
      amount: Math.max(0, Math.round(input.amount ?? (await getGlobalEconomyConfig()).submissions.highlightSeasonAward)),
      discord_channel_id: highlight.data.discord_channel_id,
      discord_message_id: highlight.data.discord_message_id,
      updated_at: new Date().toISOString(),
    };

  const review = await supabase.from("rec_highlight_payout_reviews").insert(payload).select("*").single();
  if (review.error) throw new ApiError(500, "Failed to create highlight award review.", review.error);

  await supabase
    .from("rec_highlight_posts")
    .update({ retained_as_poty: true, updated_at: new Date().toISOString() })
    .eq("id", highlight.data.id);

  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: context.leagueId,
    season_number: seasonNumber,
    week_number: highlight.data.week_number,
    queue_type: "highlight",
    status: "pending",
    priority: 0,
    header: `Player of the Season award: ${input.category}`,
    summary: `Highlight nominated for ${input.category} (${input.voteCount} votes).`,
    requester_discord_id: null,
    requester_user_id: highlight.data.user_id,
    amount: payload.amount,
    source_table: "rec_highlight_payout_reviews",
    source_id: review.data.id,
    payload: { reviewId: review.data.id, highlightPostId: highlight.data.id, payoutKind: "season_award", category: input.category },
  });
  void notifyLeagueCommissionersOfPendingItem(context.leagueId);

  return {
    review: review.data,
    highlight: highlight.data,
    commissionerRoleId: (context.routes as any)?.commissioner_role_id ?? null,
    compCommitteeRoleId: (context.routes as any)?.comp_committee_role_id ?? null,
  };
}

/**
 * Game of the Year: tallies explicit "goty" nominations across every
 * H2H game played this season and creates a pending review for whichever game(s)
 * lead. Unlike Play of the Year, ties are NOT auto-split — every tied game gets
 * its own row and the commissioner picks the winner from the Pending Payouts
 * inbox by approving one and denying the rest. Call this at the same season-end
 * boundary as the other automations (POTY, EOS payouts).
 */
export async function settleGameOfTheYear(guildId: string): Promise<{ candidates: number; alreadyFinalized: boolean }> {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);

  const existing = await supabase
    .from("rec_game_of_year_reviews")
    .select("id")
    .eq("league_id", context.leagueId)
    .eq("season_number", seasonNumber)
    .limit(1);
  if (existing.error) throw new ApiError(500, "Failed to check Game of the Year finalization.", existing.error);
  if ((existing.data ?? []).length > 0) return { candidates: 0, alreadyFinalized: true };

  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  let gamesQuery = supabase
    .from("rec_games")
    .select("id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation)")
    .eq("league_id", context.leagueId)
    .not("home_user_id", "is", null)
    .not("away_user_id", "is", null);
  if (seasonId) gamesQuery = gamesQuery.eq("season_id", seasonId);
  const games = await gamesQuery;
  if (games.error) throw new ApiError(500, "Failed to load season games for Game of the Year.", games.error);
  const gameIds = (games.data ?? []).map((game: any) => game.id);
  if (!gameIds.length) return { candidates: 0, alreadyFinalized: false };

  const reactions = await supabase.from("rec_game_reactions").select("game_id,user_id,reaction_key").in("game_id", gameIds);
  if (reactions.error) throw new ApiError(500, "Failed to load game reactions for Game of the Year.", reactions.error);
  const likeCounts = new Map<string, number>();
  for (const row of reactions.data ?? []) {
    if (row.reaction_key !== "goty") continue;
    likeCounts.set(row.game_id, (likeCounts.get(row.game_id) ?? 0) + 1);
  }

  const maxLikes = Math.max(0, ...[...likeCounts.values()]);
  if (maxLikes <= 0) return { candidates: 0, alreadyFinalized: false };
  const topGames = (games.data ?? []).filter((game: any) => (likeCounts.get(game.id) ?? 0) === maxLikes);

  let candidates = 0;
  for (const game of topGames) {
    const homeTeam = Array.isArray(game.home_team) ? game.home_team[0] : game.home_team;
    const awayTeam = Array.isArray(game.away_team) ? game.away_team[0] : game.away_team;
    const inserted = await supabase.from("rec_game_of_year_reviews").upsert({
      league_id: context.leagueId,
      game_id: game.id,
      season_number: seasonNumber,
      like_count: maxLikes,
      home_user_id: game.home_user_id,
      home_team_id: homeTeam?.id ?? null,
      home_team_label: homeTeam?.name ?? homeTeam?.abbreviation ?? "Home",
      away_user_id: game.away_user_id,
      away_team_id: awayTeam?.id ?? null,
      away_team_label: awayTeam?.name ?? awayTeam?.abbreviation ?? "Away",
      amount: Math.floor((await getGlobalEconomyConfig()).submissions.gameOfYear / topGames.length),
      status: "pending",
    }, { onConflict: "league_id,season_number,game_id" }).select("id").single();
    if (inserted.error) throw new ApiError(500, "Failed to create Game of the Year review.", inserted.error);

    await supabase.from("rec_commissioners_inbox").insert({
      guild_id: guildId,
      server_id: context.serverId,
      league_id: context.leagueId,
      season_number: seasonNumber,
      week_number: null,
      queue_type: "game_of_the_year",
      status: "pending",
      priority: 0,
      header: `Game of the Year candidate: ${awayTeam?.name ?? "Away"} @ ${homeTeam?.name ?? "Home"}`,
      summary: topGames.length > 1
        ? `Tied at ${maxLikes} eligible like${maxLikes === 1 ? "" : "s"} — the payout is split evenly across the tied games.`
        : `Leads the season with ${maxLikes} like${maxLikes === 1 ? "" : "s"}.`,
      requester_discord_id: null,
      requester_user_id: null,
      amount: Math.floor((await getGlobalEconomyConfig()).submissions.gameOfYear / topGames.length),
      source_table: "rec_game_of_year_reviews",
      source_id: inserted.data.id,
      payload: { reviewId: inserted.data.id, gameId: game.id, likeCount: maxLikes, tied: topGames.length > 1 },
    });
    void notifyLeagueCommissionersOfPendingItem(context.leagueId);
    candidates += 1;
  }

  if (candidates > 0) {
    const names = topGames.map((game: any) => {
      const homeTeam = Array.isArray(game.home_team) ? game.home_team[0] : game.home_team;
      const awayTeam = Array.isArray(game.away_team) ? game.away_team[0] : game.away_team;
      return `${awayTeam?.name ?? "Away"} @ ${homeTeam?.name ?? "Home"}`;
    });
    await publishTransitionStory({
      guildId,
      headline: "Game of the Year Candidates Are In",
      body: `${names.join(", ")} — ${maxLikes} like${maxLikes === 1 ? "" : "s"}${topGames.length > 1 ? ". Tied — the commissioner will pick the winner." : "."}`,
      primaryAngle: "game_of_the_year_nominees",
    }).catch((error) => console.error("[ERROR] Failed to publish Game of the Year headline (non-fatal):", error));
  }

  return { candidates, alreadyFinalized: false };
}

type ReviewGameOfYearInput = {
  leagueId?: string | null;
  guildId?: string | null;
  reviewId: string;
  action: "approve" | "deny";
  reviewedByDiscordId: string;
  deniedReason?: string | null;
};

export async function reviewGameOfYearPayout(input: ReviewGameOfYearInput) {
  let reviewQuery = supabase.from("rec_game_of_year_reviews").select("*").eq("id", input.reviewId);
  if (input.leagueId) reviewQuery = reviewQuery.eq("league_id", input.leagueId);
  const existing = await reviewQuery.maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load Game of the Year review.", existing.error);
  if (!existing.data) throw new ApiError(404, "Game of the Year review was not found.");
  if (existing.data.status !== "pending") {
    return { updated: false, reason: `Review is already ${existing.data.status}.`, review: existing.data };
  }

  if (input.action === "deny") {
    const denied = await supabase
      .from("rec_game_of_year_reviews")
      .update({
        status: "denied",
        reviewed_by_discord_id: input.reviewedByDiscordId,
        denied_reason: input.deniedReason ?? "Denied by commissioner review.",
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.reviewId)
      .select("*")
      .single();
    if (denied.error) throw new ApiError(500, "Failed to deny Game of the Year review.", denied.error);
    await supabase.from("rec_commissioners_inbox").update({
      status: "denied",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      reviewed_at: denied.data.reviewed_at,
    }).eq("source_table", "rec_game_of_year_reviews").eq("source_id", input.reviewId);
    return { updated: true, review: denied.data };
  }

  // Approving a winner denies every other tied candidate from the same season —
  // the whole point of a manual commissioner tie-break.
  const amount = Number(existing.data.amount ?? (await getGlobalEconomyConfig()).submissions.gameOfYear);
  for (const [userId, label] of [[existing.data.home_user_id, existing.data.home_team_label], [existing.data.away_user_id, existing.data.away_team_label]] as const) {
    if (!userId) continue;
    // Note: "gotw" is the closest valid rec_source_type enum member — there is no dedicated
    // "game_of_the_year" value (the prior "game_of_the_year" literal here would have made
    // every one of these payouts fail with an invalid-enum-value error).
    await creditOrBacklog({
      leagueId: existing.data.league_id,
      seasonNumber: existing.data.season_number,
      userId,
      amount,
      description: `Game of the Year payout (${label ?? "team"})`,
      transactionType: "game_of_the_year_payout",
      source: "gotw",
      sourceReference: { reviewId: existing.data.id, gameId: existing.data.game_id },
    });
  }

  const approved = await supabase
    .from("rec_game_of_year_reviews")
    .update({
      status: "issued",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      reviewed_at: new Date().toISOString(),
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.reviewId)
    .select("*")
    .single();
  if (approved.error) throw new ApiError(500, "Failed to approve Game of the Year review.", approved.error);

  await supabase.from("rec_commissioners_inbox").update({
    status: "approved",
    reviewed_by_discord_id: input.reviewedByDiscordId,
    reviewed_at: approved.data.reviewed_at,
  }).eq("source_table", "rec_game_of_year_reviews").eq("source_id", input.reviewId);

  await publishTransitionStory({
    guildId: input.guildId ?? "",
    headline: "Game of the Year",
    body: `${existing.data.away_team_label ?? "Away"} @ ${existing.data.home_team_label ?? "Home"} takes it home with ${existing.data.like_count} like${existing.data.like_count === 1 ? "" : "s"}.`,
    primaryAngle: "game_of_the_year",
  }).catch((error) => console.error("[ERROR] Failed to publish Game of the Year winner headline (non-fatal):", error));

  return { updated: true, review: approved.data, amount };
}
