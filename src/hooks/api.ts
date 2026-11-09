"use client";

// Browser-side fetch for our own API. Parses the error shape (Section P.2) into ApiError.
// A 401 UNAUTHENTICATED on an app call sends the user to login and back (AU-4).

export type ApiErrorBody = { error: { code: string; message: string; requestId: string; details?: Record<string, unknown> } };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  fieldError(path: string): string | undefined {
    const fields = (this.details?.fields as { path: string; message: string }[] | undefined) ?? [];
    return fields.find((f) => f.path === path || f.path.endsWith(`.${path}`))?.message;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; redirectOn401?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    const form = typeof FormData !== "undefined" && init.body instanceof FormData;
    res = await fetch(path, {
      method: init.method ?? "GET",
      // FormData sets its own multipart content type with the boundary.
      headers: init.body !== undefined && !form ? { "content-type": "application/json" } : undefined,
      body: init.body === undefined ? undefined : form ? (init.body as FormData) : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "You appear to be offline. Check your connection and try again.");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, "BAD_RESPONSE", "The server sent an unexpected response. Please try again.");
  }
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    const err = new ApiError(res.status, e?.code ?? "UNKNOWN", e?.message ?? "Something went wrong. Please try again.", e?.requestId, e?.details);
    if (res.status === 401 && err.code === "UNAUTHENTICATED" && init.redirectOn401 !== false && typeof window !== "undefined") {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      // Full reload on purpose: drops all client state and Firestore listeners after auth changes.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?reason=expired&next=${next}`);
    }
    throw err;
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Something went wrong. Please try again.";
}
