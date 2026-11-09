"use client";

import { AnimatePresence, motion } from "motion/react";
import { Spinner } from "@/components/ui/spinner";

// Button label that swaps to a spinner + "Saving…" while a request runs. The width change is
// carried by `layout` so the button does not jump; the two labels cross-fade (150 ms).
export function PendingLabel({ pending, idle, busy }: { pending: boolean; idle: React.ReactNode; busy: string }) {
  return (
    <motion.span layout="size" transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }} className="inline-flex items-center gap-2">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={pending ? "busy" : "idle"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ duration: 0.15 }}
          className="inline-flex items-center gap-2"
        >
          {pending ? (
            <>
              <Spinner aria-hidden className="motion-reduce:animate-none" />
              {busy}
            </>
          ) : (
            idle
          )}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}
