import { CFB_27_TEAMS, NFL_TEAMS } from "@rec/shared";
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";

const GAME = ["madden_26", "madden_27", "cfb_27"] as const;
type Game = (typeof GAME)[number];

function teamCatalogFor(game: string) {
  if (game === "cfb_27") {
    return CFB_27_TEAMS.filter((t) => !t.isSchedulePlaceholder).map((t) => ({ abbr: t.abbreviation, name: t.name }));
  }
  return NFL_TEAMS.map((t) => ({ abbr: t.abbreviation, name: t.name }));
}

function resolveTeamLoose(game: string, rawValue: string): { abbr: string; name: string } | null {
  const value = rawValue.trim().toUpperCase();
  if (!value) return null;
  const catalog = teamCatalogFor(game);
  return (
    catalog.find((t) => t.abbr.toUpperCase() === value) ??
    catalog.find((t) => t.name.toUpperCase() === value) ??
    null
  );
}

// Minimal RFC4180-ish CSV line splitter -- handles quoted fields with embedded commas/quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { pushField(); continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { pushRow(); continue; }
    field += ch;
  }
  if (field.length || row.length) pushRow();
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

const CORE_HEADER_ALIASES: Record<string, string[]> = {
  team: ["team", "team name", "teamabbr", "team abbr"],
  name: ["name", "player", "full name", "player name"],
  position: ["position", "pos"],
  jersey: ["jersey", "number", "jersey #", "#", "jersey number"],
  overall: ["ovr", "overall", "overall rating"],
};

function matchCoreHeader(header: string): keyof typeof CORE_HEADER_ALIASES | null {
  const normalized = header.trim().toLowerCase();
  for (const [core, aliases] of Object.entries(CORE_HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return core as keyof typeof CORE_HEADER_ALIASES;
  }
  return null;
}

export async function createRosterLibrary(input: {
  recUserId: string;
  game: Game;
  name: string;
  sourceNote?: string | null;
}) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new ApiError(400, "Give the roster library a name.");
  try {
    const result = await getPgPool().query(
      `insert into rec_site_roster_libraries (game, name, source_note, created_by_user_id)
       values ($1, $2, $3, $4) returning *`,
      [input.game, name, input.sourceNote?.trim() || null, input.recUserId],
    );
    return { library: result.rows[0] };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(409, "A roster library with that name already exists for this game.");
    }
    throw error;
  }
}

export async function listRosterLibraries(input: { game?: string } = {}) {
  const result = await getPgPool().query(
    `
      select l.*,
        (select count(*)::int from rec_site_roster_library_players p where p.library_id = l.id) as player_count,
        (select count(distinct p.team_abbr)::int from rec_site_roster_library_players p where p.library_id = l.id) as team_count
      from rec_site_roster_libraries l
      where ($1::text is null or l.game = $1)
      order by l.is_baseline desc, l.created_at desc
    `,
    [input.game ?? null],
  );
  return {
    libraries: result.rows.map((row) => ({
      id: row.id,
      game: row.game,
      name: row.name,
      isBaseline: row.is_baseline,
      sourceNote: row.source_note,
      playerCount: Number(row.player_count),
      teamCount: Number(row.team_count),
      createdAt: row.created_at,
    })),
  };
}

export async function getRosterLibrary(input: { libraryId: string }) {
  const library = await getPgPool().query(`select * from rec_site_roster_libraries where id = $1`, [input.libraryId]);
  const row = library.rows[0];
  if (!row) throw new ApiError(404, "Roster library not found.");
  const players = await getPgPool().query(
    `select * from rec_site_roster_library_players where library_id = $1 order by team_abbr, overall_rating desc nulls last, full_name`,
    [input.libraryId],
  );
  type LibraryPlayer = {
    id: string; fullName: string; position: string | null;
    jerseyNumber: number | null; overallRating: number | null; attributes: unknown;
  };
  const teams = new Map<string, { abbr: string; name: string; players: LibraryPlayer[] }>();
  for (const team of teamCatalogFor(row.game)) {
    teams.set(team.abbr, { abbr: team.abbr, name: team.name, players: [] });
  }
  for (const p of players.rows) {
    const entry = teams.get(p.team_abbr) ?? { abbr: p.team_abbr, name: p.team_name, players: [] as LibraryPlayer[] };
    entry.players.push({
      id: p.id,
      fullName: p.full_name,
      position: p.position,
      jerseyNumber: p.jersey_number,
      overallRating: p.overall_rating,
      attributes: p.attributes,
    });
    teams.set(p.team_abbr, entry);
  }
  return {
    library: {
      id: row.id,
      game: row.game,
      name: row.name,
      isBaseline: row.is_baseline,
      sourceNote: row.source_note,
      createdAt: row.created_at,
    },
    teams: Array.from(teams.values()),
  };
}

