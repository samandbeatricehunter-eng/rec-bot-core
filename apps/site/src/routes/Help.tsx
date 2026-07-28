import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { SiteFooter } from "../components/SiteFooter.js";

type Faq = { q: string; a: string };
type FaqSection = { title: string; items: Faq[] };

const SECTIONS: FaqSection[] = [
  {
    title: "General",
    items: [
      {
        q: "What is REC Leagues eSports?",
        a: "A companion platform for community EA Sports College Football and Madden NFL leagues — manage rosters, schedules, stats, stories, and league content from the web app, an installable PWA, or Discord.",
      },
      {
        q: "What games are supported?",
        a: "CFB 27, Madden 26, and Madden 27.",
      },
      {
        q: "Do I need Discord to use REC Leagues eSports?",
        a: "No. Leagues can run entirely standalone on the site/app. Linking a Discord server — including the REC Scout bot — is optional and available as a Platinum add-on.",
      },
      {
        q: "What's the difference between the site, the PWA, and Discord?",
        a: "The site is the full browser experience. It can be installed as a PWA for an app-like experience on your phone or desktop. For leagues that link a Discord server, chat, game channels, and (on Platinum with the bot enabled) auto-posted headlines, announcements, and power rankings also surface there.",
      },
    ],
  },
  {
    title: "Plans & Billing",
    items: [
      {
        q: "What's the difference between Gold and Platinum?",
        a: "Gold lets you join up to 5 leagues per game with full site access, stats, inbox, and friends. Platinum includes everything in Gold, plus the ability to create/own up to 5 leagues per game, join up to 20 per game, and enable the Discord bot add-on.",
      },
      {
        q: "How does monthly vs. annual billing work?",
        a: "Toggle between monthly and annual pricing on the Plans page — paying annually saves about 17% compared to paying monthly.",
      },
      {
        q: "How do I cancel or change my plan?",
        a: "Go to Account and choose Manage Billing, which opens Stripe's secure billing portal where you can change plans, update payment methods, or cancel.",
      },
      {
        q: "What happens if a payment fails?",
        a: "You get a short grace period before losing access. Renew from the billing portal to keep everything active — leagues you own are only frozen if the grace period fully expires.",
      },
      {
        q: "What is the Discord bot add-on?",
        a: "An optional capability of the Platinum tier (not a separate charge). Once enabled and invited to your server, it posts generated headlines, announcements, and weekly power rankings to channels you assign, and supports slash-command league management.",
      },
    ],
  },
  {
    title: "Getting Started",
    items: [
      {
        q: "How do I create an account?",
        a: "Subscribe to a plan from the Welcome page — payment happens first, then you'll set a password to finish creating your account (or sign in instantly with Discord). You can also sign up directly and subscribe afterward.",
      },
      {
        q: "How do I link my Discord account?",
        a: "From the Account page, or automatically if you sign up or log in using Continue with Discord.",
      },
      {
        q: "How do I join a league?",
        a: "Go to Leagues and search or browse public leagues, or use a league's invite link/password if it's private.",
      },
      {
        q: "How do I create my own league?",
        a: "Creating a league requires a Platinum subscription. From Leagues, choose Create League and select your game.",
      },
    ],
  },
  {
    title: "For Members",
    items: [
      {
        q: "How do I submit a box score?",
        a: "Upload the required screenshots from your matchup in Matchups. Your commissioner reviews and approves the submission, which imports the score/stats and issues any payout.",
      },
      {
        q: "How does the coin economy work?",
        a: "Coins are a virtual in-league currency earned from stat payouts, wagers, and approved highlights. Spend them in the League Store on Dev Trait upgrades, attribute points, contract adjustments, Campus Legends/Custom Recruits, and more.",
      },
      {
        q: "How do wagers work?",
        a: "Challenge another member to a coin wager on an upcoming matchup (moneyline, spread, or total). Wagers settle automatically once that game's result is logged, with a grace period before an unresolved wager is refunded.",
      },
      {
        q: "What are Game of the Week, Game of the Year, and Play of the Year?",
        a: "Game of the Week is an automatically-nominated weekly spotlight matchup. Game of the Year and Play of the Year are member-voted end-of-season awards drawn from the season's nominated games and highlight clips.",
      },
      {
        q: "How do badges and stats work?",
        a: "Season and career badges are awarded automatically from your stat line each game. Season badges reset every year; career badges accumulate for good. Your win-loss record and point differential update automatically from approved box scores, manual entries, and week advances.",
      },
      {
        q: "What are Legends and Custom Recruits/Players?",
        a: "Premium store items that add a player to your roster. A Legend (Campus Legend in CFB) instantly replaces a roster spot with a top-tier historical or custom player. CFB's Custom Recruit joins at the next season as a replacement for a committed recruit; Madden's Custom Player joins through the normal annual draft instead.",
      },
    ],
  },
  {
    title: "For Commissioners",
    items: [
      {
        q: "How do I advance the week?",
        a: "From League Management > Advance, enter or import each game's result and advance. This updates records, badges, and power rankings, and — if the Discord bot is enabled — posts the summary, headlines, and power rankings to your configured channels.",
      },
      {
        q: "How do I review pending items?",
        a: "The Commissioner Inbox lists everything awaiting your approval: box scores, highlights, store purchases (including Legends/Custom Recruits), and payouts.",
      },
      {
        q: "How do I set up Discord channels?",
        a: "League Management > Server Settings lets you assign channels for announcements, headlines, highlights, streams, weekly submissions, and more (requires Platinum with the bot enabled).",
      },
      {
        q: "How do I manage end-of-season payouts and awards?",
        a: "These auto-prepare once the season reaches its postseason boundary. Review, adjust, and approve them from the Pending Payouts inbox.",
      },
      {
        q: "What can co-commissioners do?",
        a: "Co-commissioners can advance the league and manage most day-to-day operations, including submission review. Only the head commissioner can transfer ownership or delete the league.",
      },
      {
        q: "How do I add/remove members and assign teams?",
        a: "From League Management you can manage team assignments and roles, and retire or replace members as needed.",
      },
    ],
  },
  {
    title: "Troubleshooting",
    items: [
      {
        q: "My stats, record, or point differential look wrong.",
        a: "Results only count once a box score or manual entry is actually approved/logged — double-check the game has a result recorded. If it still looks wrong after a fresh reload, reach out to your commissioner.",
      },
      {
        q: "The Discord bot isn't posting or responding.",
        a: "Confirm the league is Platinum, the bot is enabled and has been invited to your server, and the relevant channel is assigned under Server Settings.",
      },
      {
        q: "I can't see my league.",
        a: "Confirm your team assignment or membership is active, and that you're within your plan's league-join limit for that game.",
      },
      {
        q: "Where do I report a bug or ask something not covered here?",
        a: "Reach out to your league commissioner, who can escalate it. You can also check the Privacy Policy or Terms of Service pages for policy-specific questions.",
      },
    ],
  },
];

export function Help() {
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

      <main className="site-legal-page site-help-page">
        <h1>Help &amp; FAQ</h1>
        <p className="site-muted">
          Answers for members and commissioners. Can't find what you need? Reach out to your league
          commissioner.
        </p>

        {SECTIONS.map((section) => (
          <section key={section.title} className="site-help-section">
            <h2>{section.title}</h2>
            {section.items.map((item) => (
              <details key={item.q} className="site-help-item">
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </section>
        ))}
      </main>

      <SiteFooter />
    </div>
  );
}
