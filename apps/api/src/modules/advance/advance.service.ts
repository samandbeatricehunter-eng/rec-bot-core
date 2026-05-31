import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueForGuild } from "../team-ownership/team-ownership.service.js";

type AdvanceLeagueInput = {
  guildId: string;
  requestedByDiscordId: string;
  nextAdvanceAtIso: string;
  nextAdvanceTimezone: string;
};

function buildAnnouncement(previousWeek: number | null, nextWeek: number | null, nextAdvanceAtIso: string, timezone: string) {
  const date = new Date(nextAdvanceAtIso);
  const formattedDate = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone
  });
  const formattedTime = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: timezone
  });

  return [
    `Week ${previousWeek ?? "?"} → Week ${nextWeek ?? "?"} Advance Complete`,
    "",
    "Next Advance:",
    formattedDate,
    formattedTime
  ].join("\n");
}

export async function advanceLeagueWeek(input: AdvanceLeagueInput) {
  const { server, league } = await getCurrentLeagueForGuild(input.guildId);

  const state = await supabase
    .from("rec_league_state")
    .select("*")
    .eq("league_id", league.id)
    .maybeSingle();

  if (state.error) {
    throw new ApiError(500, "Failed to load league state.", state.error);
  }

  const previousWeek = state.data?.current_week ?? 1;
  const nextWeek = previousWeek + 1;

  const updated = await supabase
    .from("rec_league_state")
    .upsert({
      league_id: league.id,
      server_id: server.id,
      current_week: nextWeek,
      next_advance_at: input.nextAdvanceAtIso,
      next_advance_timezone: input.nextAdvanceTimezone,
      updated_at: new Date().toISOString()
    }, { onConflict: "league_id" })
    .select("*")
    .single();

  if (updated.error) {
    throw new ApiError(500, "Failed to advance league state.", updated.error);
  }

  return {
    league,
    server,
    previousWeek,
    nextWeek,
    nextAdvanceAtIso: input.nextAdvanceAtIso,
    nextAdvanceTimezone: input.nextAdvanceTimezone,
    announcement: buildAnnouncement(previousWeek, nextWeek, input.nextAdvanceAtIso, input.nextAdvanceTimezone),
    checklist: {
      verifyCurrentWeekImported: "pending",
      updateStandings: "pending",
      recalculateStrengthOfSchedule: "pending",
      recalculateCompetitorRatings: "pending",
      trainerActions: "pending",
      scoutActions: "pending",
      coinPayouts: "pending",
      createGameChannelPanels: "pending"
    }
  };
}
