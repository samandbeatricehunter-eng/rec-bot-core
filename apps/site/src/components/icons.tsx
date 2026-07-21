import type { ReactNode } from "react";

type IconProps = { className?: string; title?: string };

function base(props: IconProps, path: ReactNode) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props.title ? undefined : true}
      role={props.title ? "img" : undefined}
    >
      {props.title ? <title>{props.title}</title> : null}
      {path}
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return base(
    props,
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
    </>,
  );
}

export function IconLeagues(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.2 2.4 3.4 5.1 3.4 8.5S14.2 18.1 12 20.5C9.8 18.1 8.6 15.4 8.6 12S9.8 5.9 12 3.5Z" />
    </>,
  );
}

export function IconHeadlines(props: IconProps) {
  return base(
    props,
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M7 9h6" />
      <path d="M7 13h10" />
      <path d="M7 16h8" />
    </>,
  );
}

export function IconComp(props: IconProps) {
  return base(
    props,
    <>
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 7H4.5A2.5 2.5 0 0 1 4.5 2H7" />
      <path d="M17 7h2.5A2.5 2.5 0 0 0 19.5 2H17" />
    </>,
  );
}

export function IconAccount(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.6-3.2 4-4.8 7-4.8s5.4 1.6 7 4.8" />
    </>,
  );
}

export function IconBuzz(props: IconProps) {
  return base(
    props,
    <>
      <path d="M4 12c2.5-4 5.5-6 8-6s5.5 2 8 6c-2.5 4-5.5 6-8 6s-5.5-2-8-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>,
  );
}

export function IconMatchups(props: IconProps) {
  return base(
    props,
    <>
      <path d="M4 7h7v10H4z" />
      <path d="M13 7h7v10h-7z" />
      <path d="M11 12h2" />
    </>,
  );
}

export function IconTeam(props: IconProps) {
  return base(
    props,
    <>
      <path d="M12 3 4 7v5c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V7l-8-4Z" />
      <path d="M9 12l2 2 4-4" />
    </>,
  );
}

export function IconStore(props: IconProps) {
  return base(
    props,
    <>
      <path d="M4 9h16l-1.2 11H5.2L4 9Z" />
      <path d="M8 9V6.5A4 4 0 0 1 16 6.5V9" />
    </>,
  );
}

export function IconRetire(props: IconProps) {
  return base(
    props,
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>,
  );
}

export function IconMgmt(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3 12h2.2M18.8 12H21M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6" />
    </>,
  );
}

export function IconCaret(props: IconProps) {
  return base(props, <path d="M7 10l5 5 5-5" />);
}

export function IconBell(props: IconProps) {
  return base(
    props,
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.7 1.7 0 0 0 3.4 0" />
    </>,
  );
}
