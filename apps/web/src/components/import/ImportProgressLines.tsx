import type { EaImportProgressEvent } from "../../lib/rec-api-client.js";
import { importProgressLines } from "../../lib/import-progress.js";

export function ImportProgressLines({ events }: { events: EaImportProgressEvent[] }) {
  return (
    <div className="import-progress-lines">
      {importProgressLines(events).map((line, index) => (
        <div
          key={`${line.text}-${index}`}
          className={line.isError ? "import-progress-line is-error" : "import-progress-line"}
        >
          <span className="import-progress-line-icon">{line.icon}</span>
          <span>{line.text}</span>
        </div>
      ))}
    </div>
  );
}
