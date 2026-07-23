import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { isLeagueCommissioner } from "../site-inbox/site-inbox.service.js";

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

/** Resolve Discord guild + identity for rendering the hub inside apps/site (no iframe). */
export async function openSiteLeagueHub(input: {
  recUserId: string;
  leagueId: string;
  view?: SiteLeagueHubView;
  embed?: boolean;
}): Promise<{
  guildId: string;
  discordId: string;
  leagueId: string;
}> {
  void input.view;
  void input.embed;
  return openSiteLeagueHubContext(input);
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
