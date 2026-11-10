import "server-only";
import { ApiError, Client, Environment, OrdersController, PaymentsController, SubscriptionsController } from "@paypal/paypal-server-sdk";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { appAccessToken, PayPalError } from "./http";

// PayPal Server SDK client (Section G.11): Orders, Payments (refunds) and Subscriptions.
// - The access token comes from our own cache in http.ts (one token for SDK and REST calls,
//   refreshed 60 s before expiry), so the SDK never fetches tokens itself.
// - The SDK has no base-URL option. When PAYPAL_API_BASE is not the sandbox host (tests point it
//   at a local stub), every request URL is rewritten before it is sent. Because tokens come from
//   http.ts, which also honours PAYPAL_API_BASE, no request can reach the real PayPal in tests.
// - Timeout per attempt, and retries for 5xx/timeouts on our keyed (idempotent) calls.

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

/** What controllers need from a client (structural; the SDK does not export its interface). */
type ClientInterface = Pick<Client, "getRequestBuilderFactory">;

let cached: { client: ClientInterface; base: string } | null = null;

function build(): ClientInterface {
  const e = env();
  const client = new Client({
    environment: Environment.Sandbox,
    timeout: e.PAYPAL_TIMEOUT_MS,
    clientCredentialsAuthCredentials: {
      oAuthClientId: e.PAYPAL_CLIENT_ID,
      oAuthClientSecret: e.PAYPAL_CLIENT_SECRET,
      // Asked again whenever the token below "expires"; http.ts answers from its cache.
      oAuthTokenProvider: async () => ({
        accessToken: await appAccessToken(),
        tokenType: "Bearer",
        expiry: BigInt(Math.floor(Date.now() / 1000) + 30),
      }),
    },
    httpClientOptions: {
      timeout: e.PAYPAL_TIMEOUT_MS,
      retryConfig: {
        maxNumberOfRetries: 2,
        retryInterval: 0.3,
        backoffFactor: 3,
        maximumRetryWaitTime: 5,
        retryOnTimeout: true,
        httpStatusCodesToRetry: [408, 500, 502, 503, 504],
        // Every POST we send through the SDK carries a PayPal-Request-Id (or is a status-guarded cancel).
        httpMethodsToRetry: ["GET", "POST"],
      },
    },
  });
  if (e.PAYPAL_API_BASE === SANDBOX_BASE) return client;

  const factory = client.getRequestBuilderFactory();
  const base = e.PAYPAL_API_BASE;
  const redirected: typeof factory = (...args) => {
    const builder = factory(...args);
    builder.interceptRequest((request) => ({ ...request, url: request.url.replace(SANDBOX_BASE, base) }));
    return builder;
  };
  return { getRequestBuilderFactory: () => redirected };
}

function client(): ClientInterface {
  const base = env().PAYPAL_API_BASE;
  if (!cached || cached.base !== base) cached = { client: build(), base };
  return cached.client;
}

export const orders = () => new OrdersController(client());
export const payments = () => new PaymentsController(client());
export const subscriptions = () => new SubscriptionsController(client());

type ErrorPayload = { name?: string; debug_id?: string; details?: { issue?: string }[] };

/** SDK failures become the same PayPalError as REST calls, so one mapping (paypalAppError) applies. */
export async function sdkCall<T>(what: string, fn: () => Promise<{ result: T; statusCode: number }>, requestId?: string): Promise<{ result: T; statusCode: number }> {
  const started = Date.now();
  try {
    const res = await fn();
    log.info("paypal.sdk", { requestId, what, status: res.statusCode, durationMs: Date.now() - started });
    return res;
  } catch (err) {
    if (err instanceof ApiError) {
      const body = (err.result ?? parseBody(err.body)) as ErrorPayload | undefined;
      const issues = (body?.details ?? []).map((d) => d.issue).filter((x): x is string => Boolean(x));
      const debugId = body?.debug_id ?? headerOf(err.headers, "paypal-debug-id");
      log.warn("paypal.sdk_failed", { requestId, what, status: err.statusCode, paypalName: body?.name, issues, debug_id: debugId, durationMs: Date.now() - started });
      throw new PayPalError(err.statusCode, body?.name ?? null, issues, debugId);
    }
    log.warn("paypal.sdk_network_error", { requestId, what, durationMs: Date.now() - started, error: err });
    throw new PayPalError(0, null, [], null, [], true);
  }
}

function parseBody(body: unknown): unknown {
  if (typeof body !== "string" || !body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function headerOf(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null;
  const k = Object.keys(headers).find((h) => h.toLowerCase() === name);
  return k ? headers[k] : null;
}

/** Tests only. */
export function resetPayPalSdk() {
  cached = null;
}
