import type { ReactNode } from "react";

export function LeagueChassis({ children }: { children: ReactNode }) {
  return (
    <div className="site-hub-embed site-hub-inprocess">
      <div className="site-hub-inprocess-content">
        <div className="site-league-chassis">
          <div className="site-league-chassis-body">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function LeagueTopRail({ children }: { children: ReactNode }) {
  return (
    <div className="site-league-top-rail">
      {children}
    </div>
  );
}

export function LeagueChassisLoading() {
  const cells = Array.from({ length: 8 }, (_, index) => index);
  return (
    <LeagueChassis>
      <div className="hub-page site-league-chassis-loading" role="status" aria-live="polite">
        <LeagueTopRail>
          <div className="hub-season-snapshot-box site-league-rail-skeleton" aria-label="Loading league navigation">
            <div className="hub-season-snapshot-grid">
              {cells.slice(0, 4).map((cell) => (
                <article key={cell} aria-hidden="true">
                  <span />
                  <strong />
                </article>
              ))}
            </div>
            <div className="hub-season-snapshot-grid hub-season-snapshot-secondary">
              {cells.slice(4).map((cell) => (
                <article key={cell} aria-hidden="true">
                  <span />
                  <strong />
                </article>
              ))}
            </div>
          </div>
        </LeagueTopRail>
        <section className="hub-section site-league-body-skeleton" aria-label="Loading league body">
          <div />
          <div />
          <div />
        </section>
      </div>
    </LeagueChassis>
  );
}
