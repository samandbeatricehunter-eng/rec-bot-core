// Bespoke line-icon set for the My Team Quick Actions panel — same 2px-stroke, currentColor,
// 24x24-viewBox convention as lucide (so they drop into IconWell unchanged), but shaped around
// what each action actually does instead of a generic stand-in icon.
type IconProps = { size?: number };

export function InterviewMicIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M8.5 21h7" />
      <path d="M18.5 6.5c1 .8 1 3.2 0 4" opacity="0.7" />
      <path d="M20.5 5c1.6 1.4 1.6 5.2 0 6.6" opacity="0.45" />
    </svg>
  );
}

export function BoxScoreIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 2.5h6a1 1 0 0 1 1 1V5H8V3.5a1 1 0 0 1 1-1Z" fill="currentColor" stroke="none" />
      <path d="M7.5 12v4" />
      <path d="M12 9.5v6.5" />
      <path d="M16.5 13.5v2.5" />
    </svg>
  );
}

export function HighlightReelIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 8 1.6-4.2A1 1 0 0 1 5.5 3H19a2 2 0 0 1 2 2v.5" />
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="m3 8 1-2.5" />
      <path d="m8 8 1-3" />
      <path d="m13 8 1-3" />
      <path d="m18 8 1-3" />
      <path d="M10.3 12.2v4.6a.6.6 0 0 0 .92.5l3.6-2.3a.6.6 0 0 0 0-1l-3.6-2.3a.6.6 0 0 0-.92.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ManageTeamIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 5.5v5c0 5 3.4 8.4 8 9.5 4.6-1.1 8-4.5 8-9.5v-5L12 2Z" />
      <circle cx="12" cy="10" r="2.2" />
      <path d="M8.3 15.5a4 3 0 0 1 7.4 0" />
    </svg>
  );
}

export function ScheduleIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17" />
      <path d="M8 2.5v4" />
      <path d="M16 2.5v4" />
      <path d="M7.5 13.2h2.2" />
      <path d="M11.9 13.2h2.2" />
      <path d="M16.3 13.2h2.2" />
      <path d="M7.5 16.8h2.2" />
      <path d="M11.9 16.8h2.2" />
    </svg>
  );
}

export function MyMatchupIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4c3 .5 5 2.3 5.6 5.3L11 16l-2 4-4.6-2 1.4-4.4L3 6.6 4 4Z" />
      <path d="M20 4c-3 .5-5 2.3-5.6 5.3L13 16l2 4 4.6-2-1.4-4.4L21 6.6 20 4Z" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RecruitingCapIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4 2 9l10 4.5L22 9 12 4Z" />
      <path d="M6 11.3V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.7" />
      <path d="M22 9v6" />
      <circle cx="22" cy="17" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SubmitArticleIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M15 3v4h4" />
      <path d="M8 12h8" />
      <path d="M8 15.2h8" />
      <path d="M8 18.4h5" />
      <path d="M8 8.8h3.5" />
    </svg>
  );
}
