// Cross-league Discord "recruiting board": one live-edited embed per league (with open teams)
// in the management guild's per-game-type league-post channel, plus the request flow for
// users who aren't in that league's own Discord server (or whose league has none) yet.
import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage, editDiscordMessage, deleteDiscordMessage, getGuildMemberDisplayNameMap } from "../../lib/discord-guild.js";
import { getSiteDiscordConfig } from "../admin/site-discord-config.service.js";
import { checkLeagueLinked } from "../setup/setup.service.js";
import { listOpenTeamsForLeagueId } from "../team-ownership/team-ownership.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { grantWelcomeBonus } from "../economy/welcome-bonus.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { CFB_LEAGUE_TEMPLATES, MADDEN_LEAGUE_TEMPLATES } from "@rec/shared";

const GAME_LABELS: Record<string, string> = { madden_26: "Madden NFL 26", madden_27: "Madden NFL 27", cfb_27: "College Football 27" };

function channelForGame(config: Awaited<ReturnType<typeof getSiteDiscordConfig>>, game: string): string | null {
  if (game === "madden_26") return config.leaguePostChannels.madden_26;
  if (game === "madden_27") return config.leaguePostChannels.madden_27;
  if (game === "cfb_27") return config.leaguePostChannels.cfb_27;
  return null;
}

async function loadLeagueForAd(leagueId: string) {
  const { data, error } = await supabase.from("rec_leagues").select("id,name,game,max_members,template_id").eq("id", leagueId).maybeSingle();
  if (error) throw new ApiError(500, "Failed to load league.", error);
  return data as { id: string; name: string; game: string; max_members: number | null; template_id: string | null } | null;
}

function templateDisplayName(game: string, templateId: string | null): string | null {
  if (!templateId) return null;
  const catalog = game === "cfb_27" ? CFB_LEAGUE_TEMPLATES : MADDEN_LEAGUE_TEMPLATES;
  return catalog.find((t) => t.id === templateId)?.name ?? null;
}

async function removeAd(leagueId: string) {
  const existing = await supabase.from("rec_league_recruiting_ads").select("*").eq("league_id", leagueId).maybeSingle();
  if (existing.data?.message_id) await deleteDiscordMessage(existing.data.channel_id, existing.data.message_id);
  if (existing.data) await supabase.from("rec_league_recruiting_ads").delete().eq("league_id", leagueId);
}

