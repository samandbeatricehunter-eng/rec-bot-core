import { Modal } from "../ui/Modal.js";
import { useHighlightUpload } from "../../lib/highlight-upload-context.js";

// Direct-to-Cloudflare-Stream upload. Selecting files closes this modal and hands the
// work to HighlightUploadDrawer (bottom-left, same pattern as EA imports) so the user
// can keep using the hub while each clip shows its own progress meter.
export function HighlightUploadModal({ guildId, gameId, onClose, onSubmitted }: { guildId: string; gameId: string; onClose: () => void; onSubmitted: () => void }) {
  const uploads = useHighlightUpload();

  function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    uploads.startUploads({
      guildId,
      gameId,
      files: Array.from(fileList).slice(0, 2),
      onComplete: onSubmitted,
    });
    onClose();
  }

  return (
    <Modal title="Upload Highlight(s)" onClose={onClose}>
      <label className="form-field">
        <span className="form-label">Highlight clips (up to 2 videos, ≤45s each)</span>
        <input
          type="file"
          accept="video/*"
          multiple
          onChange={(event) => {
            onFilesSelected(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
    </Modal>
  );
}
