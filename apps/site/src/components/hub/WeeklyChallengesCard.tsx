import { useEffect, useState } from "react";
import { recApi } from "../../lib/rec-api-client.js";
import { SectionFrame } from "../design-system/SectionFrame.js";
import type { MyWeeklyChallengesResponse, WeeklyTeamChallenge } from "../../types/api.js";

const SIDE_LABELS: Record<WeeklyTeamChallenge["side"], string> = {
  offense: "Offense", defense: "Defense", special_teams: "Special Teams",
};
const TIER_LABELS: Record<"bronze" | "silver" | "gold", string> = { bronze: "Bronze", silver: "Silver", gold: "Gold" };

/** Non-RTI weekly team challenges -- one card per side (offense/defense/special teams), each with
 * stacking bronze/silver/gold tiers (silver requires bronze's requirements too, gold requires
 * both). Self-fetches; renders nothing once loaded if there's nothing to show yet (no box score
 * in for the current week, no active team, or an RTI league, which has its own separate weekly
 * challenge system). */
export function WeeklyChallengesCard({ guildId }: { guildId: string }) {
  const [data, setData] = useState<MyWeeklyChallengesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    recApi.getMyWeeklyChallenges(guildId)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load weekly challenges."); });
    return () => { cancelled = true; };
  }, [guildId]);

  if (error || (data && !data.challenges.length)) return null;
  if (!data) return null;

  return (
    <SectionFrame eyebrow="This Week" title="Team Challenges" subtitle={`Week ${data.weekNumber} — complete a tier for Player XP`}>
      <div className="hub-weekly-challenges">
        {data.challenges.map((challenge) => (
          <div key={challenge.side} className="hub-weekly-challenge-row">
            <div className="hub-weekly-challenge-header">
              <span className="hub-weekly-challenge-side">{SIDE_LABELS[challenge.side]}</span>
              <span className="hub-weekly-challenge-name">{challenge.name}</span>
            </div>
            <div className="hub-weekly-challenge-tiers">
              {challenge.tiers.map((tier) => (
                <span key={tier.tier} className={`hub-weekly-tier-pip hub-weekly-tier-${tier.tier} ${tier.complete ? "is-complete" : ""}`}>
                  {TIER_LABELS[tier.tier]}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionFrame>
  );
}
