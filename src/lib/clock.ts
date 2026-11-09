// The only source of "now" on the server. Tests replace it with setClock().
// Every time decision goes through this function and src/lib/state/effective.ts.

type ClockFn = () => Date;

const systemClock: ClockFn = () => new Date();
let current: ClockFn = systemClock;

export function now(): Date {
  return current();
}

export function nowMs(): number {
  return current().getTime();
}

/** Tests only. Pass a fixed Date or a function. */
export function setClock(value: Date | ClockFn) {
  current = typeof value === "function" ? value : () => new Date(value.getTime());
}

export function resetClock() {
  current = systemClock;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
