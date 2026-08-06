import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import type { CommissionerPoll } from "../../../types/api.js";

function CommissionerPollsCard() {
  const { guildId, discordId } = useReadyAuth();
  const [polls, setPolls] = useState<CommissionerPoll[] | null>(null);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [durationHours, setDurationHours] = useState(24);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPolls() {
    try {
      const result = await recApi.listCommissionerPolls({ guildId });
      setPolls(result.polls);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to load polls."); }
  }

  useEffect(() => { void loadPolls(); }, [guildId]);

  function setOption(index: number, value: string) {
    setOptions((current) => current.map((option, i) => (i === index ? value : option)));
  }

  async function createPoll() {
    setBusy("create"); setError(null);
    try {
      await recApi.createCommissionerPoll({ guildId, discordId, question, options: options.filter((o) => o.trim()), durationHours });
      setQuestion(""); setOptions(["", ""]); setDurationHours(24);
      await loadPolls();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to create poll."); }
    finally { setBusy(null); }
  }

  async function closePoll(pollId: string) {
    setBusy(pollId); setError(null);
    try { await recApi.closeCommissionerPoll({ guildId, pollId }); await loadPolls(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to close poll."); }
    finally { setBusy(null); }
  }

  async function cancelPoll(pollId: string) {
    setBusy(pollId); setError(null);
    try { await recApi.cancelCommissionerPoll({ guildId, pollId }); await loadPolls(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to cancel poll."); }
    finally { setBusy(null); }
  }

  const validOptionCount = options.filter((o) => o.trim()).length;

  return <Card>
    <h2>Commissioner Polls</h2>
    <p className="form-hint">
      Posts to Campus Buzz for every member of this league to vote on directly — no Discord link required.
      If a voting-polls channel is configured, an informational mirror posts there too.
    </p>
    {error && <ErrorState message={error} />}
    <div className="form-field"><label className="form-label">Question</label><input className="form-input" maxLength={300} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should we vote on?" /></div>
    {options.map((option, index) => (
      <div className="form-field" key={index}>
        <label className="form-label">Option {index + 1}</label>
        <input className="form-input" maxLength={55} value={option} onChange={(event) => setOption(index, event.target.value)} />
      </div>
    ))}
    <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap" }}>
      {options.length < 10 && <Button variant="secondary" onClick={() => setOptions((current) => [...current, ""])}>Add Option</Button>}
      {options.length > 2 && <Button variant="secondary" onClick={() => setOptions((current) => current.slice(0, -1))}>Remove Last Option</Button>}
      <div className="form-field" style={{ maxWidth: 140 }}>
        <label className="form-label">Duration (hours)</label>
        <input className="form-input" type="number" min={1} max={720} value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))} />
      </div>
      <Button variant="tactical" disabled={busy !== null || !question.trim() || validOptionCount < 2} onClick={() => void createPoll()}>{busy === "create" ? "Posting…" : "Post Poll"}</Button>
    </div>

    {polls === null ? <p className="form-hint">Loading polls…</p> : polls.length === 0 ? <p className="form-hint">No polls yet.</p> : <div style={{ marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {polls.map((poll) => {
        const totalVotes = poll.totalVotes;
        return <div key={poll.id} style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", alignItems: "baseline" }}>
            <strong>{poll.question}</strong>
            <span className="form-hint" style={{ margin: 0 }}>{poll.status === "open" ? "Open" : poll.status === "closed" ? "Closed" : "Cancelled"}</span>
          </div>
          <div style={{ marginTop: "var(--space-2)", display: "flex", flexDirection: "column", gap: 6 }}>
            {poll.tally.map((option) => {
              const count = option.votes;
              const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
              return <div key={option.id}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)" }}><span>{option.text}</span><span>{count} vote{count === 1 ? "" : "s"} ({pct}%)</span></div>
                <div style={{ height: 6, borderRadius: 999, background: "color-mix(in srgb, var(--text-secondary) 20%, transparent)", overflow: "hidden" }}><div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: "var(--accent)" }} /></div>
              </div>;
            })}
          </div>
          {poll.status === "open" && <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)" }}>
            <Button variant="secondary" disabled={busy !== null} onClick={() => void closePoll(poll.id)}>{busy === poll.id ? "Closing…" : "Close Poll"}</Button>
            <Button variant="danger" disabled={busy !== null} onClick={() => void cancelPoll(poll.id)}>{busy === poll.id ? "Cancelling…" : "Cancel Poll"}</Button>
          </div>}
        </div>;
      })}
    </div>}
  </Card>;
}

export function PublishingHome() {
  const { guildId } = useReadyAuth();
  const [announcement, setAnnouncement] = useState({ title: "", body: "" });
  const [story, setStory] = useState({ headline: "", body: "", storyType: "headline" as "headline" | "article" });
  const [mediaArticle, setMediaArticle] = useState({ title: "", body: "", imageUrl: "", immediatePost: false });
  const [busy, setBusy] = useState<"announcement" | "story" | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptRange, setPromptRange] = useState({ weekFrom: 1, weekTo: 1 });
  const [promptText, setPromptText] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => {
    recApi.getAdvanceWeekGames(guildId).then((data) => {
      setPromptRange({ weekFrom: data.currentWeek, weekTo: data.currentWeek });
    }).catch(() => undefined);
  }, [guildId]);

  async function generatePrompt() {
    setPromptBusy(true); setError(null); setPromptCopied(false);
    try {
      const result = await recApi.getArticlePromptDigest({ guildId, ...promptRange });
      setPromptText(result.prompt);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to build the article prompt."); }
    finally { setPromptBusy(false); }
  }

  async function copyPrompt() {
    if (!promptText) return;
    try {
      await navigator.clipboard.writeText(promptText);
      setPromptCopied(true);
    } catch { /* clipboard may be unavailable — the text is still selectable in the textarea */ }
  }

  async function publishAnnouncement() {
    setBusy("announcement"); setError(null);
    try {
      await recApi.publishHubAnnouncement({ guildId, ...announcement });
      setAnnouncement({ title: "", body: "" }); setNotice("Announcement published to the League Hub.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to publish announcement."); }
    finally { setBusy(null); }
  }

  async function publishStory() {
    setBusy("story"); setError(null);
    try {
      await recApi.publishHubStory({ guildId, ...story });
      setStory({ headline: "", body: "", storyType: "headline" }); setNotice(story.storyType === "article" ? "Roundtable article published." : "Headline published.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to publish story."); }
    finally { setBusy(null); }
  }

  async function uploadMediaImage(file: File | null) {
    if (!file) return;
    setMediaBusy(true); setError(null);
    try {
      const result = await recApi.uploadHubMediaImage(guildId, file);
      setMediaArticle((current) => ({ ...current, imageUrl: result.url }));
      setNotice("Article image uploaded.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to upload image."); }
    finally { setMediaBusy(false); }
  }

  async function publishMediaArticle() {
    setMediaBusy(true); setError(null);
    try {
      const result = await recApi.publishCommissionerMediaArticle({ guildId, ...mediaArticle });
      setMediaArticle({ title: "", body: "", imageUrl: "", immediatePost: false });
      setNotice(result.published ? "Commissioner article posted to Headlines." : "Commissioner article scheduled for the next advance.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to save commissioner article."); }
    finally { setMediaBusy(false); }
  }

  return <div>
    <PageHeader title="League Publishing" subtitle="Publish official announcements, headlines, commissioner features, and REC Network articles." />
    {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}
    {error && <ErrorState message={error} />}
    <div className="publishing-grid">
      <Card><h2>Announcement</h2><p className="form-hint">Appears in the official Announcements section near the top of the Hub.</p>
        <div className="form-field"><label className="form-label">Title</label><input className="form-input" value={announcement.title} onChange={(event) => setAnnouncement({ ...announcement, title: event.target.value })} /></div>
        <div className="form-field"><label className="form-label">Announcement</label><textarea className="form-input" rows={7} value={announcement.body} onChange={(event) => setAnnouncement({ ...announcement, body: event.target.value })} /></div>
        <Button variant="tactical" disabled={busy !== null || !announcement.title.trim() || !announcement.body.trim()} onClick={() => void publishAnnouncement()}>{busy === "announcement" ? "Publishing..." : "Publish Announcement"}</Button>
      </Card>
      <Card><h2>Headline or Article</h2><p className="form-hint">Quick headlines stay in the feed. Articles open into a studio roundtable discussion.</p>
        <div className="segmented"><Button variant={story.storyType === "headline" ? "primary" : "secondary"} onClick={() => setStory({ ...story, storyType: "headline" })}>Quick Headline</Button><Button variant={story.storyType === "article" ? "primary" : "secondary"} onClick={() => setStory({ ...story, storyType: "article" })}>Roundtable Article</Button></div>
        <div className="form-field"><label className="form-label">Headline</label><input className="form-input" value={story.headline} onChange={(event) => setStory({ ...story, headline: event.target.value })} /></div>
        <div className="form-field"><label className="form-label">Story summary and facts</label><textarea className="form-input" rows={9} value={story.body} onChange={(event) => setStory({ ...story, body: event.target.value })} /></div>
        <Button variant="tactical" disabled={busy !== null || !story.headline.trim() || !story.body.trim()} onClick={() => void publishStory()}>{busy === "story" ? "Publishing..." : story.storyType === "article" ? "Publish Article" : "Publish Headline"}</Button>
      </Card>
      <Card><h2>Commissioner Feature Article</h2><p className="form-hint">Design-heavy article card with one optional image. Post now or stage it for the next advance.</p>
        <div className="form-field"><label className="form-label">Title</label><input className="form-input" value={mediaArticle.title} onChange={(event) => setMediaArticle({ ...mediaArticle, title: event.target.value })} /></div>
        <div className="form-field"><label className="form-label">Article body</label><textarea className="form-input" rows={10} value={mediaArticle.body} onChange={(event) => setMediaArticle({ ...mediaArticle, body: event.target.value })} /></div>
        <div className="form-field"><label className="form-label">Article image</label><input className="form-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadMediaImage(event.target.files?.[0] ?? null)} />{mediaArticle.imageUrl && <img className="media-image-preview" src={mediaArticle.imageUrl} alt="" />}</div>
        <label className="media-toggle"><input type="checkbox" checked={mediaArticle.immediatePost} onChange={(event) => setMediaArticle({ ...mediaArticle, immediatePost: event.target.checked })} /> Post immediately</label>
        <Button variant="tactical" disabled={mediaBusy || !mediaArticle.title.trim() || !mediaArticle.body.trim()} onClick={() => void publishMediaArticle()}>{mediaBusy ? "Saving..." : mediaArticle.immediatePost ? "Post Article" : "Schedule For Next Advance"}</Button>
      </Card>
      <Card>
        <h2>Provide Prompt</h2>
        <p className="form-hint">
          Builds a copy/paste prompt — results and power rankings for the selected weeks, plus the REC Network roundtable
          cast and each voice's writing assignment — for you to hand to an external AI tool. Paste the article it writes
          back into Headline or Article above.
        </p>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="form-field" style={{ maxWidth: 140 }}>
            <label className="form-label">From week</label>
            <input className="form-input" type="number" min={0} value={promptRange.weekFrom} onChange={(event) => setPromptRange({ ...promptRange, weekFrom: Number(event.target.value) })} />
          </div>
          <div className="form-field" style={{ maxWidth: 140 }}>
            <label className="form-label">To week</label>
            <input className="form-input" type="number" min={0} value={promptRange.weekTo} onChange={(event) => setPromptRange({ ...promptRange, weekTo: Number(event.target.value) })} />
          </div>
          <Button variant="secondary" disabled={promptBusy} onClick={() => void generatePrompt()}>{promptBusy ? "Building…" : "Provide Prompt"}</Button>
        </div>
        {promptText && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <textarea className="form-input" rows={14} readOnly value={promptText} onFocus={(event) => event.currentTarget.select()} />
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
              <Button variant="secondary" onClick={() => void copyPrompt()}>Copy to Clipboard</Button>
              {promptCopied && <span className="form-hint" style={{ margin: 0 }}>Copied.</span>}
            </div>
          </div>
        )}
      </Card>
      <RoundtableHostsCard />
      <CommissionerPollsCard />
    </div>
  </div>;
}

