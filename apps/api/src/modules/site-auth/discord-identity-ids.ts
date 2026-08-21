export function isSyntheticDiscordId(discordId: string | null | undefined): boolean {
  return String(discordId ?? "").startsWith("site:");
}
