import { randomUUID } from "node:crypto";
import {
  HIGHLIGHT_MAX_DURATION_SECONDS,
  HIGHLIGHT_MAX_HEIGHT,
  createStreamDirectUpload,
  deleteStreamVideo,
  streamPlaybackUrls,
} from "../../lib/cloudflare-stream.js";
import { ApiError } from "../../lib/errors.js";
import { bestEffort } from "../../lib/best-effort.js";
import { getPgPool } from "../../db/client.js";
import { formatTournamentPlayerName } from "@rec/shared";

const DURATION_REJECT_MESSAGE =
  "Clip longer than 45 seconds. Crop to 45 seconds or less and upload again.";

async function loadMatch(tournamentId: string, matchId: string) {
  const result = await getPgPool().query(
    `select * from rec_site_tournament_matches where id = $1 and tournament_id = $2`,
    [matchId, tournamentId],
  );
  const match = result.rows[0] as {
    id: string;
    tournament_id: string;
    player_a_user_id: string | null;
    player_b_user_id: string | null;
  } | undefined;
  if (!match) throw new ApiError(404, "Match not found.");
  return match;
}

export async function createTournamentHighlightDirectUpload(input: {
  recUserId: string;
  isAdmin: boolean;
  tournamentId: string;
  matchId: string;
  fileName?: string | null;
}) {
  const match = await loadMatch(input.tournamentId, input.matchId);
  const inMatch = input.recUserId === match.player_a_user_id || input.recUserId === match.player_b_user_id;
  if (!input.isAdmin && !inMatch) throw new ApiError(403, "Only a player in this match can upload highlights.");
  const count = await getPgPool().query(
    `
      select count(*)::int as n
      from rec_site_tournament_highlights
      where match_id = $1 and user_id = $2 and status <> 'rejected' and media_status <> 'failed'
    `,
    [match.id, input.recUserId],
  );
  if (Number(count.rows[0]?.n ?? 0) >= 2) {
    throw new ApiError(409, "Each player can submit 2 highlights per match.");
  }
  const highlightId = randomUUID();
  const stream = await createStreamDirectUpload({
    maxDurationSeconds: HIGHLIGHT_MAX_DURATION_SECONDS,
    meta: {
      name: input.fileName?.slice(0, 120) || `tournament-highlight-${highlightId}`,
      highlightId,
      tournamentId: input.tournamentId,
      matchId: match.id,
      kind: "site_tournament",
    },
  });
  try {
    await getPgPool().query(
      `
        insert into rec_site_tournament_highlights
          (id, tournament_id, match_id, user_id, url, status, cloudflare_stream_uid, storage_provider, media_status)
        values ($1, $2, $3, $4, null, 'pending', $5, 'cloudflare_stream', 'uploading')
      `,
      [highlightId, input.tournamentId, match.id, input.recUserId, stream.uid],
    );
  } catch (error) {
    await bestEffort("stream.delete_orphan_on_insert_failure", () => deleteStreamVideo(stream.uid), { entityId: stream.uid });
    throw error;
  }
  return {
    highlightId,
    uploadURL: stream.uploadURL,
    streamUid: stream.uid,
    maxDurationSeconds: HIGHLIGHT_MAX_DURATION_SECONDS,
    maxHeight: HIGHLIGHT_MAX_HEIGHT,
  };
}

export async function markTournamentHighlightUploadReceived(input: {
  recUserId: string;
  tournamentId: string;
  highlightId: string;
}) {
  const updated = await getPgPool().query(
    `
      update rec_site_tournament_highlights
      set media_status = 'processing'
      where id = $1 and tournament_id = $2 and user_id = $3 and media_status in ('uploading', 'processing')
      returning id, media_status
    `,
    [input.highlightId, input.tournamentId, input.recUserId],
  );
  if (!updated.rows[0]) throw new ApiError(404, "Highlight draft not found.");
  return { highlightId: updated.rows[0].id, mediaStatus: updated.rows[0].media_status };
}

export async function getTournamentHighlightUploadStatus(input: {
  recUserId: string;
  tournamentId: string;
  highlightId: string;
}) {
  const result = await getPgPool().query(
    `
      select id, media_status, playback_url, cloudflare_stream_uid, url
      from rec_site_tournament_highlights
      where id = $1 and tournament_id = $2
    `,
    [input.highlightId, input.tournamentId],
  );
  const row = result.rows[0] as {
    id: string;
    media_status: string;
    playback_url: string | null;
    cloudflare_stream_uid: string | null;
    url: string | null;
  } | undefined;
  if (!row) throw new ApiError(404, "Highlight not found.");
  const streamUid = row.cloudflare_stream_uid;
  return {
    highlightId: row.id,
    mediaStatus: row.media_status,
    playbackUrl: row.playback_url ?? row.url,
    streamUid,
    iframeUrl: streamUid ? streamPlaybackUrls(streamUid).iframe : null,
    failureReason: row.media_status === "failed" ? DURATION_REJECT_MESSAGE : null,
  };
}

type StreamWebhookBody = {
  uid?: string;
  readyToStream?: boolean;
  duration?: number;
  status?: { state?: string; errorReasonCode?: string; errorReasonText?: string };
  playback?: { hls?: string };
  input?: { height?: number; duration?: number };
};

