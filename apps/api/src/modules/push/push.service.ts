import { getPgPool } from "../../db/client.js";
import { env } from "../../config/env.js";

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
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
