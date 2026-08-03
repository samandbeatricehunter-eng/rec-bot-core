import { ApiError } from "../../lib/errors.js";
import { banDiscordGuildMember, kickDiscordGuildMember, listGuildMembers, unbanDiscordGuildMember } from "../../lib/discord-guild.js";
import { getPgPool } from "../../db/client.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { snapshotLeagueHistory } from "../users/league-history.service.js";
import { publishTransitionStory } from "../hub/story-publishing.js";

async function resolveActor(discordId: string | null): Promise<string> {
  if (!discordId) throw new ApiError(403, "A linked commissioner account is required.");
  const result = await getPgPool().query(`select user_id from rec_discord_accounts where discord_id=$1 limit 1`, [discordId]);
  if (!result.rows[0]?.user_id) throw new ApiError(403, "Link your REC account before moderating users.");
  return String(result.rows[0].user_id);
}

async function resolveTarget(query: string, guildId: string) {
  const normalized = query.trim().replace(/^@/, "");
  const result = await getPgPool().query(
    `select u.id,u.username,u.display_name,da.discord_id
     from rec_users u left join rec_discord_accounts da on da.user_id=u.id
     where lower(coalesce(u.username,''))=lower($1)
        or lower(coalesce(u.display_name,''))=lower($1)
        or da.discord_id=$1
     limit 1`,
    [normalized],
  );
  if (result.rows[0]) return result.rows[0] as { id: string; username: string | null; display_name: string | null; discord_id: string | null };
  const member = (await listGuildMembers(guildId)).find((row) => row.discordId === normalized || row.username.toLowerCase() === normalized.toLowerCase() || row.displayName.toLowerCase() === normalized.toLowerCase());
  if (!member || member.isBot) throw new ApiError(404, "No REC or Discord user matched that selection.");
  return { id: null, username: null, display_name: member.displayName, discord_id: member.discordId };
}

export async function listModerationTargets(guildId: string) {
  const members = (await listGuildMembers(guildId)).filter((member) => !member.isBot);
  const discordIds = members.map((member) => member.discordId);
  const linked = discordIds.length ? await getPgPool().query(
    `select da.discord_id,u.id user_id,u.username,u.display_name from rec_discord_accounts da join rec_users u on u.id=da.user_id where da.discord_id=any($1::text[])`,
    [discordIds],
  ) : { rows: [] as any[] };
  const byDiscord = new Map(linked.rows.map((row) => [String(row.discord_id), row]));
  return { targets: members.map((member) => {
    const account = byDiscord.get(member.discordId);
    return account
      ? { value: account.username || account.user_id, label: `${account.username || account.display_name} (${member.displayName})`, registered: true, discordId: member.discordId }
      : { value: member.discordId, label: `${member.displayName} (Discord Only)`, registered: false, discordId: member.discordId };
  }).sort((a, b) => a.label.localeCompare(b.label)) };
}

export async function listLeagueModeration(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const [bans, restrictions, suspensions, audit] = await Promise.all([
    getPgPool().query(
      `select s.*,u.username,u.display_name,p.full_name as player_name,p.position,t.name as team_name,
              (s.active and s.season_number=$2 and $3 between s.start_week and s.end_week) as currently_active
       from rec_league_suspensions s
       left join rec_users u on u.id=s.user_id left join rec_players p on p.id=s.player_id
       left join rec_teams t on t.id=p.team_id where s.league_id=$1
       order by s.active desc,s.created_at desc`,
      [context.leagueId, Number(context.rec_leagues.season_number ?? 1), Number(context.rec_leagues.current_week ?? 1)],
    ),
    getPgPool().query(
      `select b.*,u.username,u.display_name,
              (b.active and (b.expires_at is null or b.expires_at>now())) as currently_active
       from rec_league_bans b left join rec_users u on u.id=b.banned_user_id
       where b.owner_user_id=$1 and (b.league_id=$2 or b.scope='owner_all_leagues')
       order by b.active desc,b.created_at desc`,
      [context.rec_leagues.owner_user_id, context.leagueId],
    ),
    getPgPool().query(
      `select r.*,u.username,u.display_name,
              (r.active and (r.expires_at is null or r.expires_at>now())) as currently_active
       from rec_league_restrictions r join rec_users u on u.id=r.user_id
       where r.league_id=$1 order by r.active desc,r.created_at desc`,
      [context.leagueId],
    ),
    getPgPool().query(
      `select a.*,u.username as target_username from rec_league_moderation_audit a
       left join rec_users u on u.id=a.target_user_id where a.league_id=$1 order by a.created_at desc limit 100`,
      [context.leagueId],
    ),
  ]);
  return { bans: bans.rows, restrictions: restrictions.rows, suspensions: suspensions.rows, audit: audit.rows };
}

