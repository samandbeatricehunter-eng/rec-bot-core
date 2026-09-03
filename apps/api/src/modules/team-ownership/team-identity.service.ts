import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  formatRelocationCityLabel,
  maddenRelocationBrandBySlug,
  maddenRelocationBrandsForCity,
  maddenRelocationCityById,
  maddenRelocationLogoPath,
  MADDEN_RELOCATION_BRANDS,
  MADDEN_RELOCATION_CITIES,
} from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { setGuildMemberNickname } from "../../lib/discord-guild.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";

const MEDIA_BUCKET = "rec-media";
const TEAM_CREST_SIZE = 400;
const TEAM_CREST_MIME = new Set(["image/png", "image/webp"]);

const HEX = /^#[0-9A-Fa-f]{6}$/;

async function userIdForDiscord(discordId: string) {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "We couldn't look up that Discord account. Please try again.", account.error);
  if (!account.data?.user_id) throw new ApiError(404, "That Discord account is not linked to a REC user.");
  return account.data.user_id as string;
}

async function activeTeamForUser(leagueId: string, userId: string) {
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id,team:rec_teams(*)")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "We couldn't load your team. Please try again.", assignment.error);
  const team = Array.isArray(assignment.data?.team) ? assignment.data.team[0] : assignment.data?.team;
  if (!assignment.data?.team_id || !team) throw new ApiError(404, "You don't have a team linked in this league.");
  return { teamId: assignment.data.team_id as string, team: team as Record<string, any> };
}

function shortNick(team: Record<string, any>, isCfb: boolean) {
  if (isCfb) return String(team.display_city ?? team.name ?? "Team").trim();
  const nick = String(team.display_nick ?? "").trim();
  if (nick) return nick;
  const name = String(team.name ?? "Team").trim();
  const parts = name.split(/\s+/);
  return parts[parts.length - 1] || name;
}

function normalizeColor(value: string) {
  const hex = value.trim();
  if (!HEX.test(hex)) throw new ApiError(400, "Primary color must be a 6-digit hex value like #C8102E.");
  return hex.toUpperCase();
}

function normalizeAbbr(value: string) {
  const abbr = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (abbr.length < 2 || abbr.length > 4) throw new ApiError(400, "Team abbreviation must be 2–4 letters.");
  return abbr;
}

