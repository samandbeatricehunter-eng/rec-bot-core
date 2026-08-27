import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createStreamDirectUpload, enableStreamDownload, streamPlaybackUrls } from "../../lib/cloudflare-stream.js";
import { supabase } from "../../lib/supabase.js";
import { parseScorebugFrameAuto } from "../scorebug-ocr/scorebug-parser.js";

const execFileAsync = promisify(execFile);
const activeCaptures = new Map<string, ChildProcess>();
let processing = false;

// Deliberately code-owned production package. Replacing these four files changes the league's
// recap identity without exposing a per-league UI/configuration surface.
const RECAP_ASSETS = {
  intro: path.resolve(process.cwd(), "assets/weekly-recap/intro.mp4"),
  outro: path.resolve(process.cwd(), "assets/weekly-recap/outro.mp4"),
  overlay: path.resolve(process.cwd(), "assets/weekly-recap/overlay.png"),
  music: path.resolve(process.cwd(), "assets/weekly-recap/music.mp3"),
} as const;
const WORK_DIR = path.resolve(process.env.STREAM_OCR_WORK_DIR?.trim() || ".rec-stream-ocr");
const FFMPEG = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN?.trim() || "ffprobe";
const RESOLVER = process.env.STREAM_RESOLVER_BIN?.trim() || "yt-dlp";

function missingTable(error: any) {
  return ["42P01", "PGRST205"].includes(String(error?.code ?? ""));
}

async function commandAvailable(command: string) {
  try { await execFileAsync(command, ["-version"], { timeout: 10_000 }); return true; }
  catch { return false; }
}

export async function enqueueStreamAutoclip(input: { sessionId: string; leagueId: string; gameId: string; streamUrl: string }) {
  const result = await supabase.from("rec_stream_capture_jobs").upsert({
    streaming_session_id: input.sessionId,
    league_id: input.leagueId,
    game_id: input.gameId,
    stream_url: input.streamUrl,
    status: "pending",
    updated_at: new Date().toISOString(),
  }, { onConflict: "streaming_session_id", ignoreDuplicates: true });
  if (result.error && !missingTable(result.error)) throw result.error;
}

export async function requestStreamAutoclipStop(sessionId: string) {
  const result = await supabase.from("rec_stream_capture_jobs").update({ status: "stop_requested", updated_at: new Date().toISOString() })
    .eq("streaming_session_id", sessionId).in("status", ["pending", "capturing"]);
  if (result.error && !missingTable(result.error)) throw result.error;
  activeCaptures.get(sessionId)?.kill("SIGINT");
}

async function resolveMediaUrl(streamUrl: string) {
  const { stdout } = await execFileAsync(RESOLVER, ["--no-playlist", "-f", "best[height<=1080]/best", "--get-url", streamUrl], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const resolved = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!resolved) throw new Error("The stream resolver returned no playable media URL.");
  return resolved;
}

