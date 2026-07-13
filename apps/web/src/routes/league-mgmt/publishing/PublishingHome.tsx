import { useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

export function PublishingHome() {
  const { guildId } = useReadyAuth();
  const [announcement, setAnnouncement] = useState({ title: "", body: "" });
  const [story, setStory] = useState({ headline: "", body: "", storyType: "headline" as "headline" | "article" });
  const [busy, setBusy] = useState<"announcement" | "story" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return <div>
    <PageHeader title="League Publishing" subtitle="Publish official announcements, quick headlines, and full REC Network roundtable articles." />
    {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}
    {error && <ErrorState message={error} />}
    <div className="publishing-grid">
      <Card><h2>Announcement</h2><p className="form-hint">Appears in the official Announcements section near the top of the Hub.</p>
        <div className="form-field"><label className="form-label">Title</label><input className="form-input" value={announcement.title} onChange={(event) => setAnnouncement({ ...announcement, title: event.target.value })} /></div>
        <div className="form-field"><label className="form-label">Announcement</label><textarea className="form-input" rows={7} value={announcement.body} onChange={(event) => setAnnouncement({ ...announcement, body: event.target.value })} /></div>
        <Button variant="primary" disabled={busy !== null || !announcement.title.trim() || !announcement.body.trim()} onClick={() => void publishAnnouncement()}>{busy === "announcement" ? "Publishing…" : "Publish Announcement"}</Button>
      </Card>
      <Card><h2>Headline or Article</h2><p className="form-hint">Quick headlines stay in the feed. Articles open into a studio roundtable discussion.</p>
        <div className="segmented"><Button variant={story.storyType === "headline" ? "primary" : "secondary"} onClick={() => setStory({ ...story, storyType: "headline" })}>Quick Headline</Button><Button variant={story.storyType === "article" ? "primary" : "secondary"} onClick={() => setStory({ ...story, storyType: "article" })}>Roundtable Article</Button></div>
        <div className="form-field"><label className="form-label">Headline</label><input className="form-input" value={story.headline} onChange={(event) => setStory({ ...story, headline: event.target.value })} /></div>
        <div className="form-field"><label className="form-label">Story summary and facts</label><textarea className="form-input" rows={9} value={story.body} onChange={(event) => setStory({ ...story, body: event.target.value })} /></div>
        <Button variant="primary" disabled={busy !== null || !story.headline.trim() || !story.body.trim()} onClick={() => void publishStory()}>{busy === "story" ? "Publishing…" : story.storyType === "article" ? "Publish Article" : "Publish Headline"}</Button>
      </Card>
    </div>
  </div>;
}
