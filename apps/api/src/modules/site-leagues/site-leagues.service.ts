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
  const result = await getPgPool().query(
    `
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
      order by l.name asc
    `,
    [input.recUserId],
  );

  const leagues: SiteLeagueSummary[] = [];
  for (const row of result.rows as Array<{
    id: string;
    name: string;
    game: string;
    owner_user_id: string | null;
    team_name: string | null;
    membership_role: string | null;
  }>) {
    const isCommissioner = await isLeagueCommissioner(input.recUserId, row.id);
    const role = String(row.membership_role ?? "").toLowerCase();
    let commissionerRole: "head" | "co" | "member" = "member";
    if (row.owner_user_id === input.recUserId || role === "commissioner") {
      commissionerRole = "head";
    } else if (isCommissioner || role === "co_commissioner") {
      commissionerRole = "co";
    }
    leagues.push({
      id: row.id,
      name: row.name,
      game: row.game,
      gameLabel: gameLabelFor(row.game),
      teamName: row.team_name ?? null,
      isCommissioner: commissionerRole !== "member",
      commissionerRole,
    });
  }

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
