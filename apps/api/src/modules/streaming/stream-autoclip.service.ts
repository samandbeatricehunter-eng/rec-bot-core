import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createStreamDirectUpload, enableStreamDownload, streamPlaybackUrls } from "../../lib/cloudflare-stream.js";
import { supabase } from "../../lib/supabase.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { parseScorebugFrameAuto } from "../scorebug-ocr/scorebug-parser.js";

const execFileAsync = promisify(execFile);
const activeCaptures = new Map<string, ChildProcess>();
let processing = false;

// Deliberately code-owned production package. Replacing these files changes the league's recap
// identity without exposing a per-league UI/configuration surface. No outro -- the recap ends on
// the last highlight clip. `music` is a directory: one track is picked at random per recap run
// (see processRecap), not a single fixed file.
const RECAP_ASSETS = {
  intro: path.resolve(process.cwd(), "assets/weekly-recap/intro.mp4"),
  overlay: path.resolve(process.cwd(), "assets/weekly-recap/overlay.png"),
  musicDir: path.resolve(process.cwd(), "assets/weekly-recap/music"),
} as const;
const WORK_DIR = path.resolve(process.env.STREAM_OCR_WORK_DIR?.trim() || ".rec-stream-ocr");
const FFMPEG = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN?.trim() || "ffprobe";
const RESOLVER = process.env.STREAM_RESOLVER_BIN?.trim() || "yt-dlp";

// A stream's game may not have kicked off yet when a coach posts the link, so the resolver (and,
// once recording starts, the OCR check below) is allowed to keep failing for a while before this
// is treated as a real problem. Budget is measured against `phase_started_at`, which covers BOTH
// repeated resolve failures and a successful recording that never produces a usable scorebug
// frame -- either way, "no usable stream after this long" means the same thing. Phase 0 is the
// first window; if it runs out, the job waits out COOLDOWN_MS once, then gets exactly one more
// window (phase 1) before being abandoned for good.
const INITIAL_BUDGET_MS = 10 * 60_000;
const COOLDOWN_MS = 5 * 60_000;
const PROBE_INTERVAL_MS = 60_000;

function missingTable(error: any) {
  return ["42P01", "PGRST205"].includes(String(error?.code ?? ""));
}

