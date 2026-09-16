import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useReadyAuth } from "@rec/hub-ui";
import { Button } from "../../../components/ui/Button.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { HubResponse } from "../../../types/api.js";
import { RetireFromLeagueModal } from "./RetireFromLeagueModal.js";

/**
 * My Team body owned by apps/site. Record + nav chrome lives in TeamRouteRail
 * (two-row snapshot); this page keeps the coach heading + retire foothold.
 */
export function TeamHomePage() {
  const { guildId } = useReadyAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hub, setHub] = useState<HubResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retireOpen, setRetireOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void recApi.getHub(guildId)
      .then((next) => {
        if (!cancelled) setHub(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load My Team.");
      });
    return () => {
      cancelled = true;
    };
  }, [guildId]);

  useEffect(() => {
    if (searchParams.get("openModal") !== "retire") return;
    setRetireOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("openModal");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (error && !hub) {
    return (
      <section className="hub-section hub-my-team">
        <p className="hub-empty">{error}</p>
      </section>
    );
  }

  if (!hub) {
    return (
      <section className="hub-section hub-my-team">
        <p className="hub-empty">Loading My Team…</p>
      </section>
    );
  }

  const my = hub.myTeam?.display ?? {};
  const profile = hub.myTeam?.profile ?? {};
  const teamName = profile.teamName ?? my.teamName ?? "No team linked";
  const coachName =
    my.siteUsername
    || my.displayName
    || profile.user?.username
    || my.discordUsername
    || profile.user?.display_name
    || "REC Member";
  const heroTeam = String(profile.teamName ?? my.teamName ?? "").trim() || teamName;

  return (
    <>
      <section className="hub-section hub-my-team">
        <div className="hub-section-heading">
          <div>
            <p className="hub-eyebrow">Full coach profile</p>
            <h2>{teamName}</h2>
            <p>{coachName}</p>
          </div>
        </div>
        {/* Body intentionally cleared for a redesign — rebuild the rest fresh. */}
        {!hub.canManageLeague ? (
          <div className="hub-retire-league">
            <Button
              variant="danger"
              onClick={() => setRetireOpen(true)}
            >
              Retire from League
            </Button>
          </div>
        ) : null}
      </section>
      {retireOpen ? (
        <RetireFromLeagueModal
          leagueName={hub.league.name}
          teamNickname={heroTeam}
          onClose={() => setRetireOpen(false)}
        />
      ) : null}
    </>
  );
}
