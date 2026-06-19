import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

function isMissingRpcError(error: unknown) {
  const err = error as { code?: string; message?: string };
  return err?.code === "42883" || err?.code === "PGRST202" || /function .* does not exist/i.test(err?.message ?? "");
}

const CONFERENCE_ORDER = ["NFC", "AFC"];
const DIVISION_ORDER = ["East", "North", "South", "West"];

// Resolve the primary league linked to a Discord guild.
// Chain: rec_discord_servers (guild_id) -> rec_server_league_links (is_primary) -> rec_leagues.
async function resolveLeagueId(guildId: string): Promise<string> {
  const context = await getCurrentLeagueContext(guildId);
  return context.leagueId;
}

function teamDisplayName(t: any): string {
  if (t.is_relocated && t.display_city) {
    return `${t.display_city}${t.display_nick ? ` ${t.display_nick}` : ""}`.trim();
  }
  return t.name as string;
}

type ConferenceTeam = {
  id: string;
  name: string;
  abbreviation: string | null;
  division: string;
  linkedDiscordId: string | null;
  linkedName: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointDifferential: number;
  recordText: string;
};
type DivisionGroup = { division: string; label: string; teams: ConferenceTeam[] };
type ConferenceGroup = { conference: string; divisions: DivisionGroup[] };

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRecord(record?: { wins?: number; losses?: number; ties?: number } | null) {
  return `${record?.wins ?? 0}-${record?.losses ?? 0}-${record?.ties ?? 0}`;
}

function sortTeamsByRecord(a: ConferenceTeam, b: ConferenceTeam) {
  const aPlayed = a.wins + a.losses + a.ties;
  const bPlayed = b.wins + b.losses + b.ties;
  const aPct = aPlayed ? (a.wins + a.ties * 0.5) / aPlayed : 0;
  const bPct = bPlayed ? (b.wins + b.ties * 0.5) / bPlayed : 0;
  return bPct - aPct || b.wins - a.wins || b.pointDifferential - a.pointDifferential || a.name.localeCompare(b.name);
}

async function loadTeamRecords(leagueId: string, seasonNumber: number) {
  const { data: assignments } = await supabase
    .from("rec_team_assignments")
    .select("team_id,user_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);

  const teamByUser = new Map<string, string>();
  const userIds: string[] = [];
  for (const assignment of assignments ?? []) {
    if (!assignment.user_id || !assignment.team_id) continue;
    teamByUser.set(String(assignment.user_id), String(assignment.team_id));
    userIds.push(String(assignment.user_id));
  }

  const records = new Map<string, { wins: number; losses: number; ties: number; pointDifferential: number; recordText: string }>();
  if (!userIds.length) return records;

  const { data } = await supabase
    .from("rec_season_user_records")
    .select("user_id,wins,losses,ties,point_differential")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .in("user_id", userIds);

  for (const row of data ?? []) {
    const teamId = teamByUser.get(String(row.user_id));
    if (!teamId) continue;
    const wins = asNumber(row.wins);
    const losses = asNumber(row.losses);
    const ties = asNumber(row.ties);
    records.set(teamId, {
      wins,
      losses,
      ties,
      pointDifferential: asNumber(row.point_differential),
      recordText: formatRecord({ wins, losses, ties })
    });
  }
  return records;
}

async function loadTeamDiscordUsernames(leagueId: string) {
  const { data } = await supabase
    .from("rec_team_assignments")
    .select("team_id, rec_users(rec_discord_accounts(username, global_name))")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  const names = new Map<string, string>();
  for (const assignment of data ?? []) {
    const accounts = (assignment as any).rec_users?.rec_discord_accounts;
    const account = Array.isArray(accounts) ? accounts[0] : accounts;
    if ((assignment as any).team_id) names.set(String((assignment as any).team_id), account?.username ?? account?.global_name ?? "Linked User");
  }
  return names;
}

async function getLeagueConferencesFallback(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const seasonNumber = asNumber(context.rec_leagues?.season_number ?? context.rec_leagues?.display_season_number ?? 1);
  const records = await loadTeamRecords(leagueId, seasonNumber);
  const discordNames = await loadTeamDiscordUsernames(leagueId);

  const { data: teams, error } = await supabase
    .from("rec_teams")
    .select("id, name, abbreviation, conference, division, display_city, display_nick, display_abbr, is_relocated, original_abbreviation")
    .eq("league_id", leagueId);
  if (error) throw new ApiError(500, "Failed to load teams.", error);

  const { data: assignments } = await supabase
    .from("rec_team_assignments")
    .select("team_id, rec_users(display_name, rec_discord_accounts(discord_id, global_name, username))")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);

  const linkByTeam = new Map<string, { discordId: string | null; name: string | null }>();
  for (const a of assignments ?? []) {
    const accounts = (a as any).rec_users?.rec_discord_accounts;
    const acc = Array.isArray(accounts) ? accounts[0] : accounts;
    linkByTeam.set((a as any).team_id, {
      discordId: acc?.discord_id ?? null,
      name: (a as any).rec_users?.display_name ?? acc?.global_name ?? acc?.username ?? null
    });
  }

  const rows = (teams ?? []).map((t) => {
    const link = linkByTeam.get(t.id as string);
    const record = records.get(t.id as string) ?? { wins: 0, losses: 0, ties: 0, pointDifferential: 0, recordText: "0-0-0" };
    return {
      id: t.id as string,
      name: teamDisplayName(t),
      abbreviation: (t.is_relocated && t.display_abbr ? t.display_abbr : t.abbreviation) ?? null,
      originalAbbreviation: (t.original_abbreviation ?? t.abbreviation) ?? null,
      conference: (t.conference ?? "").toUpperCase(),
      division: t.division ?? "",
      linkedDiscordId: link?.discordId ?? null,
      linkedName: discordNames.get(t.id as string) ?? link?.name ?? null,
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      pointDifferential: record.pointDifferential,
      recordText: record.recordText
    };
  });

  const confOrder = (c: string) => {
    const i = CONFERENCE_ORDER.indexOf(c);
    return i === -1 ? CONFERENCE_ORDER.length : i;
  };
  const divOrder = (d: string) => {
    const i = DIVISION_ORDER.indexOf(d);
    return i === -1 ? DIVISION_ORDER.length : i;
  };

  const conferenceNames = [...new Set(rows.map((r) => r.conference))].sort((a, b) => confOrder(a) - confOrder(b) || a.localeCompare(b));

  const conferences: ConferenceGroup[] = conferenceNames.map((conference) => {
    const confTeams = rows.filter((r) => r.conference === conference);
    const divisionNames = [...new Set(confTeams.map((r) => r.division))].sort((a, b) => divOrder(a) - divOrder(b) || a.localeCompare(b));
    const divisions: DivisionGroup[] = divisionNames.map((division) => ({
      division,
      label: `${conference} ${division}`.trim(),
      teams: confTeams
        .filter((r) => r.division === division)
        .map(({ id, name, abbreviation, originalAbbreviation, linkedDiscordId, linkedName, wins, losses, ties, pointDifferential, recordText }: any) => ({ id, name, abbreviation, originalAbbreviation, division, linkedDiscordId, linkedName, wins, losses, ties, pointDifferential, recordText }))
        .sort(sortTeamsByRecord)
    }));
    return { conference, divisions };
  });

  return { leagueType: context.rec_leagues?.league_type ?? context.rec_leagues?.leagueType ?? null, conferences };
}