function RoundtableHostsCard() {
  const { guildId } = useReadyAuth();
  const [hosts, setHosts] = useState<Array<{ voice: string; displayName: string; role: string; personalityKey: string | null; isCustom: boolean }> | null>(null);
  const [personalities, setPersonalities] = useState<Array<{ key: string; label: string; description: string }>>([]);
  const [drafts, setDrafts] = useState<Record<string, { displayName: string; personalityKey: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const result = await recApi.getRoundtableHostConfig(guildId);
      setHosts(result.hosts);
      setPersonalities(result.personalities);
      setDrafts(Object.fromEntries(result.hosts.map((h) => [h.voice, { displayName: h.displayName, personalityKey: h.personalityKey ?? result.personalities[0]?.key ?? "" }])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to load roundtable hosts."); }
  }

  useEffect(() => { void load(); }, [guildId]);

  async function save(voice: string) {
    setBusy(voice); setError(null);
    try {
      const draft = drafts[voice];
      await recApi.updateRoundtableHost({ guildId, voice, displayName: draft.displayName, personalityKey: draft.personalityKey });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to save host."); }
    finally { setBusy(null); }
  }

  async function reset(voice: string) {
    setBusy(voice); setError(null);
    try { await recApi.resetRoundtableHost({ guildId, voice }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to reset host."); }
    finally { setBusy(null); }
  }

  async function randomizeName(voice: string) {
    setBusy(voice); setError(null);
    try {
      const result = await recApi.generateRoundtableHostName({ guildId, seed: `${voice}:${Date.now()}` });
      setDrafts((current) => ({ ...current, [voice]: { ...current[voice], displayName: result.fullName } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to generate a name."); }
    finally { setBusy(null); }
  }

  if (!hosts) return null;
  return <Card>
    <h2>Roundtable Hosts</h2>
    <p className="form-hint">
      Rename any of the 4 roundtable voices and assign them a personality — real-world sports analyst names are blocked.
      In this app's own auto-generated headlines, only the byline and persona label change. The personality's full
      description (how that voice actually thinks and writes) is included as a character brief in Provide Prompt below,
      for the external AI tool to actually follow.
    </p>
    {error && <ErrorState message={error} />}
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      {hosts.map((host) => {
        const draft = drafts[host.voice] ?? { displayName: host.displayName, personalityKey: "" };
        const selectedPersonality = personalities.find((p) => p.key === draft.personalityKey);
        return <div key={host.voice} style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="form-field" style={{ minWidth: 180 }}>
              <label className="form-label">Name ({host.voice})</label>
              <input className="form-input" maxLength={60} value={draft.displayName} onChange={(event) => setDrafts((current) => ({ ...current, [host.voice]: { ...draft, displayName: event.target.value } }))} />
            </div>
            <div className="form-field" style={{ minWidth: 220 }}>
              <label className="form-label">Personality</label>
              <select className="form-select" value={draft.personalityKey} onChange={(event) => setDrafts((current) => ({ ...current, [host.voice]: { ...draft, personalityKey: event.target.value } }))}>
                {personalities.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <Button variant="secondary" disabled={busy === host.voice} onClick={() => void randomizeName(host.voice)}>Random Name</Button>
            <Button variant="tactical" disabled={busy === host.voice || !draft.displayName.trim()} onClick={() => void save(host.voice)}>{busy === host.voice ? "Saving…" : "Save"}</Button>
            {host.isCustom && <Button variant="secondary" disabled={busy === host.voice} onClick={() => void reset(host.voice)}>Reset to Default</Button>}
          </div>
          {selectedPersonality && <p className="form-hint" style={{ margin: 0 }}>{selectedPersonality.description}</p>}
        </div>;
      })}
    </div>
  </Card>;
}
