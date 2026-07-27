import webpush from "web-push";
import { getPgPool } from "../../db/client.js";
import { env } from "../../config/env.js";

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}

let vapidConfigured = false;
function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  vapidConfigured = true;
  return true;
}

export type PushPayload = { title: string; body?: string | null; url?: string | null };

/** Fire-and-forget by design — a push failure must never break the caller's primary write. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureVapid()) return;
  const result = await getPgPool().query(
    `select id, endpoint, p256dh, auth from rec_push_subscriptions where user_id = $1`,
    [userId],
  );
  const rows = result.rows as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
  if (!rows.length) return;

  const body = JSON.stringify({ title: payload.title, body: payload.body ?? "", url: payload.url ?? "/" });
  const staleIds: string[] = [];
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number } | null)?.statusCode;
        if (statusCode === 404 || statusCode === 410) staleIds.push(row.id);
      }
    }),
  );
  if (staleIds.length) {
    await getPgPool().query(`delete from rec_push_subscriptions where id = any($1::uuid[])`, [staleIds]);
  }
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  const unique = [...new Set(userIds)];
  await Promise.all(unique.map((userId) => sendPushToUser(userId, payload)));
}

export async function saveSubscription(input: {
  recUserId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}) {
  await getPgPool().query(
    `
      insert into rec_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      values ($1, $2, $3, $4, $5)
      on conflict (endpoint) do update
        set user_id = excluded.user_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            user_agent = excluded.user_agent
    `,
    [input.recUserId, input.endpoint, input.p256dh, input.auth, input.userAgent ?? null],
  );
  return { ok: true as const };
}

export async function removeSubscription(input: { recUserId: string; endpoint: string }) {
  await getPgPool().query(
    `delete from rec_push_subscriptions where endpoint = $1 and user_id = $2`,
    [input.endpoint, input.recUserId],
  );
  return { ok: true as const };
}