/** Square PNG crest matching the stock NFL logo pass (max 400px) with a transparent canvas. */
export async function persistTeamCrestBuffer(leagueId: string, buffer: Buffer, contentType: string): Promise<string> {
  if (!TEAM_CREST_MIME.has(contentType)) {
    throw new ApiError(400, "Custom logos must be a PNG or WebP with a transparent background.");
  }
  let image;
  try {
    image = sharp(buffer, { failOn: "none" }).rotate();
  } catch {
    throw new ApiError(400, "That file isn't a valid image.");
  }
  const meta = await image.metadata();
  if (meta.format === "jpeg" || meta.format === "jpg") {
    throw new ApiError(400, "JPEG logos have no transparency. Upload a PNG or WebP with a transparent background.");
  }
  const alphaStats = await sharp(buffer).ensureAlpha().extractChannel("alpha").stats();
  const minAlpha = alphaStats.channels[0]?.min ?? 255;
  if (!meta.hasAlpha || minAlpha >= 254) {
    throw new ApiError(400, "That logo has no transparent background, so it may not render on matchup cards. Export it as a PNG or WebP with transparency and try again.");
  }
  const png = await image
    .ensureAlpha()
    .resize(TEAM_CREST_SIZE, TEAM_CREST_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const path = `${leagueId}/team-crests/${randomUUID()}.png`;
  const uploaded = await supabase.storage.from(MEDIA_BUCKET).upload(path, png, {
    contentType: "image/png",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploaded.error) throw new ApiError(500, "We couldn't upload that team logo. Please try again.", uploaded.error);
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new ApiError(500, "We couldn't finish uploading that team logo. Please try again.");
  return data.publicUrl;
}

async function resyncDiscordNicknames(guildId: string, leagueId: string, teamId: string, team: Record<string, any>, isCfb: boolean) {
  const linked = await supabase
    .from("rec_team_assignments")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (linked.error || !linked.data?.length) return;
  const userIds = linked.data.map((row) => row.user_id).filter(Boolean);
  const accounts = await supabase.from("rec_discord_accounts").select("discord_id").in("user_id", userIds);
  // Rise to Immortality nicknames the full "City Mascot" (set at franchise assignment via
  // formatTeamDisplayName) -- falling back to the short mascot-only convention here would
  // silently strip the city part the next time this team's identity changes.
  const { loadImmortalityLeague } = await import("../immortality/immortality.service.js");
  const immortality = await loadImmortalityLeague(leagueId).catch(() => null);
  const nick = immortality ? (formatTeamDisplayName(team as any) ?? shortNick(team, isCfb)) : shortNick(team, isCfb);
  for (const account of accounts.data ?? []) {
    if (!account.discord_id) continue;
    await setGuildMemberNickname(guildId, account.discord_id, nick, "REC team relocated — nickname updated")
      .catch((error) => console.error(`[WARN] Failed to update nickname for ${account.discord_id} after relocate:`, error));
  }
}

async function applyIdentity(input: {
  leagueId: string;
  guildId: string;
  teamId: string;
  displayCity: string;
  displayNick: string;
  displayAbbr: string;
  primaryColor: string;
  logoUrl: string | null;
  keepStockLogo?: boolean;
}) {
  const existing = await supabase.from("rec_teams").select("*").eq("id", input.teamId).eq("league_id", input.leagueId).maybeSingle();
  if (existing.error || !existing.data) throw new ApiError(404, "That team was not found.");
  const originalAbbreviation = existing.data.original_abbreviation ?? existing.data.abbreviation;
  const name = `${input.displayCity} ${input.displayNick}`.trim();
  const logoUrl = input.keepStockLogo ? null : input.logoUrl;
  const updated = await supabase
    .from("rec_teams")
    .update({
      name,
      display_city: input.displayCity,
      display_nick: input.displayNick,
      display_abbr: input.displayAbbr,
      is_relocated: true,
      original_abbreviation: originalAbbreviation,
      primary_color: input.primaryColor,
      logo_url: logoUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.teamId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "We couldn't save that team identity. Please try again.", updated.error);

  const league = await supabase.from("rec_leagues").select("game").eq("id", input.leagueId).maybeSingle();
  const isCfb = league.data?.game === "cfb_27";
  await resyncDiscordNicknames(input.guildId, input.leagueId, input.teamId, updated.data, isCfb);
  const { refreshGameChannelIntrosForTeam } = await import("../game-channels/game-channels.service.js");
  await refreshGameChannelIntrosForTeam(input.guildId, input.teamId).catch((error) => {
    console.error("[ERROR] Failed to refresh game-channel embeds after team identity change (non-fatal):", error);
  });
  return updated.data;
}

export function listMaddenRelocationCatalog() {
  return {
    cities: MADDEN_RELOCATION_CITIES.map((city) => ({
      ...city,
      label: formatRelocationCityLabel(city),
    })),
    brands: MADDEN_RELOCATION_BRANDS.map((brand) => ({
      ...brand,
      logoUrl: maddenRelocationLogoPath(brand.slug),
    })),
  };
}

export async function relocateHubTeam(input: {
  guildId: string;
  discordId: string;
  cityId: string;
  keepBranding: boolean;
  brandSlug?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (String(context.rec_leagues.game ?? "").startsWith("madden") === false) {
    throw new ApiError(400, "Franchise relocation is available in Madden leagues.");
  }
  const userId = await userIdForDiscord(input.discordId);
  const { teamId, team } = await activeTeamForUser(context.leagueId, userId);
  const city = maddenRelocationCityById(input.cityId);
  if (!city) throw new ApiError(400, "Pick a Madden 27 relocation city.");

  if (input.keepBranding) {
    const nick = shortNick(team, false);
    const abbr = String(team.display_abbr ?? team.abbreviation ?? "").trim() || "TM";
    const color = String(team.primary_color ?? "#FFFFFF");
    const saved = await applyIdentity({
      leagueId: context.leagueId,
      guildId: input.guildId,
      teamId,
      displayCity: city.name,
      displayNick: nick,
      displayAbbr: normalizeAbbr(abbr),
      primaryColor: HEX.test(color) ? color.toUpperCase() : "#FFFFFF",
      logoUrl: team.logo_url ?? null,
      keepStockLogo: !team.logo_url,
    });
    await writeAuditLog({
      action: "team.relocated.keep_branding",
      entityType: "rec_teams",
      entityId: teamId,
      newValue: { city: city.name, name: saved.name },
      reason: "Hub relocate wizard — kept existing logo and name.",
      source: "manual_admin_entry",
    });
    return { team: saved, pendingApproval: false };
  }

  const allowed = maddenRelocationBrandsForCity(city.id);
  const brand = maddenRelocationBrandBySlug(String(input.brandSlug ?? ""));
  if (!brand || !allowed.some((item) => item.slug === brand.slug)) {
    throw new ApiError(400, "Pick a Madden relocation team brand for that city.");
  }
  const saved = await applyIdentity({
    leagueId: context.leagueId,
    guildId: input.guildId,
    teamId,
    displayCity: city.name,
    displayNick: brand.name,
    displayAbbr: brand.abbr,
    primaryColor: brand.primaryColor,
    logoUrl: maddenRelocationLogoPath(brand.slug),
  });
  await writeAuditLog({
    action: "team.relocated.brand",
    entityType: "rec_teams",
    entityId: teamId,
    newValue: { city: city.name, brand: brand.slug, name: saved.name },
    reason: "Hub relocate wizard — Madden relocation brand.",
    source: "manual_admin_entry",
  });
  return { team: saved, pendingApproval: false };
}

export async function submitCustomTeamIdentity(input: {
  guildId: string;
  discordId: string;
  city: string;
  nick: string;
  abbr: string;
  primaryColor: string;
  logoUrl: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (String(context.rec_leagues.game ?? "").startsWith("madden") === false) {
    throw new ApiError(400, "Custom team replacement is available in Madden leagues.");
  }
  const userId = await userIdForDiscord(input.discordId);
  const { teamId, team } = await activeTeamForUser(context.leagueId, userId);
  const city = input.city.trim();
  const nick = input.nick.trim();
  if (city.length < 2 || nick.length < 2) throw new ApiError(400, "Enter a city name and a team name.");
  const abbr = normalizeAbbr(input.abbr);
  const primaryColor = normalizeColor(input.primaryColor);
  const logoUrl = String(input.logoUrl ?? "").trim();
  if (!/^https?:\/\//i.test(logoUrl) && !logoUrl.startsWith("/")) {
    throw new ApiError(400, "Upload a team logo before submitting.");
  }

  const pending = await supabase
    .from("rec_commissioners_inbox")
    .select("id")
    .eq("league_id", context.leagueId)
    .eq("team_id", teamId)
    .eq("queue_type", "custom_team")
    .eq("status", "pending")
    .maybeSingle();
  if (pending.error) throw new ApiError(500, "We couldn't check pending custom-team requests. Please try again.", pending.error);
  if (pending.data) throw new ApiError(409, "A custom-team logo is already waiting on commissioner approval.");

  const header = `Custom Team: ${city} ${nick} (${abbr})`;
  const inbox = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: context.serverId,
    league_id: context.leagueId,
    season_number: Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1),
    week_number: Number(context.rec_leagues.current_week ?? 1),
    queue_type: "custom_team",
    status: "pending",
    priority: 1,
    header,
    summary: `${formatTeamDisplayName(team) ?? team.name} requested a custom identity. Approve to apply the name, logo, and primary color site-wide and in Discord.`,
    requester_user_id: userId,
    requester_discord_id: input.discordId,
    team_id: teamId,
    amount: null,
    payload: { city, nick, abbr, primaryColor, logoUrl, previousName: team.name },
  });
  if (inbox.error) throw new ApiError(500, "We couldn't submit that custom team for review. Please try again.", inbox.error);
  void notifyLeagueCommissionersOfPendingItem(context.leagueId);
  return { pendingApproval: true, header };
}

export async function reviewCustomTeamIdentity(input: {
  guildId: string;
  inboxId: string;
  action: "approve" | "deny";
  reviewerDiscordId: string;
  deniedReason?: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const inbox = await supabase
    .from("rec_commissioners_inbox")
    .select("*")
    .eq("id", input.inboxId)
    .eq("guild_id", input.guildId)
    .eq("queue_type", "custom_team")
    .eq("status", "pending")
    .maybeSingle();
  if (inbox.error) throw new ApiError(500, "We couldn't load that custom-team request. Please try again.", inbox.error);
  if (!inbox.data) throw new ApiError(404, "That custom-team request is not pending.");

  const payload = (inbox.data.payload ?? {}) as {
    city?: string; nick?: string; abbr?: string; primaryColor?: string; logoUrl?: string;
  };
  const now = new Date().toISOString();

  if (input.action === "deny") {
    const reason = input.deniedReason?.trim() || "Denied by commissioner.";
    await supabase.from("rec_commissioners_inbox").update({
      status: "denied",
      reviewed_by_discord_id: input.reviewerDiscordId,
      reviewed_at: now,
      review_reason: reason,
      updated_at: now,
    }).eq("id", inbox.data.id);
    if (inbox.data.requester_user_id) {
      await createSiteNotification({
        userId: inbox.data.requester_user_id,
        leagueId: context.leagueId,
        kind: "custom_team_denied",
        title: "Your custom team was denied",
        body: reason,
        href: "/app",
      }).catch((error) => console.error("[WARN] Failed to notify custom-team requester of denial:", error));
    }
    return { reviewed: true as const, decision: "deny" as const };
  }

  const teamId = String(inbox.data.source_id ?? inbox.data.team_id ?? "");
  if (!teamId || !payload.city || !payload.nick || !payload.abbr || !payload.primaryColor || !payload.logoUrl) {
    throw new ApiError(400, "That custom-team request is missing identity fields.");
  }
  const saved = await applyIdentity({
    leagueId: context.leagueId,
    guildId: input.guildId,
    teamId,
    displayCity: payload.city,
    displayNick: payload.nick,
    displayAbbr: payload.abbr,
    primaryColor: payload.primaryColor,
    logoUrl: payload.logoUrl,
  });
  await supabase.from("rec_commissioners_inbox").update({
    status: "approved",
    reviewed_by_discord_id: input.reviewerDiscordId,
    reviewed_at: now,
    updated_at: now,
  }).eq("id", inbox.data.id);
  if (inbox.data.requester_user_id) {
    await createSiteNotification({
      userId: inbox.data.requester_user_id,
      leagueId: context.leagueId,
      kind: "custom_team_approved",
      title: `${saved.name} is live`,
      body: "Your custom team name, logo, and color are now used across the site and Discord.",
      href: "/app",
    }).catch((error) => console.error("[WARN] Failed to notify custom-team requester:", error));
  }
  await writeAuditLog({
    action: "team.custom_identity.approved",
    entityType: "rec_teams",
    entityId: teamId,
    newValue: { name: saved.name, logoUrl: saved.logo_url, primaryColor: saved.primary_color },
    reason: "Commissioner approved a Hub custom-team identity.",
    source: "manual_admin_entry",
  });
  return { reviewed: true as const, decision: "approve" as const, team: saved };
}
