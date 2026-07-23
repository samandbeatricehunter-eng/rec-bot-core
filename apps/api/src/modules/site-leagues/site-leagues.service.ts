import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { isLeagueCommissioner } from "../site-inbox/site-inbox.service.js";
import { buildWebHubUrl } from "../web-session/web-session.service.js";

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
    displayName: row.display_name ?? row.username ?? "REC Member",
  };
}

export type SiteLeagueSummary = {
  id: string;
  name: string;
  game: string;
  gameLabel: string;
  teamName: string | null;
  isCommissioner: boolean;
  /** head = owner / head commissioner; co = co-commissioner; member = player only */
  commissionerRole: "head" | "co" | "member";
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
          l.game,
          l.owner_user_id,
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
          l.game,
          l.owner_user_id,
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
        id, name, game, owner_user_id, team_name, membership_role
      from linked
      order by id, team_name nulls last
    `,
    [input.recUserId],
  );

  const leagues: SiteLeagueSummary[] = (result.rows as Array<{
    id: string;
    name: string;
    game: string;
    owner_user_id: string | null;
    team_name: string | null;
    membership_role: string | null;
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
      game: row.game,
      gameLabel: gameLabelFor(row.game),
      teamName: row.team_name ?? null,
      isCommissioner: commissionerRole !== "member",
      commissionerRole,
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

  return { ok: true };
}

export type SiteLeagueHubView = "buzz" | "matchups" | "team" | "store" | "mgmt";

async function assertSiteLeagueAccess(recUserId: string, leagueId: string): Promise<void> {
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

function hubHashForView(view: SiteLeagueHubView): string {
  switch (view) {
    case "matchups":
      return "/?section=league&subTab=matchups";
    case "team":
      return "/?section=team";
    case "store":
      return "/?section=store";
    case "mgmt":
      return "/league-mgmt";
    case "buzz":
    default:
      return "/?section=league&subTab=buzz";
  }
}

/**
 * Resolve Discord guild + identity for the in-process site hub.
 * Also includes hubUrl for older site bundles that still iframe WEB_APP_URL.
 */
export async function openSiteLeagueHub(input: {
  recUserId: string;
  leagueId: string;
  view?: SiteLeagueHubView;
  embed?: boolean;
}): Promise<{
  guildId: string;
  discordId: string;
  leagueId: string;
  hubUrl: string | null;
}> {
  const context = await openSiteLeagueHubContext(input);
  let hubUrl: string | null = null;
  try {
    const issued = await buildWebHubUrl({
      discordId: context.discordId,
      guildId: context.guildId,
      hashPath: hubHashForView(input.view ?? "buzz"),
      embed: input.embed ?? true,
    });
    hubUrl = issued.hubUrl;
  } catch (error) {
    // In-process hub only needs guildId/discordId; hubUrl is legacy compat.
    console.warn(
      "[open-hub] hubUrl unavailable:",
      error instanceof Error ? error.message : error,
    );
  }
  return { ...context, hubUrl };
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
  if (!row?.discord_id) {
    throw new ApiError(403, "Link your Discord identity on Account before opening a league hub.");
  }
  if (!row.username) {
    throw new ApiError(403, "Choose a username on Account before opening a league hub.");
  }

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
  const guildId = (guild.rows[0] as { guild_id: string } | undefined)?.guild_id;
  if (!guildId) {
    throw new ApiError(404, "This league is not linked to a Discord server yet.");
  }

  return { guildId, discordId: row.discord_id, leagueId: input.leagueId };
}

export type SiteLeagueSearchFilters = {
  q?: string;
  game?: string;
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

export type SiteLeagueSearchHit = {
  id: string;
  name: string;
  game: string;
  gameLabel: string;
  seasonStage: string;
  seasonNumber: number;
  openTeamCount: number;
  memberCount: number;
  commissionerUsername: string | null;
  commissionerDiscordName: string | null;
  difficulty: string | null;
  streamingRequirement: string | null;
  coinEconomyEnabled: boolean;
  acceleratedClockEnabled: boolean;
  acceleratedClockMinimumSeconds: number | null;
  tradeApprovalPolicy: string | null;
  offensivePlayCallLimitsEnabled: boolean;
  offensivePlayCallLimit: number | null;
  offensivePlayCallCooldown: number | null;
  defensivePlayCallLimitsEnabled: boolean;
  defensivePlayCallLimit: number | null;
  defensivePlayCallCooldown: number | null;
  isMember: boolean;
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
  if (input.filters.difficulty) {
    params.push(input.filters.difficulty);
    where.push(`c.difficulty = $${params.length}`);
  }
  if (input.filters.streamingRequirement) {
    params.push(input.filters.streamingRequirement);
    where.push(`c.streaming_requirement = $${params.length}`);
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
        l.game,
        l.season_stage,
        l.season_number,
        l.created_at,
        owner.username as commissioner_username,
        coalesce(da.global_name, da.username) as commissioner_discord_name,
        c.difficulty,
        c.streaming_requirement,
        coalesce(c.coin_economy_enabled, false) as coin_economy_enabled,
        coalesce(c.accelerated_clock_enabled, false) as accelerated_clock_enabled,
        c.accelerated_clock_minimum_seconds,
        c.trade_approval_policy,
        coalesce(c.offensive_play_call_limits_enabled, false) as offensive_play_call_limits_enabled,
        c.offensive_play_call_limit,
        c.offensive_play_call_cooldown,
        coalesce(c.defensive_play_call_limits_enabled, false) as defensive_play_call_limits_enabled,
        c.defensive_play_call_limit,
        c.defensive_play_call_cooldown,
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
      left join rec_discord_accounts da on da.user_id = owner.id
      where ${where.join("\n        and ")}
      order by ${orderBy}
      limit $${params.length}
    `,
    params,
  );

  const leagues: SiteLeagueSearchHit[] = (
    result.rows as Array<{
      id: string;
      name: string;
      game: string;
      season_stage: string;
      season_number: number;
      commissioner_username: string | null;
      commissioner_discord_name: string | null;
      difficulty: string | null;
      streaming_requirement: string | null;
      coin_economy_enabled: boolean;
      accelerated_clock_enabled: boolean;
      accelerated_clock_minimum_seconds: number | null;
      trade_approval_policy: string | null;
      offensive_play_call_limits_enabled: boolean;
      offensive_play_call_limit: number | null;
      offensive_play_call_cooldown: number | null;
      defensive_play_call_limits_enabled: boolean;
      defensive_play_call_limit: number | null;
      defensive_play_call_cooldown: number | null;
      open_team_count: number;
      member_count: number;
      is_member: boolean;
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    game: row.game,
    gameLabel: gameLabelFor(row.game),
    seasonStage: row.season_stage,
    seasonNumber: row.season_number,
    openTeamCount: Number(row.open_team_count ?? 0),
    memberCount: Number(row.member_count ?? 0),
    commissionerUsername: row.commissioner_username,
    commissionerDiscordName: row.commissioner_discord_name,
    difficulty: row.difficulty,
    streamingRequirement: row.streaming_requirement,
    coinEconomyEnabled: Boolean(row.coin_economy_enabled),
    acceleratedClockEnabled: Boolean(row.accelerated_clock_enabled),
    acceleratedClockMinimumSeconds: row.accelerated_clock_minimum_seconds,
    tradeApprovalPolicy: row.trade_approval_policy,
    offensivePlayCallLimitsEnabled: Boolean(row.offensive_play_call_limits_enabled),
    offensivePlayCallLimit: row.offensive_play_call_limit,
    offensivePlayCallCooldown: row.offensive_play_call_cooldown,
    defensivePlayCallLimitsEnabled: Boolean(row.defensive_play_call_limits_enabled),
    defensivePlayCallLimit: row.defensive_play_call_limit,
    defensivePlayCallCooldown: row.defensive_play_call_cooldown,
    isMember: Boolean(row.is_member),
  }));

  return { leagues };
}

