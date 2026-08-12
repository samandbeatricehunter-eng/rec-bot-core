import { Pool } from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
dotenv.config({ path: path.resolve(currentDir, "../.env") });
dotenv.config({ path: path.resolve(currentDir, "../apps/api/.env"), override: false });

const url = (process.env.REC_DATABASE_URL ?? "");
if (!url) {
  console.error("NO REC_DATABASE_URL");
  process.exit(1);
}
const pool = new Pool({ connectionString: url });

async function main() {
  const pending = await pool.query(`
    select r.id, r.guild_id, r.league_id, r.team_id, r.status, r.requester_discord_id, r.requester_user_id,
           t.name as team_name, l.name as league_name
    from rec_team_link_requests r
    join rec_teams t on t.id = r.team_id
    join rec_leagues l on l.id = r.league_id
    where r.status in ('pending','approved')
    order by r.created_at desc
    limit 50
  `);
  console.log("=== STUCK PENDING/APPROVED REQUESTS ===");
  console.table(pending.rows);

  const orphanAssignments = await pool.query(`
    select a.id, a.league_id, a.team_id, a.user_id, a.assignment_status, a.ended_at, a.created_at,
           t.name as team_name, l.name as league_name, d.discord_id, u.display_name
    from rec_team_assignments a
    join rec_teams t on t.id = a.team_id
    join rec_leagues l on l.id = a.league_id
    left join rec_users u on u.id = a.user_id
    left join rec_discord_accounts d on d.user_id = a.user_id
    where a.ended_at is null
    order by a.created_at desc
    limit 100
  `);
  console.log("=== ACTIVE ASSIGNMENTS (ended_at null) ===");
  console.table(orphanAssignments.rows);

  const recents = await pool.query(`
    select id, guild_id, league_id, team_id, status, requester_discord_id, requester_user_id, resolved_at, created_at
    from rec_team_link_requests
    order by created_at desc
    limit 15
  `);
  console.log("=== RECENT REQUESTS ===");
  console.table(recents.rows);
}

main().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });