import { CFB_27_TEAMS, stageLabel } from "@rec/shared";
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { isLeagueCommissioner } from "../site-inbox/site-inbox.service.js";
import { getHubMatchupSchedule } from "../hub/hub.service.js";
import { getGameWagerOptions } from "../wagers/odds.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { siteOnlyGuildId } from "../league-context/league-context.service.js";
import { siteOnlyDiscordId } from "../../lib/user-auth.js";
import { clearDiscordTeamIdentityForUsers } from "../team-ownership/team-ownership.service.js";
import { syncLeagueRecruitingAd } from "../recruiting-board/recruiting-board.service.js";

const CFB_DEFAULT_CONFERENCE = new Map(
  CFB_27_TEAMS.map((team) => [team.abbreviation.toUpperCase(), team.conference]),
);

/** Linked REC profile (username optional — used by chrome/league selector). */
export async function requireLinkedRecUser(authUserId: string): Promise<{
  recUserId: string;
  username: string | null;
  displayName: string;
}> {
  const result = await getPgPool().query(
    `
      select id, username, display_name
      from rec_users
      where supabase_auth_user_id = $1
      limit 1
    `,
    [authUserId],
  );
  const row = result.rows[0] as
    | { id: string; username: string | null; display_name: string | null }
    | undefined;
  if (!row) {
    throw new ApiError(403, "Link your REC profile before continuing.");
  }
  return {
    recUserId: row.id,
    username: row.username,
    displayName: row.username ?? row.display_name ?? "REC Member",
  };
}

export type SiteLeagueSummary = {
  id: string;
  name: string;
  logoUrl: string | null;
  game: string;
  gameLabel: string;
  teamName: string | null;
  isCommissioner: boolean;
  /** head = owner / head commissioner; co = co-commissioner; member = player only */
  commissionerRole: "head" | "co" | "member";
  discordBotEnabled: boolean;
};

const GAME_LABELS: Record<string, string> = {
  cfb_27: "CFB 27",
  madden_26: "Madden 26",
  madden_27: "Madden 27",
};

export function gameLabelFor(game: string): string {
  return GAME_LABELS[game] ?? game.replace(/_/g, " ").toUpperCase();
}

export async function listMySiteLeagues(input: {
  recUserId: string;
}): Promise<{ leagues: SiteLeagueSummary[] }> {
  // Include active team assignments AND league memberships (commissioners without a team).
  // Do not call Discord for this list — a token/permission failure was wiping the sidebar.
  const result = await getPgPool().query(
    `
      with linked as (
        select
          l.id,
          l.name,
          l.logo_url,
          l.game,
          l.owner_user_id,
          l.discord_bot_enabled
            or exists (select 1 from rec_server_league_links sll where sll.league_id = l.id and sll.is_primary) as discord_bot_enabled,
          t.name as team_name,
          m.role as membership_role
        from rec_team_assignments ta
        inner join rec_leagues l on l.id = ta.league_id
        inner join rec_teams t on t.id = ta.team_id
        left join rec_league_memberships m
          on m.league_id = l.id and m.user_id = ta.user_id
        where ta.user_id = $1
          and ta.assignment_status = 'active'
          and ta.ended_at is null

        union all

        select
          l.id,
          l.name,
          l.logo_url,
          l.game,
          l.owner_user_id,
          l.discord_bot_enabled
            or exists (select 1 from rec_server_league_links sll where sll.league_id = l.id and sll.is_primary) as discord_bot_enabled,
          null::text as team_name,
          m.role as membership_role
        from rec_league_memberships m
        inner join rec_leagues l on l.id = m.league_id
        where m.user_id = $1
          and not exists (
            select 1
            from rec_team_assignments ta
            where ta.user_id = m.user_id
              and ta.league_id = m.league_id
              and ta.assignment_status = 'active'
              and ta.ended_at is null
          )
      )
      select distinct on (id)
        id, name, logo_url, game, owner_user_id, discord_bot_enabled, team_name, membership_role
      from linked
      order by id, team_name nulls last
    `,
    [input.recUserId],
  );

  const leagues: SiteLeagueSummary[] = (result.rows as Array<{
    id: string;
    name: string;
    logo_url: string | null;
    game: string;
    owner_user_id: string | null;
    team_name: string | null;
    membership_role: string | null;
    discord_bot_enabled: boolean | null;
  }>).map((row) => {
    const role = String(row.membership_role ?? "").toLowerCase();
    let commissionerRole: "head" | "co" | "member" = "member";
    if (row.owner_user_id === input.recUserId || role === "commissioner") {
      commissionerRole = "head";
    } else if (role === "co_commissioner") {
      commissionerRole = "co";
    }
    return {
      id: row.id,
      name: row.name,
      logoUrl: row.logo_url ?? null,
      game: row.game,
      gameLabel: gameLabelFor(row.game),
      teamName: row.team_name ?? null,
      isCommissioner: commissionerRole !== "member",
      commissionerRole,
      discordBotEnabled: Boolean(row.discord_bot_enabled),
    };
  });

  leagues.sort((a, b) => a.name.localeCompare(b.name));
  return { leagues };
}

