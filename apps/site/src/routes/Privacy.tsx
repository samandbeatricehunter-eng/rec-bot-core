import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { SiteFooter } from "../components/SiteFooter.js";

export function Privacy() {
  const auth = useAuth();
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

      <main className="site-legal-page">
        <h1>Privacy Policy</h1>
        <p className="site-muted">Last updated: July 28, 2026</p>
        <p className="site-legal-notice">
          This policy is provided as a plain-language summary of how REC Leagues eSports handles
          your data. It has not been reviewed by an attorney and should not be treated as a
          substitute for legal advice specific to your jurisdiction.
        </p>

        <h2>1. Information We Collect</h2>
        <p>We collect the minimum information needed to run leagues and your account:</p>
        <ul>
          <li><strong>Account information:</strong> your email address and password (if you sign up directly), handled by our authentication provider (Supabase Auth). We never see or store your raw password.</li>
          <li><strong>Discord information:</strong> if you link or sign in with Discord, we receive your Discord user ID, username, display name/nickname, avatar, and the servers (guilds) and roles relevant to leagues you participate in.</li>
          <li><strong>League and gameplay data:</strong> team assignments, box scores and stats you or your commissioner submit, wager activity, store purchases, chat messages within a league, and highlight clips or screenshots you upload.</li>
          <li><strong>Payment information:</strong> subscription payments are processed entirely by Stripe. We store only your subscription status, plan tier, and a Stripe customer/subscription reference — we never receive or store your full card number.</li>
          <li><strong>Technical information:</strong> basic device/browser information and session tokens necessary to keep you signed in and the app secure.</li>
        </ul>

        <h2>2. How We Use Information</h2>
        <ul>
          <li>To operate league features: matchups, stats, records, badges, the coin economy, wagers, and Game of the Week/Year voting.</li>
          <li>To authenticate you and keep your account secure.</li>
          <li>To process subscription payments and manage billing status.</li>
          <li>To send you notifications you've opted into (in-app, push, and — for Platinum leagues with the Discord bot enabled — Discord messages).</li>
          <li>To maintain and improve the service, including diagnosing bugs and abuse.</li>
        </ul>

        <h2>3. How We Share Information</h2>
        <p>We do not sell your personal information. We share data only with the service providers necessary to run REC Leagues eSports:</p>
        <ul>
          <li><strong>Supabase</strong> — authentication and database hosting.</li>
          <li><strong>Stripe</strong> — subscription billing and payment processing.</li>
          <li><strong>Discord</strong> — OAuth sign-in, server/bot integration, and notifications for leagues that enable it.</li>
          <li><strong>Cloudflare</strong> — video hosting/streaming for highlight clips.</li>
        </ul>
        <p>Within a league, your username/display name, team, stats, and public activity (highlights, chat, wagers) are visible to other members of that league by design.</p>

        <h2>4. Data Retention</h2>
        <p>
          We retain league and gameplay data for as long as your account or league remains active,
          plus a reasonable period afterward for historical stats and dispute resolution. You can
          request deletion of your account at any time (see Section 6).
        </p>

        <h2>5. Children's Privacy</h2>
        <p>
          REC Leagues eSports is not directed at children and is not intended for use by anyone
          under the minimum age required by Discord's own Terms of Service (currently 13) or the
          minimum age of digital consent in your jurisdiction, whichever is higher. We do not
          knowingly collect information from children under that age.
        </p>

        <h2>6. Your Rights &amp; Account Deletion</h2>
        <p>
          You can review and update your account details from the Account page at any time. To
          request deletion of your account and associated personal data, contact us using the
          details in Section 9 — we'll confirm what, if anything, must be retained (e.g. league
          stat history other members rely on) before deleting the rest.
        </p>

        <h2>7. Security</h2>
        <p>
          We rely on our infrastructure providers' security practices (Supabase, Stripe, Cloudflare,
          Discord) and use encrypted connections (HTTPS) throughout. No method of transmission or
          storage is 100% secure, and we can't guarantee absolute security.
        </p>

        <h2>8. Changes to This Policy</h2>
        <p>
          We may update this policy as the product changes. Material changes will be reflected by
          updating the "Last updated" date above.
        </p>

        <h2>9. Contact</h2>
        <p>Questions about this policy or a data request can be sent to the league commissioner or through the <Link to="/help">Help / FAQ</Link> page.</p>
      </main>

      <SiteFooter />
    </div>
  );
}
