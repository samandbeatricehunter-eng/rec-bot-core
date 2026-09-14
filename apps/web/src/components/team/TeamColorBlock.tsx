import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import { TeamLogo } from "../ui/TeamLogo.js";
import { resolveTeamAppearance, type TeamAppearanceInput } from "./teamAppearance.js";

type TeamColorBlockProps = TeamAppearanceInput & {
  className?: string;
  title?: string;
  disabled?: boolean;
  /**
   * Replaces the default city/nick column entirely (still left of `trailing`).
   * Use for font-fit standings identity or league-leader player rows.
   */
  identitySlot?: ReactNode;
  /** Middle column under city/nick when using the default identity. */
  details?: ReactNode;
  /** Right-side metric (record, status chip, etc.). */
  trailing?: ReactNode;
  children?: ReactNode;
};

/**
 * Shared translucent team-color wash used by division standings, league leaders, and mgmt boards.
 * Appearance for the stock 32 NFL clubs is resolved from the central catalog; custom/relocated
 * teams pass primaryColor/logoUrl from the DB.
 */
export function TeamColorBlock({
  className,
  title,
  disabled = false,
  identitySlot,
  details,
  trailing,
  children,
  onClick,
  ...appearanceInput
}: TeamColorBlockProps & {
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
}) {
  const appearance = resolveTeamAppearance(appearanceInput);
  const style = {
    ["--team-color" as string]: appearance.primaryColor,
    ["--team-ink" as string]: appearance.inkColor,
  } as CSSProperties;
  const classes = ["hub-div-standing-team", className].filter(Boolean).join(" ");

  const identity = identitySlot ?? (
    <div className="hub-div-standing-identity">
      {appearance.city ? <small className="hub-div-standing-city">{appearance.city}</small> : null}
      <span className="hub-div-standing-nick-row">
        <strong className="hub-div-standing-nick">{appearance.nick}</strong>
      </span>
      {details}
      {children}
    </div>
  );

  const body = (
    <>
      <TeamLogo
        abbreviation={appearance.logoAbbr}
        logoUrl={appearance.logoUrl}
        alt=""
        className="hub-div-standing-logo"
        priority
      />
      {identity}
      {identitySlot ? <>{details}{children}</> : null}
      {trailing}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`${classes} is-clickable`}
        style={style}
        title={title}
        onClick={onClick}
        disabled={disabled}
      >
        {body}
      </button>
    );
  }

  return (
    <article className={classes} style={style} title={title}>
      {body}
    </article>
  );
}

export function TeamColorBlockShell({
  className,
  style,
  ...rest
}: HTMLAttributes<HTMLElement> & { style?: CSSProperties }) {
  return <article className={["hub-div-standing-team", className].filter(Boolean).join(" ")} style={style} {...rest} />;
}