async function startCapture(job: any) {
  if (activeCaptures.has(job.streaming_session_id)) return;
  const configured = await Promise.all([commandAvailable(FFMPEG), commandAvailable(RESOLVER)]);
  if (configured.some((ready) => !ready)) {
    await supabase.from("rec_stream_capture_jobs").update({
      status: "awaiting_configuration",
      last_error: `Install ${FFMPEG} and ${RESOLVER} on the API image (or set FFMPEG_BIN / STREAM_RESOLVER_BIN).`,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return;
  }
  await mkdir(WORK_DIR, { recursive: true });
  const capturePath = path.join(WORK_DIR, `${job.id}.mkv`);
  const mediaUrl = await resolveMediaUrl(job.stream_url);
  const child = spawn(FFMPEG, ["-nostdin", "-y", "-i", mediaUrl, "-map", "0:v:0", "-map", "0:a?", "-c", "copy", capturePath], { stdio: ["ignore", "ignore", "pipe"] });
  activeCaptures.set(job.streaming_session_id, child);
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  await supabase.from("rec_stream_capture_jobs").update({ status: "capturing", capture_path: capturePath, started_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
  child.once("close", async (code) => {
    activeCaptures.delete(job.streaming_session_id);
    const exists = await stat(capturePath).then((item) => item.size > 0).catch(() => false);
    await supabase.from("rec_stream_capture_jobs").update({
      status: exists ? "processing" : "retry",
      ended_at: new Date().toISOString(),
      last_error: exists ? null : `FFmpeg capture exited ${code ?? "without a code"}: ${stderr}`,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
  });
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

async function processCapture(job: any) {
  if (!job.capture_path) throw new Error("Capture job has no recording path.");
  const game = await supabase.from("rec_games").select("season_number,week_number").eq("id", job.game_id).maybeSingle();
  if (!game.data) throw new Error("Capture game no longer exists.");
  const duration = await durationSeconds(job.capture_path);
  let previous: { away: number; home: number } | null = null;
  const events: Array<{ second: number; parsed: Awaited<ReturnType<typeof parseScorebugFrameAuto>> }> = [];
  for (let second = 3; second < duration; second += 3) {
    const frame = await outputBuffer(FFMPEG, ["-loglevel", "error", "-ss", String(second), "-i", job.capture_path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"]);
    const parsed = await parseScorebugFrameAuto(frame);
    if (!parsed.isLiveScorebug || parsed.awayScore == null || parsed.homeScore == null) continue;
    if (previous && (parsed.awayScore > previous.away || parsed.homeScore > previous.home)) events.push({ second, parsed });
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
      ocr_payload: event.parsed,
    }, { onConflict: "capture_job_id,event_second,event_type" });
  }
  await supabase.from("rec_stream_capture_jobs").update({ status: "completed", last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
}

export async function enqueueWeeklyHighlightRecap(input: { leagueId: string; seasonNumber: number; weekNumber: number }) {
  const result = await supabase.from("rec_weekly_recap_jobs").upsert({ ...input, status: "pending", updated_at: new Date().toISOString() }, { onConflict: "league_id,season_number,week_number", ignoreDuplicates: true });
  if (result.error && !missingTable(result.error)) throw result.error;
}

async function processRecap(job: any) {
  for (const asset of Object.values(RECAP_ASSETS)) if (!await stat(asset).then(() => true).catch(() => false)) {
    await supabase.from("rec_weekly_recap_jobs").update({ status: "awaiting_assets", last_error: `Missing hardcoded recap asset: ${asset}`, updated_at: new Date().toISOString() }).eq("id", job.id);
    return;
  }
  const clips = await supabase.from("rec_stream_event_clips").select("id,cloudflare_stream_uid,event_second").eq("league_id", job.league_id).eq("season_number", job.season_number).eq("week_number", job.week_number).not("cloudflare_stream_uid", "is", null).order("event_second").limit(12);
  if (!clips.data?.length) {
    await supabase.from("rec_weekly_recap_jobs").update({ status: "completed", last_error: "No OCR score-change clips were available for this week.", updated_at: new Date().toISOString() }).eq("id", job.id);
    return;
  }
  await supabase.from("rec_stream_event_clips").update({ selected_for_recap: true }).in("id", clips.data.map((clip) => clip.id));
  const downloaded: string[] = [];
  for (const [index, clip] of clips.data.entries()) {
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

  const videos = [RECAP_ASSETS.intro, ...downloaded, RECAP_ASSETS.outro];
  const output = path.join(WORK_DIR, `${job.id}-weekly-recap.mp4`);
  const args: string[] = ["-y"];
  for (const video of videos) args.push("-i", video);
  const overlayIndex = videos.length;
  const musicIndex = videos.length + 1;
  args.push("-loop", "1", "-i", RECAP_ASSETS.overlay, "-stream_loop", "-1", "-i", RECAP_ASSETS.music);
  const videoFilters = videos.map((_, index) => `[${index}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30,setsar=1,setpts=PTS-STARTPTS[v${index}]`);
  const concatInputs = videos.map((_, index) => `[v${index}]`).join("");
  const filter = `${videoFilters.join(";")};${concatInputs}concat=n=${videos.length}:v=1:a=0[base];[base][${overlayIndex}:v]overlay=0:0:format=auto[v]`;
  args.push("-filter_complex", filter, "-map", "[v]", "-map", `${musicIndex}:a:0`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", output);
  await execFileAsync(FFMPEG, args, { timeout: 20 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  const media = await uploadVideo(output, { name: `REC weekly recap S${job.season_number} W${job.week_number}`, leagueId: job.league_id }, 20 * 60);
  await supabase.from("rec_weekly_recap_jobs").update({ status: "completed", output_stream_uid: media.uid, playback_url: media.playbackUrl, last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
}

export async function runStreamAutoclipSweep() {
  const stranded = await supabase.from("rec_stream_capture_jobs").select("id,streaming_session_id,status,capture_path").in("status", ["capturing", "stop_requested"]);
  if (!stranded.error) for (const job of stranded.data ?? []) {
    if (activeCaptures.has(job.streaming_session_id)) continue;
    const hasCapture = job.capture_path ? await stat(job.capture_path).then((item) => item.size > 0).catch(() => false) : false;
    await supabase.from("rec_stream_capture_jobs").update({ status: hasCapture ? "processing" : "retry", updated_at: new Date().toISOString() }).eq("id", job.id);
  }
  const pending = await supabase.from("rec_stream_capture_jobs").select("*").in("status", ["pending", "retry"]).order("created_at").limit(2);
  if (pending.error) { if (missingTable(pending.error)) return; throw pending.error; }
  for (const job of pending.data ?? []) await startCapture(job).catch(async (error) => {
    await supabase.from("rec_stream_capture_jobs").update({ status: "retry", attempt_count: Number(job.attempt_count ?? 0) + 1, last_error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }).eq("id", job.id);
  });
  if (processing) return;
  const ready = await supabase.from("rec_stream_capture_jobs").select("*").eq("status", "processing").order("ended_at").limit(1).maybeSingle();
  if (ready.data) {
    processing = true;
    try { await processCapture(ready.data); }
    catch (error) { await supabase.from("rec_stream_capture_jobs").update({ status: "processing", attempt_count: Number(ready.data.attempt_count ?? 0) + 1, last_error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }).eq("id", ready.data.id); }
    finally { processing = false; }
  }
  const recap = await supabase.from("rec_weekly_recap_jobs").select("*").in("status", ["pending", "retry"]).order("created_at").limit(1).maybeSingle();
  if (recap.data) await processRecap(recap.data).catch(async (error) => {
    await supabase.from("rec_weekly_recap_jobs").update({ status: "retry", attempt_count: Number(recap.data.attempt_count ?? 0) + 1, last_error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }).eq("id", recap.data.id);
  });
}
