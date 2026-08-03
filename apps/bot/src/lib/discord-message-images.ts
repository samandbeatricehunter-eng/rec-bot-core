import type { Message } from "discord.js";

const MAX_IMAGE_URLS = 5;

export type MessageImage = { url: string; mimeType: string };

/** Every static image worth bridging from a Discord message — real uploaded image files, plus
 * the image Discord auto-embeds for a pasted or GIF-picker-sent Tenor/Giphy link. Doesn't cover
 * "gifv" embeds' actual video/mp4 asset (only their static thumbnail) — the site's chat
 * attachment renderer is an <img>, not a video player, so an mp4 URL wouldn't render anyway.
 * Embeds don't carry a content-type, so those default to image/gif (the common case for a
 * GIF-picker send) rather than guessing a specific raster format that's more often wrong. */
export function extractMessageImages(message: Message): MessageImage[] {
  const images: MessageImage[] = [];
  const seen = new Set<string>();

  for (const attachment of message.attachments.values()) {
    if (!attachment.contentType?.startsWith("image/") || seen.has(attachment.url)) continue;
    seen.add(attachment.url);
    images.push({ url: attachment.url, mimeType: attachment.contentType });
  }

  for (const embed of message.embeds) {
    const url = embed.image?.url ?? embed.thumbnail?.url ?? null;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push({ url, mimeType: "image/gif" });
  }

  return images.slice(0, MAX_IMAGE_URLS);
}
