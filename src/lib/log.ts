import "server-only";

// Structured JSON logs (Section P.3). Redacts emails (keeps domain), tokens, codes,
// secrets, agreement text and receipt contents. Never log raw request bodies.

type Level = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const REDACT_KEYS = /token|secret|password|code|otp|authorization|cookie|private|apikey|api_key|text|quote|content|body|idtoken/i;
const KEEP_KEYS = new Set(["requestId", "route", "familyId", "outcome", "durationMs", "status", "errorCode", "debug_id", "debugId", "method", "event", "machine", "from", "to", "statusCode"]);
const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export function redactEmail(value: string): string {
  return value.replace(EMAIL_RE, (_m, _first: string, domain: string) => `***@${domain}`);
}

export function redact(value: unknown, key = "", depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (key && !KEEP_KEYS.has(key) && REDACT_KEYS.test(key)) return "[redacted]";
  if (typeof value === "string") return redactEmail(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, "", depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactEmail(value.message) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k, depth + 1);
    return out;
  }
  return value;
}

function write(level: Level, msg: string, fields: LogFields) {
  if (process.env.VITEST && level === "debug") return;
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...(redact(fields) as LogFields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export type Logger = {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
};

export function createLogger(base: LogFields = {}): Logger {
  return {
    debug: (m, f = {}) => write("debug", m, { ...base, ...f }),
    info: (m, f = {}) => write("info", m, { ...base, ...f }),
    warn: (m, f = {}) => write("warn", m, { ...base, ...f }),
    error: (m, f = {}) => write("error", m, { ...base, ...f }),
    child: (f) => createLogger({ ...base, ...f }),
  };
}

export const log = createLogger();