export async function listSuspensionPlayers(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const result = await getPgPool().query(
    `select p.id,p.full_name,p.position,t.name team_name,t.abbreviation team_abbreviation
     from rec_players p join rec_teams t on t.id=p.team_id
     where p.league_id=$1 and coalesce(p.roster_status,'active')='active'
     order by t.name,p.position,p.full_name`, [context.leagueId],
  );
  return { players: result.rows };
}

export async function createLeagueBan(input: {
  guildId: string;
  target: string;
  scope: "league" | "owner_all_leagues";
  reason: string;
  appealInstructions?: string | null;
  expiresAt?: string | null;
  actorDiscordId: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const actorUserId = await resolveActor(input.actorDiscordId);
  if (String(context.rec_leagues.owner_user_id) !== actorUserId) {
    throw new ApiError(403, "Only the league owner can ban users.");
  }
  const target = await resolveTarget(input.target, input.guildId);
  if (target.id === actorUserId) throw new ApiError(400, "You cannot ban yourself.");
  const client = await getPgPool().connect();
  let committed = false;
  try {
    await client.query("begin");
    const inserted = await client.query(
      `insert into rec_league_bans(owner_user_id,league_id,banned_user_id,target_discord_id,scope,reason,appeal_instructions,expires_at,created_by_user_id)
       values($1,$2,$3,$4,$5,$6,$7,$8,$1) returning *`,
      [actorUserId, input.scope === "league" ? context.leagueId : null, target.id, target.discord_id, input.scope, input.reason.trim(), input.appealInstructions?.trim() || null, input.expiresAt ?? null],
    );
    const affectedLeagueIds = input.scope === "league"
      ? [context.leagueId]
      : (await client.query(`select id from rec_leagues where owner_user_id=$1`, [actorUserId])).rows.map((row) => String(row.id));
    if (target.id) await client.query(
      `update rec_team_assignments set assignment_status='unlinked',ended_at=now(),user_id=null,updated_at=now()
       where user_id=$1 and league_id=any($2::uuid[]) and assignment_status='active' and ended_at is null`,
      [target.id, affectedLeagueIds],
    );
    if (target.id) await client.query(`delete from rec_league_memberships where user_id=$1 and league_id=any($2::uuid[])`, [target.id, affectedLeagueIds]);
    await client.query(
      `insert into rec_league_moderation_audit(league_id,actor_user_id,target_user_id,action,reason,metadata)
       values($1,$2,$3,'ban',$4,$5::jsonb)`,
      [context.leagueId, actorUserId, target.id, input.reason.trim(), JSON.stringify({ scope: input.scope, expiresAt: input.expiresAt ?? null })],
    );
    await client.query("commit");
    committed = true;
    if (target.discord_id) {
      const guildIds = input.scope === "league"
        ? [input.guildId]
        : (await getPgPool().query(
            `select distinct ds.guild_id from rec_leagues l
             join rec_server_league_links sl on sl.league_id=l.id
             join rec_discord_servers ds on ds.id=sl.server_id
             where l.owner_user_id=$1`,
            [actorUserId],
          )).rows.map((row) => String(row.guild_id));
      const outcomes = await Promise.allSettled(guildIds.map((guildId) => banDiscordGuildMember(guildId, target.discord_id!, `REC league ban: ${input.reason}`)));
      if (outcomes.some((outcome) => outcome.status === "fulfilled")) {
        await getPgPool().query(`update rec_league_bans set discord_ban_applied_at=now() where id=$1`, [inserted.rows[0].id]);
      }
      const failures = outcomes.filter((outcome) => outcome.status === "rejected").length;
      if (failures) {
        await getPgPool().query(
          `insert into rec_league_moderation_audit(league_id,actor_user_id,target_user_id,action,reason,metadata)
           values($1,$2,$3,'discord_ban_failed',$4,$5::jsonb)`,
          [context.leagueId, actorUserId, target.id, "One or more Discord servers rejected the ban.", JSON.stringify({ failures, attempted: guildIds.length })],
        );
      }
    }
    return { ban: inserted.rows[0] };
  } catch (error) {
    if (!committed) await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function liftLeagueBan(input: { guildId: string; banId: string; actorDiscordId: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const actorUserId = await resolveActor(input.actorDiscordId);
  if (String(context.rec_leagues.owner_user_id) !== actorUserId) throw new ApiError(403, "Only the league owner can lift bans.");
  const result = await getPgPool().query(
    `update rec_league_bans set active=false,lifted_by_user_id=$2,lifted_at=now()
     where id=$1 and owner_user_id=$2 and active=true returning *`,
    [input.banId, actorUserId],
  );
  if (!result.rows[0]) throw new ApiError(404, "Active ban not found.");
  const target = result.rows[0].banned_user_id ? await getPgPool().query(`select discord_id from rec_discord_accounts where user_id=$1 limit 1`, [result.rows[0].banned_user_id]) : { rows: [] as any[] };
  const targetDiscordId = target.rows[0]?.discord_id ?? result.rows[0].target_discord_id;
  if (targetDiscordId && result.rows[0].discord_ban_applied_at) {
    const guildIds = result.rows[0].scope === "owner_all_leagues"
      ? (await getPgPool().query(
          `select distinct ds.guild_id from rec_leagues l
           join rec_server_league_links sl on sl.league_id=l.id
           join rec_discord_servers ds on ds.id=sl.server_id
           where l.owner_user_id=$1`,
          [actorUserId],
        )).rows.map((row) => String(row.guild_id))
      : [input.guildId];
    await Promise.allSettled(guildIds.map((guildId) => unbanDiscordGuildMember(guildId, String(targetDiscordId), "REC league ban lifted")));
  }
  await getPgPool().query(
    `insert into rec_league_moderation_audit(league_id,actor_user_id,target_user_id,action,metadata)
     values($1,$2,$3,'ban_lifted',$4::jsonb)`,
    [context.leagueId, actorUserId, result.rows[0].banned_user_id, JSON.stringify({ banId: input.banId })],
  );
  return { ok: true };
}

export async function setLeagueRestriction(input: {
  guildId: string;
  target: string;
  restrictionType: "wagers" | "highlights";
  reason: string;
  expiresAt?: string | null;
  actorDiscordId: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const actorUserId = await resolveActor(input.actorDiscordId);
  const target = await resolveTarget(input.target, input.guildId);
  if (!target.id) throw new ApiError(400, "Website restrictions require a registered REC user. Discord-only members can be kicked or banned instead.");
  const result = await getPgPool().query(
    `insert into rec_league_restrictions(league_id,user_id,restriction_type,reason,expires_at,created_by_user_id)
     values($1,$2,$3,$4,$5,$6) returning *`,
    [context.leagueId, target.id, input.restrictionType, input.reason.trim(), input.expiresAt ?? null, actorUserId],
  );
  await getPgPool().query(
    `insert into rec_league_moderation_audit(league_id,actor_user_id,target_user_id,action,reason,metadata)
     values($1,$2,$3,'restriction',$4,$5::jsonb)`,
    [context.leagueId, actorUserId, target.id, input.reason.trim(), JSON.stringify({ restrictionType: input.restrictionType, expiresAt: input.expiresAt ?? null })],
  );
  return { restriction: result.rows[0] };
}

export async function suspendLeagueTargets(input: {
  guildId: string; targetType: "user" | "player"; target?: string; playerIds?: string[];
  startWeek: number; weekCount: number; reason: string; actorDiscordId: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const actorUserId = await resolveActor(input.actorDiscordId);
  const season = Number(context.rec_leagues.season_number ?? 1);
  const endWeek = input.startWeek + input.weekCount - 1;
  let targetUserId: string | null = null;
  let playerRows: Array<{ id: string; full_name: string; position: string; team_name: string }> = [];
  if (input.targetType === "user") {
    if (!input.target) throw new ApiError(400, "Select a user to suspend.");
    const target = await resolveTarget(input.target, input.guildId);
    if (!target.id) throw new ApiError(400, "User suspensions require a registered REC account.");
    targetUserId = target.id;
  } else {
    const ids = [...new Set(input.playerIds ?? [])];
    if (!ids.length) throw new ApiError(400, "Select at least one player to suspend.");
    const players = await getPgPool().query(
      `select p.id,p.full_name,p.position,t.name team_name from rec_players p join rec_teams t on t.id=p.team_id
       where p.league_id=$1 and p.id=any($2::uuid[])`, [context.leagueId, ids],
    );
    if (players.rows.length !== ids.length) throw new ApiError(400, "One or more selected players are not on an active league roster.");
    playerRows = players.rows;
  }
  const client = await getPgPool().connect();
  const insertedIds: string[] = [];
  try {
    await client.query("begin");
    const targets = input.targetType === "user" ? [null] : playerRows;
    for (const player of targets) {
      const inserted = await client.query(
        `insert into rec_league_suspensions(league_id,target_type,user_id,player_id,season_number,start_week,end_week,reason,created_by_user_id)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [context.leagueId,input.targetType,targetUserId,player?.id ?? null,season,input.startWeek,endWeek,input.reason.trim(),actorUserId],
      );
      insertedIds.push(String(inserted.rows[0].id));
    }
    await client.query(
      `insert into rec_league_moderation_audit(league_id,actor_user_id,target_user_id,action,reason,metadata)
       values($1,$2,$3,'suspension',$4,$5::jsonb)`,
      [context.leagueId,actorUserId,targetUserId,input.reason.trim(),JSON.stringify({ targetType: input.targetType, playerIds: playerRows.map((p) => p.id), season, startWeek: input.startWeek, endWeek })],
    );
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  const subject = input.targetType === "user"
    ? (await getPgPool().query(`select coalesce(display_name,username,'User') name from rec_users where id=$1`, [targetUserId])).rows[0]?.name
    : playerRows.map((p) => `${p.full_name} (${p.position}, ${p.team_name})`).join(", ");
  const story = await publishTransitionStory({ guildId: input.guildId, headline: `${subject} Suspended`, body: `${subject} has been suspended for Week ${input.startWeek}${endWeek === input.startWeek ? "" : ` through Week ${endWeek}`} of Season ${season}.\n\nLeague reason: ${input.reason.trim()}`, primaryAngle: "league_suspension", storyType: "headline" });
  await getPgPool().query(`update rec_league_suspensions set public_story_id=$1 where id=any($2::uuid[])`, [story.storyId, insertedIds]);
  return { suspended: true, suspensionIds: insertedIds, storyId: story.storyId };
}

export async function liftLeagueSuspension(input: { guildId: string; suspensionId: string; actorDiscordId: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const actorUserId = await resolveActor(input.actorDiscordId);
  const result = await getPgPool().query(`update rec_league_suspensions set active=false,lifted_by_user_id=$3,lifted_at=now() where id=$1 and league_id=$2 and active=true returning *`, [input.suspensionId,context.leagueId,actorUserId]);
  if (!result.rows[0]) throw new ApiError(404, "Active suspension not found.");
  return { ok: true };
}

export async function kickLeagueUser(input: { guildId: string; target: string; scope: "league" | "server" | "both"; reason: string; actorDiscordId: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const actorUserId = await resolveActor(input.actorDiscordId);
  const target = await resolveTarget(input.target, input.guildId);
  if (target.id === actorUserId) throw new ApiError(400, "You cannot kick yourself.");
  if ((input.scope === "league" || input.scope === "both") && target.id) {
    await snapshotLeagueHistory(context.leagueId, false);
    const client = await getPgPool().connect();
    try {
      await client.query("begin");
      await client.query(`update rec_team_assignments set assignment_status='archived',ended_at=now(),updated_at=now() where league_id=$1 and user_id=$2 and assignment_status='active' and ended_at is null`, [context.leagueId, target.id]);
      await client.query(`delete from rec_league_memberships where league_id=$1 and user_id=$2`, [context.leagueId, target.id]);
      await client.query(`insert into rec_league_moderation_audit(league_id,actor_user_id,target_user_id,action,reason,metadata) values($1,$2,$3,'kick',$4,$5::jsonb)`, [context.leagueId, actorUserId, target.id, input.reason.trim(), JSON.stringify({ scope: input.scope, discordId: target.discord_id })]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
  if ((input.scope === "server" || input.scope === "both") && target.discord_id) await kickDiscordGuildMember(input.guildId, target.discord_id, `REC commissioner kick: ${input.reason}`);
  return { kicked: true, registered: Boolean(target.id), scope: input.scope };
}

export async function liftLeagueRestriction(input: { guildId: string; restrictionId: string; actorDiscordId: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const actorUserId = await resolveActor(input.actorDiscordId);
  const result = await getPgPool().query(
    `update rec_league_restrictions set active=false,lifted_by_user_id=$3,lifted_at=now()
     where id=$1 and league_id=$2 and active=true returning *`,
    [input.restrictionId, context.leagueId, actorUserId],
  );
  if (!result.rows[0]) throw new ApiError(404, "Active restriction not found.");
  await getPgPool().query(
    `insert into rec_league_moderation_audit(league_id,actor_user_id,target_user_id,action,metadata)
     values($1,$2,$3,'restriction_lifted',$4::jsonb)`,
    [context.leagueId, actorUserId, result.rows[0].user_id, JSON.stringify({ restrictionId: input.restrictionId })],
  );
  return { ok: true };
}

export async function assertNotLeagueRestricted(leagueId: string, userId: string, type: "wagers" | "highlights") {
  const result = await getPgPool().query(
    `select 1 from rec_league_restrictions where league_id=$1 and user_id=$2 and restriction_type=$3
       and active=true and (expires_at is null or expires_at>now()) limit 1`,
    [leagueId, userId, type],
  );
  if (result.rows[0]) throw new ApiError(403, `You are currently restricted from ${type} in this league.`);
  const suspended = await getPgPool().query(
    `select 1 from rec_league_suspensions s join rec_leagues l on l.id=s.league_id
     where s.league_id=$1 and s.user_id=$2 and s.target_type='user' and s.active=true
       and s.season_number=l.season_number and l.current_week between s.start_week and s.end_week limit 1`,
    [leagueId,userId],
  );
  if (suspended.rows[0]) throw new ApiError(403, "You are suspended from league actions for the current week.");
}
