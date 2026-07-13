import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table(props: HTMLAttributes<HTMLTableElement>) {
  return <table className="rec-table" {...props} />;
}
export function Th(props: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th {...props} />;
}
export function Td(props: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} />;
}
