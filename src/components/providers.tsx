"use client";

import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";

// Client providers for the whole app: theme (system default, toggle in settings),
// reduced motion respected for every Motion animation, and toasts.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </MotionConfig>
    </ThemeProvider>
  );
}
