// Pure, platform-agnostic role-name matching for "is this Discord member a
// commissioner/co-commissioner" checks. Kept here (not apps/bot) so both the bot's
// discord.js-based checks (which have a cached GuildMember and its role names for free)
// and the API's REST-based checks (which fetch role names from Discord's REST API for a
// browser session that has no cached GuildMember) share one source of truth instead of
// two lists that can quietly drift apart.

export function normalizeDiscordRoleName(roleName: string): string {
  return roleName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export const COMMISSIONER_ROLE_NAMES: readonly string[] = [
  "commissioner",
  "commissioners",
  "rec league commissioner",
];

export const CO_COMMISSIONER_ROLE_NAMES: readonly string[] = [
  "co commissioner",
  "co commissioners",
  "co commish",
  "co commishes",
  "rec league co commissioner",
  "rec league co commish",
  "rec league comp committee",
  "comp committee",
  "competition committee",
];

export function isCommissionerRoleName(name: string): boolean {
  return COMMISSIONER_ROLE_NAMES.includes(normalizeDiscordRoleName(name));
}

export function isCoCommissionerRoleName(name: string): boolean {
  return CO_COMMISSIONER_ROLE_NAMES.includes(normalizeDiscordRoleName(name));
}

// Takes plain role-name strings (not discord.js Role objects) so both call sites — the
// bot mapping `member.roles.cache`, the API mapping Discord REST role objects — can use
// the exact same classification in one pass.
export function classifyGuildRoleNames(roleNames: string[]): { isCommissioner: boolean; isCoCommissioner: boolean } {
  let isCommissioner = false;
  let isCoCommissioner = false;
  for (const name of roleNames) {
    if (!isCommissioner && isCommissionerRoleName(name)) isCommissioner = true;
    if (!isCoCommissioner && isCoCommissionerRoleName(name)) isCoCommissioner = true;
    if (isCommissioner && isCoCommissioner) break;
  }
  return { isCommissioner, isCoCommissioner };
}

// The 3 roles REC actively manages (grants/revokes) per guild — as opposed to the name
// lists above, which only classify roles a guild admin may have created by hand. Single
// source of truth for both the bot's discord.js-based role sync (apps/bot/src/lib/
// role-sync.ts) and the API's REST-based grant/revoke (apps/api/src/modules/roles/).
// compCommittee's name is deliberately one of CO_COMMISSIONER_ROLE_NAMES above — granting
// it via either surface is literally what makes someone a co-commissioner elsewhere in the app.
export const REC_MANAGED_ROLES = {
  member: { name: "REC League Member", color: 0x87ceeb },
  compCommittee: { name: "REC League Comp. Committee", color: 0xc27c0e },
  commissioner: { name: "REC League Commissioner", color: 0xd4af37 },
  discordOnly: { name: "REC Discord Only", color: 0x808080 },
} as const;

export type RecManagedRoleKey = keyof typeof REC_MANAGED_ROLES;
