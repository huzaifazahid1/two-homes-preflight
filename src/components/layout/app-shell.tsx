"use client";

import { cn } from "cn";
import { LayoutGroup, motion } from "motion/react";
import { MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Logo } from "./logo";
import { isActive, NAV } from "./nav-items";
import { NotificationBell } from "./notification-bell";
import { SignOutButton } from "./sign-out-button";

// AppShell (P.9): bottom tab bar under 1024 px (Home, Expenses, raised + New, Money, More),
// a 248 px sidebar from 1024 px. Top bar with title and the notification bell.

export function AppShell({ children, userName, familyLabel }: { children: React.ReactNode; userName: string; familyLabel: string }) {
  const pathname = usePathname();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface px-3 py-4 lg:flex">
        <Logo href="/app" className="px-2" />
        <nav aria-label="Main" className="mt-6 flex-1">
          <ul className="space-y-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-md px-3 text-[15px]",
                      active ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon aria-hidden className="size-[18px]" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-border px-2 pt-3">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="t-small truncate text-muted-foreground">{familyLabel}</p>
          <SignOutButton variant="ghost" className="-ml-2 mt-2 h-10 px-2" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur lg:px-8">
          <div className="lg:hidden">
            <Logo href="/app" className="text-[15px]" />
          </div>
          <div className="hidden lg:block" />
          <NotificationBell />
        </header>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-28 pt-6 lg:px-8 lg:pb-12">{children}</main>
      </div>

      <BottomTabs pathname={pathname} />
    </div>
  );
}

function BottomTabs({ pathname }: { pathname: string }) {
  const tabs = [NAV[0], NAV[1], null, NAV[2]] as const;
  const moreActive = isActive(pathname, "/app/settings");
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-safe lg:hidden">
      <LayoutGroup id="tabs">
        <ul className="grid h-16 grid-cols-5">
          {tabs.map((item) =>
            item === null ? (
              <li key="new" className="flex items-start justify-center">
                <Link
                  href="/app/expenses"
                  aria-label="New expense"
                  className="-mt-4 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_14px_rgb(18_64_60/0.35)]"
                >
                  <Plus aria-hidden className="size-6" />
                </Link>
              </li>
            ) : (
              <li key={item.href}>
                <TabLink href={item.href} label={item.label} active={isActive(pathname, item.href)}>
                  <item.icon aria-hidden className="size-5" />
                </TabLink>
              </li>
            ),
          )}
          <li>
            <Drawer>
              <DrawerTrigger
                render={
                  <button type="button" className={cn("relative flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[11px]", moreActive ? "text-primary" : "text-muted-foreground")} />
                }
              >
                {moreActive ? <Indicator /> : null}
                <MoreHorizontal aria-hidden className="size-5" />
                More
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>More</DrawerTitle>
                </DrawerHeader>
                <ul className="px-4 pb-6">
                  <li>
                    <Link href="/app/settings" className="flex min-h-12 items-center rounded-md px-2 text-[15px] hover:bg-muted">
                      Settings
                    </Link>
                  </li>
                  <li className="mt-2 border-t border-border pt-2">
                    <SignOutButton variant="ghost" className="h-12 w-full justify-start px-2 text-[15px]" />
                  </li>
                </ul>
              </DrawerContent>
            </Drawer>
          </li>
        </ul>
      </LayoutGroup>
    </nav>
  );
}

function TabLink({ href, label, active, children }: { href: string; label: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("relative flex h-16 flex-col items-center justify-center gap-0.5 text-[11px]", active ? "font-medium text-primary" : "text-muted-foreground")}
    >
      {active ? <Indicator /> : null}
      {children}
      {label}
    </Link>
  );
}

function Indicator() {
  return <motion.span layoutId="tab-indicator" className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-primary" transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }} />;
}
