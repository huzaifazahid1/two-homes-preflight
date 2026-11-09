"use client";

import { WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLiveRefresh, type LiveTarget } from "@/hooks/use-live-refresh";

// Mount once per page that shows live data. Renders nothing while live; a small banner when paused.
export function LiveRefresh({ target }: { target: LiveTarget }) {
  const { status, retry } = useLiveRefresh(target);
  return (
    <div aria-live="polite">
      <AnimatePresence initial={false}>
        {status === "paused" ? (
          <motion.button
            type="button"
            onClick={retry}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.14 } }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="t-small mb-4 flex min-h-11 w-full items-center gap-2 rounded-[10px] border border-border bg-surface-2 px-4 text-left text-muted-foreground hover:text-foreground"
          >
            <WifiOff aria-hidden className="size-4 shrink-0" />
            Live updates paused. Tap to retry.
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