async function enrichConferencesWithRecords(guildId: string, payload: any) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = asNumber(context.rec_leagues?.season_number ?? context.rec_leagues?.display_season_number ?? 1);
  const records = await loadTeamRecords(context.leagueId, seasonNumber);
  const discordNames = await loadTeamDiscordUsernames(context.leagueId);
  const teamIds = (payload?.conferences ?? [])
    .flatMap((conference: any) => conference.divisions ?? [])
    .flatMap((division: any) => division.teams ?? [])
    .map((team: any) => team.id)
    .filter(Boolean)
    .map(String);
  const teamSlots = new Map<string, { originalAbbreviation: string | null; abbreviation: string | null }>();
  if (teamIds.length) {
    const { data: teams } = await supabase
      .from("rec_teams")
      .select("id,abbreviation,original_abbreviation")
      .in("id", teamIds);
    for (const team of teams ?? []) {
      teamSlots.set(String(team.id), {
        originalAbbreviation: (team as any).original_abbreviation ?? (team as any).abbreviation ?? null,
        abbreviation: (team as any).abbreviation ?? null
      });
    }
  }
  const conferences = (payload?.conferences ?? []).map((conference: any) => ({
    ...conference,
    divisions: (conference.divisions ?? []).map((division: any) => ({
      ...division,
      teams: (division.teams ?? [])
        .map((team: any) => {
          const record = records.get(String(team.id)) ?? { wins: 0, losses: 0, ties: 0, pointDifferential: 0, recordText: "0-0-0" };
          return {
            ...team,
            originalAbbreviation: teamSlots.get(String(team.id))?.originalAbbreviation ?? team.originalAbbreviation ?? team.abbreviation ?? null,
            linkedName: discordNames.get(String(team.id)) ?? team.linkedName ?? null,
            wins: record.wins,
            losses: record.losses,
            ties: record.ties,
            pointDifferential: record.pointDifferential,
            recordText: record.recordText
          };
        })
        .sort(sortTeamsByRecord)
    }))
  }));
  return { ...payload, leagueType: context.rec_leagues?.league_type ?? context.rec_leagues?.leagueType ?? null, conferences };
}

