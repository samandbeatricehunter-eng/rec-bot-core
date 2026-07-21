import { Link, useParams } from "react-router-dom";

function PlaceholderCard({
  title,
  body,
  links,
}: {
  title: string;
  body: string;
  links?: Array<{ to: string; label: string }>;
}) {
  return (
    <div className="site-page-card">
      <h1>{title}</h1>
      <p>{body}</p>
      {links?.length ? (
        <div className="site-league-demo-links">
          {links.map((link) => (
            <Link key={link.to} className="site-btn site-btn-ghost" to={link.to}>
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HomePage() {
  return (
    <PlaceholderCard
      title="Home"
      body="Main hub home. League feeds, shortcuts, and season highlights will land here."
    />
  );
}

export function LeaguesPage() {
  return (
    <PlaceholderCard
      title="Leagues"
      body="Search and manage the leagues you belong to. Join / request flows come next."
    />
  );
}

export function HeadlinesPage() {
  return (
    <PlaceholderCard
      title="Headlines"
      body="Global REC media and headlines (formerly Media). Stories and clips will appear here."
    />
  );
}

export function CompPage() {
  return (
    <PlaceholderCard
      title="Comp"
      body="Competition board placeholder — standings across events and ladders."
    />
  );
}

export function LeagueBuzzPage() {
  const { leagueId = "" } = useParams();
  return (
    <PlaceholderCard
      title="Campus Buzz"
      body="League social feed placeholder."
      links={[{ to: `/l/${leagueId}/matchups`, label: "Matchups" }]}
    />
  );
}

export function LeagueMatchupsPage() {
  return (
    <PlaceholderCard
      title="Matchups"
      body="This week's slate. Rankings and Open Teams will be tabs on this page in a later pass."
    />
  );
}

export function LeagueTeamPage() {
  return (
    <PlaceholderCard
      title="My Team"
      body="Your roster, depth chart, and team tools for this league."
    />
  );
}

export function LeagueStorePage() {
  return (
    <PlaceholderCard
      title="Store"
      body="League store placeholder — purchases and upgrades for this franchise."
    />
  );
}

export function LeagueMgmtPage() {
  const { leagueId = "" } = useParams();
  return (
    <PlaceholderCard
      title="League Mgmt"
      body="Commissioner tools live here. Retire, request demotion to member, and future primary-commissioner transfer will be managed from this page. The notification bell’s Commissioner section deep-links into this league’s review inbox — it does not replace the Office tools here."
      links={[
        { to: `/l/${leagueId}/mgmt/inbox`, label: "Commissioner inbox" },
      ]}
    />
  );
}

export function LeagueMgmtInboxPage() {
  return (
    <PlaceholderCard
      title="Commissioner inbox"
      body="League review queue (streams, box scores, purchases, etc.). Distinct from the top-right notification bell, which only summarizes and deep-links here. Full review UI ports from Commissioners Office next."
    />
  );
}
