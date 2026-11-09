"use client";

import { Bell, BellOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/hooks/api";
import { useNotifications } from "@/hooks/use-notifications";

const timeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function NotificationBell() {
  const feed = useNotifications();
  const [open, setOpen] = useState(false);
  const unread = feed.items.filter((i) => !i.read);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && unread.length > 0) {
      // If marking read fails, the items stay unread (visible state) and are retried on the next open.
      api("/api/notifications/read", { method: "POST", body: { ids: unread.map((i) => i.id) } }).catch((e: unknown) =>
        console.warn("notifications: mark read failed", e),
      );
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="relative size-11" aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"} />
        }
      >
        {feed.status === "paused" ? <BellOff aria-hidden /> : <Bell aria-hidden />}
        {unread.length > 0 ? (
          <span className="absolute right-2 top-2 flex min-w-4 items-center justify-center rounded-full bg-brand-accent px-1 font-mono text-[10px] leading-4 text-white tabular-nums">
            {unread.length}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(360px,calc(100vw-32px))] p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="font-medium">Notifications</p>
        </div>
        {feed.status === "paused" ? (
          <button type="button" onClick={feed.retry} className="t-small block w-full bg-approval-bg px-4 py-2 text-left text-approval">
            Live updates paused, tap to retry
          </button>
        ) : null}
        <ul aria-live="polite" className="max-h-96 overflow-y-auto">
          {feed.items.length === 0 ? (
            <li className="t-small px-4 py-6 text-muted-foreground">
              {feed.status === "connecting" ? "Loading…" : "Nothing yet. Approvals, payments and invite updates show up here."}
            </li>
          ) : (
            feed.items.map((n) => {
              const inner = (
                <>
                  <p className="flex items-center gap-2 font-medium">
                    {!n.read ? <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-brand-accent" /> : null}
                    {n.title}
                  </p>
                  <p className="t-small text-muted-foreground">{n.body}</p>
                  {n.createdAt ? <p className="t-label mt-1 text-muted-foreground">{timeFmt.format(n.createdAt)}</p> : null}
                </>
              );
              return (
                <li key={n.id} className="border-b border-border last:border-0">
                  {n.link ? (
                    <Link href={n.link} className="block px-4 py-3 hover:bg-muted" onClick={() => setOpen(false)}>
                      {inner}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{inner}</div>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
