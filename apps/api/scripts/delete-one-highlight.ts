// One-off: delete a single mis-tagged/duplicate highlight (Cloudflare Stream asset + DB row).
//   pnpm --filter @rec/api exec tsx scripts/delete-one-highlight.ts <highlightPostId>
import { deleteStreamVideo } from "../src/lib/cloudflare-stream.js";
import { supabase } from "../src/lib/supabase.js";

const id = process.argv[2];
if (!id) throw new Error("Usage: delete-one-highlight.ts <highlightPostId>");

async function main() {
  const post = await supabase.from("rec_highlight_posts").select("id,cloudflare_stream_uid").eq("id", id).maybeSingle();
  if (post.error) throw post.error;
  if (!post.data) throw new Error("Highlight post not found.");

  if (post.data.cloudflare_stream_uid) {
    try {
      await deleteStreamVideo(post.data.cloudflare_stream_uid);
      console.log(`Deleted Stream asset ${post.data.cloudflare_stream_uid}`);
    } catch (error) {
      console.error("Failed to delete Stream asset (continuing):", error);
    }
  }

  const updated = await supabase
    .from("rec_highlight_posts")
    .update({ media_status: "deleted", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updated.error) throw updated.error;
  console.log(`Marked highlight post ${id} as deleted.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
