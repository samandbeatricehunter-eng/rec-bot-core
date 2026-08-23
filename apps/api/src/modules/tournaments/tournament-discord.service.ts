// Broadcasts a tournament's registration embed to the announcements channel of every Discord
// server whose primary league plays the same game, with a link button routing to the site's
// tournament page. By design this deletes the old tracked post and sends a fresh one on every
// update (not edited in place) so the announcement bumps back to the bottom of the channel each
// time something about the tournament changes, instead of sitting buried under newer messages.
import { getPgPool } from "../../db/client.js";
import { env } from "../../config/env.js";
import { deleteDiscordMessage, postDiscordChannelMessage } from "../../lib/discord-guild.js";

function payoutBlurb(row: { payoutScope: string; winnerCoins: number; runnerUpCoins: number; semifinalistCoins: number }): string {
  if (row.payoutScope === "winner") return `${row.winnerCoins.toLocaleString()} coins to the winner`;
  if (row.payoutScope === "final_two") return `${row.winnerCoins.toLocaleString()} / ${row.runnerUpCoins.toLocaleString()} coins (winner / runner-up)`;
  return `${row.winnerCoins.toLocaleString()} / ${row.runnerUpCoins.toLocaleString()} / ${row.semifinalistCoins.toLocaleString()} coins (winner / runner-up / each semi)`;
}

function gameLabel(game: string): string {
  if (game === "cfb_27") return "CFB 27";
  if (game === "madden_26") return "Madden 26";
  return "Madden 27";
}

async function resolveAnnouncementGuilds(game: string): Promise<Array<{ guild_id: string; announcements_channel_id: string }>> {
  const guilds = await getPgPool().query(
    `
      select distinct ds.guild_id, sr.announcements_channel_id
      from rec_discord_servers ds
      inner join rec_server_league_links sll on sll.server_id = ds.id and sll.is_primary = true
      inner join rec_leagues rl on rl.id = sll.league_id and rl.game = $1
      inner join rec_server_routes sr on sr.server_id = ds.id and sr.announcements_channel_id is not null
    `,
    [game],
  );
  return guilds.rows;
}

// Catches tournaments created with a future registrationOpensAt -- createTournament only fires
// the "just opened" @everyone ping immediately when registration is already open at creation
// time; this sweep fires it once that scheduled moment actually arrives.
export async function runTournamentRegistrationAnnounceSweep(): Promise<void> {
  const due = await getPgPool().query(
    `
      select id from rec_site_tournaments
      where status = 'open' and not registration_paused
        and registration_open_announced_at is null
        and registration_opens_at <= now()
    `,
  );
  for (const row of due.rows as Array<{ id: string }>) {
    await getPgPool().query(`update rec_site_tournaments set registration_open_announced_at = now() where id = $1`, [row.id]);
    await syncTournamentDiscordAnnouncements(row.id, { pingEveryone: "registration_open" }).catch((error) =>
      console.error("[ERROR] tournament @everyone announcement sweep failed (non-fatal):", error));
  }
}

