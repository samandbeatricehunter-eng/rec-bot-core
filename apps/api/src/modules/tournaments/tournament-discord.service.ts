// Broadcasts a tournament's registration embed to the announcements channel of every Discord
// server whose primary league plays the same game, with a link button routing to the site's
// tournament page. Edited in place as participants/status/schedule change, same idiom as
// matchups-channel.service.ts's per-league advisory-locked check-then-act sequence.
import { getPgPool } from "../../db/client.js";
import { env } from "../../config/env.js";
import { deleteDiscordMessage, editDiscordMessage, postDiscordChannelMessage } from "../../lib/discord-guild.js";

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

export async function syncTournamentDiscordAnnouncements(tournamentId: string): Promise<void> {
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

  const guilds = await getPgPool().query(
    `
      select distinct ds.guild_id, sr.announcements_channel_id
      from rec_discord_servers ds
      inner join rec_server_league_links sll on sll.server_id = ds.id and sll.is_primary = true
      inner join rec_leagues rl on rl.id = sll.league_id and rl.game = $1
      inner join rec_server_routes sr on sr.server_id = ds.id and sr.announcements_channel_id is not null
    `,
    [row.game],
  );
  if (!guilds.rows.length) return;

  const href = `${env.SITE_PUBLIC_URL}/tournaments/${row.id}`;
  const statusLine = row.status === "open" ? "Registration open" : row.status === "locked" ? "In progress"
    : row.status === "complete" ? "Complete" : row.status === "cancelled" ? "Cancelled" : "Draft";
  const scheduleLine = row.schedule_mode === "per_round"
    ? `Registration ${new Date(row.registration_opens_at).toLocaleDateString()} – ${new Date(row.registration_closes_at).toLocaleDateString()} · rounds scheduled individually`
    : `Registration ${new Date(row.registration_opens_at).toLocaleDateString()} – ${new Date(row.registration_closes_at).toLocaleDateString()} · Kickoff ${new Date(row.kickoff_at).toLocaleString()}`;
  const payload = {
    embeds: [{
      title: row.title,
      description: row.description || undefined,
      color: 0xd9a521,
      fields: [
        { name: "Status", value: statusLine, inline: true },
        { name: "Game", value: gameLabel(row.game), inline: true },
        { name: "Participants", value: `${row.approved_count}/${meta.size ?? "—"}`, inline: true },
        { name: "Payout", value: payoutBlurb(row), inline: false },
        { name: "Schedule", value: scheduleLine, inline: false },
      ],
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: "Register", url: href }],
    }],
  };

  for (const guild of guilds.rows as Array<{ guild_id: string; announcements_channel_id: string }>) {
    await syncOnePost(row.id, guild.guild_id, guild.announcements_channel_id, payload);
  }
}

function bracketSizeFor(bracketType: string): number | null {
  const match = /(\d+)$/.exec(bracketType);
  return match ? Number(match[1]) : null;
}

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

    if (row && row.channel_id === channelId) {
      const edited = await editDiscordMessage(channelId, row.message_id, payload).catch(() => false);
      if (edited) { await client.query("commit"); return; }
    }
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
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error("[ERROR] tournament announcement: sync failed (non-fatal):", error);
  } finally {
    client.release();
  }
}