export async function retireFromSiteLeague(input: {
  recUserId: string;
  leagueId: string;
}): Promise<{ ok: true }> {
  if (await isLeagueCommissioner(input.recUserId, input.leagueId)) {
    throw new ApiError(
      403,
      "Commissioners cannot retire here. Use League Mgmt to resign or transfer.",
    );
  }

  const active = await getPgPool().query(
    `
      select id, team_id
      from rec_team_assignments
      where league_id = $1
        and user_id = $2
        and assignment_status = 'active'
        and ended_at is null
      limit 1
    `,
    [input.leagueId, input.recUserId],
  );
  const assignment = active.rows[0] as { id: string; team_id: string } | undefined;
  if (!assignment) {
    throw new ApiError(404, "No active team assignment in this league.");
  }

  // End the assignment so the team becomes open (listOpenTeams keys off ended_at is null).
  // Keep the team row; do not delete it.
  const updated = await getPgPool().query(
    `
      update rec_team_assignments
      set
        assignment_status = 'unlinked',
        ended_at = now(),
        user_id = null,
        updated_at = now()
      where id = $1
        and ended_at is null
      returning id
    `,
    [assignment.id],
  );
  if (!updated.rows[0]) {
    throw new ApiError(409, "Could not retire from this league. Try again.");
  }

  await clearDiscordTeamIdentityForUsers({ leagueId: input.leagueId, userIds: [input.recUserId] });
  await syncLeagueRecruitingAd(input.leagueId);

  return { ok: true };
}

export type SiteOpenTeam = {
  id: string;
  name: string;
  abbreviation: string | null;
  mascot: string | null;
};

export async function listOpenTeamsForSiteLeague(input: {
  recUserId: string;
  leagueId: string;
}): Promise<{ teams: SiteOpenTeam[]; pendingTeamId: string | null }> {
  const league = await getPgPool().query(
    `select id from rec_leagues where id = $1 and coalesce(subscription_frozen, false) = false`,
    [input.leagueId],
  );
  if (!league.rows[0]) throw new ApiError(404, "League not found.");

  const result = await getPgPool().query(
    `
      select t.id, t.name, t.abbreviation, t.display_nick as mascot
      from rec_teams t
      where t.league_id = $1
        and not exists (
          select 1
          from rec_team_assignments ta
          where ta.league_id = t.league_id
            and ta.team_id = t.id
            and ta.assignment_status = 'active'
            and ta.ended_at is null
        )
        and not exists (
          select 1
          from rec_team_link_requests r
          where r.league_id = t.league_id
            and r.team_id = t.id
            and r.status in ('pending', 'approved')
            and r.requester_user_id <> $2
        )
      order by t.name asc
    `,
    [input.leagueId, input.recUserId],
  );
  const pending = await getPgPool().query(
    `
      select team_id
      from rec_team_link_requests
      where league_id = $1 and requester_user_id = $2
        and status in ('pending', 'approved')
      order by created_at desc
      limit 1
    `,
    [input.leagueId, input.recUserId],
  );
  return {
    teams: result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      abbreviation: row.abbreviation ? String(row.abbreviation) : null,
      mascot: row.mascot ? String(row.mascot) : null,
    })),
    pendingTeamId: pending.rows[0]?.team_id ? String(pending.rows[0].team_id) : null,
  };
}

