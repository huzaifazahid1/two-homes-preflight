import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CookieJar, call } from "../helpers/api";
import { resetEmulators } from "../helpers/emulator";

// AZ-1: generated from the route files. Every handler declared with auth "user" returns 401
// without a session; link action endpoints return 401 without a link session.

beforeAll(resetEmulators);

const API_DIR = join(process.cwd(), "src", "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}

type Entry = { file: string; method: string; auth: string; urlPath: string; params: Record<string, string> };

const SAMPLE_TOKEN = "A".repeat(43);

function entries(): Entry[] {
  const out: Entry[] = [];
  for (const file of routeFiles(API_DIR)) {
    const src = readFileSync(file, "utf8");
    const rel = relative(API_DIR, file).split(sep).slice(0, -1);
    const params: Record<string, string> = {};
    const urlPath = `/api/${rel
      .map((seg) => {
        const m = /^\[(.+)\]$/.exec(seg);
        if (!m) return seg;
        params[m[1]] = m[1] === "token" ? SAMPLE_TOKEN : "abcdef123456";
        return params[m[1]];
      })
      .join("/")}`;
    const re = /export const (GET|POST|PATCH|PUT|DELETE) = route\(\s*\{\s*name:\s*"[^"]+",\s*auth:\s*"(\w+)"/g;
    for (const m of src.matchAll(re)) out.push({ file, method: m[1], auth: m[2], urlPath, params });
  }
  return out;
}

const all = entries();

describe("auth matrix (AZ-1)", () => {
  it("finds the route handlers", () => {
    expect(all.length).toBeGreaterThanOrEqual(15);
    // Every exported handler goes through route().
    for (const file of routeFiles(API_DIR)) {
      const src = readFileSync(file, "utf8");
      const exported = [...src.matchAll(/export (?:const|async function|function) (GET|POST|PATCH|PUT|DELETE)\b/g)].length;
      const wrapped = [...src.matchAll(/export const (GET|POST|PATCH|PUT|DELETE) = route\(/g)].length;
      expect({ file, wrapped }).toEqual({ file, wrapped: exported });
    }
  });

  for (const e of all.filter((x) => x.auth === "user")) {
    it(`${e.method} ${e.urlPath} without a session is 401`, async () => {
      const mod = await import(/* @vite-ignore */ e.file);
      const r = await call(mod[e.method], { method: e.method, path: e.urlPath, params: e.params, body: e.method === "GET" || e.method === "DELETE" ? undefined : {}, jar: new CookieJar() });
      expect(r.status).toBe(401);
      expect(r.json.error.code).toBe("UNAUTHENTICATED");
    });
  }

  it("LK-2: link action endpoints without a link session are 401 (or 404 for an unknown token)", async () => {
    const mod = await import("@/app/api/links/[token]/accept/route");
    const r = await call(mod.POST, { method: "POST", params: { token: SAMPLE_TOKEN }, body: {} });
    expect(r.status).toBe(401);
  });
});