export async function syncTournamentDiscordAnnouncements(
  tournamentId: string,
  options: { pingEveryone?: "created" | "registration_open" } = {},
): Promise<void> {
  const tournament = await getPgPool().query(
    `
      select t.*,
        (select count(*)::int from rec_site_tournament_entrants e where e.tournament_id = t.id and e.entry_status = 'approved') as approved_count
      from rec_site_tournaments t where t.id = $1
    `,
    [tournamentId],
  );
  const row = tournament.rows[0];
  if (!row) return;
  const meta = { size: bracketSizeFor(row.bracket_type) };
  const openSlots = meta.size != null ? Math.max(0, meta.size - Number(row.approved_count ?? 0)) : null;

  const entrants = await getPgPool().query(
    `
      select coalesce(nullif(u.display_name, ''), u.username) as display_name, e.team_name
      from rec_site_tournament_entrants e
      inner join rec_users u on u.id = e.user_id
      where e.tournament_id = $1 and e.entry_status <> 'removed'
      order by e.joined_at
    `,
    [tournamentId],
  );
  let registeredField: { name: string; value: string; inline: boolean } | null = null;
  if (entrants.rows.length) {
    const lines = entrants.rows.map((r: { display_name: string | null; team_name: string | null }) =>
      r.team_name ? `${r.display_name ?? "Unknown"} — ${r.team_name}` : (r.display_name ?? "Unknown"));
    let value = lines.join("\n");
    if (value.length > 1024) {
      let shown = 0;
      let total = 0;
      for (const line of lines) {
        if (total + line.length + 1 > 900) break;
        total += line.length + 1;
        shown += 1;
      }
      value = `${lines.slice(0, shown).join("\n")}\n…and ${lines.length - shown} more`;
    }
    registeredField = { name: "Registered", value, inline: false };
  }

  const guilds = await resolveAnnouncementGuilds(row.game);
  if (!guilds.length) return;

  const href = `${env.SITE_PUBLIC_URL}/tournaments/${row.id}`;
  const statusLine = row.status === "open" ? "Registration open" : row.status === "locked" ? "In progress"
    : row.status === "complete" ? "Complete" : row.status === "cancelled" ? "Cancelled" : "Draft";
  const firstRoundLine = row.schedule_mode === "per_round"
    ? "Rounds scheduled individually (see the tournament page)"
    : `<t:${Math.floor(new Date(row.kickoff_at).getTime() / 1000)}:F>`;
  // pingEveryone makes this SAME message the @everyone ping -- carrying the full embed rather
  // than a bare separate one-line ping, so the notification people actually see has every
  // detail instead of just a title and a link.
  const pingText = options.pingEveryone === "created"
    ? `📣 @everyone New tournament: **${row.title}** — registration is open!`
    : options.pingEveryone === "registration_open"
      ? `📣 @everyone Registration is now open for **${row.title}**!`
      : undefined;
  const payload = {
    ...(pingText ? { content: pingText, allowed_mentions: { parse: ["everyone"] } } : {}),
    embeds: [{
      title: row.title,
      description: row.description || undefined,
      color: 0xd9a521,
      fields: [
        { name: "Status", value: statusLine, inline: true },
        { name: "Game", value: gameLabel(row.game), inline: true },
        { name: "Bracket", value: row.bracket_type.replace(/_/g, " "), inline: true },
        { name: "Registration Opens", value: `<t:${Math.floor(new Date(row.registration_opens_at).getTime() / 1000)}:F>`, inline: true },
        { name: "Registration Closes", value: `<t:${Math.floor(new Date(row.registration_closes_at).getTime() / 1000)}:F>`, inline: true },
        { name: "First Round", value: firstRoundLine, inline: true },
        { name: "Payout", value: payoutBlurb(row), inline: false },
        { name: "Open Slots", value: openSlots != null ? `${openSlots} of ${meta.size}` : `${row.approved_count}/—`, inline: true },
        ...(registeredField ? [registeredField] : []),
      ],
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: "Register", url: href }],
    }],
  };

  for (const guild of guilds) {
    await syncOnePost(row.id, guild.guild_id, guild.announcements_channel_id, payload);
  }
}

function bracketSizeFor(bracketType: string): number | null {
  const match = /(\d+)$/.exec(bracketType);
  return match ? Number(match[1]) : null;
}

// Always delete-and-repost (never edit) per design: the announcement should bump to the bottom
// of the channel on every update so it stays visible, rather than sitting in place and getting
// buried under newer messages.
async function syncOnePost(tournamentId: string, guildId: string, channelId: string, payload: Record<string, unknown>) {
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`tournament-discord:${tournamentId}:${guildId}`]);
    const state = await client.query(
      `select channel_id, message_id from rec_site_tournament_discord_posts where tournament_id = $1 and guild_id = $2`,
      [tournamentId, guildId],
    );
    const row = state.rows[0] as { channel_id: string; message_id: string } | undefined;
    if (row?.message_id) {
      await deleteDiscordMessage(row.channel_id, row.message_id).catch(() => undefined);
    }
    const posted = await postDiscordChannelMessage(channelId, payload).catch((error) => {
      console.error("[ERROR] tournament announcement: failed to post (non-fatal):", error);
      return null;
    });
    if (posted?.id) {
      await client.query(
        `
          insert into rec_site_tournament_discord_posts (tournament_id, guild_id, channel_id, message_id, updated_at)
          values ($1, $2, $3, $4, now())
          on conflict (tournament_id, guild_id) do update set channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = now()
        `,
        [tournamentId, guildId, channelId, posted.id],
      );
    } else if (row?.message_id) {
      await client.query(`delete from rec_site_tournament_discord_posts where tournament_id = $1 and guild_id = $2`, [tournamentId, guildId]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error("[ERROR] tournament announcement: sync failed (non-fatal):", error);
  } finally {
    client.release();
  }
}