// ffmpeg only understands single-dash flags (-version); yt-dlp is a strict GNU-style parser that
// clusters an unrecognized single-dash flag as combined short options -- "-version" got read as
// -v -e -r("sion"), landing on -r's (--limit-rate) argument and failing with a rate-limit error
// that has nothing to do with what was actually wrong. Each binary needs its own real flag.
async function commandAvailable(command: string, versionArg: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try { await execFileAsync(command, [versionArg], { timeout: 10_000 }); return { ok: true }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

async function updateJob(id: string, patch: Record<string, unknown>) {
  await supabase.from("rec_stream_capture_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

export async function enqueueStreamAutoclip(input: { sessionId: string; leagueId: string; gameId: string; streamUrl: string }) {
  const now = new Date().toISOString();
  const result = await supabase.from("rec_stream_capture_jobs").upsert({
    streaming_session_id: input.sessionId,
    league_id: input.leagueId,
    game_id: input.gameId,
    stream_url: input.streamUrl,
    status: "pending",
    phase: 0,
    phase_started_at: now,
    updated_at: now,
  }, { onConflict: "streaming_session_id", ignoreDuplicates: true });
  if (result.error && !missingTable(result.error)) throw result.error;
}

export async function requestStreamAutoclipStop(sessionId: string) {
  const result = await supabase.from("rec_stream_capture_jobs").update({ status: "stop_requested", updated_at: new Date().toISOString() })
    .eq("streaming_session_id", sessionId).in("status", ["pending", "capturing", "retry", "cooldown"]);
  if (result.error && !missingTable(result.error)) throw result.error;
  activeCaptures.get(sessionId)?.kill("SIGINT");
}

async function resolveMediaUrl(streamUrl: string) {
  const { stdout } = await execFileAsync(RESOLVER, ["--no-playlist", "-f", "best[height<=1080]/best", "--get-url", streamUrl], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const resolved = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!resolved) throw new Error("The stream resolver returned no playable media URL.");
  return resolved;
}

// Shared budget check for both "can't even resolve/start" and "recorded but nothing usable yet"
// failures -- see the constants' doc comment above for the phase/cooldown/abandon shape.
async function handleAttemptFailure(job: any, message: string) {
  const elapsed = Date.now() - new Date(job.phase_started_at).getTime();
  if (elapsed < INITIAL_BUDGET_MS) {
    await updateJob(job.id, { status: "retry", last_error: message, attempt_count: Number(job.attempt_count ?? 0) + 1 });
    return;
  }
  if (Number(job.phase ?? 0) === 0) {
    await updateJob(job.id, {
      status: "cooldown", cooldown_until: new Date(Date.now() + COOLDOWN_MS).toISOString(),
      last_error: `${message} (10-minute window used up -- waiting 5 minutes before one more try.)`,
    });
  } else {
    await updateJob(job.id, { status: "failed", last_error: `Abandoned after two attempts: ${message}` });
  }
}

async function startCapture(job: any) {
  if (activeCaptures.has(job.streaming_session_id)) return;
  const [ffmpegCheck, resolverCheck] = await Promise.all([commandAvailable(FFMPEG, "-version"), commandAvailable(RESOLVER, "--version")]);
  if (!ffmpegCheck.ok || !resolverCheck.ok) {
    const details = [!ffmpegCheck.ok ? `${FFMPEG}: ${ffmpegCheck.error}` : null, !resolverCheck.ok ? `${RESOLVER}: ${resolverCheck.error}` : null].filter(Boolean).join(" | ");
    await updateJob(job.id, { status: "awaiting_configuration", last_error: `Install ffmpeg and yt-dlp on the API image (or set FFMPEG_BIN / STREAM_RESOLVER_BIN). ${details}` });
    return;
  }

  let mediaUrl: string;
  try {
    mediaUrl = await resolveMediaUrl(job.stream_url);
  } catch (error) {
    await handleAttemptFailure(job, error instanceof Error ? error.message : "Stream resolver failed.");
    return;
  }

  await mkdir(WORK_DIR, { recursive: true });
  const capturePath = path.join(WORK_DIR, `${job.id}.mkv`);
  const child = spawn(FFMPEG, ["-nostdin", "-y", "-i", mediaUrl, "-map", "0:v:0", "-map", "0:a?", "-c", "copy", capturePath], { stdio: ["ignore", "ignore", "pipe"] });
  activeCaptures.set(job.streaming_session_id, child);
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  await updateJob(job.id, {
    status: "capturing", capture_path: capturePath, started_at: new Date().toISOString(), last_error: null,
    first_usable_frame_at: null, last_probe_at: null,
  });
  child.once("close", async (code) => {
    activeCaptures.delete(job.streaming_session_id);
    const exists = await stat(capturePath).then((item) => item.size > 0).catch(() => false);
    if (exists) {
      await updateJob(job.id, { status: "processing", ended_at: new Date().toISOString(), last_error: null });
      return;
    }
    // Nothing was captured (immediate disconnect, DRM, etc.) -- this counts as a failed attempt
    // against the same budget as a resolve failure, not a silent "processing" of an empty file.
    const fresh = await supabase.from("rec_stream_capture_jobs").select("*").eq("id", job.id).maybeSingle();
    if (fresh.data) await handleAttemptFailure(fresh.data, `FFmpeg capture exited ${code ?? "without a code"} with no data: ${stderr}`);
  });
}

// Spot-checks an in-progress recording by grabbing one live frame straight from the stream (not
// the growing capture file -- an unfinalized mkv's duration/seek behavior is unreliable while
// it's still being written) roughly once a minute, and gives up on this attempt once the phase
// budget elapses with no usable frame ever seen -- see the module doc comment for why this exists
// (a recording that never has usable OCR data would otherwise just run until the stream ends).
async function monitorCapturingJob(job: any) {
  if (job.first_usable_frame_at) return;
  const sinceProbe = job.last_probe_at ? Date.now() - new Date(job.last_probe_at).getTime() : Infinity;
  if (sinceProbe >= PROBE_INTERVAL_MS) {
    await updateJob(job.id, { last_probe_at: new Date().toISOString() });
    try {
      const mediaUrl = await resolveMediaUrl(job.stream_url);
      const frame = await outputBuffer(FFMPEG, ["-loglevel", "error", "-i", mediaUrl, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"]);
      const parsed = await parseScorebugFrameAuto(frame);
      if (parsed.isLiveScorebug && parsed.awayScore != null && parsed.homeScore != null) {
        await updateJob(job.id, { first_usable_frame_at: new Date().toISOString(), last_error: null });
        return;
      }
    } catch {
      // Transient (game hasn't kicked off, brief resolver hiccup) -- the elapsed check below
      // still governs whether this has gone on too long.
    }
  }

  const elapsed = Date.now() - new Date(job.phase_started_at).getTime();
  if (elapsed >= INITIAL_BUDGET_MS) {
    activeCaptures.get(job.streaming_session_id)?.kill("SIGINT");
    activeCaptures.delete(job.streaming_session_id);
    await handleAttemptFailure(job, "No usable scorebug frames detected in the first 10 minutes of recording.");
  }
}

async function promoteDueCooldowns() {
  const due = await supabase.from("rec_stream_capture_jobs").select("id").eq("status", "cooldown").lte("cooldown_until", new Date().toISOString());
  if (due.error) { if (!missingTable(due.error)) console.error("[ERROR] Failed to load cooldown stream capture jobs (non-fatal):", due.error); return; }
  for (const row of due.data ?? []) {
    await updateJob(row.id, {
      status: "retry", phase: 1, phase_started_at: new Date().toISOString(),
      cooldown_until: null, first_usable_frame_at: null, last_probe_at: null, capture_path: null,
      last_error: "Retrying after the 5-minute cooldown -- this is the final attempt.",
    });
  }
}

async function outputBuffer(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; const errors: Buffer[] = [];
    child.stdout?.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => errors.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(Buffer.concat(errors).toString("utf8").slice(-2000))));
  });
}

async function durationSeconds(file: string) {
  const { stdout } = await execFileAsync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeout: 20_000 });
  return Number(stdout.trim());
}

