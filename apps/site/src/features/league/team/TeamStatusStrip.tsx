import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useReadyAuth } from "@rec/hub-ui";
import { recApi } from "../../../../../web/src/lib/rec-api-client.js";
import type { HubResponse } from "../../../../../web/src/types/api.js";
import type { TeamNavId } from "./TeamMiniNav.js";

type NavItem = {
  id: TeamNavId;
  top: string;
  bottom: string;
  to: string;
  disabled?: boolean;
  disabledTitle?: string;
};

function teamNavItems({
  leagueId,
  isRise,
  tradesUnlocked,
  storeUnlocked,
  progressionAvailable,
}: {
  leagueId: string;
  isRise: boolean;
  tradesUnlocked: boolean;
  storeUnlocked: boolean;
  progressionAvailable: boolean;
}): NavItem[] {
  const base = `/l/${leagueId}`;
  return [
    { id: "team", top: "My", bottom: "Team", to: `${base}/team` },
    { id: "roster", top: "View", bottom: "Rosters", to: `${base}/roster` },
    progressionAvailable
      ? {
          id: "progression" as const,
          top: isRise ? "Build Your" : "Team",
          bottom: isRise ? "Legacy" : "Progression",
          to: `${base}/team/progression`,
        }
      : null,
    {
      id: "trades" as const,
      top: "Trade",
      bottom: "Center",
      to: `${base}/trades`,
      disabled: !tradesUnlocked,
      disabledTitle: "Trades unlock after the fantasy draft import.",
    },
    {
      id: "store" as const,
      top: "League",
      bottom: "Store",
      to: `${base}/store`,
      disabled: !storeUnlocked,
      disabledTitle: isRise ? "Store unlocks after Week 1." : undefined,
    },
  ].filter(Boolean) as NavItem[];
}

/**
 * My Team family chassis — two snapshot rows inside LeagueTopRail:
 * Top: Season / Post-season / Career / Career post-season records
 * Bottom: My Team · View Rosters · (Progression) · Trade Center · League Store
 */
export function TeamStatusStrip({
  active,
  leagueId,
  isRise = false,
  tradesUnlocked = true,
  storeUnlocked = true,
  progressionAvailable = true,
}: {
  active: TeamNavId;
  leagueId: string;
  isRise?: boolean;
  tradesUnlocked?: boolean;
  storeUnlocked?: boolean;
  progressionAvailable?: boolean;
}) {
  const { guildId } = useReadyAuth();
  const [hub, setHub] = useState<HubResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void recApi.getHub(guildId)
      .then((next) => {
        if (!cancelled) setHub(next);
      })
      .catch(() => {
        if (!cancelled) setHub(null);
      });
    return () => {
      cancelled = true;
    };
  }, [guildId]);

  const my = hub?.myTeam?.display ?? {};
  const profile = hub?.myTeam?.profile ?? {};
  const items = teamNavItems({
    leagueId,
    isRise,
    tradesUnlocked,
    storeUnlocked,
    progressionAvailable,
  });

  return (
    <div className="hub-season-snapshot-box">
      <div className="hub-season-snapshot-grid" aria-label="My Team records">
        <article>
          <span>Season record</span>
          <strong>{my.leagueSeasonRecordText ?? "0-0-0"}</strong>
        </article>
        <article>
          <span>Post-season record</span>
          <strong>{my.leagueSeasonPlayoffText ?? "0-0"}</strong>
        </article>
        <article>
          <span>Career record</span>
          <strong>{profile.globalRecord?.text ?? "0-0-0"}</strong>
        </article>
        <article>
          <span>Career post-season record</span>
          <strong>{profile.globalRecord?.playoffText ?? "0-0"}</strong>
        </article>
      </div>
      <div className="hub-season-snapshot-grid hub-season-snapshot-secondary" aria-label="Team views">
        {items.map((item) => {
          const selected = item.id === active;
          const disabled = Boolean(item.disabled) && !selected;
          if (disabled) {
            return (
              <button
                key={item.id}
                type="button"
                disabled
                title={item.disabledTitle}
                aria-pressed={selected}
              >
                <span>{item.top}</span>
                <strong>{item.bottom}</strong>
              </button>
            );
          }
          return (
            <Link
              key={item.id}
              className={selected ? "is-active" : undefined}
              to={item.to}
              aria-current={selected ? "page" : undefined}
            >
              <span>{item.top}</span>
              <strong>{item.bottom}</strong>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
