import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3, ClipboardList, Coins, Film, MessageCircle, Radio, Send, Share2 } from "lucide-react";
import { MatchupCard } from "../../components/matchups/MatchupCard.js";
import { MatchupPreview } from "../../components/matchups/MatchupPreview.js";
import { Button } from "../../components/ui/Button.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { useReadyAuth } from "../../lib/auth-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { HubMatchupDetail, HubMatchupGame, MatchupPreview as MatchupPreviewData } from "../../types/api.js";

// Matchup action toolbar. Visibility contract:
//  - The two coaches in the matchup see Box Score, Player Stats, Share Stream, and
//    Upload Highlight(s).
//  - Everyone else (spectators) sees Wagers instead — the participants cannot wager on
//    their own game.
// NOTE: uploads/streams currently flow through Discord, so those buttons are placeholders
// for now; Box Score / Player Stats / Wagers are scaffolded here pending their web flows.
function MatchupActions({ matchup }: { matchup: HubMatchupGame }) {
  const isParticipant = matchup.involvesMe;
  return (
    <div className="matchup-actions" role="group" aria-label="Matchup actions">
      {isParticipant ? (
        <>
          <button type="button" className="matchup-action" disabled title="Box score review is coming to the web soon.">
            <ClipboardList size={16} /> Box Score
          </button>
          <button type="button" className="matchup-action" disabled title="Player stats are coming to the web soon.">
            <BarChart3 size={16} /> Player Stats
          </button>
          <button type="button" className="matchup-action" disabled title="Share your stream in the Discord game channel for now.">
            <Share2 size={16} /> Share Stream
          </button>
          <button type="button" className="matchup-action" disabled title="Highlight uploads run through Discord for now.">
            <Film size={16} /> Upload Highlight(s)
          </button>
        </>
      ) : (
        <button type="button" className="matchup-action matchup-action--wager" disabled title="Wagering on this matchup is coming to the web soon.">
          <Coins size={16} /> Wagers
        </button>
      )}
    </div>
  );
}

export function MatchupDetailPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { guildId } = useReadyAuth();
  const [detail, setDetail] = useState<HubMatchupDetail | null>(null);
  const [preview, setPreview] = useState<MatchupPreviewData | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const load = useCallback(async () => {
    if (!gameId) return;
    try { setDetail(await recApi.getHubMatchupDetail({ guildId, gameId })); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to load matchup."); }
  }, [gameId, guildId]);
  useEffect(() => { void load(); const timer=window.setInterval(() => void load(),5000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => {
    if (!gameId) return;
    let active = true;
    recApi.getMatchupPreview({ guildId, gameId }).then((data) => { if (active) setPreview(data); }).catch(() => { if (active) setPreview(null); });
    return () => { active = false; };
  }, [gameId, guildId]);
  async function send() {
    if (!gameId || !body.trim()) return;
    setSending(true);
    try { await recApi.sendHubMatchupMessage({ guildId, gameId, body }); setBody(""); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to send message."); }
    finally { setSending(false); }
  }
  if (error && !detail) return <ErrorState message={error} />;
  if (!detail) return <LoadingState label="Loading matchup…" />;
  const apiBaseUrl=import.meta.env.VITE_REC_CORE_API_URL;
  return <main className="matchup-detail-page">
    <Link className="matchup-detail-back" to="/"><ArrowLeft size={18}/> Back to matchups</Link>
    <MatchupCard game={detail.matchup} featured />
    {preview && <MatchupPreview preview={preview} />}
    <MatchupActions matchup={detail.matchup} />
    <div className="matchup-detail-grid">
      <section className="matchup-detail-panel">
        <h2><Radio size={20}/> Active Streams</h2>
        {detail.matchup.streams.length ? detail.matchup.streams.map((stream) => <a className="matchup-stream-row" key={stream.streamLogId} href={`${apiBaseUrl}${stream.watchPath}`} target="_blank" rel="noreferrer"><span className="matchup-live-dot"/><strong>Watch {stream.teamName}</strong><small>{stream.viewCount} viewer{stream.viewCount===1?"":"s"}</small></a>) : <p>No active streams for this matchup.</p>}
      </section>
      <section className="matchup-detail-panel matchup-chat">
        <h2><MessageCircle size={20}/> Game Chat</h2>
        <div className="matchup-chat-messages">{detail.messages.length ? detail.messages.map((message) => <article key={message.id}><header><strong>{message.author_display_name}</strong><time>{new Date(message.created_at).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" })}</time></header><p>{message.body}</p></article>) : <p>Start the matchup conversation.</p>}</div>
        <form onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea className="form-input" value={body} maxLength={1000} rows={3} onChange={(event) => setBody(event.target.value)} placeholder="Message this matchup…"/><Button variant="primary" disabled={sending||!body.trim()}><Send size={16}/> Send</Button></form>
      </section>
    </div>
  </main>;
}
