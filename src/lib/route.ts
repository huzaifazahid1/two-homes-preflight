import "server-only";
import { z } from "zod";
import { requireUserFromCookie, SESSION_COOKIE, type SessionUser } from "@/lib/auth/session";
import { AppError, toAppError, type ErrorBody } from "@/lib/errors";
import { newRequestId } from "@/lib/ids";
import { LINK_SESSION_COOKIE, readLinkSession } from "@/lib/links/session";
import { createLogger, type Logger } from "@/lib/log";
import { consumeRateLimit, type Limit } from "@/lib/rate-limit";

// Route Handler wrapper (Section P.1, P.2): request id, auth, zod parsing of body/query/params,
// rate limit, error mapping and structured logging. Handlers stay thin and call a lib function.

export type AuthMode = "none" | "user" | "link" | "userOrLink";

export type RouteCtx<B, Q, P> = {
  req: Request;
  requestId: string;
  log: Logger;
  body: B;
  query: Q;
  params: P;
  /** Set when auth is "user" (always) or "userOrLink"/"none" (when a valid session exists). */
  user: SessionUser | null;
  /** Valid link session cookie, if present. Handlers check it matches their token. */
  linkSession: { tokenHash: string; expiresAt: number } | null;
  cookies: Map<string, string>;
};

type Schema = z.ZodType | undefined;
type Out<S> = S extends z.ZodType ? z.infer<S> : undefined;

export type RouteConfig<BS extends Schema, QS extends Schema, PS extends Schema> = {
  /** e.g. "POST /api/family". Used in logs and the auth matrix test. */
  name: string;
  auth: AuthMode;
  body?: BS;
  query?: QS;
  params?: PS;
  rateLimit?: (ctx: RouteCtx<Out<BS>, Out<QS>, Out<PS>>) => Limit | null;
};

type NextCtx = { params: Promise<Record<string, string | string[]>> };

export function parseCookies(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) {
      try {
        map.set(k, decodeURIComponent(v));
      } catch {
        // Malformed percent-encoding: keep the raw value; verification will reject it.
        map.set(k, v);
      }
    }
  }
  return map;
}

export function errorResponse(err: AppError, requestId: string): Response {
  const body: ErrorBody = { error: { code: err.code, message: err.message, requestId, ...(err.details ? { details: err.details } : {}) } };
  const headers: Record<string, string> = { "x-request-id": requestId, "cache-control": "no-store" };
  if (err.retryAfterSeconds) headers["retry-after"] = String(err.retryAfterSeconds);
  return Response.json(body, { status: err.status, headers });
}

function zodToAppError(e: z.ZodError, where: string): AppError {
  const fields = e.issues.map((i) => ({ path: [where, ...i.path.map(String)].join("."), message: i.message }));
  return new AppError("INVALID", fields[0]?.message ?? "Invalid request.", { details: { fields } });
}

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new AppError("INVALID", "The request body is not valid JSON.", { cause: err });
  }
}

export function route<BS extends Schema = undefined, QS extends Schema = undefined, PS extends Schema = undefined>(
  config: RouteConfig<BS, QS, PS>,
  handler: (ctx: RouteCtx<Out<BS>, Out<QS>, Out<PS>>) => Promise<Response | Record<string, unknown> | unknown[]>,
) {
  return async (req: Request, nextCtx?: NextCtx): Promise<Response> => {
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || newRequestId();
    const started = Date.now();
    const logger = createLogger({ requestId, route: config.name });
    try {
      const cookies = parseCookies(req.headers.get("cookie"));

      let user: SessionUser | null = null;
      const sessionCookie = cookies.get(SESSION_COOKIE);
      if (config.auth === "user") {
        user = await requireUserFromCookie(sessionCookie);
      } else if (sessionCookie && config.auth !== "link") {
        user = await requireUserFromCookie(sessionCookie).catch((err: unknown) => {
          // Optional session: an invalid cookie just means "not signed in" here.
          logger.debug("route.optional_session_invalid", { errorCode: (err as AppError).code });
          return null;
        });
      }
      const linkSession = config.auth === "user" ? null : readLinkSession(cookies.get(LINK_SESSION_COOKIE));

      const rawParams = nextCtx ? await nextCtx.params : {};
      const params = config.params ? config.params.safeParse(rawParams) : { success: true as const, data: undefined };
      if (!params.success) throw zodToAppError(params.error, "params");

      const url = new URL(req.url);
      const query = config.query ? config.query.safeParse(Object.fromEntries(url.searchParams)) : { success: true as const, data: undefined };
      if (!query.success) throw zodToAppError(query.error, "query");

      let body: unknown = undefined;
      if (config.body) {
        const parsed = config.body.safeParse(await readJson(req));
        if (!parsed.success) throw zodToAppError(parsed.error, "body");
        body = parsed.data;
      }

      const ctx = {
        req, requestId, log: logger.child({ uid: user?.uid }), body, query: query.data, params: params.data, user, linkSession, cookies,
      } as RouteCtx<Out<BS>, Out<QS>, Out<PS>>;

      const limit = config.rateLimit?.(ctx);
      if (limit) await consumeRateLimit(limit);

      const result = await handler(ctx);
      const res = result instanceof Response ? result : Response.json(result);
      res.headers.set("x-request-id", requestId);
      if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-store");
      logger.info("request", { method: req.method, status: res.status, outcome: "ok", durationMs: Date.now() - started });
      return res;
    } catch (raw) {
      const err = toAppError(raw);
      const level = err.status >= 500 ? "error" : "info";
      logger[level]("request", {
        method: req.method, status: err.status, errorCode: err.code, outcome: "error", durationMs: Date.now() - started,
        ...(err.status >= 500 ? { error: raw instanceof Error ? raw : String(raw), cause: err.cause instanceof Error ? err.cause : undefined } : {}),
      });
      return errorResponse(err, requestId);
    }
  };
}

/** For link action endpoints: the link session must belong to this token (LK-2). */
export function requireLinkSession(ctx: { linkSession: { tokenHash: string } | null }, tokenHash: string) {
  if (!ctx.linkSession || ctx.linkSession.tokenHash !== tokenHash) {
    throw new AppError("LINK_SESSION_REQUIRED", "Enter the code we emailed you to continue.");
  }
}
