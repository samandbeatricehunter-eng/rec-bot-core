import { Coins } from "lucide-react";
import { coinsNumber } from "@rec/shared";

type Props = {
  amount: number | null | undefined;
  signed?: boolean;
  className?: string;
  iconSize?: number;
  /** Hide the icon when the parent already shows one. */
  hideIcon?: boolean;
};

/** League economy amount with coin icon (not Stripe USD). */
export function CoinAmount({
  amount,
  signed = false,
  className,
  iconSize = 14,
  hideIcon = false,
}: Props) {
  const text = coinsNumber(amount, { signed });
  return (
    <span
      className={["rec-coin-amount", className].filter(Boolean).join(" ")}
      title={`${text} coins`}
      aria-label={`${text} coins`}
    >
      {hideIcon ? null : <Coins size={iconSize} aria-hidden className="rec-coin-amount__icon" />}
      <span className="rec-coin-amount__value">{text}</span>
    </span>
  );
}
