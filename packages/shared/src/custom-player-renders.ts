// Custom-player card render catalog — 150 stylized bust options users pick after
// setting body type + position. Assets live at /assets/custom-player-renders/{id}.svg

export const REC_CARD_BODY_BUILDS = ["lean", "thin", "standard", "muscular", "heavy"] as const;
export type RecCardBodyBuild = (typeof REC_CARD_BODY_BUILDS)[number];

export const REC_CARD_SKIN_TONES = [
  "fair", "light", "medium", "tan", "brown", "deep",
] as const;
export type RecCardSkinTone = (typeof REC_CARD_SKIN_TONES)[number];

export const REC_CARD_HAIRSTYLES = [
  "buzz", "fade", "short", "curly", "locs", "braids", "afro", "long", "bald", "mohawk",
] as const;
export type RecCardHairstyle = (typeof REC_CARD_HAIRSTYLES)[number];

export type RecCustomPlayerRender = {
  id: string;
  /** Relative public path served by the web app. */
  imagePath: string;
  bodyBuild: RecCardBodyBuild;
  skinTone: RecCardSkinTone;
  hairstyle: RecCardHairstyle;
  label: string;
};

/** CFB body-type keys map 1:1 onto card builds. */
export function cardBuildFromBodyType(bodyType: string | null | undefined): RecCardBodyBuild | null {
  const key = String(bodyType ?? "").trim().toLowerCase();
  return (REC_CARD_BODY_BUILDS as readonly string[]).includes(key) ? (key as RecCardBodyBuild) : null;
}

/** Builds allowed for a roster/custom-player position — keeps OL out of skinny faces, etc. */
export function cardBuildsForPosition(position: string | null | undefined): readonly RecCardBodyBuild[] {
  const pos = String(position ?? "").trim().toUpperCase();
  if (["LT", "LG", "C", "RG", "RT", "OL"].includes(pos)) return ["muscular", "heavy"];
  if (["DT", "NT"].includes(pos)) return ["muscular", "heavy", "standard"];
  if (["FB"].includes(pos)) return ["muscular", "heavy", "standard"];
  if (["LE", "RE", "LEDGE", "REDGE", "LEDG", "REDG", "DE"].includes(pos)) return ["muscular", "standard", "heavy"];
  if (["TE"].includes(pos)) return ["standard", "muscular", "heavy"];
  if (["LOLB", "MLB", "ROLB", "WILL", "MIKE", "SAM", "LB"].includes(pos)) return ["standard", "muscular", "lean"];
  if (["QB"].includes(pos)) return ["standard", "muscular", "lean", "thin"];
  if (["HB", "RB", "WR", "CB", "FS", "SS", "DB"].includes(pos)) return ["lean", "thin", "standard", "muscular"];
  if (["K", "P", "LS"].includes(pos)) return ["lean", "thin", "standard"];
  return ["lean", "thin", "standard", "muscular", "heavy"];
}

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

/** Deterministic 150-entry catalog (30 per body build × 5 builds). */
export const REC_CUSTOM_PLAYER_RENDERS: readonly RecCustomPlayerRender[] = (() => {
  const out: RecCustomPlayerRender[] = [];
  let n = 1;
  for (const bodyBuild of REC_CARD_BODY_BUILDS) {
    for (let i = 0; i < 30; i++) {
      const skinTone = REC_CARD_SKIN_TONES[i % REC_CARD_SKIN_TONES.length];
      const hairstyle = REC_CARD_HAIRSTYLES[(i + Math.floor(i / 6)) % REC_CARD_HAIRSTYLES.length];
      const id = `cpr-${pad(n)}`;
      out.push({
        id,
        imagePath: `/assets/custom-player-renders/${id}.svg`,
        bodyBuild,
        skinTone,
        hairstyle,
        label: `${bodyBuild} · ${skinTone} · ${hairstyle}`,
      });
      n += 1;
    }
  }
  return out;
})();

export function getCustomPlayerRender(id: string | null | undefined): RecCustomPlayerRender | null {
  if (!id) return null;
  return REC_CUSTOM_PLAYER_RENDERS.find((row) => row.id === id) ?? null;
}

export function customPlayerRenderPublicUrl(id: string): string {
  const row = getCustomPlayerRender(id);
  return row?.imagePath ?? "/assets/player-cards/player-silhouette.svg";
}

/** Filter catalog by selected body build and (optional) position constraints. */
export function listCustomPlayerRendersFor(input: {
  bodyBuild: string | null | undefined;
  position?: string | null;
}): RecCustomPlayerRender[] {
  const build = cardBuildFromBodyType(input.bodyBuild);
  if (!build) return [];
  const allowed = new Set(cardBuildsForPosition(input.position));
  if (!allowed.has(build)) return [];
  return REC_CUSTOM_PLAYER_RENDERS.filter((row) => row.bodyBuild === build);
}

export function isCustomPlayerRenderAllowed(input: {
  cardRenderId: string | null | undefined;
  bodyBuild: string | null | undefined;
  position: string | null | undefined;
}): boolean {
  const row = getCustomPlayerRender(input.cardRenderId);
  if (!row) return false;
  const build = cardBuildFromBodyType(input.bodyBuild);
  if (!build || row.bodyBuild !== build) return false;
  return cardBuildsForPosition(input.position).includes(row.bodyBuild);
}
