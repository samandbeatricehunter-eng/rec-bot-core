import { HIGHLIGHT_AWARD_CATEGORY_LABELS, HIGHLIGHT_AWARD_KEYS, isRegularSeasonWeek } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { deleteDiscordMessage } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { publishTransitionStory } from "../hub/story-publishing.js";

const HIGHLIGHT_PAYOUT_AMOUNT = 25;
const HIGHLIGHT_WEEKLY_PAID_LIMIT = 2;
const HIGHLIGHT_AWARD_AMOUNT = 500;
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
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`Highlight download failed (${response.status}).`);
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "video/mp4";
  if (!contentType.startsWith("video/")) return url;
  const body = await response.arrayBuffer();
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
};

type ReviewHighlightPayoutInput = {
  reviewId: string;
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
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId);
  const assignment = await getActiveAssignment(context.leagueId, account.user_id);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);
  const seasonStage = String(context.rec_leagues.season_stage ?? context.rec_leagues.current_phase ?? "regular_season");

  // Highlights are only accepted during an active season: regular-season Week 1
  // through the championship game. Voting emojis preload only in the regular
  // season; in the postseason the payout is logged but POTY voting is closed.
  const game = context.rec_leagues.game;
  const isRegularSeason = seasonStage === "regular_season" && weekNumber >= 1 && isRegularSeasonWeek(weekNumber, game);
  const isPostseason = ["wild_card", "divisional", "conference_championship", "super_bowl", "postseason", "playoffs"].includes(seasonStage);
  const payoutEligible = isRegularSeason || isPostseason;
  const preloadEmojis = isRegularSeason;

  const existingPost = await supabase
    .from("rec_highlight_posts")
    .select("*")
    .eq("league_id", context.leagueId)
    .eq("discord_channel_id", input.discordChannelId)
    .eq("discord_message_id", input.discordMessageId)
    .maybeSingle();
  if (existingPost.error) throw new ApiError(500, "Failed to check the existing highlight.", existingPost.error);
  if (existingPost.data) {
    // Reconciliation may revisit a clip after a deploy. Use that opportunity to
    // create the durable Storage mirror if the row still points at Discord's CDN.
    if (input.content && !String(existingPost.data.content ?? "").includes(`/storage/v1/object/public/${HIGHLIGHT_BUCKET}/`)) {
      void mirrorHighlightMedia(input.content, context.leagueId, input.discordMessageId)
        .then(async (durableUrl) => {
          if (durableUrl === existingPost.data.content) return;
          await supabase.from("rec_highlight_posts").update({ content: durableUrl, updated_at: new Date().toISOString() }).eq("id", existingPost.data.id);
        })
        .catch((error) => console.error("[ERROR] Failed to mirror reconciled highlight media to storage (non-fatal):", error));
    }
    return {
      recorded: true,
      accepted: true,
      preloadEmojis,
      paidSlotAvailable: Boolean(existingPost.data.payout_review_id),
      highlight: existingPost.data,
    };
  }

  const existingPaid = await supabase
    .from("rec_highlight_payout_reviews")
    .select("id")
    .eq("league_id", context.leagueId)
    .eq("user_id", account.user_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .in("status", ["pending", "approved", "issued"])
    .limit(HIGHLIGHT_WEEKLY_PAID_LIMIT);
  if (existingPaid.error) throw new ApiError(500, "Failed to check highlight payout status.", existingPaid.error);

  const paidSlotAvailable = (existingPaid.data ?? []).length < HIGHLIGHT_WEEKLY_PAID_LIMIT;

  const highlight = await supabase
    .from("rec_highlight_posts")
    .insert({
      league_id: context.leagueId,
      user_id: account.user_id,
      team_id: assignment?.team_id ?? null,
      season_number: seasonNumber,
      week_number: weekNumber,
      season_stage: seasonStage,
      discord_channel_id: input.discordChannelId,
      discord_message_id: input.discordMessageId,
      message_url: input.messageUrl ?? null,
      content: input.content ?? null,
      is_first_this_week: (existingPaid.data ?? []).length === 0,
    })
    .select("*")
    .single();
  if (highlight.error) throw new ApiError(500, "Failed to record highlight.", highlight.error);

  // Discord attachment URLs expire. Mirror the file in the background while the fresh
  // Discord URL remains immediately usable, then point the persisted record at storage.
  if (input.content) {
    void mirrorHighlightMedia(input.content, context.leagueId, input.discordMessageId)
      .then(async (durableUrl) => {
        if (durableUrl === input.content) return;
        await supabase.from("rec_highlight_posts").update({ content: durableUrl, updated_at: new Date().toISOString() }).eq("id", highlight.data.id);
      })
      .catch((error) => console.error("[ERROR] Failed to mirror highlight media to storage (non-fatal):", error));
  }

  // Preseason/training-camp clips may still be retained as community media, but
  // they never create a payout review. Weekly payouts begin with the regular
  // season and remain available through the postseason.
  if (!payoutEligible || !paidSlotAvailable) {
    return {
      recorded: true,
      accepted: true,
      preloadEmojis,
      paidSlotAvailable: false,
      highlight: highlight.data,
    };
  }

  const review = await supabase
    .from("rec_highlight_payout_reviews")
    .insert({
      highlight_post_id: highlight.data.id,
      league_id: context.leagueId,
      user_id: account.user_id,
      team_id: assignment?.team_id ?? null,
      season_number: seasonNumber,
      week_number: weekNumber,
      payout_kind: "weekly_highlight",
      status: "pending",
      amount: HIGHLIGHT_PAYOUT_AMOUNT,
      discord_channel_id: input.discordChannelId,
      discord_message_id: input.discordMessageId,
    })
    .select("*")
    .single();
  if (review.error) throw new ApiError(500, "Failed to create highlight payout review.", review.error);

  const postUpdate = await supabase
    .from("rec_highlight_posts")
    .update({ payout_review_id: review.data.id, updated_at: new Date().toISOString() })
    .eq("id", highlight.data.id);
  if (postUpdate.error) throw new ApiError(500, "Failed to attach highlight payout review.", postUpdate.error);

  const inbox = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: context.serverId,
    league_id: context.leagueId,
    season_number: seasonNumber,
    week_number: weekNumber,
    queue_type: "highlight",
    status: "pending",
    priority: 0,
    header: `Highlight: Wk ${weekNumber}`,
    summary: `Highlight submitted by <@${input.discordId}>.`,
    requester_discord_id: input.discordId,
    requester_user_id: account.user_id,
    amount: HIGHLIGHT_PAYOUT_AMOUNT,
    source_table: "rec_highlight_payout_reviews",
    source_id: review.data.id,
    payload: { reviewId: review.data.id, highlightPostId: highlight.data.id, payoutKind: "weekly_highlight" },
  });
  if (inbox.error) throw new ApiError(500, "Failed to create the commissioner highlight notification.", inbox.error);

  return {
    recorded: true,
    accepted: true,
    preloadEmojis,
    paidSlotAvailable: true,
    highlight: { ...highlight.data, payout_review_id: review.data.id },
    review: review.data,
    commissionerRoleId: (context.routes as any)?.commissioner_role_id ?? null,
    compCommitteeRoleId: (context.routes as any)?.comp_committee_role_id ?? null,
  };
}

