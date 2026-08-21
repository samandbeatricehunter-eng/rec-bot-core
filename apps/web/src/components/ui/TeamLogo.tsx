import { useState } from "react";
import { teamLogoUrl } from "../../lib/team-logos.js";

/** Team crest for the 32 standard Madden teams — renders nothing for CFB schools, relocated/
 * custom teams, or any abbreviation without a matching asset (onError hides itself rather than
 * showing a broken-image icon). */
export function TeamLogo({ abbreviation, alt, className, priority = false }: {
  abbreviation: string | null | undefined;
  alt: string;
  className?: string;
  /** Discord/Playwright renders must not lazy-load — the screenshot fires as soon as the card
   * is visible, which is before Chromium fetches `loading="lazy"` images. */
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = teamLogoUrl(abbreviation);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={className ? `team-logo ${className}` : "team-logo"}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      fetchPriority={priority ? "high" : undefined}
      onError={() => setFailed(true)}
    />
  );
}
