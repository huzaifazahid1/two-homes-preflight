import { afterEach } from "vitest";
import { resetClock } from "@/lib/clock";
import { clearMemoryOutbox } from "@/lib/email/outbox";

// Every integration file starts from a known state; clocks and outbox never leak between tests.
afterEach(() => {
  resetClock();
  clearMemoryOutbox();
});