export async function requestSiteLeagueTeam(input: {
  recUserId: string;
  leagueId: string;
  teamId: string;
}): Promise<{ ok: true; requestId: string }> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const context = await client.query(
      `
        select l.name,
          coalesce(s.guild_id, 'site:' || l.id::text) as guild_id,
          coalesce(d.discord_id, 'site:' || $2::text) as requester_discord_id
        from rec_leagues l
        left join rec_server_league_links sl on sl.league_id = l.id and sl.is_primary = true
        left join rec_discord_servers s on s.id = sl.server_id
        left join rec_discord_accounts d on d.user_id = $2
        where l.id = $1
        limit 1
        for update of l
      `,
      [input.leagueId, input.recUserId],
    );
    const league = context.rows[0] as
      | { name: string; guild_id: string; requester_discord_id: string }
      | undefined;
    if (!league) throw new ApiError(404, "League not found.");
    const banned = await client.query(
      `select 1 from rec_league_bans b join rec_leagues l on l.id=$1
       where b.banned_user_id=$2 and b.active=true and (b.expires_at is null or b.expires_at>now())
         and ((b.scope='league' and b.league_id=$1) or (b.scope='owner_all_leagues' and b.owner_user_id=l.owner_user_id))
       limit 1`,
      [input.leagueId, input.recUserId],
    );
    if (banned.rows[0]) throw new ApiError(403, "You are not eligible to join this league.");

    const membership = await client.query(
      `
        select 1 from rec_league_memberships
        where league_id = $1 and user_id = $2 and status = 'active'
        union all
        select 1 from rec_team_assignments
        where league_id = $1 and user_id = $2
          and assignment_status = 'active' and ended_at is null
        limit 1
      `,
      [input.leagueId, input.recUserId],
    );
    if (membership.rows[0]) throw new ApiError(409, "You are already in this league.");

    const team = await client.query(
      `
        select t.id, t.name
        from rec_teams t
        where t.id = $1 and t.league_id = $2
          and not exists (
            select 1 from rec_team_assignments ta
            where ta.league_id = t.league_id and ta.team_id = t.id
              and ta.assignment_status = 'active' and ta.ended_at is null
          )
        limit 1
      `,
      [input.teamId, input.leagueId],
    );
    if (!team.rows[0]) throw new ApiError(409, "That team is no longer available.");

    const existing = await client.query(
      `
        select id from rec_team_link_requests
        where league_id = $1 and requester_user_id = $2
          and status in ('pending', 'approved')
        limit 1
      `,
      [input.leagueId, input.recUserId],
    );
    if (existing.rows[0]) throw new ApiError(409, "You already have a pending team request.");

    const inserted = await client.query(
      `
        insert into rec_team_link_requests
          (guild_id, league_id, team_id, requester_user_id, requester_discord_id, status)
        values ($1, $2, $3, $4, $5, 'pending')
        returning id
      `,
      [league.guild_id, input.leagueId, input.teamId, input.recUserId, league.requester_discord_id],
    );
    const requestId = String(inserted.rows[0].id);
    await client.query(
      `
        insert into rec_commissioners_inbox
          (guild_id, league_id, queue_type, status, priority, header, summary,
           requester_discord_id, requester_user_id, team_id, source_table, source_id, payload)
        values ($1, $2, 'team_request', 'pending', 0, $3, $4, $5, $6, $7,
                'rec_team_link_requests', $8, $9::jsonb)
      `,
      [
        league.guild_id,
        input.leagueId,
        `Team request: ${team.rows[0].name}`,
        `A site member requested ${team.rows[0].name}.`,
        league.requester_discord_id,
        input.recUserId,
        input.teamId,
        requestId,
        JSON.stringify({ requestId, teamId: input.teamId }),
      ],
    );
    await client.query("commit");
    void notifyLeagueCommissionersOfPendingItem(input.leagueId);
    return { ok: true, requestId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export type SiteLeagueHubView = "buzz" | "matchups" | "team" | "store" | "mgmt";

async function assertSiteLeagueAccess(recUserId: string, leagueId: string): Promise<void> {
  const banned = await getPgPool().query(
    `select 1 from rec_league_bans b join rec_leagues l on l.id=$2
     where b.banned_user_id=$1 and b.active=true and (b.expires_at is null or b.expires_at>now())
       and ((b.scope='league' and b.league_id=$2) or (b.scope='owner_all_leagues' and b.owner_user_id=l.owner_user_id))
     limit 1`,
    [recUserId, leagueId],
  );
  if (banned.rows[0]) throw new ApiError(403, "You no longer have access to this league.");
  const access = await getPgPool().query(
    `
      select 1
      from rec_team_assignments ta
      where ta.user_id = $1
        and ta.league_id = $2
        and ta.assignment_status = 'active'
        and ta.ended_at is null
      union all
      select 1
      from rec_league_memberships m
      where m.user_id = $1
        and m.league_id = $2
      limit 1
    `,
    [recUserId, leagueId],
  );
  if (!access.rows[0]) {
    throw new ApiError(403, "You are not a member of that league.");
  }
}

/** Resolve Discord guild + identity for the in-process site hub. */
export async function openSiteLeagueHub(input: {
  recUserId: string;
  leagueId: string;
  view?: SiteLeagueHubView;
  embed?: boolean;
}): Promise<{
  guildId: string;
  discordId: string;
  leagueId: string;
  hubUrl: null;
}> {
  const context = await openSiteLeagueHubContext(input);
  return { ...context, hubUrl: null };
}

/** Resolve Discord guild + identity for rendering the hub inside apps/site (no iframe). */
export async function openSiteLeagueHubContext(input: {
  recUserId: string;
  leagueId: string;
}): Promise<{ guildId: string; discordId: string; leagueId: string }> {
  await assertSiteLeagueAccess(input.recUserId, input.leagueId);

  const profile = await getPgPool().query(
    `
      select u.username, d.discord_id
      from rec_users u
      left join rec_discord_accounts d on d.user_id = u.id
      where u.id = $1
      limit 1
    `,
    [input.recUserId],
  );
  const row = profile.rows[0] as { username: string | null; discord_id: string | null } | undefined;
  if (!row?.username) {
    throw new ApiError(403, "Choose a username on Account before opening a league hub.");
  }
  // Discord is optional: a user without a linked Discord account, or a league never linked to
  // a Discord server, both fall back to a synthetic identity that resolves through the same
  // discordId/guildId-keyed hub plumbing (see league-context.service.ts / lib/user-auth.ts).
  const discordId = row.discord_id ?? siteOnlyDiscordId(input.recUserId);

  const guild = await getPgPool().query(
    `
      select s.guild_id
      from rec_server_league_links link
      inner join rec_discord_servers s on s.id = link.server_id
      where link.league_id = $1
      order by link.is_primary desc, link.created_at asc
      limit 1
    `,
    [input.leagueId],
  );
  const guildId = (guild.rows[0] as { guild_id: string } | undefined)?.guild_id ?? siteOnlyGuildId(input.leagueId);

  return { guildId, discordId, leagueId: input.leagueId };
}

export type SiteLeagueTickerItem = {
  gameId: string;
  awayTeamName: string;
  homeTeamName: string;
  awayScore: number | null;
  homeScore: number | null;
  isFinal: boolean;
  isLive: boolean;
  odds: {
    awayMoneyline: number;
    homeMoneyline: number;
    overUnder: number | null;
  } | null;
};

/** Current-week H2H matchups for the site ticker — reuses the same schedule/live-stream
 * logic as the Discord-activity hub (getHubMatchupSchedule), just resolved from a site
 * session instead of a guild session. */
export async function getSiteLeagueTicker(input: {
  recUserId: string;
  leagueId: string;
}): Promise<{ items: SiteLeagueTickerItem[]; weekNumber: number }> {
  const context = await openSiteLeagueHubContext(input);
  const schedule = await getHubMatchupSchedule({
    guildId: context.guildId,
    discordId: context.discordId,
  });
  const h2hGames = schedule.games.filter((game) => game.matchupType === "h2h");

  const items = await Promise.all(
    h2hGames.map(async (game) => {
      const isLive = game.streams.length > 0 && !game.isFinal;
      // Odds only make sense pre-game — getGameWagerOptions itself 409s once a game
      // leaves "scheduled" status (live or a box score already in), so treat that as
      // "no odds to show" rather than an error.
      let odds: SiteLeagueTickerItem["odds"] = null;
      if (!game.isFinal && !isLive) {
        try {
          const options = await getGameWagerOptions(context.guildId, game.gameId);
          const moneyline = options.markets.find((market) => market.market === "moneyline");
          const total = options.markets.find((market) => market.market === "total_points");
          const awaySide = moneyline?.sides.find((side) => side.pick === game.awayTeamId);
          const homeSide = moneyline?.sides.find((side) => side.pick === game.homeTeamId);
          if (awaySide && homeSide) {
            odds = { awayMoneyline: awaySide.odds, homeMoneyline: homeSide.odds, overUnder: total?.line ?? null };
          }
        } catch {
          odds = null;
        }
      }
      return {
        gameId: game.gameId,
        awayTeamName: game.awayTeamName,
        homeTeamName: game.homeTeamName,
        awayScore: game.awayScore,
        homeScore: game.homeScore,
        isFinal: game.isFinal,
        isLive,
        odds,
      };
    }),
  );
  return { items, weekNumber: schedule.currentWeek };
}

export type SiteLeagueSearchFilters = {
  q?: string;
  game?: string;
  openTeamAbbr?: string;
  difficulty?: string;
  streamingRequirement?: string;
  coinEconomyEnabled?: boolean;
  acceleratedClockEnabled?: boolean;
  tradeApprovalPolicy?: string;
  offensivePlayCallLimitsEnabled?: boolean;
  defensivePlayCallLimitsEnabled?: boolean;
  sort?: "name_asc" | "name_desc" | "open_teams" | "newest";
  limit?: number;
};

export type SiteLeagueConferenceReassignment = {
  abbreviation: string;
  name: string;
  fromConference: string;
  toConference: string;
};

export type SiteLeagueSearchHit = {
  id: string;
  name: string;
  templateId: string | null;
  game: string;
  gameLabel: string;
  seasonStage: string;
  seasonStageLabel: string;
  seasonNumber: number;
  currentWeek: number | null;
  openTeamCount: number;
  memberCount: number;
  commissionerUsername: string | null;
  isMember: boolean;

  // Shared pills / expanded
  coinEconomyEnabled: boolean;
  economyPayoutsActive: boolean;
  economyLinkedUserCount: number;
  economyMinimumLinkedUsers: number;
  economyMembersShort: number;
  advanceTiming: string | null;
  advanceTimingOther: string | null;
  regularSeasonStreamingRequirement: string | null;
  postseasonStreamingRequirement: string | null;
  /** @deprecated prefer regularSeasonStreamingRequirement */
  streamingRequirement: string | null;
  regularSeasonStreamingSide: string | null;
  postseasonStreamingSide: string | null;
  customCoachesRequired: boolean;
  customPlaybooksAllowed: boolean;
  difficulty: string | null;
  slidersAdjusted: boolean;
  quarterLengthMinutes: number | null;
  acceleratedClockEnabled: boolean;
  acceleratedClockMinimumSeconds: number | null;
  injuryPolicy: string | null;
  wearAndTearEnabled: boolean;
  fourthDownRuleTypeRegular: string | null;
  fourthDownRuleTypePlayoff: string | null;
  coachFiringPolicy: string | null;
  preorderBonusesEnabled: boolean;
  ballHawk: string | null;
  heatSeeker: string | null;
  switchAssist: string | null;
  offensivePlayCallLimitsEnabled: boolean;
  offensivePlayCallLimit: number | null;
  offensivePlayCallCooldownEnabled: boolean;
  offensivePlayCallCooldown: number | null;
  defensivePlayCallLimitsEnabled: boolean;
  defensivePlayCallLimit: number | null;
  defensivePlayCallCooldownEnabled: boolean;
  defensivePlayCallCooldown: number | null;
  fairSimRequirements: string | null;
  forceWinRequirements: string | null;

  // Purchases (expanded when coin economy on)
  customPlayersEnabled: boolean;
  legendsEnabled: boolean;
  devUpgradesEnabled: boolean;
  ageResetsEnabled: boolean;
  attributePurchasesEnabled: boolean;
  playerTraitPurchasesEnabled: boolean;
  contractAdjustmentPurchasesEnabled: boolean;

  // Madden
  rosterType: string | null;
  coachAbilitiesRestricted: boolean;
  coachAbilitiesRestrictionNotes: string | null;
  tradeApprovalPolicy: string | null;
  cpuTradingPolicy: string | null;
  cpuTradingRestriction: string | null;
  salaryCapEnabled: boolean;
  abilitiesEnabled: boolean;
  tradeDeadlineEnabled: boolean;
  positionChangePolicy: string | null;
  positionChangePolicyDescription: string | null;

  // CFB
  coachModeEnabled: boolean;
  activeRostersEnabled: boolean | null;
  dynastyType: string | null;
  conferenceRealignment: string | null;
  conferenceReassignments: SiteLeagueConferenceReassignment[];
  recruitingDifficulty: string | null;
  coachXpSetting: string | null;
  transferPortalEnabled: boolean | null;
  homeFieldAdvantageEnabled: boolean | null;
  coachCarouselEnabled: boolean | null;
  stadiumPulseEnabled: boolean | null;
  coachModeRecruitFlippingEnabled: boolean | null;
  coachModeAutoRecruitingEnabled: boolean | null;
  coachModeAutoProgressPlayersEnabled: boolean | null;
  coachModeUserAutoProgressionEnabled: boolean | null;
  coachModeCpuManageBudgetEnabled: boolean | null;
  coachModeCpuManageStaffEnabled: boolean | null;
  coachModeCpuManageFacilitiesEnabled: boolean | null;

  // Cross play
  crossPlayEnabled: boolean;
  requiredConsole: string | null;
};

export async function searchSiteLeagues(input: {
  recUserId: string;
  filters: SiteLeagueSearchFilters;
}): Promise<{ leagues: SiteLeagueSearchHit[] }> {
  const limit = Math.min(Math.max(input.filters.limit ?? 40, 1), 80);
  const q = input.filters.q?.trim() ?? "";
  const params: unknown[] = [input.recUserId];
  const where: string[] = [
    "coalesce(l.subscription_frozen, false) = false",
    // Offline dynasties/franchises don't show up in league search (they still count toward
    // the owner's league cap — that's enforced separately at creation time).
    "coalesce(l.is_online, true) = true",
    "coalesce(l.advertisement_eligible, true) = true",
    `not exists (
      select 1 from rec_league_bans b
      where b.banned_user_id = $1
        and b.active = true
        and (b.expires_at is null or b.expires_at > now())
        and (
          (b.scope = 'league' and b.league_id = l.id)
          or (b.scope = 'owner_all_leagues' and b.owner_user_id = l.owner_user_id)
        )
    )`,
  ];

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const idx = params.length;
    where.push(`(
      lower(l.name) like $${idx}
      or lower(coalesce(owner.username, '')) like $${idx}
      or lower(coalesce(owner.display_name, '')) like $${idx}
      or lower(coalesce(da.username, '')) like $${idx}
      or lower(coalesce(da.global_name, '')) like $${idx}
    )`);
  }
  if (input.filters.game) {
    params.push(input.filters.game);
    where.push(`l.game = $${params.length}`);
  }
  if (input.filters.openTeamAbbr) {
    params.push(input.filters.openTeamAbbr.toUpperCase());
    where.push(`exists (
      select 1
      from rec_teams t
      where t.league_id = l.id
        and (
          upper(coalesce(t.abbreviation, '')) = $${params.length}
          or upper(coalesce(t.original_abbreviation, '')) = $${params.length}
        )
        and not exists (
          select 1
          from rec_team_assignments ta
          where ta.team_id = t.id
            and ta.assignment_status = 'active'
            and ta.ended_at is null
        )
    )`);
  }
  if (input.filters.difficulty) {
    params.push(input.filters.difficulty);
    where.push(`case when l.game='cfb_27'
      then coalesce(c.cfb_difficulty,case c.difficulty when 'all_madden' then 'heisman' when 'all_pro' then 'all_american' when 'pro' then 'varsity' else 'freshman' end)
      else c.difficulty end = $${params.length}`);
  }
  if (input.filters.streamingRequirement) {
    params.push(input.filters.streamingRequirement);
    where.push(`(
      c.regular_season_streaming_requirement = $${params.length}
      or c.postseason_streaming_requirement = $${params.length}
      or c.streaming_requirement = $${params.length}
    )`);
  }
  if (typeof input.filters.coinEconomyEnabled === "boolean") {
    params.push(input.filters.coinEconomyEnabled);
    where.push(`c.coin_economy_enabled = $${params.length}`);
  }
  if (typeof input.filters.acceleratedClockEnabled === "boolean") {
    params.push(input.filters.acceleratedClockEnabled);
    where.push(`c.accelerated_clock_enabled = $${params.length}`);
  }
  if (input.filters.tradeApprovalPolicy) {
    params.push(input.filters.tradeApprovalPolicy);
    where.push(`c.trade_approval_policy = $${params.length}`);
  }
  if (typeof input.filters.offensivePlayCallLimitsEnabled === "boolean") {
    params.push(input.filters.offensivePlayCallLimitsEnabled);
    where.push(`c.offensive_play_call_limits_enabled = $${params.length}`);
  }
  if (typeof input.filters.defensivePlayCallLimitsEnabled === "boolean") {
    params.push(input.filters.defensivePlayCallLimitsEnabled);
    where.push(`c.defensive_play_call_limits_enabled = $${params.length}`);
  }

  const sort = input.filters.sort ?? "name_asc";
  const orderBy =
    sort === "name_desc"
      ? "l.name desc"
      : sort === "open_teams"
        ? "open_team_count desc, l.name asc"
        : sort === "newest"
          ? "l.created_at desc"
          : "l.name asc";

  params.push(limit);
  const result = await getPgPool().query(
    `
      select
        l.id,
        l.name,
        l.logo_url,
        l.template_id,
        l.game,
        l.season_stage,
        l.season_number,
        l.current_week,
        l.created_at,
        coalesce(owner.username, owner.display_name) as commissioner_username,
        c.difficulty,
        c.sliders_adjusted,
        c.streaming_requirement,
        c.regular_season_streaming_requirement,
        c.postseason_streaming_requirement,
        c.regular_season_streaming_side,
        c.postseason_streaming_side,
        coalesce(c.coin_economy_enabled, false) as coin_economy_enabled,
        coalesce(c.coin_economy_minimum_linked_users, 8) as coin_economy_minimum_linked_users,
        c.advance_timing,
        c.advance_timing_other,
        coalesce(c.custom_coaches_required, false) as custom_coaches_required,
        coalesce(c.custom_playbooks_allowed, false) as custom_playbooks_allowed,
        c.quarter_length_minutes,
        coalesce(c.accelerated_clock_enabled, false) as accelerated_clock_enabled,
        c.accelerated_clock_minimum_seconds,
        c.injury_policy,
        coalesce(c.wear_and_tear_enabled, true) as wear_and_tear_enabled,
        c.fourth_down_rule_type_regular,
        c.fourth_down_rule_type_playoff,
        c.coach_firing_policy,
        coalesce(c.preorder_bonuses_enabled, true) as preorder_bonuses_enabled,
        c.ball_hawk,
        c.heat_seeker,
        c.switch_assist,
        coalesce(c.offensive_play_call_limits_enabled, false) as offensive_play_call_limits_enabled,
        c.offensive_play_call_limit,
        coalesce(c.offensive_play_call_cooldown_enabled, false) as offensive_play_call_cooldown_enabled,
        c.offensive_play_call_cooldown,
        coalesce(c.defensive_play_call_limits_enabled, false) as defensive_play_call_limits_enabled,
        c.defensive_play_call_limit,
        coalesce(c.defensive_play_call_cooldown_enabled, false) as defensive_play_call_cooldown_enabled,
        c.defensive_play_call_cooldown,
        c.fair_sim_requirements,
        c.force_win_requirements,
        coalesce(c.custom_players_enabled, false) as custom_players_enabled,
        coalesce(c.legends_enabled, false) as legends_enabled,
        coalesce(c.dev_upgrades_enabled, false) as dev_upgrades_enabled,
        coalesce(c.age_resets_enabled, false) as age_resets_enabled,
        coalesce(c.attribute_purchases_enabled, false) as attribute_purchases_enabled,
        coalesce(c.player_trait_purchases_enabled, false) as player_trait_purchases_enabled,
        coalesce(c.contract_adjustment_purchases_enabled, false) as contract_adjustment_purchases_enabled,
        c.roster_type,
        coalesce(c.coach_abilities_restricted, false) as coach_abilities_restricted,
        c.coach_abilities_restriction_notes,
        c.trade_approval_policy,
        c.cpu_trading_policy,
        c.cpu_trading_restriction,
        coalesce(c.salary_cap_enabled, false) as salary_cap_enabled,
        coalesce(c.abilities_enabled, true) as abilities_enabled,
        coalesce(c.trade_deadline_enabled, false) as trade_deadline_enabled,
        c.position_change_policy,
        c.position_change_policy_description,
        coalesce(c.coach_mode_enabled, false) as coach_mode_enabled,
        c.active_rosters_enabled,
        c.dynasty_type,
        c.conference_realignment,
        c.recruiting_difficulty,
        c.coach_xp_setting,
        c.transfer_portal_enabled,
        c.home_field_advantage_enabled,
        c.coach_carousel_enabled,
        c.stadium_pulse_enabled,
        c.coach_mode_recruit_flipping_enabled,
        c.coach_mode_auto_recruiting_enabled,
        c.coach_mode_auto_progress_players_enabled,
        c.coach_mode_user_auto_progression_enabled,
        c.coach_mode_cpu_manage_budget_enabled,
        c.coach_mode_cpu_manage_staff_enabled,
        c.coach_mode_cpu_manage_facilities_enabled,
        coalesce(c.cross_play_enabled, true) as cross_play_enabled,
        c.required_console,
        (
          select coalesce(json_agg(json_build_object(
            'abbreviation', t.abbreviation,
            'name', t.name,
            'conference', t.conference
          ) order by t.name), '[]'::json)
          from rec_teams t
          where t.league_id = l.id
            and l.game = 'cfb_27'
        ) as cfb_teams,
        (
          select count(*)::int
          from rec_teams t
          where t.league_id = l.id
            and not exists (
              select 1
              from rec_team_assignments ta
              where ta.team_id = t.id
                and ta.assignment_status = 'active'
                and ta.ended_at is null
            )
        ) as open_team_count,
        (
          select count(distinct ta.user_id)::int
          from rec_team_assignments ta
          where ta.league_id = l.id
            and ta.assignment_status = 'active'
            and ta.ended_at is null
            and ta.user_id is not null
        ) as linked_user_count,
        (
          select count(distinct user_id)::int
          from (
            select ta.user_id
            from rec_team_assignments ta
            where ta.league_id = l.id
              and ta.assignment_status = 'active'
              and ta.ended_at is null
              and ta.user_id is not null
            union
            select m.user_id
            from rec_league_memberships m
            where m.league_id = l.id
          ) members
        ) as member_count,
        exists (
          select 1 from (
            select ta.user_id
            from rec_team_assignments ta
            where ta.league_id = l.id
              and ta.user_id = $1
              and ta.assignment_status = 'active'
              and ta.ended_at is null
            union all
            select m.user_id
            from rec_league_memberships m
            where m.league_id = l.id
              and m.user_id = $1
          ) membership
        ) as is_member
      from rec_leagues l
      left join rec_league_configuration c on c.league_id = l.id
      left join rec_users owner on owner.id = l.owner_user_id
      where ${where.join("\n        and ")}
      order by ${orderBy}
      limit $${params.length}
    `,
    params,
  );

  const leagues: SiteLeagueSearchHit[] = (
    result.rows as Array<Record<string, unknown>>
  ).map((row) => {
    const game = String(row.game ?? "");
    const seasonStage = String(row.season_stage ?? "regular_season");
    const currentWeek =
      row.current_week == null ? null : Number(row.current_week);
    const seasonNumber = Number(row.season_number ?? 1);
    const cfbTeams = Array.isArray(row.cfb_teams)
      ? (row.cfb_teams as Array<{ abbreviation: string; name: string; conference: string | null }>)
      : [];
    const conferenceReassignments: SiteLeagueConferenceReassignment[] = [];
    if (game === "cfb_27" && String(row.conference_realignment ?? "") === "allowed") {
      for (const team of cfbTeams) {
        const abbr = String(team.abbreviation ?? "").toUpperCase();
        const toConference = String(team.conference ?? "").trim();
        const fromConference = CFB_DEFAULT_CONFERENCE.get(abbr) ?? "";
        if (!toConference || !fromConference || toConference === fromConference) continue;
        conferenceReassignments.push({
          abbreviation: team.abbreviation,
          name: team.name,
          fromConference,
          toConference,
        });
      }
    }

    const regularStream =
      (row.regular_season_streaming_requirement as string | null) ??
      (row.streaming_requirement as string | null);
    const postStream =
      (row.postseason_streaming_requirement as string | null) ??
      (row.streaming_requirement as string | null);

    return {
      id: String(row.id),
      name: String(row.name),
      logoUrl: (row.logo_url as string | null) ?? null,
      templateId: (row.template_id as string | null) ?? null,
      game,
      gameLabel: gameLabelFor(game),
      seasonStage,
      seasonStageLabel: stageLabel(seasonStage, currentWeek ?? 1, game as "madden_26" | "madden_27" | "cfb_27"),
      seasonNumber,
      currentWeek,
      openTeamCount: Number(row.open_team_count ?? 0),
      memberCount: Number(row.member_count ?? 0),
      // display_name can be a raw Discord-ID placeholder left over from account
      // auto-provisioning (same guard as hub.service.ts's displayNameForUser) — never show that.
      commissionerUsername: /^\d{15,}$/.test(String(row.commissioner_username ?? "")) ? null : (row.commissioner_username as string | null) ?? null,
      isMember: Boolean(row.is_member),

      coinEconomyEnabled: Boolean(row.coin_economy_enabled),
      economyLinkedUserCount: Number(row.linked_user_count ?? 0),
      economyMinimumLinkedUsers: Math.max(8, Number(row.coin_economy_minimum_linked_users ?? 8)),
      economyPayoutsActive:
        Boolean(row.coin_economy_enabled) &&
        Number(row.linked_user_count ?? 0) >= Math.max(8, Number(row.coin_economy_minimum_linked_users ?? 8)),
      economyMembersShort: Math.max(
        0,
        Math.max(8, Number(row.coin_economy_minimum_linked_users ?? 8)) - Number(row.linked_user_count ?? 0),
      ),
      advanceTiming: (row.advance_timing as string | null) ?? "24hr",
      advanceTimingOther: (row.advance_timing_other as string | null) ?? null,
      regularSeasonStreamingRequirement: regularStream,
      postseasonStreamingRequirement: postStream,
      streamingRequirement: regularStream,
      regularSeasonStreamingSide: (row.regular_season_streaming_side as string | null) ?? null,
      postseasonStreamingSide: (row.postseason_streaming_side as string | null) ?? null,
      customCoachesRequired: Boolean(row.custom_coaches_required),
      customPlaybooksAllowed: Boolean(row.custom_playbooks_allowed),
      difficulty: (row.difficulty as string | null) ?? null,
      slidersAdjusted: Boolean(row.sliders_adjusted),
      quarterLengthMinutes:
        row.quarter_length_minutes == null ? null : Number(row.quarter_length_minutes),
      acceleratedClockEnabled: Boolean(row.accelerated_clock_enabled),
      acceleratedClockMinimumSeconds:
        row.accelerated_clock_minimum_seconds == null
          ? null
          : Number(row.accelerated_clock_minimum_seconds),
      injuryPolicy: (row.injury_policy as string | null) ?? null,
      wearAndTearEnabled: Boolean(row.wear_and_tear_enabled),
      fourthDownRuleTypeRegular: (row.fourth_down_rule_type_regular as string | null) ?? null,
      fourthDownRuleTypePlayoff: (row.fourth_down_rule_type_playoff as string | null) ?? null,
      coachFiringPolicy: (row.coach_firing_policy as string | null) ?? null,
      preorderBonusesEnabled: Boolean(row.preorder_bonuses_enabled),
      ballHawk: (row.ball_hawk as string | null) ?? null,
      heatSeeker: (row.heat_seeker as string | null) ?? null,
      switchAssist: (row.switch_assist as string | null) ?? null,
      offensivePlayCallLimitsEnabled: Boolean(row.offensive_play_call_limits_enabled),
      offensivePlayCallLimit:
        row.offensive_play_call_limit == null ? null : Number(row.offensive_play_call_limit),
      offensivePlayCallCooldownEnabled: Boolean(row.offensive_play_call_cooldown_enabled),
      offensivePlayCallCooldown:
        row.offensive_play_call_cooldown == null
          ? null
          : Number(row.offensive_play_call_cooldown),
      defensivePlayCallLimitsEnabled: Boolean(row.defensive_play_call_limits_enabled),
      defensivePlayCallLimit:
        row.defensive_play_call_limit == null ? null : Number(row.defensive_play_call_limit),
      defensivePlayCallCooldownEnabled: Boolean(row.defensive_play_call_cooldown_enabled),
      defensivePlayCallCooldown:
        row.defensive_play_call_cooldown == null
          ? null
          : Number(row.defensive_play_call_cooldown),
      fairSimRequirements: (row.fair_sim_requirements as string | null) ?? null,
      forceWinRequirements: (row.force_win_requirements as string | null) ?? null,

      customPlayersEnabled: Boolean(row.custom_players_enabled),
      legendsEnabled: Boolean(row.legends_enabled),
      devUpgradesEnabled: Boolean(row.dev_upgrades_enabled),
      ageResetsEnabled: Boolean(row.age_resets_enabled),
      attributePurchasesEnabled: Boolean(row.attribute_purchases_enabled),
      playerTraitPurchasesEnabled: Boolean(row.player_trait_purchases_enabled),
      contractAdjustmentPurchasesEnabled: Boolean(row.contract_adjustment_purchases_enabled),

      rosterType: (row.roster_type as string | null) ?? null,
      coachAbilitiesRestricted: Boolean(row.coach_abilities_restricted),
      coachAbilitiesRestrictionNotes:
        (row.coach_abilities_restriction_notes as string | null) ?? null,
      tradeApprovalPolicy: (row.trade_approval_policy as string | null) ?? null,
      cpuTradingPolicy: (row.cpu_trading_policy as string | null) ?? null,
      cpuTradingRestriction: (row.cpu_trading_restriction as string | null) ?? null,
      salaryCapEnabled: Boolean(row.salary_cap_enabled),
      abilitiesEnabled: Boolean(row.abilities_enabled),
      tradeDeadlineEnabled: Boolean(row.trade_deadline_enabled),
      positionChangePolicy: (row.position_change_policy as string | null) ?? null,
      positionChangePolicyDescription:
        (row.position_change_policy_description as string | null) ?? null,

      coachModeEnabled: Boolean(row.coach_mode_enabled),
      activeRostersEnabled:
        row.active_rosters_enabled == null ? null : Boolean(row.active_rosters_enabled),
      dynastyType: (row.dynasty_type as string | null) ?? null,
      conferenceRealignment: (row.conference_realignment as string | null) ?? null,
      conferenceReassignments,
      recruitingDifficulty: (row.recruiting_difficulty as string | null) ?? null,
      coachXpSetting: (row.coach_xp_setting as string | null) ?? null,
      transferPortalEnabled:
        row.transfer_portal_enabled == null ? null : Boolean(row.transfer_portal_enabled),
      homeFieldAdvantageEnabled:
        row.home_field_advantage_enabled == null
          ? null
          : Boolean(row.home_field_advantage_enabled),
      coachCarouselEnabled:
        row.coach_carousel_enabled == null ? null : Boolean(row.coach_carousel_enabled),
      stadiumPulseEnabled:
        row.stadium_pulse_enabled == null ? null : Boolean(row.stadium_pulse_enabled),
      coachModeRecruitFlippingEnabled:
        row.coach_mode_recruit_flipping_enabled == null
          ? null
          : Boolean(row.coach_mode_recruit_flipping_enabled),
      coachModeAutoRecruitingEnabled:
        row.coach_mode_auto_recruiting_enabled == null
          ? null
          : Boolean(row.coach_mode_auto_recruiting_enabled),
      coachModeAutoProgressPlayersEnabled:
        row.coach_mode_auto_progress_players_enabled == null
          ? null
          : Boolean(row.coach_mode_auto_progress_players_enabled),
      coachModeUserAutoProgressionEnabled:
        row.coach_mode_user_auto_progression_enabled == null
          ? null
          : Boolean(row.coach_mode_user_auto_progression_enabled),
      coachModeCpuManageBudgetEnabled:
        row.coach_mode_cpu_manage_budget_enabled == null
          ? null
          : Boolean(row.coach_mode_cpu_manage_budget_enabled),
      coachModeCpuManageStaffEnabled:
        row.coach_mode_cpu_manage_staff_enabled == null
          ? null
          : Boolean(row.coach_mode_cpu_manage_staff_enabled),
      coachModeCpuManageFacilitiesEnabled:
        row.coach_mode_cpu_manage_facilities_enabled == null
          ? null
          : Boolean(row.coach_mode_cpu_manage_facilities_enabled),

      crossPlayEnabled: Boolean(row.cross_play_enabled ?? true),
      requiredConsole: (row.required_console as string | null) ?? null,
    };
  });

  return { leagues };
}
