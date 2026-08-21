import type { PoolClient } from "pg";
import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { isSyntheticDiscordId } from "./discord-identity-ids.js";

export { isSyntheticDiscordId };

function uniqueRemap(table: string, column: string, conflictKey: string) {
  return {
    clear: `delete from ${table} as old using ${table} as keep where old.${column} = $1 and keep.${column} = $2 and old.${conflictKey} = keep.${conflictKey}`,
    update: `update ${table} set ${column} = $2 where ${column} = $1`,
  };
}

async function remapLiveDiscordIds(client: PoolClient, fromId: string, toId: string) {
  const votes = uniqueRemap("rec_game_of_week_votes", "discord_id", "poll_id");
  await client.query(votes.clear, [fromId, toId]);
  await client.query(votes.update, [fromId, toId]);

  const pollVotes = uniqueRemap("rec_commissioner_poll_votes", "voter_discord_id", "poll_id");
  await client.query(pollVotes.clear, [fromId, toId]);
  await client.query(pollVotes.update, [fromId, toId]);

  const topicVotes = uniqueRemap("rec_commissioner_chat_topic_votes", "voter_discord_id", "topic_id");
  await client.query(topicVotes.clear, [fromId, toId]);
  await client.query(topicVotes.update, [fromId, toId]);

  await client.query(
    `delete from rec_chat_reactions as old
     using rec_chat_reactions as keep
     where old.discord_id = $1 and keep.discord_id = $2
       and old.channel_type = keep.channel_type
       and old.message_id = keep.message_id
       and old.emoji_key = keep.emoji_key`,
    [fromId, toId],
  );
  await client.query(`update rec_chat_reactions set discord_id = $2 where discord_id = $1`, [fromId, toId]);

  const checkins = uniqueRemap("rec_game_channel_checkins", "discord_user_id", "game_channel_id");
  await client.query(checkins.clear, [fromId, toId]);
  await client.query(checkins.update, [fromId, toId]);

  const streamReactions = uniqueRemap("rec_stream_reactions", "discord_id", "stream_log_id");
  await client.query(streamReactions.clear, [fromId, toId]);
  await client.query(streamReactions.update, [fromId, toId]);

  const streamViews = uniqueRemap("rec_stream_views", "discord_id", "stream_log_id");
  await client.query(streamViews.clear, [fromId, toId]);
  await client.query(streamViews.update, [fromId, toId]);

  await client.query(`update rec_hub_presence_heartbeats set discord_id = $2 where discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_fantasy_draft_checkins set discord_id = $2 where discord_id = $1`, [fromId, toId]);
  await client.query(`delete from user_gameday_preferences where discord_id = $1`, [toId]);
  await client.query(`update user_gameday_preferences set discord_id = $2 where discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_active_check_responses set discord_id = $2 where discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_active_check_misses set discord_id = $2 where discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_purchases set discord_id = $2 where discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_team_invite_requests set discord_id = $2 where discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_trade_block_listings set discord_id = $2 where discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_team_link_requests set requester_discord_id = $2 where requester_discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_commissioners_inbox set requester_discord_id = $2 where requester_discord_id = $1 and status = 'pending'`, [fromId, toId]);
  await client.query(`update rec_commissioners_inbox set target_discord_id = $2 where target_discord_id = $1 and status = 'pending'`, [fromId, toId]);
  await client.query(`update rec_wagers set placed_by_discord_id = $2 where placed_by_discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_wagers set accepted_by_discord_id = $2 where accepted_by_discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_league_chat_messages set author_discord_id = $2 where author_discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_game_chat_messages set author_discord_id = $2 where author_discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_commissioner_chat_messages set author_discord_id = $2 where author_discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_trade_votes set voter_discord_id = $2 where voter_discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_league_bans set target_discord_id = $2 where target_discord_id = $1`, [fromId, toId]);
  await client.query(`update rec_award_winners set winner_discord_id = $2 where winner_discord_id = $1`, [fromId, toId]);
  await client.query(`update gameday_matchup_panels set home_discord_id = $2 where home_discord_id = $1`, [fromId, toId]);
  await client.query(`update gameday_matchup_panels set away_discord_id = $2 where away_discord_id = $1`, [fromId, toId]);
  await client.query(
    `
      update rec_trade_committee_polls
      set eligible_voter_discord_ids = coalesce((
        select jsonb_agg(
          case
            when jsonb_typeof(elem) = 'string' and elem #>> '{}' = $1 then to_jsonb($2::text)
            else elem
          end
        )
        from jsonb_array_elements(coalesce(eligible_voter_discord_ids, '[]'::jsonb)) elem
      ), '[]'::jsonb)
      where eligible_voter_discord_ids @> to_jsonb($1::text)
         or eligible_voter_discord_ids @> jsonb_build_array($1::text)
    `,
    [fromId, toId],
  );
}

export async function transferDiscordIdentity(input: {
  userId: string;
  fromDiscordId: string;
  toDiscordId: string;
  username?: string | null;
  globalName?: string | null;
  reason: string;
}): Promise<{ fromDiscordId: string; toDiscordId: string }> {
  if (input.fromDiscordId === input.toDiscordId) {
    return { fromDiscordId: input.fromDiscordId, toDiscordId: input.toDiscordId };
  }
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    const occupied = await client.query(
      `select user_id from rec_discord_accounts where discord_id = $1 for update`,
      [input.toDiscordId],
    );
    const occupiedUserId = (occupied.rows[0] as { user_id?: string } | undefined)?.user_id;
    if (occupiedUserId && occupiedUserId !== input.userId) {
      throw new ApiError(409, "That Discord account is already linked to a different REC profile.");
    }

    const current = await client.query(
      `select id, discord_id from rec_discord_accounts where user_id = $1 for update`,
      [input.userId],
    );
    const rows = current.rows as Array<{ id: string; discord_id: string }>;
    const canonical = rows.find((row) => row.discord_id === input.fromDiscordId) ?? rows[0];
    if (!canonical) {
      await client.query(
        `insert into rec_discord_accounts (user_id, discord_id, username, global_name)
         values ($1, $2, $3, $4)`,
        [input.userId, input.toDiscordId, input.username ?? null, input.globalName ?? null],
      );
    } else {
      for (const extra of rows.filter((row) => row.id !== canonical.id)) {
        await client.query(`delete from rec_discord_accounts where id = $1`, [extra.id]);
      }
      if (occupiedUserId === input.userId && canonical.discord_id !== input.toDiscordId) {
        await client.query(`delete from rec_discord_accounts where discord_id = $1 and id <> $2`, [input.toDiscordId, canonical.id]);
      }
      await client.query(
        `update rec_discord_accounts
         set discord_id = $2, username = coalesce($3, username), global_name = coalesce($4, global_name), updated_at = now()
         where id = $1`,
        [canonical.id, input.toDiscordId, input.username ?? null, input.globalName ?? null],
      );
    }

    await remapLiveDiscordIds(client, input.fromDiscordId, input.toDiscordId);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  await writeAuditLog({
    action: "user.discord.relinked",
    entityType: "rec_users",
    entityId: input.userId,
    previousValue: { discordId: input.fromDiscordId },
    newValue: { discordId: input.toDiscordId },
    reason: input.reason,
    source: "manual_admin_entry",
  }).catch((error) => console.error("[WARN] Failed to audit Discord relink (non-fatal):", error));

  return { fromDiscordId: input.fromDiscordId, toDiscordId: input.toDiscordId };
}
