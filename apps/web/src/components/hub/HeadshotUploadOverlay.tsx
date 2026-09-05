import { useRef, useState, type ReactNode } from "react";
import { readImageAsResizedBase64, HEADSHOT_ALLOWED_TYPES } from "../../lib/image-resize.js";

/** Wraps a headshot portrait so tapping it opens a file picker and uploads a replacement in
 * place -- used on the Overview page's Season Snapshot cards (offense/owner/defense) so members
 * can swap their own photos over time without a League Mgmt trip. */
export function HeadshotUploadOverlay({ onUpload, children, disabled }: {
  onUpload: (resized: { contentType: string; imageBase64: string }) => Promise<void>;
  children: ReactNode;
  disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (!(HEADSHOT_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
        setError("Must be a JPEG, PNG, or WebP image.");
        return;
      }
      const resized = await readImageAsResizedBase64(file);
      await onUpload(resized);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`hub-headshot-upload${busy ? " is-busy" : ""}${disabled ? " is-disabled" : ""}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Tap to upload a replacement photo"
      aria-disabled={disabled || busy}
      onClick={() => { if (!disabled && !busy) fileInputRef.current?.click(); }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !disabled && !busy) {
          event.preventDefault();
          fileInputRef.current?.click();
        }
      }}
    >
      {children}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(event) => { void handleFile(event.target.files?.[0]); event.target.value = ""; }}
      />
      {!disabled ? <div className="hub-headshot-upload-hint">{busy ? "Uploading…" : "Tap to change photo"}</div> : null}
      {error ? <div className="hub-headshot-upload-error">{error}</div> : null}
    </div>
  );
}