export async function importRosterLibraryCsv(input: { libraryId: string; csvText: string }) {
  const library = await getPgPool().query(`select game from rec_site_roster_libraries where id = $1`, [input.libraryId]);
  const game = library.rows[0]?.game as string | undefined;
  if (!game) throw new ApiError(404, "Roster library not found.");

  const rows = parseCsv(input.csvText);
  if (rows.length < 2) throw new ApiError(400, "CSV needs a header row plus at least one player row.");
  const header = rows[0].map((h) => h.trim());
  const coreIndex = new Map<string, number>();
  header.forEach((h, idx) => {
    const core = matchCoreHeader(h);
    if (core) coreIndex.set(core, idx);
  });
  if (!coreIndex.has("team") || !coreIndex.has("name")) {
    throw new ApiError(400, "CSV must include Team and Name columns (aliases like Player/Team Name are also recognized).");
  }

  const players: Array<{
    team_abbr: string; team_name: string; full_name: string; position: string | null;
    jersey_number: number | null; overall_rating: number | null; attributes: Record<string, string>;
  }> = [];
  const skipped: Array<{ row: number; reason: string }> = [];

  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    const rawTeam = cells[coreIndex.get("team")!] ?? "";
    const rawName = cells[coreIndex.get("name")!] ?? "";
    if (!rawName.trim()) { skipped.push({ row: i + 1, reason: "Missing player name." }); continue; }
    const team = resolveTeamLoose(game, rawTeam);
    if (!team) { skipped.push({ row: i + 1, reason: `Unrecognized team "${rawTeam}".` }); continue; }

    const jerseyRaw = coreIndex.has("jersey") ? cells[coreIndex.get("jersey")!] : "";
    const overallRaw = coreIndex.has("overall") ? cells[coreIndex.get("overall")!] : "";
    const attributes: Record<string, string> = {};
    header.forEach((h, idx) => {
      if (matchCoreHeader(h)) return;
      const value = cells[idx];
      if (value !== undefined && value !== "") attributes[h] = value;
    });

    players.push({
      team_abbr: team.abbr,
      team_name: team.name,
      full_name: rawName.trim(),
      position: coreIndex.has("position") ? (cells[coreIndex.get("position")!]?.trim() || null) : null,
      jersey_number: jerseyRaw && !Number.isNaN(Number(jerseyRaw)) ? Math.trunc(Number(jerseyRaw)) : null,
      overall_rating: overallRaw && !Number.isNaN(Number(overallRaw)) ? Math.trunc(Number(overallRaw)) : null,
      attributes,
    });
  }

  if (!players.length) throw new ApiError(400, "No valid player rows found in that CSV.");

  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`delete from rec_site_roster_library_players where library_id = $1`, [input.libraryId]);
    const chunkSize = 200;
    for (let i = 0; i < players.length; i += chunkSize) {
      const chunk = players.slice(i, i + chunkSize);
      const values: unknown[] = [];
      const placeholders = chunk.map((p, idx) => {
        const base = idx * 8;
        values.push(
          input.libraryId, p.team_abbr, p.team_name, p.full_name, p.position, p.jersey_number, p.overall_rating,
          JSON.stringify(p.attributes),
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::jsonb)`;
      }).join(", ");
      await client.query(
        `insert into rec_site_roster_library_players
           (library_id, team_abbr, team_name, full_name, position, jersey_number, overall_rating, attributes)
         values ${placeholders}`,
        values,
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return { imported: players.length, skipped };
}

export async function cloneRosterLibrary(input: { libraryId: string; recUserId: string; newName: string }) {
  const name = input.newName.trim();
  if (name.length < 2 || name.length > 80) throw new ApiError(400, "Give the cloned library a name.");
  const source = await getPgPool().query(`select * from rec_site_roster_libraries where id = $1`, [input.libraryId]);
  const row = source.rows[0];
  if (!row) throw new ApiError(404, "Roster library not found.");

  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    const inserted = await client.query(
      `insert into rec_site_roster_libraries (game, name, source_note, created_by_user_id)
       values ($1, $2, $3, $4) returning id`,
      [row.game, name, row.source_note, input.recUserId],
    );
    const newLibraryId = inserted.rows[0].id as string;
    await client.query(
      `insert into rec_site_roster_library_players
         (library_id, team_abbr, team_name, full_name, position, jersey_number, overall_rating, attributes)
       select $1, team_abbr, team_name, full_name, position, jersey_number, overall_rating, attributes
       from rec_site_roster_library_players where library_id = $2`,
      [newLibraryId, input.libraryId],
    );
    await client.query("commit");
    return { libraryId: newLibraryId };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(409, "A roster library with that name already exists for this game.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function setRosterLibraryBaseline(input: { libraryId: string; isBaseline: boolean }) {
  const result = await getPgPool().query(
    `update rec_site_roster_libraries set is_baseline = $2, updated_at = now() where id = $1 returning game`,
    [input.libraryId, input.isBaseline],
  );
  if (!result.rows[0]) throw new ApiError(404, "Roster library not found.");
  if (input.isBaseline) {
    // Only one baseline per game -- unset any other library previously flagged for the same game.
    await getPgPool().query(
      `update rec_site_roster_libraries set is_baseline = false, updated_at = now() where game = $1 and id <> $2`,
      [result.rows[0].game, input.libraryId],
    );
  }
  return { ok: true as const };
}

export async function deleteRosterLibrary(input: { libraryId: string }) {
  const inUse = await getPgPool().query(
    `select count(*)::int as n from rec_site_tournaments where roster_library_id = $1`,
    [input.libraryId],
  );
  if (Number(inUse.rows[0]?.n ?? 0) > 0) {
    throw new ApiError(409, "This library is linked to a tournament -- unlink it before deleting.");
  }
  await getPgPool().query(`delete from rec_site_roster_libraries where id = $1`, [input.libraryId]);
  return { ok: true as const };
}
