# Subscriptions

Locked product decisions for REC Bot subscription entitlements.

## Locked product answers

| Topic | Decision |
| --- | --- |
| Member access | Each member needs their **own** Gold or Platinum subscription |
| Co-commissioner | Co-commish requires **Gold+** |
| Cancel grace | **14 days** grace on cancel |
| Transfer | Transfer only to **Platinum** |
| New create/join caps | Caps apply **immediately** on create/join |
| Claim dropdown | **Auto + manual** (auto-close when empty; manual kill switch) |
| Billing cadence | **Monthly only** |
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
| **Discord-only** | Insignia / Discord-linked presence without a paid Stripe plan (see grandfather) |

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

Platinum league owners may enable the Discord bot and receive an invite token. Admins claim it in Discord with `/claim-league`. Discord-only members get the **REC Discord Only** role and a ` · DC` nickname marker.

## API / Stripe env

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_GOLD`, `STRIPE_PRICE_PLATINUM`
- `SITE_PUBLIC_URL` (default `https://rec-leagues.com`)
- Webhook: `POST /v1/subscriptions/stripe-webhook`