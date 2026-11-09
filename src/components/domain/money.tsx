import { cn } from "cn";
import { formatCents } from "@/lib/money";

// Money is always rendered from integer cents in Geist Mono tabular figures (P.9).
export function Money({ cents, size = "inline", className }: { cents: number; size?: "inline" | "table" | "big"; className?: string }) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        size === "big" && "t-amount",
        size === "table" && "text-sm leading-5",
        className,
      )}
    >
      {formatCents(cents)}
    </span>
  );
}
