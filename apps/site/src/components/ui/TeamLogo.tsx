import { useState } from "react";
import { teamLogoUrl } from "../../lib/team-logos.js";

/** Team crest. Prefers an explicit logoUrl (relocated/custom), then the 32 stock Madden
 *  abbreviations. Renders nothing when neither resolves (CFB, missing asset, load error). */
export function TeamLogo({ abbreviation, logoUrl, alt, className, priority = false }: {
  abbreviation: string | null | undefined;
  logoUrl?: string | null;
  alt: string;
  className?: string;
  /** Discord/Playwright renders must not lazy-load — the screenshot fires as soon as the card
   * is visible, which is before Chromium fetches `loading="lazy"` images. */
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = logoUrl || teamLogoUrl(abbreviation);
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