export async function reviewHighlightPayout(input: ReviewHighlightPayoutInput) {
  const existing = await supabase
    .from("rec_highlight_payout_reviews")
    .select("*,highlight_post:rec_highlight_posts(*)")
    .eq("id", input.reviewId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load highlight payout review.", existing.error);
  if (!existing.data) throw new ApiError(404, "Highlight payout review was not found.");
  if (existing.data.status !== "pending") {
    return { updated: false, reason: `Review is already ${existing.data.status}.`, review: existing.data, highlight: existing.data.highlight_post };
  }

  if (input.action === "deny") {
    const denied = await supabase
      .from("rec_highlight_payout_reviews")
      .update({
        status: "denied",
        reviewed_by_discord_id: input.reviewedByDiscordId,
        denied_reason: input.deniedReason ?? "Denied by commissioner review.",
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.reviewId)
      .select("*,highlight_post:rec_highlight_posts(*)")
      .single();
    if (denied.error) throw new ApiError(500, "Failed to deny highlight payout review.", denied.error);
    await supabase
      .from("rec_commissioners_inbox")
      .update({
        status: "denied",
        reviewed_by_discord_id: input.reviewedByDiscordId,
        reviewed_at: denied.data.reviewed_at,
        review_reason: denied.data.denied_reason ?? null,
      })
      .eq("source_table", "rec_highlight_payout_reviews")
      .eq("source_id", input.reviewId);
    return { updated: true, review: denied.data, highlight: denied.data.highlight_post };
  }

  const amount = Number(existing.data.amount ?? HIGHLIGHT_PAYOUT_AMOUNT);
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: existing.data.user_id,
    p_amount: amount,
    p_league_id: existing.data.league_id,
    p_description: existing.data.payout_kind === "season_award"
      ? `Play of the Year payout (${existing.data.award_category})`
      : `Highlight payout - Wk ${existing.data.week_number}`,
    p_transaction_type: existing.data.payout_kind === "season_award" ? "highlight_award_payout" : "highlight_payout",
    p_source: "highlight",
    p_source_reference: { reviewId: existing.data.id, highlightPostId: existing.data.highlight_post_id, awardCategory: existing.data.award_category ?? null },
  });
  if (ledger.error) throw new ApiError(500, "Failed to issue highlight payout.", ledger.error);

  const approved = await supabase
    .from("rec_highlight_payout_reviews")
    .update({
      status: "issued",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      issued_ledger_id: ledger.data,
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
    .update({ payout_issued: true, updated_at: new Date().toISOString() })
    .eq("id", existing.data.highlight_post_id);
  if (postUpdate.error) throw new ApiError(500, "Failed to mark highlight payout issued.", postUpdate.error);

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
 * the ones that won a Play of the Year category (those stay in the carousel
 * permanently). Fires one combined headline announcing every POTY category winner.
 * Call this once when the league advances into the offseason, alongside the other
 * season-end automations (EOS payouts, defense nicknames).
 */
export async function cleanupSeasonHighlights(guildId: string, leagueId: string, seasonNumber: number): Promise<{ deleted: number; winners: number }> {
  const [postsResult, winsResult] = await Promise.all([
    supabase.from("rec_highlight_posts").select("id,discord_channel_id,discord_message_id").eq("league_id", leagueId).eq("season_number", seasonNumber),
    supabase
      .from("rec_highlight_payout_reviews")
      .select("highlight_post_id,award_category,user_id,team:rec_teams!rec_highlight_payout_reviews_team_id_fkey(name,abbreviation)")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .eq("payout_kind", "season_award")
      .in("status", ["approved", "issued"]),
  ]);
  if (postsResult.error) throw new ApiError(500, "Failed to load season highlights for cleanup.", postsResult.error);
  if (winsResult.error) throw new ApiError(500, "Failed to load Play of the Year winners.", winsResult.error);

  const posts = postsResult.data ?? [];
  // Safety: POTY tallying (the commissioner's "Run POTY Tallies" action) is a separate
  // manual step that may not have happened yet by the time the league advances. If
  // this season had highlights but zero approved/issued season_award reviews, that's
  // a strong signal tallying hasn't run — abort rather than hard-delete everything
  // under the mistaken assumption that "no winners" means "nothing is exempt."
  if (posts.length > 0 && (winsResult.data ?? []).length === 0) {
    console.warn(`[WARN] cleanupSeasonHighlights: league ${leagueId} season ${seasonNumber} has ${posts.length} highlight(s) but no settled Play of the Year winners — skipping cleanup (POTY tallies likely haven't been run yet).`);
    return { deleted: 0, winners: 0 };
  }

  const winningHighlightIds = new Set((winsResult.data ?? []).map((row: any) => row.highlight_post_id).filter(Boolean));
  const toDelete = posts.filter((post: any) => !winningHighlightIds.has(post.id));

  await Promise.all(toDelete.map(async (post: any) => {
    if (post.discord_channel_id && post.discord_message_id) {
      await deleteDiscordMessage(post.discord_channel_id, post.discord_message_id).catch(() => undefined);
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
    .not("discord_channel_id", "is", null)
    .not("discord_message_id", "is", null);
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
        .select("highlight_post_id,reaction_key")
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
          (webReactions.data ?? []).filter((reaction: any) => reaction.highlight_post_id === highlight.id && reaction.reaction_key === key).length,
        ]),
      ),
    })),
    alreadyFinalized: (existingAwards.data ?? []).length > 0,
  };
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
      amount: Math.max(0, Math.round(input.amount ?? HIGHLIGHT_AWARD_AMOUNT)),
      discord_channel_id: highlight.data.discord_channel_id,
      discord_message_id: highlight.data.discord_message_id,
      updated_at: new Date().toISOString(),
    };

  const review = await supabase.from("rec_highlight_payout_reviews").insert(payload).select("*").single();
  if (review.error) throw new ApiError(500, "Failed to create highlight award review.", review.error);

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

  return {
    review: review.data,
    highlight: highlight.data,
    commissionerRoleId: (context.routes as any)?.commissioner_role_id ?? null,
    compCommitteeRoleId: (context.routes as any)?.comp_committee_role_id ?? null,
  };
}