async function uploadVideo(file: string, meta: Record<string, string>, maxDurationSeconds: number) {
  const direct = await createStreamDirectUpload({ maxDurationSeconds, meta });
  const data = new FormData();
  data.append("file", new Blob([await readFile(file)], { type: "video/mp4" }), path.basename(file));
  const uploaded = await fetch(direct.uploadURL, { method: "POST", body: data, signal: AbortSignal.timeout(120_000) });
  if (!uploaded.ok) throw new Error(`Cloudflare Stream upload failed (${uploaded.status}).`);
  return { uid: direct.uid, playbackUrl: streamPlaybackUrls(direct.uid).watch };
}

function downDistanceText(value: Awaited<ReturnType<typeof parseScorebugFrameAuto>>["downDistance"]) {
  return value === "kickoff" ? "KICKOFF" : value ? `${value.down} & ${value.distance}` : null;
}

function parseClockSeconds(clock: string | null): number | null {
  const match = clock ? /^(\d{1,2}):(\d{2})$/.exec(clock.trim()) : null;
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// A clip's value is about game-deciding drama, not just "a score happened" -- a go-ahead score in
// the final minute of a one-score game is a very different clip than a garbage-time score in a
// blowout, even though both are "the score changed." Weighs: how many points, whether it changed
// or tied the lead, how close the game is after the play, and (only when the game is still
// actually in doubt) how little time is left. Used both to rank clips within a game and to decide
// which games get more of the recap's limited clip budget (see selectRecapClips).
export function computeClipValue(input: {
  quarter: string | null; gameClock: string | null;
  awayBefore: number; homeBefore: number; awayAfter: number; homeAfter: number;
}): number {
  const pointsScored = Math.max(0, (input.awayAfter - input.awayBefore) + (input.homeAfter - input.homeBefore));
  const marginBefore = Math.abs(input.awayBefore - input.homeBefore);
  const marginAfter = Math.abs(input.awayAfter - input.homeAfter);
  const leadBefore = Math.sign(input.awayBefore - input.homeBefore);
  const leadAfter = Math.sign(input.awayAfter - input.homeAfter);
  const leadChanged = marginBefore > 0 && leadAfter !== 0 && leadBefore !== leadAfter;
  const tyingPlay = marginBefore > 0 && marginAfter === 0;

  let value = pointsScored * 3;
  if (leadChanged) value += 25;
  if (tyingPlay) value += 20;
  value += Math.max(0, 15 - marginAfter);

  const quarterNum = input.quarter === "OT" ? 5 : Number(input.quarter ?? 0);
  const gameStillInDoubt = marginAfter <= 16; // roughly two scores -- a blowout gets no clutch bonus regardless of clock
  if (quarterNum >= 4 && gameStillInDoubt) {
    const secondsRemaining = input.quarter === "OT" ? 0 : (parseClockSeconds(input.gameClock) ?? 900);
    if (secondsRemaining <= 120) value += 30;
    else if (secondsRemaining <= 300) value += 20;
    else if (secondsRemaining <= 600) value += 10;
  }
  return Math.round(value * 10) / 10;
}

async function processCapture(job: any) {
  if (!job.capture_path) throw new Error("Capture job has no recording path.");
  const game = await supabase.from("rec_games").select("season_number,week_number").eq("id", job.game_id).maybeSingle();
  if (!game.data) throw new Error("Capture game no longer exists.");
  const duration = await durationSeconds(job.capture_path);
  let previous: { away: number; home: number } | null = null;
  const events: Array<{ second: number; parsed: Awaited<ReturnType<typeof parseScorebugFrameAuto>>; value: number }> = [];
  for (let second = 3; second < duration; second += 3) {
    const frame = await outputBuffer(FFMPEG, ["-loglevel", "error", "-ss", String(second), "-i", job.capture_path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"]);
    const parsed = await parseScorebugFrameAuto(frame);
    if (!parsed.isLiveScorebug || parsed.awayScore == null || parsed.homeScore == null) continue;
    if (previous && (parsed.awayScore > previous.away || parsed.homeScore > previous.home)) {
      const value = computeClipValue({
        quarter: parsed.quarter == null ? null : String(parsed.quarter), gameClock: parsed.gameClock,
        awayBefore: previous.away, homeBefore: previous.home, awayAfter: parsed.awayScore, homeAfter: parsed.homeScore,
      });
      events.push({ second, parsed, value });
    }
    previous = { away: parsed.awayScore, home: parsed.homeScore };
  }
  for (const [index, event] of events.entries()) {
    const clipPath = path.join(WORK_DIR, `${job.id}-event-${index}.mp4`);
    await execFileAsync(FFMPEG, ["-y", "-ss", String(Math.max(0, event.second - 12)), "-i", job.capture_path, "-t", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-movflags", "+faststart", clipPath], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    const media = await uploadVideo(clipPath, { name: `REC auto-clip W${game.data.week_number}`, captureJobId: job.id, gameId: job.game_id }, 45);
    await supabase.from("rec_stream_event_clips").upsert({
      capture_job_id: job.id, league_id: job.league_id, game_id: job.game_id,
      season_number: Number(game.data.season_number ?? 1), week_number: Number(game.data.week_number ?? 1),
      event_type: "score_change", event_second: event.second,
      away_score: event.parsed.awayScore, home_score: event.parsed.homeScore,
      quarter: event.parsed.quarter == null ? null : String(event.parsed.quarter), game_clock: event.parsed.gameClock,
      down_distance: downDistanceText(event.parsed.downDistance), yard_line: event.parsed.yardLine,
      possession: event.parsed.possession, cloudflare_stream_uid: media.uid, playback_url: media.playbackUrl,
      value_score: event.value, ocr_payload: event.parsed,
    }, { onConflict: "capture_job_id,event_second,event_type" });
  }
  await updateJob(job.id, { status: "completed", last_error: null });
}

export async function enqueueWeeklyHighlightRecap(input: { leagueId: string; seasonNumber: number; weekNumber: number; seasonStage: string }) {
  const result = await supabase.from("rec_weekly_recap_jobs").upsert({ ...input, status: "pending", updated_at: new Date().toISOString() }, { onConflict: "league_id,season_number,week_number", ignoreDuplicates: true });
  if (result.error && !missingTable(result.error)) throw result.error;
}

const RECAP_CLIP_BUDGET = 15;
type RecapClip = { id: string; cloudflare_stream_uid: string; event_second: number; game_id: string; value_score: number };
type RecapGame = { gameId: string; matchupType: "h2h" | "human_cpu" | "cpu"; isGotw: boolean };

const byValueDesc = (a: RecapClip, b: RecapClip) => b.value_score - a.value_score;
const byEventSecondAsc = (a: RecapClip, b: RecapClip) => a.event_second - b.event_second;

// Regular season: GOTW gets up to 3 clips, guaranteed, ahead of everything else. Every H2H game
// is guaranteed its own single best clip (a floor -- every real coach's game gets represented).
// Every H2H game's *second* clip and every Human-vs-CPU game's *only* clip then compete for
// whatever budget is left, purely on value_score -- so a Human-vs-CPU highlight that scored
// higher than a H2H game's second-best moment wins that slot instead, per the exact rule given:
// "don't include the lower scoring [h2h] one, instead skip it in favor of the higher-scoring
// human vs cpu highlight."
function selectRegularSeasonClips(games: RecapGame[], clipsByGame: Map<string, RecapClip[]>): RecapClip[] {
  const sortedFor = (gameId: string) => [...(clipsByGame.get(gameId) ?? [])].sort(byValueDesc);
  const gotwGames = games.filter((g) => g.isGotw);
  const h2hGames = games.filter((g) => !g.isGotw && g.matchupType === "h2h");
  const cpuGames = games.filter((g) => !g.isGotw && g.matchupType === "human_cpu");

  const gotw: RecapClip[] = [];
  let gotwBudget = 3;
  for (const g of gotwGames) {
    if (gotwBudget <= 0) break;
    const take = sortedFor(g.gameId).slice(0, gotwBudget);
    gotw.push(...take);
    gotwBudget -= take.length;
  }

  const h2hFloor: RecapClip[] = [];
  const bonusPool: RecapClip[] = [];
  for (const g of h2hGames) {
    if (gotw.length + h2hFloor.length >= RECAP_CLIP_BUDGET) break;
    const clips = sortedFor(g.gameId);
    if (clips[0]) h2hFloor.push(clips[0]);
    if (clips[1]) bonusPool.push(clips[1]);
  }
  for (const g of cpuGames) {
    const clips = sortedFor(g.gameId);
    if (clips[0]) bonusPool.push(clips[0]);
  }

  const remaining = Math.max(0, RECAP_CLIP_BUDGET - gotw.length - h2hFloor.length);
  bonusPool.sort(byValueDesc);
  const bonus = bonusPool.slice(0, remaining);

  return [
    ...gotw.sort(byEventSecondAsc),
    ...h2hFloor.sort(byEventSecondAsc),
    ...bonus.sort(byEventSecondAsc),
  ];
}

// Postseason: every game is treated as GOTW-caliber, but the caps come from the round instead --
// each round gets a [min, max] highlight range per game (fewer games survive each round, so each
// one earns more screen time), and the Super Bowl takes the whole budget for its one game. Every
// game in the round gets its min first (its best min clips, guaranteed), then any leftover budget
// goes to whichever game's next-best available clip scores highest, up to that game's max.
const POSTSEASON_ROUND_RULES: Record<string, [min: number, max: number]> = {
  wild_card: [2, 3],
  divisional: [3, 4],
  conference_championship: [7, 8],
  super_bowl: [0, RECAP_CLIP_BUDGET],
};

function selectPostseasonClips(games: RecapGame[], clipsByGame: Map<string, RecapClip[]>, rules: [number, number]): RecapClip[] {
  const [min, max] = rules;
  const roundGames = games.filter((g) => (clipsByGame.get(g.gameId)?.length ?? 0) > 0);
  const sortedByGame = new Map(roundGames.map((g) => [g.gameId, [...(clipsByGame.get(g.gameId) ?? [])].sort(byValueDesc)]));

  const allocation = new Map<string, number>();
  for (const g of roundGames) allocation.set(g.gameId, Math.min(min, sortedByGame.get(g.gameId)!.length));
  let remaining = RECAP_CLIP_BUDGET - [...allocation.values()].reduce((sum, n) => sum + n, 0);

  while (remaining > 0) {
    let bestGameId: string | null = null;
    let bestValue = -Infinity;
    for (const g of roundGames) {
      const clips = sortedByGame.get(g.gameId)!;
      const current = allocation.get(g.gameId)!;
      const cap = Math.min(max, clips.length);
      if (current >= cap) continue;
      const nextValue = clips[current].value_score;
      if (nextValue > bestValue) { bestValue = nextValue; bestGameId = g.gameId; }
    }
    if (!bestGameId) break;
    allocation.set(bestGameId, allocation.get(bestGameId)! + 1);
    remaining -= 1;
  }

  const selected: RecapClip[] = [];
  for (const g of roundGames) {
    const count = allocation.get(g.gameId) ?? 0;
    if (count) selected.push(...sortedByGame.get(g.gameId)!.slice(0, count).sort(byEventSecondAsc));
  }
  return selected;
}

async function selectRecapClips(job: any): Promise<RecapClip[] | null> {
  const allClips = await supabase.from("rec_stream_event_clips").select("id,cloudflare_stream_uid,event_second,game_id,value_score")
    .eq("league_id", job.league_id).eq("season_number", job.season_number).eq("week_number", job.week_number).not("cloudflare_stream_uid", "is", null);
  if (allClips.error) throw allClips.error;
  if (!allClips.data?.length) return null;
  const clips = allClips.data as RecapClip[];

  const gameIds = [...new Set(clips.map((c) => c.game_id))];
  const [gamesRes, gotwRes] = await Promise.all([
    supabase.from("rec_games").select("id,home_user_id,away_user_id").in("id", gameIds),
    supabase.from("rec_game_of_week_polls").select("game_id").eq("league_id", job.league_id).in("game_id", gameIds),
  ]);
  if (gamesRes.error) throw gamesRes.error;
  if (gotwRes.error) throw gotwRes.error;
  const gotwGameIds = new Set((gotwRes.data ?? []).map((row: any) => row.game_id));
  const games: RecapGame[] = (gamesRes.data ?? []).map((row: any) => ({
    gameId: row.id,
    matchupType: row.home_user_id && row.away_user_id ? "h2h" : (row.home_user_id || row.away_user_id) ? "human_cpu" : "cpu",
    isGotw: gotwGameIds.has(row.id),
  })).filter((g) => g.matchupType !== "cpu");

  const clipsByGame = new Map<string, RecapClip[]>();
  for (const clip of clips) clipsByGame.set(clip.game_id, [...(clipsByGame.get(clip.game_id) ?? []), clip]);

  const rules = POSTSEASON_ROUND_RULES[String(job.season_stage ?? "")];
  return rules ? selectPostseasonClips(games, clipsByGame, rules) : selectRegularSeasonClips(games, clipsByGame);
}

// The recap's matchup board shows final scores, so generating it before every game for the week
// has actually been scored would freeze some cards mid-game (or blank) -- wait instead. No time
// budget here (unlike stream capture): it's normal for a commissioner to review/approve box
// scores well after the advance itself completes, so this just keeps retrying on the regular
// sweep cadence until the week is genuinely done. Pure CPU-vs-CPU games need no score to "count."
async function allWeekScoresIn(leagueId: string, seasonNumber: number, weekNumber: number): Promise<boolean> {
  const seasonId = await resolveSeasonId(leagueId, seasonNumber).catch(() => null);
  let query = supabase.from("rec_games").select("home_user_id,away_user_id,home_score,away_score").eq("league_id", leagueId).eq("week_number", weekNumber);
  query = seasonId ? query.eq("season_id", seasonId) : query;
  const games = await query;
  if (games.error) throw games.error;
  const scorable = (games.data ?? []).filter((g: any) => g.home_user_id || g.away_user_id);
  return scorable.every((g: any) => g.home_score != null && g.away_score != null);
}

async function pickRandomMusicTrack(): Promise<string | null> {
  const files = await readdir(RECAP_ASSETS.musicDir).catch(() => [] as string[]);
  const tracks = files.filter((f) => /\.(mp3|m4a|wav)$/i.test(f));
  if (!tracks.length) return null;
  return path.join(RECAP_ASSETS.musicDir, tracks[Math.floor(Math.random() * tracks.length)]);
}

async function processRecap(job: any) {
  if (!await stat(RECAP_ASSETS.intro).then(() => true).catch(() => false) || !await stat(RECAP_ASSETS.overlay).then(() => true).catch(() => false)) {
    await supabase.from("rec_weekly_recap_jobs").update({ status: "awaiting_assets", last_error: "Missing hardcoded recap asset: intro.mp4 or overlay.png.", updated_at: new Date().toISOString() }).eq("id", job.id);
    return;
  }
  const musicTrack = await pickRandomMusicTrack();
  if (!musicTrack) {
    await supabase.from("rec_weekly_recap_jobs").update({ status: "awaiting_assets", last_error: "No music tracks found in assets/weekly-recap/music/.", updated_at: new Date().toISOString() }).eq("id", job.id);
    return;
  }

  if (!await allWeekScoresIn(job.league_id, job.season_number, job.week_number)) {
    await supabase.from("rec_weekly_recap_jobs").update({ status: "retry", last_error: "Waiting on box scores -- not every game this week has a final score yet.", updated_at: new Date().toISOString() }).eq("id", job.id);
    return;
  }

  const clips = await selectRecapClips(job);
  if (!clips) {
    await supabase.from("rec_weekly_recap_jobs").update({ status: "completed", last_error: "No OCR score-change clips were available for this week.", updated_at: new Date().toISOString() }).eq("id", job.id);
    return;
  }
  if (!clips.length) {
    await supabase.from("rec_weekly_recap_jobs").update({ status: "completed", last_error: "No clips scored highly enough to include in this week's recap.", updated_at: new Date().toISOString() }).eq("id", job.id);
    return;
  }
  await supabase.from("rec_stream_event_clips").update({ selected_for_recap: true }).in("id", clips.map((clip) => clip.id));

  // The "here's this week's slate" hold screen (GOTW/H2H/Human-vs-CPU matchup cards with final
  // scores, over black) sits between the intro and the first clip -- rendered fresh per recap
  // rather than baked into the hardcoded intro, since its content is different every week.
  const { renderWeeklyMatchupBoardPng } = await import("../../lib/weekly-matchup-board-render.js");
  const boardPath = path.join(WORK_DIR, `${job.id}-board.png`);
  let boardVideoPath: string | null = null;
  try {
    await writeFile(boardPath, await renderWeeklyMatchupBoardPng(job.league_id, job.week_number));
    boardVideoPath = path.join(WORK_DIR, `${job.id}-board.mp4`);
    await execFileAsync(FFMPEG, ["-y", "-loop", "1", "-i", boardPath, "-t", "6", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-vf", "fps=30", boardVideoPath], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    console.error("[WARN] Failed to render the weekly matchup board hold screen (non-fatal, recap continues without it):", error);
    boardVideoPath = null;
  }

  const downloaded: string[] = [];
  for (const [index, clip] of clips.entries()) {
    const download = await enableStreamDownload(String(clip.cloudflare_stream_uid));
    if (!download.ready) {
      await supabase.from("rec_weekly_recap_jobs").update({ status: "retry", last_error: "Selected clips are still encoding downloadable MP4s in Cloudflare Stream.", updated_at: new Date().toISOString() }).eq("id", job.id);
      return;
    }
    const response = await fetch(download.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Could not download selected recap clip (${response.status}).`);
    const local = path.join(WORK_DIR, `${job.id}-recap-clip-${index}.mp4`);
    await writeFile(local, Buffer.from(await response.arrayBuffer()));
    downloaded.push(local);
  }

  const videos = [RECAP_ASSETS.intro, ...(boardVideoPath ? [boardVideoPath] : []), ...downloaded];
  // Every segment's duration is either known outright (board hold = 6s, each extracted clip =
  // 30s, both fixed by the ffmpeg args that produced them) or cheap to ask ffprobe for (the
  // intro, which changes if the asset is ever swapped) -- computed up front so the music track's
  // fade-out can land exactly at the end of the final video instead of guessing.
  const introDuration = await durationSeconds(RECAP_ASSETS.intro).catch(() => 14);
  const totalDuration = introDuration + (boardVideoPath ? 6 : 0) + downloaded.length * 30;
  const fadeDuration = 3;
  const fadeStart = Math.max(0, totalDuration - fadeDuration);

  const output = path.join(WORK_DIR, `${job.id}-weekly-recap.mp4`);
  const args: string[] = ["-y"];
  for (const video of videos) args.push("-i", video);
  const overlayIndex = videos.length;
  const musicIndex = videos.length + 1;
  args.push("-loop", "1", "-i", RECAP_ASSETS.overlay, "-stream_loop", "-1", "-i", musicTrack);
  const videoFilters = videos.map((_, index) => `[${index}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30,setsar=1,setpts=PTS-STARTPTS[v${index}]`);
  const concatInputs = videos.map((_, index) => `[v${index}]`).join("");
  // loudnorm brings every track (they're not all mastered to the same level) to a consistent
  // broadcast-style loudness; afade tapers it out over the last 3 seconds instead of cutting off
  // hard when -shortest truncates the looped track to the video's length.
  const audioFilter = `[${musicIndex}:a]loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=${fadeStart.toFixed(2)}:d=${fadeDuration}[aout]`;
  const filter = `${videoFilters.join(";")};${concatInputs}concat=n=${videos.length}:v=1:a=0[base];[base][${overlayIndex}:v]overlay=0:0:format=auto[v];${audioFilter}`;
  args.push("-filter_complex", filter, "-map", "[v]", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", output);
  await execFileAsync(FFMPEG, args, { timeout: 20 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  const media = await uploadVideo(output, { name: `REC weekly recap S${job.season_number} W${job.week_number}`, leagueId: job.league_id }, 20 * 60);
  await supabase.from("rec_weekly_recap_jobs").update({ status: "completed", output_stream_uid: media.uid, playback_url: media.playbackUrl, last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
}

export async function runStreamAutoclipSweep() {
  await promoteDueCooldowns();

  const stranded = await supabase.from("rec_stream_capture_jobs").select("id,streaming_session_id,status,capture_path").in("status", ["capturing", "stop_requested"]);
  if (!stranded.error) for (const job of stranded.data ?? []) {
    if (activeCaptures.has(job.streaming_session_id)) continue;
    const hasCapture = job.capture_path ? await stat(job.capture_path).then((item) => item.size > 0).catch(() => false) : false;
    await updateJob(job.id, { status: hasCapture ? "processing" : "retry" });
  }

  const pending = await supabase.from("rec_stream_capture_jobs").select("*").in("status", ["pending", "retry"]).order("created_at").limit(2);
  if (pending.error) { if (missingTable(pending.error)) return; throw pending.error; }
  for (const job of pending.data ?? []) await startCapture(job).catch((error) => handleAttemptFailure(job, error instanceof Error ? error.message : String(error)));

  const capturing = await supabase.from("rec_stream_capture_jobs").select("*").eq("status", "capturing");
  if (!capturing.error) for (const job of capturing.data ?? []) await monitorCapturingJob(job).catch((error) => console.error("[ERROR] Failed to monitor stream capture job (non-fatal):", job.id, error));

  if (processing) return;
  const ready = await supabase.from("rec_stream_capture_jobs").select("*").eq("status", "processing").order("ended_at").limit(1).maybeSingle();
  if (ready.data) {
    processing = true;
    try { await processCapture(ready.data); }
    catch (error) { await updateJob(ready.data.id, { status: "processing", attempt_count: Number(ready.data.attempt_count ?? 0) + 1, last_error: error instanceof Error ? error.message : String(error) }); }
    finally { processing = false; }
  }
  const recap = await supabase.from("rec_weekly_recap_jobs").select("*").in("status", ["pending", "retry"]).order("created_at").limit(1).maybeSingle();
  if (recap.data) await processRecap(recap.data).catch(async (error) => {
    await supabase.from("rec_weekly_recap_jobs").update({ status: "retry", attempt_count: Number(recap.data.attempt_count ?? 0) + 1, last_error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }).eq("id", recap.data.id);
  });
}