const POSITION_GROUPS: { label: string; side: "offense" | "defense" | "special" | "other"; positions: string[] }[] = [
  { label: "Quarterbacks", side: "offense", positions: ["QB"] },
  { label: "Running Backs", side: "offense", positions: ["HB", "RB", "FB"] },
  { label: "Wide Receivers", side: "offense", positions: ["WR"] },
  { label: "Tight Ends", side: "offense", positions: ["TE"] },
  { label: "Offensive Line", side: "offense", positions: ["LT", "LG", "C", "RG", "RT", "OL", "T", "G"] },
  { label: "Defensive Line", side: "defense", positions: ["LEDGE", "DT", "REDGE", "LE", "RE", "DL", "EDGE"] },
  { label: "Linebackers", side: "defense", positions: ["WILL", "MIKE", "SAM", "MLB", "LOLB", "ROLB", "LB"] },
  { label: "Defensive Backs", side: "defense", positions: ["CB", "FS", "SS", "DB", "S"] },
  { label: "Special Teams", side: "special", positions: ["K", "P", "LS"] }
];

function groupLabelFor(position: string): string {
  const pos = (position ?? "").toUpperCase();
  const group = POSITION_GROUPS.find((g) => g.positions.includes(pos));
  return group?.label ?? "Other";
}

function groupSideFor(label: string) {
  return POSITION_GROUPS.find((g) => g.label === label)?.side ?? "other";
}

function positionOrder(position: string) {
  const pos = (position ?? "").toUpperCase();
  const group = POSITION_GROUPS.find((g) => g.positions.includes(pos));
  if (!group) return 99;
  const index = group.positions.indexOf(pos);
  return index === -1 ? 99 : index;
}

async function getTeamRosterFallback(guildId: string, teamId: string) {
  const leagueId = await resolveLeagueId(guildId);

  const { data: team } = await supabase
    .from("rec_teams")
    .select("id, league_id, name, conference, division, display_city, display_nick, is_relocated")
    .eq("id", teamId)
    .maybeSingle();
  if (!team || team.league_id !== leagueId) throw new ApiError(404, "Team not found in this league.");

  const { data: latest } = await supabase
    .from("rec_roster_snapshots")
    .select("season_number")
    .eq("league_id", leagueId)
    .order("season_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const season = latest?.season_number ?? null;

  let query = supabase
    .from("rec_roster_snapshots")
    .select("player_name, position, overall_rating, dev_trait, age, jersey_number, is_active, contract_years_left, contract_salary, raw_payload, rec_players(cap_hit, contract_years_left, contract_salary, dev_trait)")
    .eq("league_id", leagueId)
    .eq("team_id", teamId);
  if (season != null) query = query.eq("season_number", season);

  const { data: rows, error } = await query;
  if (error) throw new ApiError(500, "Failed to load roster.", error);

  const players = (rows ?? [])
    .filter((r) => r.is_active !== false)
    .map((r) => ({
      name: r.player_name ?? "Unknown",
      position: (r.position ?? "").toUpperCase(),
      ovr: r.overall_rating ?? 0,
      dev: (r as any).rec_players?.dev_trait ?? r.dev_trait ?? null,
      age: r.age ?? null,
      jersey: r.jersey_number ?? null,
      capHit: (r as any).rec_players?.cap_hit ?? (r.raw_payload as any)?.capHit ?? null,
      contractYearsLeft: (r as any).rec_players?.contract_years_left ?? r.contract_years_left ?? (r.raw_payload as any)?.contractYearsLeft ?? null,
      contractSalary: (r as any).rec_players?.contract_salary ?? r.contract_salary ?? (r.raw_payload as any)?.contractSalary ?? null,
      positionOrder: positionOrder(String(r.position ?? ""))
    }))
    .sort((a, b) => a.positionOrder - b.positionOrder || b.ovr - a.ovr || a.name.localeCompare(b.name));

  const groups = POSITION_GROUPS.map((g) => ({
    label: g.label,
    side: g.side,
    members: players.filter((p) => g.positions.includes(p.position))
  }));
  const otherMembers = players.filter((p) => groupLabelFor(p.position) === "Other");
  if (otherMembers.length) groups.push({ label: "Other", side: "other", members: otherMembers });

  return {
    team: {
      id: team.id as string,
      name: teamDisplayName(team),
      conference: (team.conference ?? "").toUpperCase(),
      division: team.division ?? ""
    },
    season,
    totalPlayers: players.length,
    groups: groups.filter((g) => g.members.length > 0)
  };
}

// Returns the league's teams grouped by conference/division for the "View Players by Team" grid.
// Primary path uses Supabase RPC so the bot only renders the prepared payload.
export async function getLeagueConferences(guildId: string) {
  const { data, error } = await supabase.rpc("rec_roster_league_conferences", {
    p_guild_id: guildId
  });

  if (error) {
    if (isMissingRpcError(error)) return getLeagueConferencesFallback(guildId);
    throw new ApiError(500, "Failed to load teams.", error);
  }
  return enrichConferencesWithRecords(guildId, data ?? { conferences: [] });
}

// Returns one team's active roster grouped by position group, members sorted by overall rating.
export async function getTeamRoster(guildId: string, teamId: string) {
  const { data, error } = await supabase.rpc("rec_roster_team", {
    p_guild_id: guildId,
    p_team_id: teamId
  });

  if (error) {
    if (isMissingRpcError(error)) return getTeamRosterFallback(guildId, teamId);
    throw new ApiError(500, "Failed to load roster.", error);
  }
  if (!data) throw new ApiError(404, "Team not found in this league.");
  return data;
}