function isDurationReject(body: StreamWebhookBody): boolean {
  const code = String(body.status?.errorReasonCode ?? "").toUpperCase();
  const text = String(body.status?.errorReasonText ?? "").toLowerCase();
  if (code.includes("DURATION") || text.includes("duration") || text.includes("maxduration")) return true;
  const duration = Number(body.duration ?? body.input?.duration ?? 0);
  return Number.isFinite(duration) && duration > HIGHLIGHT_MAX_DURATION_SECONDS;
}

export async function applyTournamentStreamWebhook(body: StreamWebhookBody): Promise<{
  ok: true;
  matched: boolean;
  mediaStatus?: string;
  reason?: string;
}> {
  const uid = body.uid?.trim();
  if (!uid) return { ok: true, matched: false };
  const result = await getPgPool().query(
    `select id from rec_site_tournament_highlights where cloudflare_stream_uid = $1`,
    [uid],
  );
  const row = result.rows[0] as { id: string } | undefined;
  if (!row) return { ok: true, matched: false };

  const state = String(body.status?.state ?? "").toLowerCase();
  if (state === "error" || isDurationReject(body)) {
    await getPgPool().query(
      `update rec_site_tournament_highlights set media_status = 'failed', status = 'rejected' where id = $1`,
      [row.id],
    );
    await deleteStreamVideo(uid).catch((error) => {
      console.error(`[ERROR] Failed to delete rejected tournament Stream video ${uid}:`, error);
    });
    return {
      ok: true,
      matched: true,
      mediaStatus: "failed",
      reason: isDurationReject(body) ? DURATION_REJECT_MESSAGE : undefined,
    };
  }
  if (state === "ready" || body.readyToStream) {
    const urls = streamPlaybackUrls(uid);
    const playbackUrl = body.playback?.hls ?? urls.hls;
    await getPgPool().query(
      `
        update rec_site_tournament_highlights
        set media_status = 'ready', playback_url = $2, url = $2
        where id = $1
      `,
      [row.id, playbackUrl],
    );
    return { ok: true, matched: true, mediaStatus: "ready" };
  }
  await getPgPool().query(
    `update rec_site_tournament_highlights set media_status = 'processing' where id = $1 and media_status in ('uploading', 'processing')`,
    [row.id],
  );
  return { ok: true, matched: true, mediaStatus: "processing" };
}

export async function listTournamentStreamHighlights(input: {
  tournamentId: string;
  recUserId: string;
  isAdmin: boolean;
}) {
  const rows = await getPgPool().query(
    `
      select
        h.id, h.match_id, h.user_id, h.url, h.playback_url, h.status, h.media_status,
        h.cloudflare_stream_uid, h.created_at, u.username, u.display_name, e.gamer_tag,
        e.team_name, e.team_abbr,
        t.title as tournament_title,
        a.username as a_username, a.display_name as a_display_name,
        b.username as b_username, b.display_name as b_display_name,
        ea.team_name as a_team_name, eb.team_name as b_team_name,
        m.player_a_user_id, m.player_b_user_id
      from rec_site_tournament_highlights h
      inner join rec_users u on u.id = h.user_id
      inner join rec_site_tournaments t on t.id = h.tournament_id
      inner join rec_site_tournament_matches m on m.id = h.match_id
      left join rec_site_tournament_entrants e
        on e.tournament_id = h.tournament_id and e.user_id = h.user_id
      left join rec_users a on a.id = m.player_a_user_id
      left join rec_users b on b.id = m.player_b_user_id
      left join rec_site_tournament_entrants ea
        on ea.tournament_id = h.tournament_id and ea.user_id = m.player_a_user_id
      left join rec_site_tournament_entrants eb
        on eb.tournament_id = h.tournament_id and eb.user_id = m.player_b_user_id
      where h.tournament_id = $1
        and (
          (h.status = 'approved' and h.media_status = 'ready')
          or h.user_id = $2
          or $3
        )
      order by h.created_at desc
    `,
    [input.tournamentId, input.recUserId, input.isAdmin],
  );
  return {
    highlights: rows.rows.map((row) => {
      const home = [row.a_team_name, formatTournamentPlayerName(row.a_username, row.a_display_name, null)].filter(Boolean).join(" · ");
      const away = [row.b_team_name, formatTournamentPlayerName(row.b_username, row.b_display_name, null)].filter(Boolean).join(" · ");
      const matchupLabel = away && home ? `${away} at ${home}` : home || away || "Matchup";
      const streamUid = row.cloudflare_stream_uid as string | null;
      return {
        id: row.id,
        matchId: row.match_id,
        userId: row.user_id,
        url: row.playback_url ?? row.url,
        playbackUrl: row.playback_url ?? row.url,
        iframeUrl: streamUid ? streamPlaybackUrls(streamUid).iframe : null,
        streamUid,
        status: row.status,
        mediaStatus: row.media_status,
        createdAt: row.created_at,
        displayName: formatTournamentPlayerName(row.username, row.display_name, row.gamer_tag),
        teamName: row.team_name ?? null,
        tournamentTitle: row.tournament_title,
        matchupLabel,
        label: `${row.tournament_title} · ${matchupLabel}`,
        isYou: row.user_id === input.recUserId,
      };
    }),
  };
}
