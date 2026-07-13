import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ variant = "secondary", className, ...rest }: ButtonProps) {
  return <button className={["btn", `btn-${variant}`, className].filter(Boolean).join(" ")} {...rest} />;
}
