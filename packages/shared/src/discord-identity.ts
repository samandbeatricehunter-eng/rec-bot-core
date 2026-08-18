// Discord's OAuth/API can return an empty-string global_name for accounts with no display name
// set — a plain `a ?? b` chain treats "" as present and never falls through to b, which is what
// broke the "Discord not linked" account-page display for at least one real account (see
// apps/api/src/modules/site-auth/site-auth.service.ts discordIdentityFromAuthUser). Use this
// wherever a Discord global_name/username is chained with a fallback, instead of `??`.
export function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