function buildAdPayload(
  league: { id: string; name: string; game: string; template_id: string | null },
  allTeams: any[],
  openTeamIds: Set<string>,
  rosterInfo: { rosterType: string | null; draftScheduledAt: string | null },
) {
  const openCount = allTeams.filter((team) => openTeamIds.has(team.id)).length;

  // Every team is already listed directly in the embed (struck through once taken), so the
  // separate "Open Teams" button was a redundant extra click — removed. Grouped into one
  // field per conference (with bold division sub-headers inside, blank-line separated) so a
  // 32-team league reads as a structured standings sheet instead of one long flat list.
  const byConference = new Map<string, any[]>();
  for (const team of allTeams) {
    const key = team.conference || "Teams";
    const list = byConference.get(key) ?? [];
    list.push(team);
    byConference.set(key, list);
  }
  const fields = [...byConference.entries()].slice(0, 25).map(([conference, teams]) => {
    const byDivision = new Map<string, any[]>();
    for (const team of teams) {
      const key = team.division || "";
      const list = byDivision.get(key) ?? [];
      list.push(team);
      byDivision.set(key, list);
    }
    const lines: string[] = [];
    for (const [division, divisionTeams] of byDivision) {
      if (division) lines.push(`**${division}**`);
      for (const team of divisionTeams) {
        const name = formatTeamDisplayName(team) ?? team.name;
        lines.push(openTeamIds.has(team.id) ? name : `~~${name}~~`);
      }
      lines.push("");
    }
    return { name: `**${conference}**`, value: lines.join("\n").trim().slice(0, 1024) || "—", inline: true };
  });

  // "Regs" (roster carries over / default catalog teams) vs "Fantasy Draft" (roster built via
  // a scheduled draft night) — the single biggest thing a recruit wants to know up front.
  const rosterTypeLabel = rosterInfo.rosterType === "fantasy_draft" ? "Fantasy Draft" : "Regs";
  const templateName = templateDisplayName(league.game, league.template_id);
  const descriptionLines = [
    `${GAME_LABELS[league.game] ?? league.game} — **${openCount}** of **${allTeams.length}** teams open.`,
    `**${rosterTypeLabel}**${templateName ? ` · Template: ${templateName}` : ""}`,
  ];
  // Discord's <t:UNIX:R> timestamp renders as a live, self-updating "in X hours" countdown on
  // every client with zero further edits from us — far more reliable than trying to keep an
  // embed synced with a setInterval-style re-post loop.
  if (rosterInfo.rosterType === "fantasy_draft" && rosterInfo.draftScheduledAt) {
    const unix = Math.floor(new Date(rosterInfo.draftScheduledAt).getTime() / 1000);
    descriptionLines.push(`🗓️ Fantasy Draft: <t:${unix}:F> (<t:${unix}:R>)`);
  }
  const baseDescription = descriptionLines.join("\n");
  // Discord rejects an embed outright once title+description+all field name/value text
  // combined exceeds 6000 characters — a large-conference-count league (CFB, easily 10+
  // conferences vs Madden's 8 divisions) can cross that with per-conference team lists. A
  // rejected post/edit used to fail completely silently, leaving the ad frozen on whatever it
  // last showed; degrading to a compact summary here means the ad always at least updates.
  const totalFieldLength = fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
  const fitsEmbedLimit = league.name.length + baseDescription.length + totalFieldLength < 5500;
  const embed = {
    title: league.name,
    description: fitsEmbedLimit
      ? baseDescription
      : `${baseDescription}\n\nThis league has too many teams to list here — tap **Request Team** for the full conference/division breakdown.`,
    color: 0x2ecc71,
    fields: fitsEmbedLimit ? fields : [],
    footer: { text: "League Settings for a full rundown · Request Team to claim an open team." },
  };
  // Both League Settings and Request Team open a paginated ephemeral browser (Discord modals
  // can't hold buttons/select menus or scrollable content — only up to 5 text-input fields —
  // so a real "browse this, then pick one" flow has to be an ephemeral message with Prev/Next
  // buttons, not a modal).
  const components: any[] = [
    {
      type: 1,
      components: [
        { type: 2, style: 2, label: "League Settings", custom_id: `rec:board:settings:${league.id}:0` },
        ...(openCount > 0 ? [{ type: 2, style: 1, label: "Request Team", custom_id: `rec:board:reqpage:${league.id}:0` }] : []),
      ],
    },
  ];
  return { embeds: [embed], components };
}

/** Re-render (or remove) a single league's recruiting-board ad. Called after any team
 * assignment/request change so the embed's strikethroughs stay current; safe to call whenever
 * — it's a no-op if the league has no game-type channel configured yet. */
