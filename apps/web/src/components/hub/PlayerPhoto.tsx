import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";

/** Player headshot with graceful fallback on a failed/expired image load -- mirrors
 *  TeamLogo.tsx's onError pattern. Without this, a stale/deleted Cloudflare Images URL (photos
 *  get replaced in place over a player's lifetime -- re-import, re-upload, custom-player
 *  re-render) shows a broken-image icon forever instead of ever reaching the caller's
 *  fallback, which is what made photos look "inconsistent" across the site rather than
 *  reliably present-or-absent. */
export function PlayerPhoto({ photoUrl, alt = "", fallback, ...imgProps }: {
  photoUrl: string | null | undefined;
  alt?: string;
  fallback: ReactNode;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  if (!photoUrl || failed) return <>{fallback}</>;
  return <img src={photoUrl} alt={alt} onError={() => setFailed(true)} {...imgProps} />;
}
