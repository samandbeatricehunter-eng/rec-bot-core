import { useState } from "react";
import { teamLogoUrl } from "../../lib/team-logos.js";

/** Team crest for the 32 standard Madden teams — renders nothing for CFB schools, relocated/
 * custom teams, or any abbreviation without a matching asset (onError hides itself rather than
 * showing a broken-image icon). */
export function TeamLogo({ abbreviation, alt, className }: { abbreviation: string | null | undefined; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = teamLogoUrl(abbreviation);
  if (!src || failed) return null;
  return <img src={src} alt={alt} className={className ? `team-logo ${className}` : "team-logo"} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
