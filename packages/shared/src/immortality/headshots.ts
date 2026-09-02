import { customPlayerRenderBaseUrl } from "../custom-player-renders.js";

export type ImmortalityHeadshot = {
  id: string;
  label: string;
  kind: "owner" | "QB" | "MIKE";
  imageUrl: string;
};

function imageUrl(id: string): string {
  const base = customPlayerRenderBaseUrl();
  return base && /^https:\/\/imagedelivery\.net\//i.test(base)
    ? `${base}/${id}/public`
    : `/assets/rti-headshots/${id}.webp`;
}

function catalog(kind: ImmortalityHeadshot["kind"], count: number): readonly ImmortalityHeadshot[] {
  const prefix = kind === "owner" ? "owner" : kind.toLowerCase();
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(3, "0");
    const id = `rti-${prefix}-headshot-${number}`;
    return { id, kind, label: `${kind === "owner" ? "Owner" : kind} ${index + 1}`, imageUrl: imageUrl(id) };
  });
}

export const IMMORTALITY_OWNER_HEADSHOTS = catalog("owner", 33);
export const IMMORTALITY_QB_HEADSHOTS = catalog("QB", 20);
export const IMMORTALITY_MIKE_HEADSHOTS = catalog("MIKE", 20);

export function immortalityPlayerHeadshots(position: string): readonly ImmortalityHeadshot[] {
  if (position.toUpperCase() === "QB") return IMMORTALITY_QB_HEADSHOTS;
  if (position.toUpperCase() === "MIKE") return IMMORTALITY_MIKE_HEADSHOTS;
  return [];
}
