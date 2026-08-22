import { useEffect, useState } from "react";

const SILHOUETTE = "/assets/player-cards/player-silhouette.svg";

/** Headshot with the shared player-card silhouette when the photo is missing or fails to load. */
export function PlayerAvatar({
  photoUrl,
  alt,
  className,
}: {
  photoUrl: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState(photoUrl || SILHOUETTE);
  useEffect(() => { setSrc(photoUrl || SILHOUETTE); }, [photoUrl]);
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => { if (src !== SILHOUETTE) setSrc(SILHOUETTE); }}
    />
  );
}
