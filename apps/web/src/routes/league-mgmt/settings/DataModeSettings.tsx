import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";

type DataMode = "import" | "box_scores" | "manual";

const MODES: Array<{ value: DataMode; label: string; hint: string }> = [
  { value: "import", label: "Import", hint: "Rosters, scores, and stats are pulled from EA (OAuth or Madden Companion App). Box score submissions and manual entry are hidden for coaches; the commissioner can still always enter or fix a score manually under League Mgmt." },
  { value: "box_scores", label: "Box Scores", hint: "Coaches submit box score screenshots after each game; the commissioner can also submit on a coach's behalf." },
  { value: "manual", label: "Manual Entry", hint: "Scores and player stats are typed in directly; coaches can propose roster edits for the commissioner to approve or reject." },
];

// Bespoke (not schema-driven like settings-fields.ts) because it needs a game-aware option
// list — CFB has no EA import pipeline, so "Import" is never offered there. Madden leagues are
// Import or Manual only going forward -- Box Scores was the pre-EA-import workflow and isn't
// offered as a new choice for Madden anymore (a league already on it keeps working; this just
// stops new leagues, or an existing one switching modes, from picking it again).
export function DataModeSettings({ game, dataMode, onChange }: {
  game: string;
  dataMode: string;
  onChange: (next: DataMode) => void;
}) {
  const isMadden = game.startsWith("madden_");
  const options = isMadden ? MODES.filter((m) => m.value !== "box_scores") : MODES.filter((m) => m.value !== "import");
  const active = options.find((m) => m.value === dataMode) ?? options[0];

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Data Mode</h3>
      <p className="form-hint">How this league's game results, stats, and rosters get entered. Only the active mode's submission paths are available to coaches.</p>
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {options.map((m) => (
          <Button key={m.value} variant={m.value === active.value ? "primary" : "secondary"} onClick={() => onChange(m.value)}>
            {m.label}
          </Button>
        ))}
      </div>
      {active && <p className="form-hint" style={{ marginTop: "var(--space-2)" }}>{active.hint}</p>}
      {!isMadden && <p className="form-hint">Import isn't available for this game — there's no EA import pipeline for it.</p>}
    </Card>
  );
}
