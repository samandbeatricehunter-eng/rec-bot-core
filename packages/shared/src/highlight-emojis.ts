export const HIGHLIGHT_AWARD_EMOJIS = {
  TOTY: { label: "Best Throw", name: "BestThrow", id: "1519432540639985664" },
  COTY: { label: "Best Catch", name: "BestCatch", id: "1519432498550149201" },
  ROTY: { label: "Best Run", name: "BestRun", id: "1519432452710465638" },
  IOTY: { label: "Best Interception", name: "BestINT", id: "1519432367486402601" },
  HOTY: { label: "Best Hit", name: "BestHit", id: "1519432303376335019" },
} as const;

// Award categories voted on through the web Hub's reaction pills only — there's no
// preloaded Discord reaction emoji for these (no application emoji has been uploaded
// for them), so Discord-side voting isn't available, but they tally and pay out at
// end-of-season settlement exactly like the categories above.
export const HIGHLIGHT_AWARD_WEB_ONLY = {
  MVP_PLAY: { label: "Most Valuable Play" },
} as const;

export const HIGHLIGHT_AWARD_CATEGORY_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(HIGHLIGHT_AWARD_EMOJIS).map(([key, value]) => [key, value.label])),
  ...Object.fromEntries(Object.entries(HIGHLIGHT_AWARD_WEB_ONLY).map(([key, value]) => [key, value.label])),
};

export const HIGHLIGHT_AWARD_KEYS = [
  ...Object.keys(HIGHLIGHT_AWARD_EMOJIS),
  ...Object.keys(HIGHLIGHT_AWARD_WEB_ONLY),
] as const;
