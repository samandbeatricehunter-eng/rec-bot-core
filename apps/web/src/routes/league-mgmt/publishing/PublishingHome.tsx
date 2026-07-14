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
  const [mediaArticle, setMediaArticle] = useState({ title: "", body: "", imageUrl: "", immediatePost: false });
  const [busy, setBusy] = useState<"announcement" | "story" | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
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
    </div>
  </div>;
}
