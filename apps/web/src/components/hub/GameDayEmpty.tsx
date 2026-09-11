/** Centered Quantico empty copy for Game Day surfaces. */
export function GameDayEmpty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="hub-gameday-empty" role="status">
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

export function offseasonEmptyCopy(stageLabel: string | null | undefined) {
  const stage = stageLabel?.trim();
  return {
    title: "This league is currently in an offseason stage.",
    detail: stage
      ? `No matchups to show here (${stage}).`
      : "No matchups to show here.",
  };
}

export function byeWeekEmptyCopy() {
  return {
    title: "Your team is on a BYE week this week.",
    detail: "No matchup to show here.",
  };
}

export function noGotwEmptyCopy() {
  return {
    title: "No Game of the Week is live for this slate.",
    detail: "Check back when voting opens.",
  };
}

export function noScheduleEmptyCopy(weekLabel: string) {
  return {
    title: `No matchups scheduled for ${weekLabel}.`,
    detail: "Pick another week or season to browse the archive.",
  };
}
