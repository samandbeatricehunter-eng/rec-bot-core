import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";

// Resolve the primary league linked to a Discord guild.
// Chain: rec_discord_servers (guild_id) -> rec_server_league_links (is_primary) -> rec_leagues.
async function resolveLeagueId(guildId: string): Promise<string> {
  const { data: server } = await supabase
    .from("rec_discord_servers")
    .select("id")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (!server?.id) throw new ApiError(404, "Server not found for this guild.");

  const { data: link } = await supabase
    .from("rec_server_league_links")
    .select("league_id")
    .eq("server_id", server.id)
    .eq("is_primary", true)
    .maybeSingle();
  if (!link?.league_id) throw new ApiError(404, "No league linked to this server.");

  return link.league_id as string;
}

// Order conferences NFC first (Column A) then AFC (Column B); divisions in standard order.
const CONFERENCE_ORDER = ["NFC", "AFC"];
const DIVISION_ORDER = ["East", "North", "South", "West"];

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
};
type DivisionGroup = { division: string; label: string; teams: ConferenceTeam[] };
type ConferenceGroup = { conference: string; divisions: DivisionGroup[] };

// Returns the league's teams grouped by conference and division for the "View Players by Team" grid.
export async function getLeagueConferences(guildId: string) {
  const leagueId = await resolveLeagueId(guildId);

  const { data: teams, error } = await supabase
    .from("rec_teams")
    .select("id, name, abbreviation, conference, division, display_city, display_nick, display_abbr, is_relocated")
    .eq("league_id", leagueId);
  if (error) throw new ApiError(500, "Failed to load teams.", error);

  // Map each team to its linked coach (active assignment) so the grid can show the @user instead of the name.
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
    return {
      id: t.id as string,
      name: teamDisplayName(t),
      abbreviation: (t.is_relocated && t.display_abbr ? t.display_abbr : t.abbreviation) ?? null,
      conference: (t.conference ?? "").toUpperCase(),
      division: t.division ?? "",
      linkedDiscordId: link?.discordId ?? null,
      linkedName: link?.name ?? null
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
        .map(({ id, name, abbreviation, linkedDiscordId, linkedName }) => ({ id, name, abbreviation, division, linkedDiscordId, linkedName }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }));
    return { conference, divisions };
  });

  return { conferences };
}

// Depth-chart ordering. Positions not listed fall into a trailing "Other" group.
const POSITION_GROUPS: { label: string; positions: string[] }[] = [
  { label: "Quarterbacks", positions: ["QB"] },
  { label: "Running Backs", positions: ["HB", "RB", "FB"] },
  { label: "Wide Receivers", positions: ["WR"] },
  { label: "Tight Ends", positions: ["TE"] },
  { label: "Offensive Line", positions: ["LT", "LG", "C", "RG", "RT", "OL", "T", "G"] },
  { label: "Defensive Line", positions: ["LEDGE", "REDGE", "LE", "RE", "DT", "DL", "EDGE"] },
  { label: "Linebackers", positions: ["MIKE", "SAM", "WILL", "MLB", "LOLB", "ROLB", "LB"] },
  { label: "Defensive Backs", positions: ["CB", "FS", "SS", "DB", "S"] },
  { label: "Special Teams", positions: ["K", "P", "LS"] }
];

function groupLabelFor(position: string): string {
  const pos = (position ?? "").toUpperCase();
  const group = POSITION_GROUPS.find((g) => g.positions.includes(pos));
  return group?.label ?? "Other";
}

// Returns one team's active roster grouped by position group, members sorted by overall rating descending.
export async function getTeamRoster(guildId: string, teamId: string) {
  const leagueId = await resolveLeagueId(guildId);

  const { data: team } = await supabase
    .from("rec_teams")
    .select("id, league_id, name, conference, division, display_city, display_nick, is_relocated")
    .eq("id", teamId)
    .maybeSingle();
  if (!team || team.league_id !== leagueId) throw new ApiError(404, "Team not found in this league.");

  // Roster snapshots store one row per player; week_number is null, so latest is keyed by season.
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
    .select("player_name, position, overall_rating, dev_trait, age, jersey_number, is_active")
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
      dev: r.dev_trait ?? null,
      age: r.age ?? null,
      jersey: r.jersey_number ?? null
    }))
    .sort((a, b) => b.ovr - a.ovr);

  const groups = POSITION_GROUPS.map((g) => ({
    label: g.label,
    members: players.filter((p) => g.positions.includes(p.position))
  }));
  const otherMembers = players.filter((p) => groupLabelFor(p.position) === "Other");
  if (otherMembers.length) groups.push({ label: "Other", members: otherMembers });

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
