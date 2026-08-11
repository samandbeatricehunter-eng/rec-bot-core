import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi } from "../lib/site-api.js";
import { annualSavingsPercent, PLANS, priceLabel, type BillingInterval, type PlanTier } from "../lib/plans.js";
import { SiteFooter } from "../components/SiteFooter.js";

const PILLARS = [
  {
    title: "Site, PWA, or Discord — your call",
    body:
      "Run your league entirely from the web app (installable as a PWA on phone or desktop), or link it to your Discord server and manage everything from there too. Nothing is locked to one surface — commissioners and members move between the site and Discord freely.",
  },
  {
    title: "Standalone or Discord-integrated leagues",
    body:
      "A league can operate without ever connecting a Discord server, running entirely on the site/app — or link it to your server for game-day channels, chat forwarding, and (on Platinum) the REC Scout bot posting headlines, announcements, and power rankings straight into your channels.",
  },
  {
    title: "A real coin economy and media system",
    body:
      "Every league runs on a coin economy — wagers between members, stat payouts, and a store for Dev Trait upgrades, attribute points, contracts, Campus Legends/Custom Recruits and more. Layer in auto-generated headlines, weekly power rankings, Game of the Week and Game of the Year voting, and highlight reels to make every season feel like a real broadcast.",
  },
];

const GAMES = ["CFB 27", "Madden 26", "Madden 27"];

function PreviewMock({ kind }: { kind: "matchups" | "store" | "badges" }) {
  if (kind === "matchups") {
    return (
      <div className="site-preview-card" aria-hidden="true">
        <div className="site-preview-card-title">Matchups · Week 9</div>
        <div className="site-preview-row"><span>Iron State</span><strong>28</strong><span className="site-preview-vs">at</span><strong>24</strong><span>Coastal U</span></div>
        <div className="site-preview-row"><span>Granite Tech</span><strong>17</strong><span className="site-preview-vs">at</span><strong>31</strong><span>Redline A&amp;M</span></div>
        <div className="site-preview-row site-preview-row-muted"><span>Harbor College</span><strong>—</strong><span className="site-preview-vs">at</span><strong>—</strong><span>Summit State</span></div>
      </div>
    );
  }
  if (kind === "store") {
    return (
      <div className="site-preview-card" aria-hidden="true">
        <div className="site-preview-card-title">League Store</div>
        <div className="site-preview-store-row"><span>Dev Trait Upgrade</span><span className="site-preview-price">1,200</span></div>
        <div className="site-preview-store-row"><span>Campus Legend</span><span className="site-preview-price">3,000</span></div>
        <div className="site-preview-store-row"><span>Attribute Points ×3</span><span className="site-preview-price">900</span></div>
      </div>
    );
  }
  return (
    <div className="site-preview-card" aria-hidden="true">
      <div className="site-preview-card-title">Season Badges</div>
      <div className="site-preview-badge-row">
        <span className="site-preview-badge">Winning Season</span>
        <span className="site-preview-badge">Ball Control</span>
        <span className="site-preview-badge">Ball Hawk 18+</span>
      </div>
      <div className="site-preview-badge-row">
        <span className="site-preview-badge">Iron Man</span>
        <span className="site-preview-badge">Comeback Kid</span>
      </div>
    </div>
  );
}

