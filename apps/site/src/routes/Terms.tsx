import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { SiteFooter } from "../components/SiteFooter.js";

export function Terms() {
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
        <h1>Terms of Service</h1>
        <p className="site-muted">Last updated: July 28, 2026</p>
        <p className="site-legal-notice">
          This is a plain-language set of terms provided as a starting point and has not been
          reviewed by an attorney. It is not a substitute for legal advice.
        </p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By creating an account or otherwise using REC Leagues eSports (the "Service"), you agree
          to these Terms of Service. If you don't agree, don't use the Service.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          REC Leagues eSports is a league management platform for community sports-video-game
          leagues (currently EA Sports College Football and Madden NFL leagues), available as a
          website/installable web app and, for leagues that enable the optional Discord bot
          add-on, through Discord. Leagues can run entirely standalone or integrated with Discord.
        </p>

        <h2>3. Eligibility</h2>
        <p>
          You must meet the minimum age required by Discord's Terms of Service (currently 13) and
          by the law of your jurisdiction to use the Service, and you must have the legal capacity
          to enter into these Terms.
        </p>

        <h2>4. Accounts</h2>
        <p>
          You're responsible for the security of your account and everything that happens under
          it. You can create an account with an email/password or by linking Discord. Provide
          accurate information and keep your credentials confidential.
        </p>

        <h2>5. Subscriptions &amp; Billing</h2>
        <ul>
          <li>Gold and Platinum are paid subscription tiers, billed monthly or annually through Stripe.</li>
          <li>Subscriptions renew automatically until canceled. You can cancel any time from the billing portal on your Account page; you'll keep access through the end of the current billing period.</li>
          <li>The Platinum-only Discord bot is an add-on capability of the Platinum tier, not a separately billed product.</li>
          <li>Fees are non-refundable except where required by law. If you believe you were charged in error, contact us — see Section 13.</li>
          <li>We reserve the right to change pricing going forward; existing subscribers will be notified before a price change takes effect on their next renewal.</li>
        </ul>

        <h2>6. Virtual Currency &amp; Wagers</h2>
        <p>
          Coins, wagers, and the league store are entertainment features with no real-world monetary
          value. Coins cannot be purchased with real money, cashed out, transferred outside the
          Service, or redeemed for anything of value. Wagers between league members settle in coins
          only and are not real-money gambling.
        </p>

        <h2>7. User Content</h2>
        <p>
          You retain ownership of the highlight clips, screenshots, chat messages, and other content
          you submit ("User Content"). By submitting User Content, you grant REC Leagues eSports a
          non-exclusive, worldwide, royalty-free license to host, store, display, and distribute it
          within the Service (including league hubs, spotlight/highlight reels, and — where you or
          your commissioner enable it — Discord) for the purpose of operating the Service. You're
          responsible for making sure your User Content doesn't infringe anyone else's rights.
        </p>

        <h2>8. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Upload content you don't have the right to share, or that is unlawful, harassing, or infringing.</li>
          <li>Attempt to manipulate stats, payouts, wagers, or badges through exploits or falsified data.</li>
          <li>Interfere with the Service's operation or attempt unauthorized access to other accounts or leagues.</li>
          <li>Use the Service for real-money gambling or to circumvent the virtual-currency restrictions in Section 6.</li>
        </ul>

        <h2>9. Third-Party Services &amp; Trademarks</h2>
        <p>
          The Service references team, player, and game names from EA Sports titles for descriptive
          and statistical purposes only. REC Leagues eSports is not affiliated with, endorsed by, or
          sponsored by Electronic Arts Inc., the NFL, NFL Players Association, the NCAA, or Discord
          Inc. Your use of Discord is separately governed by Discord's own Terms of Service.
        </p>

        <h2>10. Commissioners &amp; League Management</h2>
        <p>
          League owners and commissioners are responsible for managing their own league's rosters,
          schedules, payouts, and moderation. REC Leagues eSports provides the tools but is not a
          party to and does not arbitrate disputes between league members, commissioners, or
          co-commissioners.
        </p>

        <h2>11. Termination</h2>
        <p>
          You may stop using the Service and cancel your subscription at any time. We may suspend or
          terminate accounts that violate these Terms, engage in abuse, or where required by law.
        </p>

        <h2>12. Disclaimers &amp; Limitation of Liability</h2>
        <p>
          The Service is provided "as is" without warranties of any kind. To the maximum extent
          permitted by law, REC Leagues eSports is not liable for indirect, incidental, or
          consequential damages arising from your use of the Service, including loss of league data,
          stats, or virtual currency.
        </p>

        <h2>13. Changes &amp; Contact</h2>
        <p>
          We may update these Terms as the product evolves; material changes will update the "Last
          updated" date above. Questions can be sent through the <Link to="/help">Help / FAQ</Link>{" "}
          page or your league commissioner.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
