export function formatUserIdentity(input: {
  siteUsername?: string | null;
  displayName?: string | null;
  discordGlobalName?: string | null;
  discordUsername?: string | null;
}): string {
  const siteIdentity = input.siteUsername?.trim() || input.displayName?.trim() || "REC Member";
  const discordIdentity = input.discordGlobalName?.trim() || input.discordUsername?.trim() || null;

  if (!discordIdentity || discordIdentity.localeCompare(siteIdentity, undefined, { sensitivity: "accent" }) === 0) {
    return siteIdentity;
  }

  return `${siteIdentity} (${discordIdentity})`;
}