export async function syncLeagueRecruitingAd(leagueId: string): Promise<void> {
  try {
    const league = await loadLeagueForAd(leagueId);
    if (!league) return void (await removeAd(leagueId));

    const config = await getSiteDiscordConfig();
    const channelId = channelForGame(config, league.game);
    if (!channelId) return void (await removeAd(leagueId));

    const { openTeams, allTeams } = await listOpenTeamsForLeagueId(leagueId);
    if (!openTeams.length) return void (await removeAd(leagueId));

    const openTeamIds = new Set<string>(openTeams.map((team: any) => String(team.id)));

    const [configResult, draftResult] = await Promise.all([
      supabase.from("rec_league_configuration").select("roster_type").eq("league_id", leagueId).maybeSingle(),
      supabase.from("rec_fantasy_draft_sessions").select("scheduled_at,status").eq("league_id", leagueId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const rosterInfo = {
      rosterType: configResult.data?.roster_type ?? null,
      draftScheduledAt: draftResult.data?.status === "scheduled" ? draftResult.data.scheduled_at : null,
    };

    const payload = buildAdPayload(league, allTeams, openTeamIds, rosterInfo);

    const existing = await supabase.from("rec_league_recruiting_ads").select("*").eq("league_id", leagueId).maybeSingle();
    if (existing.data?.message_id && existing.data.channel_id === channelId) {
      const edited = await editDiscordMessage(channelId, existing.data.message_id, payload);
      if (edited) {
        await supabase.from("rec_league_recruiting_ads").update({ game: league.game, updated_at: new Date().toISOString() }).eq("league_id", leagueId);
        return;
      }
    } else if (existing.data?.message_id) {
      await deleteDiscordMessage(existing.data.channel_id, existing.data.message_id);
    }

    const posted = await postDiscordChannelMessage(channelId, payload);
    await supabase.from("rec_league_recruiting_ads").upsert(
      { league_id: leagueId, game: league.game, channel_id: channelId, message_id: posted?.id ?? null, updated_at: new Date().toISOString() },
      { onConflict: "league_id" },
    );
  } catch (error) {
    console.error("[WARN] Failed to sync recruiting-board ad:", error);
  }
}

/** Backfill/repair every league of a game family — used after an admin sets or changes a
 * league-post channel so already-open leagues appear without waiting for their next roster event. */
export async function syncAllRecruitingAdsForGame(game: string): Promise<void> {
  const leagues = await supabase.from("rec_leagues").select("id").eq("game", game);
  if (leagues.error) throw new ApiError(500, "Failed to load leagues for recruiting-board backfill.", leagues.error);
  for (const row of leagues.data ?? []) await syncLeagueRecruitingAd(row.id);
}

export async function getRecruitingBoardOpenTeams(leagueId: string) {
  const league = await loadLeagueForAd(leagueId);
  if (!league) throw new ApiError(404, "League not found.");
  const { openTeams } = await listOpenTeamsForLeagueId(leagueId);
  return {
    leagueName: league.name,
    game: league.game,
    openTeams: openTeams.map((team: any) => ({
      id: team.id,
      name: formatTeamDisplayName(team) ?? team.name,
      conference: team.conference ?? null,
      division: team.division ?? null,
    })),
  };
}

export type RecruitingBoardGroup = {
  groupLabel: string;
  teams: Array<{ id: string; name: string; open: boolean }>;
};

/** Teams grouped by conference (CFB) or division (Madden) for the paginated Request Team
 * browser — one Discord page per group, since a single 25-option select menu can't hold a
 * full league and a flat list has no way to convey "these go together." */
export async function getRecruitingBoardGroupedTeams(leagueId: string): Promise<{ leagueName: string; groups: RecruitingBoardGroup[] }> {
  const league = await loadLeagueForAd(leagueId);
  if (!league) throw new ApiError(404, "League not found.");
  const { openTeams, allTeams } = await listOpenTeamsForLeagueId(leagueId);
  const openTeamIds = new Set<string>(openTeams.map((team: any) => String(team.id)));
  const isCfb = league.game === "cfb_27";
  const byGroup = new Map<string, RecruitingBoardGroup["teams"]>();
  for (const team of allTeams as any[]) {
    const key = (isCfb ? team.conference : team.division) || (isCfb ? team.division : team.conference) || "Teams";
    const list = byGroup.get(key) ?? [];
    list.push({ id: team.id, name: formatTeamDisplayName(team) ?? team.name, open: openTeamIds.has(team.id) });
    byGroup.set(key, list);
  }
  return {
    leagueName: league.name,
    groups: [...byGroup.entries()].map(([groupLabel, teams]) => ({ groupLabel, teams })),
  };
}

// `game` filters entries to CFB-only ("cfb"), Madden-only ("madden"), or unset for always-shown.
// `condition` additionally hides a field based on the loaded config row (e.g. Required Console
// only matters once cross-play is off) — evaluated after the game filter.
const LEAGUE_SETTINGS_SECTIONS: Array<{
  title: string;
  fields: Array<[label: string, key: string, game?: "cfb" | "madden", condition?: (row: Record<string, unknown>) => boolean]>;
}> = [
  {
    title: "General & Format",
    fields: [
      ["Roster type", "roster_type"],
      ["Quarter length", "quarter_length_minutes"], ["Accelerated clock", "accelerated_clock_enabled"],
      ["Difficulty", "difficulty", "madden"], ["CFB difficulty", "cfb_difficulty", "cfb"],
      ["Cross-play", "cross_play_enabled"],
      ["Required console", "required_console", undefined, (row) => row.cross_play_enabled === false],
      ["Advance timing", "advance_timing"],
    ],
  },
  {
    title: "Purchases & Economy",
    fields: [
      ["Coin economy", "coin_economy_enabled"], ["Custom players", "custom_players_enabled"],
      ["Legends", "legends_enabled"], ["Dev upgrades", "dev_upgrades_enabled"],
      ["Age resets", "age_resets_enabled"], ["Attribute purchases", "attribute_purchases_enabled"],
      ["Contract adjustments", "contract_adjustment_purchases_enabled"],
    ],
  },
  {
    title: "Gameplay Rules",
    fields: [
      ["Salary cap", "salary_cap_enabled"], ["Injuries", "injury_policy"], ["Wear and tear", "wear_and_tear_enabled"],
      ["Trade approval", "trade_approval_policy"], ["Trade deadline", "trade_deadline_enabled"],
      ["CPU trading", "cpu_trading_policy"], ["4th down rule (regular)", "fourth_down_rule_type_regular"],
      ["4th down rule (playoff)", "fourth_down_rule_type_playoff"], ["Custom playbooks", "custom_playbooks_allowed"],
      ["Position changes", "position_change_policy"],
    ],
  },
  {
    title: "Streaming & Requirements",
    fields: [
      ["Regular season streaming", "regular_season_streaming_requirement"], ["Postseason streaming", "postseason_streaming_requirement"],
      ["Custom coaches required", "custom_coaches_required"], ["Fair sim requirements", "fair_sim_requirements"],
      ["Force win requirements", "force_win_requirements"],
    ],
  },
];

function formatSettingValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value.trim() ? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
  return String(value);
}

/** Curated, recruit-relevant subset of rec_league_configuration's ~130 columns, grouped into
 * pages — not every raw setting, just what actually helps someone decide whether to join. */
export async function getRecruitingBoardLeagueSettings(leagueId: string): Promise<{ leagueName: string; pages: Array<{ title: string; lines: string[] }> }> {
  const league = await loadLeagueForAd(leagueId);
  if (!league) throw new ApiError(404, "League not found.");
  const config = await supabase.from("rec_league_configuration").select("*").eq("league_id", leagueId).maybeSingle();
  if (config.error) throw new ApiError(500, "Failed to load league settings.", config.error);
  const row: Record<string, unknown> = config.data ?? {};
  const isCfb = league.game === "cfb_27";
  const pages = LEAGUE_SETTINGS_SECTIONS.map((section) => ({
    title: section.title,
    lines: section.fields
      .filter(([, , game, condition]) => {
        if (game === "cfb" && !isCfb) return false;
        if (game === "madden" && isCfb) return false;
        if (condition && !condition(row)) return false;
        return true;
      })
      .map(([label, key]) => `**${label}:** ${formatSettingValue(row[key])}`),
  }));
  return { leagueName: league.name, pages };
}

/** Team-request creation for the cross-league recruiting board — the requester is interacting
 * from the management guild, not the league's own guild, so this takes an explicit leagueId
 * rather than resolving one from guildId context (contrast createTeamLinkRequest). */
export async function createRecruitingBoardTeamRequest(input: { leagueId: string; discordId: string; teamId: string }) {
  const league = await loadLeagueForAd(input.leagueId);
  if (!league) throw new ApiError(404, "League not found.");

  const link = await checkLeagueLinked(input.leagueId);
  const guildIdForRequest = link.linked && link.guildId ? link.guildId : `site:${input.leagueId}`;

  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account.", account.error);
  let userId = account.data?.user_id ?? null;

  if (!link.linked) {
    // Unlinked leagues have no Discord server to invite anyone into, so approval only ever
    // does a site-side membership/assignment — the requester must already be a registered
    // site account (Discord identity alone isn't enough here).
    if (!userId) throw new ApiError(400, "This league doesn't have a linked Discord server yet — sign up on the REC site and link your Discord account before requesting a team.");
    const user = await supabase.from("rec_users").select("supabase_auth_user_id").eq("id", userId).maybeSingle();
    if (user.error) throw new ApiError(500, "Failed to load your account.", user.error);
    if (!user.data?.supabase_auth_user_id) throw new ApiError(400, "This league doesn't have a linked Discord server yet — sign up on the REC site and link your Discord account before requesting a team.");
  } else if (!userId) {
    // Look up the real Discord nickname/username instead of stashing the raw snowflake as a
    // placeholder — that placeholder was never getting corrected later. "" (the column's own
    // default) stands in for a failed/missed lookup; a later login or hub read can still
    // resolve a real name, but a written snowflake never self-heals.
    const liveName = await bestEffort("discord.member_display_name", () => getGuildMemberDisplayNameMap(link.guildId!).then((names) => names.get(input.discordId) ?? null), { guildId: link.guildId }) ?? null;
    const createdUser = await supabase.from("rec_users").insert({ display_name: liveName ?? "", status: "active" }).select("id").single();
    if (createdUser.error) throw new ApiError(500, "Failed to create REC user.", createdUser.error);
    userId = createdUser.data.id;
    void grantWelcomeBonus(String(userId));
    const createdAccount = await supabase
      .from("rec_discord_accounts")
      .insert({ user_id: userId, discord_id: input.discordId, username: null, global_name: null })
      .select("user_id")
      .single();
    if (createdAccount.error) {
      await supabase.from("rec_users").delete().eq("id", userId);
      throw new ApiError(500, "Failed to link Discord account.", createdAccount.error);
    }
  }

  const existingAssignment = await supabase
    .from("rec_team_assignments")
    .select("id")
    .eq("league_id", input.leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (existingAssignment.error) throw new ApiError(500, "Failed to check existing assignment.", existingAssignment.error);
  if (existingAssignment.data) throw new ApiError(409, "You are already linked to a team in this league.");

  const team = await supabase.from("rec_teams").select("*").eq("id", input.teamId).eq("league_id", input.leagueId).maybeSingle();
  if (team.error) throw new ApiError(500, "Failed to load team.", team.error);
  if (!team.data) throw new ApiError(404, "Team not found in this league.");

  const teamTaken = await supabase.from("rec_team_assignments").select("id")
    .eq("league_id", input.leagueId).eq("team_id", input.teamId).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (teamTaken.error) throw new ApiError(500, "Failed to check team availability.", teamTaken.error);
  if (teamTaken.data) throw new ApiError(409, "That team is no longer available.");

  const teamRequested = await supabase.from("rec_team_link_requests").select("id")
    .eq("league_id", input.leagueId).eq("team_id", input.teamId).in("status", ["pending", "approved"]).maybeSingle();
  if (teamRequested.error) throw new ApiError(500, "Failed to check team availability.", teamRequested.error);
  if (teamRequested.data) throw new ApiError(409, "That team already has a pending request from another member.");

  const pending = await supabase.from("rec_team_link_requests").select("id")
    .eq("league_id", input.leagueId).eq("requester_user_id", userId).in("status", ["pending", "approved"]).maybeSingle();
  if (pending.error) throw new ApiError(500, "Failed to check pending requests.", pending.error);
  if (pending.data) throw new ApiError(409, "You already have a pending team request.");

  const inserted = await supabase
    .from("rec_team_link_requests")
    .insert({
      guild_id: guildIdForRequest,
      league_id: input.leagueId,
      team_id: input.teamId,
      requester_user_id: userId,
      requester_discord_id: input.discordId,
      status: "pending",
    })
    .select("*")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to create team request.", inserted.error);

  const teamName = formatTeamDisplayName(team.data) ?? team.data.name;
  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: guildIdForRequest,
    server_id: null,
    league_id: input.leagueId,
    season_number: null,
    week_number: null,
    queue_type: "team_request",
    status: "pending",
    priority: 0,
    header: teamName ? `Team link request: ${teamName}` : "Team link request",
    summary: `Requested by <@${input.discordId}> via the recruiting board.`,
    requester_discord_id: input.discordId,
    requester_user_id: userId,
    team_id: input.teamId,
    source_table: "rec_team_link_requests",
    source_id: inserted.data.id,
    payload: { requestId: inserted.data.id, teamId: input.teamId },
  });
  void notifyLeagueCommissionersOfPendingItem(input.leagueId);
  await syncLeagueRecruitingAd(input.leagueId);

  return { request: inserted.data, teamName, leagueName: league.name };
}
