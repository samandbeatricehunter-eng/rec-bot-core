export function formatUserIdentity(input: {
  username?: string | null;
  displayName?: string | null;
  discordUsername?: string | null;
}): string {
  const siteIdentity = input.username?.trim() || input.displayName?.trim() || "REC Member";
  const discordIdentity = input.discordUsername?.trim() || null;
  if (!discordIdentity || discordIdentity.localeCompare(siteIdentity, undefined, { sensitivity: "accent" }) === 0) {
    return siteIdentity;
  }
  return `${siteIdentity} (${discordIdentity})`;
}
