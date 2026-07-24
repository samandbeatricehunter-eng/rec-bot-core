import { getPgPool } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { sendDiscordDirectMessage } from "../../lib/discord-guild.js";
import { FREE_LIFETIME_CLAIM_DEADLINE_ISO } from "./entitlements.service.js";

const SITE_URL = process.env.REC_SITE_URL ?? "https://rec-leagues.com";

/**
 * DM every CFB-league team-linked user who has not registered a site account yet.
 */
export async function notifyUnclaimedCfbFreeAccounts(): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  deadline: string;
}> {
  const result = await getPgPool().query(
    `
      select distinct
        da.discord_id,
        coalesce(nullif(da.global_name, ''), nullif(da.username, ''), 'Coach') as name
      from rec_leagues l
      join rec_team_assignments ta
        on ta.league_id = l.id
       and ta.assignment_status = 'active'
       and ta.ended_at is null
       and ta.user_id is not null
      join rec_users u on u.id = ta.user_id
      join rec_discord_accounts da on da.user_id = u.id
      where l.game = 'cfb_27'
        and coalesce(l.subscription_frozen, false) = false
        and u.supabase_auth_user_id is null
        and da.discord_id is not null
    `,
  );

  const rows = result.rows as Array<{ discord_id: string; name: string }>;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const content = [
    "**REC Leagues — Free account claim reminder**",
    "",
    "You're linked to a CFB league team but haven't registered your free REC Leagues website account yet.",
    "",
    `You have until **July 31, 2026 at 12:00 noon (America/Chicago)** to claim your free account at ${SITE_URL}/account.`,
    "",
    "After that deadline, free lifetime Platinum will no longer be available — you'll need to register and subscribe to keep hub access.",
    "",
    "Claim now so you don't lose the offer.",
  ].join("\n");

  for (const row of rows) {
    try {
      await sendDiscordDirectMessage(row.discord_id, content);
      sent += 1;
    } catch (error) {
      console.error("[free-claim-notice] DM failed", row.discord_id, error);
      failed += 1;
    }
  }

  if (!rows.length) skipped = 1;

  return { sent, failed, skipped, deadline: FREE_LIFETIME_CLAIM_DEADLINE_ISO };
}