// Public marketing home — the root of the site for signed-out visitors.
export function Landing() {
  const auth = useAuth();
  const [interval, setIntervalValue] = useState<BillingInterval>("month");
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Pays first: Stripe collects the email and card on its own hosted page before anything
  // is created on our side. Only a successful payment lands the user on /signup/complete to
  // set a password — a declined card never leaves behind an account.
  async function startCheckout(tier: PlanTier) {
    setCheckoutError(null);
    setBusyTier(tier);
    try {
      const { url } = await siteApi.createPublicCheckout(tier, interval);
      window.location.assign(url);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Checkout failed.");
      setBusyTier(null);
    }
  }

  return (
    <div className="site-page site-landing">
      <header className="site-nav site-landing-nav">
        <Link to="/" className="site-landing-brand">
          <img src="/icons/icon-192.png" alt="" width={36} height={36} className="site-landing-logo" />
          <span className="site-wordmark">REC Leagues eSports</span>
        </Link>
        <nav>
          {auth.status === "signed-in"
            ? <Link className="site-btn site-btn-primary" to="/home">Go to Home</Link>
            : <>
                <Link className="site-btn site-btn-ghost" to="/login">Log In</Link>
                <Link className="site-btn site-btn-primary" to="/signup">Sign Up</Link>
              </>}
        </nav>
      </header>

      <main className="site-hero">
        <h1>Manage your leagues and find new ones for CFB and Madden. All in one place, right at your fingertips.</h1>
        <p>
          Keep your matchups organized, bring your leagues to life with auto and custom headlines and interviews,
          Game of the Week, Game of the Year and Play of the Year voting. For Platinum members, a Discord bot
          (The REC Scout) is available if you prefer to manage your leagues through Discord. Track all-time stats
          across leagues and games, see where you rank amongst your comp and the world. Find H2H opponents that are
          also REC League members to track your stats and build your rep. This is your world — your league — at the
          tip of your fingers. Time to lock in.
        </p>
        {auth.status !== "signed-in" && (
          <>
            <p className="site-trial-badge">Start with a 7-day free trial — no charge until it ends, cancel anytime.</p>
            <p className="site-muted site-trial-note">
              During the trial: Gold can join 1 league per game; Platinum can join 1 and create 1
              league per game. Full limits (join up to 5/20, create up to 5) unlock once the
              trial ends or you subscribe.
            </p>
            <div className="site-profile-actions">
              <Link className="site-btn site-btn-primary site-btn-lg" to="/signup">Create your account</Link>
              <a className="site-btn site-btn-ghost site-btn-lg" href="#plans">View plans</a>
            </div>
          </>
        )}
      </main>

      <section className="site-landing-section site-landing-pillars">
        <div className="site-landing-games">
          {GAMES.map((game) => <span key={game} className="site-landing-game-chip">{game}</span>)}
        </div>
        <div className="site-landing-pillar-grid">
          {PILLARS.map((pillar) => (
            <article key={pillar.title} className="site-page-card site-landing-pillar">
              <h2>{pillar.title}</h2>
              <p>{pillar.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-landing-section">
        <h2 className="site-landing-section-title">A look inside a league</h2>
        <p className="site-muted site-landing-preview-note">
          Illustrative previews of the in-league hub — matchups, the store, and season badges.
        </p>
        <div className="site-landing-preview-grid">
          <PreviewMock kind="matchups" />
          <PreviewMock kind="store" />
          <PreviewMock kind="badges" />
        </div>
      </section>

      <section id="plans" className="site-landing-section site-landing-plans">
        <h2 className="site-landing-section-title">Plans</h2>
        <div className="site-billing-interval" role="tablist" aria-label="Billing interval">
          <button type="button" role="tab" aria-selected={interval === "month"} className={interval === "month" ? "is-active" : ""} onClick={() => setIntervalValue("month")}>Monthly</button>
          <button type="button" role="tab" aria-selected={interval === "year"} className={interval === "year" ? "is-active" : ""} onClick={() => setIntervalValue("year")}>Annual</button>
        </div>
        <p className="site-trial-badge site-landing-plans-trial">Every new subscription starts with a 7-day free trial.</p>
        <p className="site-muted site-trial-note">
          Trial accounts are capped at 1 league joined per game (Platinum: also 1 created per
          game) until the trial ends or converts to a full subscription.
        </p>
        {checkoutError && <p className="site-auth-error">{checkoutError}</p>}
        <div className="site-pricing-grid">
          {PLANS.map((plan) => (
            <article key={plan.tier} className="site-page-card site-plan-card">
              <h2>{plan.name}</h2>
              <p className="site-plan-price">{priceLabel(plan, interval)}</p>
              {interval === "year" && <p className="site-plan-savings">Save {annualSavingsPercent(plan)}% vs. monthly</p>}
              <p className="site-muted">{plan.blurb}</p>
              <ul className="site-plan-features">
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <button
                type="button"
                className="site-btn site-btn-primary site-btn-lg"
                disabled={busyTier != null}
                onClick={() => void startCheckout(plan.tier)}
              >
                {busyTier === plan.tier ? "Redirecting…" : `Subscribe to ${plan.name}`}
              </button>
            </article>
          ))}
        </div>
        <p className="site-muted site-landing-plans-footnote">
          Already have a REC League account? <Link to="/pricing">Manage your plan</Link>.
          Active REC OG (CFB 27) members get lifetime Platinum when they sign in with Discord.
        </p>
      </section>

      <SiteFooter />
    </div>
  );
}
