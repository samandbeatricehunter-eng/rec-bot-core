import { personaDnaCatalog } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";

const IS_CUSTOM_PROSPECT_PREFIX = "rti:";
const PLAYERS_PER_TEAM = 5;

// Trait names (from packages/shared/src/immortality/config/persona_dna.json's 60-trait catalog)
// that lean a generated player toward instigating rather than praising a rival/teammate, or vice
// versa -- a lightweight heuristic, not the full RTI persona-DNA mechanic (that one's tied to a
// specific prospect's own answered questions; these are real, non-RTI roster players who never
// answer anything, so their 3 traits are picked once, deterministically, and never drift).
const INSTIGATE_LEANING_TRAITS = new Set([
  "Win At All Costs", "Aggressive", "Overly Competitive", "Assertive", "Demanding",
  "Headstrong", "Intense", "Outspoken", "Uncompromising", "Stubborn", "Confident",
  "Unpredictable", "Particular",
]);
const PRAISE_LEANING_TRAITS = new Set([
  "Team First", "Mentor", "Collaborative", "Empathetic", "Respectful", "Diplomatic",
  "Approachable", "Grounded", "Reliable", "Accountable", "Composed", "Patient", "Sensitive",
  "Family Focused",
]);

function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function handleForPlayerName(fullName: string | null | undefined): { handle: string; displayName: string } {
  const displayName = (fullName ?? "").trim() || "Player";
  const slug = displayName.replace(/[^A-Za-z0-9]/g, "") || "Player";
  return { handle: `@${slug}`, displayName };
}

function generatePersonaTraits(seed: string): { traits: string[]; tonePraiseWeight: number } {
  const catalog = personaDnaCatalog();
  if (!catalog.length) return { traits: [], tonePraiseWeight: 0.5 };
  const rng = seededRandom(seed);
  const pool = [...catalog];
  const picked: string[] = [];
  for (let i = 0; i < 3 && pool.length; i += 1) {
    const index = Math.floor(rng() * pool.length);
    picked.push(pool.splice(index, 1)[0]!.name);
  }
  const instigateMatches = picked.filter((name) => INSTIGATE_LEANING_TRAITS.has(name)).length;
  const praiseMatches = picked.filter((name) => PRAISE_LEANING_TRAITS.has(name)).length;
  const tonePraiseWeight = Math.max(0.15, Math.min(0.85, 0.5 - (instigateMatches - praiseMatches) * 0.15));
  return { traits: picked, tonePraiseWeight };
}

/** Generates (idempotently) a fictional Twitter personality for the top 5 real (non-RTI) roster
 * players by OVR on every team in this league -- ~160 players across a full 32-team league.
 * Called after every EA import alongside the other post-import RTI steps, right next to
 * queuePlayerChatterAfterImport, which is the actual consumer of these rows. Re-running this is
 * cheap and safe: existing persona rows are left untouched (a player's voice/tone/traits, once
 * generated, don't drift even if they later fall out of the top 5 -- they just stop being picked
 * as a new author, same as any other roster player). */
export async function ensurePlayerPersonasForLeague(leagueId: string): Promise<void> {
  const teams = await supabase.from("rec_teams").select("id").eq("league_id", leagueId);
  const teamIds = (teams.data ?? []).map((row: any) => String(row.id));
  if (!teamIds.length) return;

  const existing = await supabase.from("rec_immortality_player_personas").select("player_id").eq("league_id", leagueId);
  const existingPlayerIds = new Set((existing.data ?? []).map((row: any) => String(row.player_id)));

  const rows: Array<{
    league_id: string; player_id: string; team_id: string; handle: string; display_name: string;
    traits: string[]; tone_praise_weight: number;
  }> = [];

  for (const teamId of teamIds) {
    const players = await supabase.from("rec_players")
      .select("id,full_name,madden_player_id,overall_rating,team_id")
      .eq("league_id", leagueId).eq("team_id", teamId)
      .not("overall_rating", "is", null)
      .order("overall_rating", { ascending: false })
      .limit(20);
    const eligible = (players.data ?? [])
      .filter((row: any) => !String(row.madden_player_id ?? "").startsWith(IS_CUSTOM_PROSPECT_PREFIX))
      .filter((row: any) => !existingPlayerIds.has(String(row.id)))
      .slice(0, PLAYERS_PER_TEAM);

    for (const player of eligible) {
      const { handle, displayName } = handleForPlayerName(player.full_name);
      const { traits, tonePraiseWeight } = generatePersonaTraits(`${leagueId}:${player.id}`);
      rows.push({
        league_id: leagueId, player_id: String(player.id), team_id: teamId,
        handle, display_name: displayName, traits, tone_praise_weight: tonePraiseWeight,
      });
    }
  }

  if (!rows.length) return;
  await supabase.from("rec_immortality_player_personas").upsert(rows, { onConflict: "league_id,player_id", ignoreDuplicates: true });
}

export type PlayerPersona = {
  playerId: string;
  handle: string;
  displayName: string;
  traits: string[];
  tonePraiseWeight: number;
  avatarUrl: string | null;
};

/** Looked up by tweet-generation.service.ts when choosing a player-chatter author -- a curated
 * top-5-per-team player gets their persisted voice/tone/avatar instead of the fully ad-hoc random
 * tone every other roster player still gets. */
export async function playerPersonaFor(leagueId: string, playerId: string): Promise<PlayerPersona | null> {
  const row = await supabase.from("rec_immortality_player_personas")
    .select("player_id,handle,display_name,traits,tone_praise_weight,avatar_url")
    .eq("league_id", leagueId).eq("player_id", playerId).maybeSingle();
  if (!row.data) return null;
  return {
    playerId: String(row.data.player_id),
    handle: String(row.data.handle),
    displayName: String(row.data.display_name),
    traits: (row.data.traits ?? []) as string[],
    tonePraiseWeight: Number(row.data.tone_praise_weight ?? 0.5),
    avatarUrl: row.data.avatar_url ? String(row.data.avatar_url) : null,
  };
}

/** Avatar-only lookup by handle -- used at post time (sweepImmortalityTweetQueue) once the
 * static host/generic catalogs have already missed, since a persona's handle is dynamic. */
export async function playerPersonaAvatarForHandle(leagueId: string, handle: string): Promise<string | null> {
  const row = await supabase.from("rec_immortality_player_personas")
    .select("avatar_url").eq("league_id", leagueId).eq("handle", handle).maybeSingle();
  return row.data?.avatar_url ? String(row.data.avatar_url) : null;
}
