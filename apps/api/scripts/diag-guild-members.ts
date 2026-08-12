import { Pool } from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
dotenv.config({ path: path.resolve(currentDir, "../.env") });
dotenv.config({ path: path.resolve(currentDir, "../apps/api/.env"), override: false });

const pool = new Pool({ connectionString: process.env.REC_DATABASE_URL ?? "" });
const GUILD = "1476251181524189438";
const token = process.env.DISCORD_TOKEN ?? "";

async function member(guildId: string, userId: string) {
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (res.status === 404) return { present: false };
  if (!res.ok) return { present: null };
  return { present: true };
}

async function main() {
  const { rows } = await pool.query(`
    select a.id, a.team_id, a.user_id, a.assignment_status, a.created_at,
           t.name as team_name, d.discord_id
    from rec_team_assignments a
    join rec_teams t on t.id = a.team_id
    left join rec_discord_accounts d on d.user_id = a.user_id
    where a.ended_at is null
      and exists (select 1 from rec_server_league_links sl
                  join rec_discord_servers s on s.id = sl.server_id
                  where sl.league_id = a.league_id and s.guild_id = $1)
    order by a.created_at desc
  `, [GUILD]);
  console.log(`Active assignments in guild ${GUILD}: ${rows.length}`);
  for (const r of rows) {
    if (!r.discord_id || !/^\d{17,20}$/.test(String(r.discord_id))) {
      console.log(`${r.team_name.padEnd(24)} user=${String(r.user_id).slice(0,8)} discord=${String(r.discord_id).slice(0,8)||"none"} (site-only)`);
      continue;
    }
    const m = await member(GUILD, r.discord_id);
    console.log(`${r.team_name.padEnd(24)} discord=${r.discord_id} present=${m.present}`);
  }
}

main().then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });