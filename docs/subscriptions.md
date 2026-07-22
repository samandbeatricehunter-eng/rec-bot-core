# Subscriptions

Locked product decisions for REC Bot subscription entitlements.

## Locked product answers

| Topic | Decision |
| --- | --- |
| Member access | Each member needs their **own** Gold or Platinum subscription |
| Co-commissioner | Co-comms require **Gold+** |
| Cancel grace | **14 days** grace on cancel |
| Transfer | Transfer only to **Platinum** |
| Frozen takeover | After grace expires and owned leagues freeze, any **active member** with **Platinum** (including lifetime grandfather) and an **open create slot** for that game can claim ownership. **First claim wins** and unfreezes the league. Previous head commissioner is demoted to co-commissioner when a membership row exists. |
| New create/join caps | Caps apply **immediately** on create/join |
| Claim dropdown | **Auto + manual** (auto-close when empty; manual kill switch) |
| Billing cadence | **Monthly or annual** |
| Payments | **Stripe** |

## Surfaces

| Surface | Role |
| --- | --- |
| `apps/site` | Desktop + mobile **PWA** (primary subscribe / manage experience) |
| `apps/web` | **CTA only** (point users to site for billing) |
| Discord | **Discord-only insignia** (status badge; not a full billing UI) |

## Tiers

| Tier | Entitlement summary |
| --- | --- |
| **Platinum** | Full paid tier (create/join caps, transfer target, co-commish Gold+, Discord bot where enabled) |
| **Gold** | Paid member / co-commish floor (Gold+) |
| **Discord-only** | Insignia for Discord-linked presence without a paid Stripe plan (see grandfather) |

## Grandfather

Users with a linked Discord account (`rec_discord_accounts`) are grandfathered to **lifetime_comp Platinum** (`subscription_tier = platinum`, `billing_status = lifetime_comp`).

While the Discord identity claim dropdown still has claimable users, registration can complete via the existing claim path and grant that lifetime Platinum.

When the dropdown is empty or deliberately closed, new registration requires an active paid subscription (Gold or Platinum) before full account completion / site access.

After close-out: Discord-only users can still exist in bot leagues; to get site/app they must subscribe then link Discord. Stats backfill only counts results on/after `stats_credit_starts_at` for that team assignment.

## Limits (per game title)

| Tier | Create (own) | Join (member) |
| --- | --- | --- |
| Platinum | 5 active leagues / game | 20 active leagues / game |
| Gold | 0 | 5 active leagues / game |
| Discord-only | N/A | Discord team link only |

## Discord bot

Platinum league owners may enable the Discord bot and receive an invite token. Admins claim it in Discord with `/claim-league`. Discord-only members get the **REC Discord Only** role and a `§ DC` nickname marker.

## API / Stripe env

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_GOLD`, `STRIPE_PRICE_PLATINUM`, `STRIPE_PRICE_GOLD_ANNUAL`, `STRIPE_PRICE_PLATINUM_ANNUAL`
- `SITE_PUBLIC_URL` (default `https://rec-leagues.com`)
- Webhook: `POST /v1/subscriptions/stripe-webhook`
- Event destination scope in Stripe Dashboard: **Your account** (not Connected accounts — REC does not use Stripe Connect for these subscriptions)
- Claimable frozen leagues: `GET /v1/subscriptions/claimable-leagues`
- Claim ownership: `POST /v1/subscriptions/leagues/:leagueId/claim-ownership`
