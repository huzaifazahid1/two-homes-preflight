import Link from "next/link";
import { cn } from "cn";

// Mark: two roofs sharing one wall, the "two homes" of the product name.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M6 22v-7.5L11.5 10 17 14.5V22" className="stroke-primary-foreground" strokeWidth="2" fill="none" strokeLinejoin="round" />
      <path d="M17 22v-5l4.5-3.5L26 17v5" className="stroke-primary-foreground" strokeWidth="2" fill="none" strokeLinejoin="round" />
      <path d="M5 22.5h22" className="stroke-primary-foreground" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ href = "/", className, compact }: { href?: string; className?: string; compact?: boolean }) {
  return (
    <Link href={href} aria-label="Two Homes Preflight, home" className={cn("inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className={compact ? "hidden min-[420px]:inline" : undefined}>Two Homes Preflight</span>
    </Link>
  );
}
