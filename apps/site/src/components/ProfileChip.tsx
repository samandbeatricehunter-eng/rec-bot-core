import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { siteApi, type EntitlementSummary, type LinkProfileResponse } from "../lib/site-api.js";

function tierLabel(entitlements: EntitlementSummary | null | undefined) {
  const tier = entitlements?.tier ?? "none";
  if (tier === "platinum") return "Platinum Member";
  if (tier === "gold") return "Gold Member";
  return "Member";
}

export function ProfileChip() {
  const auth = useAuth();
  const [profile, setProfile] = useState<LinkProfileResponse | null>(null);

  useEffect(() => {
    if (auth.status !== "signed-in") {
      setProfile(null);
      return;
    }
    let cancelled = false;
    siteApi
      .getLinkProfile()
      .then((me) => {
        if (!cancelled) setProfile(me);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  if (auth.status !== "signed-in") return null;

  const name = profile?.displayName || profile?.username || auth.user.email?.split("@")[0] || "Member";
  const initial = String(name).slice(0, 1).toUpperCase();
  const tier = tierLabel(profile?.entitlements);
  const isPlatinum = profile?.entitlements?.tier === "platinum";

  return (
    <div className="site-profile-chip">
      {isPlatinum ? <span className="site-profile-tier">{tier}</span> : null}
      <Link to="/account" className="site-profile-link" title="My Account">
        <span className="site-profile-avatar" aria-hidden>
          {initial}
        </span>
        <span className="site-profile-meta">
          <strong>{name}</strong>
          <span>{isPlatinum ? "Head of house" : tier}</span>
        </span>
      </Link>
    </div>
  );
}
