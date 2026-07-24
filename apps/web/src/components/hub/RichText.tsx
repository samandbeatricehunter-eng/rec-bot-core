import { Fragment, type ReactNode } from "react";

const INLINE_STYLE_PATTERN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_STYLE_PATTERN).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("__") && part.endsWith("__")) return <u key={index}>{part.slice(2, -2)}</u>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function RichText({ text }: { text: string | null | undefined }) {
  return <>{String(text ?? "").split("\n").map((line, index, lines) => (
    <Fragment key={index}>{renderInline(line)}{index < lines.length - 1 ? <br /> : null}</Fragment>
  ))}</>;
}
