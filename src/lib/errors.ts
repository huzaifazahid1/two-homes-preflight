// AppError codes and HTTP status mapping (Section P.2). Safe messages only:
// never put provider messages, stack traces or personal data in `message`.

export const ERROR_STATUS = {
  INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_INVALID: 400,
  PAYPAL_STATE_MISMATCH: 400,
  UNAUTHENTICATED: 401,
  LINK_SESSION_REQUIRED: 401,
  PLAN_REQUIRED: 402,
  FORBIDDEN: 403,
  EMAIL_NOT_VERIFIED: 403,
  NOT_FOUND: 404,
  STATE_CONFLICT: 409,
  DUPLICATE: 409,
  DUPLICATE_RECEIPT: 409,
  LINK_GONE: 410,
  LOCKED: 423,
  RATE_LIMITED: 429,
  UPSTREAM_FAILED: 502,
  UPLOAD_FAILED: 502,
  DB_UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export type ErrorBody = {
  error: { code: ErrorCode; message: string; requestId: string; details?: Record<string, unknown> };
};

// gRPC status codes used by Firestore (numeric) and their string forms (client SDK).
const UNAVAILABLE = new Set<unknown>([14, 4, "unavailable", "deadline-exceeded"]);
const ABORTED = new Set<unknown>([10, "aborted"]);

/** Maps unknown errors (Firestore, network) to an AppError. Unknown errors become INTERNAL. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  const code = (e as { code?: unknown } | null)?.code;
  if (UNAVAILABLE.has(code)) {
    return new AppError("DB_UNAVAILABLE", "The database is unavailable. Please try again.", { cause: e });
  }
  if (ABORTED.has(code)) {
    return new AppError("STATE_CONFLICT", "Someone else changed this at the same time. Please refresh and try again.", { cause: e });
  }
  return new AppError("INTERNAL", "Something went wrong on our side.", { cause: e });
}
