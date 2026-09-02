// Client-side headshot resize before upload, mirroring
// apps/web/src/routes/league-mgmt/manage-league/TeamRosterForm.tsx's readImageAsResizedBase64.
const HEADSHOT_MAX_DIMENSION = 600;
const HEADSHOT_MAX_BASE64 = 6_000_000; // ~4.5 MB binary, safely under the server's 5 MB cap

export const HEADSHOT_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Read + downscale an image file to a base64 payload the API can re-host via Cloudflare Images. */
export function readImageAsResizedBase64(file: File): Promise<{ contentType: string; imageBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read the image file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a valid image."));
      img.onload = () => {
        const scale = Math.min(1, HEADSHOT_MAX_DIMENSION / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Your browser can't resize this image here.")); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const preferred = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
        let dataUrl = canvas.toDataURL(preferred, preferred === "image/png" ? undefined : 0.9);
        if (dataUrl.length > HEADSHOT_MAX_BASE64) {
          for (const quality of [0.7, 0.5, 0.35]) {
            dataUrl = canvas.toDataURL("image/jpeg", quality);
            if (dataUrl.length <= HEADSHOT_MAX_BASE64) break;
          }
        }
        const contentType = dataUrl.startsWith("data:image/png") ? "image/png" : dataUrl.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
        resolve({ contentType, imageBase64: dataUrl.split(",")[1] ?? "" });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
