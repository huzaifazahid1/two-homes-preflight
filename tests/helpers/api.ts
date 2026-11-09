import { adminAuth } from "@/lib/firebase/admin";
import { POST as createSession } from "@/app/api/auth/session/route";
import { signInWithPassword } from "./emulator";

// Calls Route Handlers directly with Request objects (Section N.1 integration layer).

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>;

export class CookieJar {
  private jar = new Map<string, string>();
  absorb(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim())) || value === "";
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  get(name: string) {
    return this.jar.get(name);
  }
  set(name: string, value: string) {
    this.jar.set(name, value);
  }
  delete(name: string) {
    this.jar.delete(name);
  }
  header() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  clone() {
    const c = new CookieJar();
    for (const [k, v] of this.jar) c.set(k, v);
    return c;
  }
}

export async function call(
  handler: Handler,
  opts: { method?: string; path?: string; body?: unknown; jar?: CookieJar; params?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<{ res: Response; status: number; json: any }> {
  const url = `http://localhost:3100${opts.path ?? "/api/test"}`;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.jar) headers.cookie = opts.jar.header();
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(url, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  opts.jar?.absorb(res);
  const text = await res.clone().text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, status: res.status, json };
}

let counter = 0;

/** Creates an Auth emulator user and a session cookie for them. */
export async function signedInUser(opts: { email?: string; verified?: boolean; name?: string } = {}) {
  counter++;
  const email = opts.email ?? `owner${counter}.${Date.now()}@example.com`;
  const password = "Passw0rd!long";
  const record = await adminAuth().createUser({ email, password, emailVerified: opts.verified ?? true, displayName: opts.name });
  const idToken = await signInWithPassword(email, password);
  const jar = new CookieJar();
  const { status, json } = await call(createSession, { method: "POST", path: "/api/auth/session", body: { idToken, timeZone: "Asia/Karachi" }, jar });
  if (status !== 200) throw new Error(`session failed: ${status} ${JSON.stringify(json)}`);
  return { uid: record.uid, email, password, jar };
}
