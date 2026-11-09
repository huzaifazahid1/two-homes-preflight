import { CreditCard, Home, ReceiptText, ScrollText, Settings, Table2, Wallet, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV: NavItem[] = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/app/expenses", label: "Expenses", icon: ReceiptText },
  { href: "/app/money", label: "Money", icon: Wallet },
  { href: "/app/ledger", label: "Ledger", icon: Table2 },
  { href: "/app/agreement", label: "Agreement", icon: ScrollText },
  { href: "/app/billing", label: "Billing", icon: CreditCard },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}
