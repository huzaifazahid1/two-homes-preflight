import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Local HTTP stub for external providers (PayPal, Resend) in integration tests.
// Used instead of MSW in files that also talk to the Firestore emulator: MSW's Node interceptors
// stall the Admin SDK's gRPC (HTTP/2) channel. Providers are pointed here through their base-URL
// env vars (PAYPAL_API_BASE, RESEND_BASE_URL). See docs/decisions.md 1.x.

export type StubRequest = { method: string; path: string; query: URLSearchParams; headers: IncomingMessage["headers"]; body: string };
export type StubResponse = { status?: number; json?: unknown; headers?: Record<string, string> };
type Handler = (req: StubRequest) => StubResponse | Promise<StubResponse>;

export class StubServer {
  private server: Server | null = null;
  private handlers = new Map<string, Handler>();
  readonly calls: StubRequest[] = [];
  url = "";

  async start() {
    this.server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const u = new URL(req.url ?? "/", "http://stub");
      const sreq: StubRequest = { method: req.method ?? "GET", path: u.pathname, query: u.searchParams, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      this.calls.push(sreq);
      const h = this.handlers.get(`${sreq.method} ${sreq.path}`);
      const out = h ? await h(sreq) : { status: 404, json: { error: "no stub" } };
      res.writeHead(out.status ?? 200, { "content-type": "application/json", ...(out.headers ?? {}) });
      res.end(out.json === undefined ? "" : JSON.stringify(out.json));
    });
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this;
  }

  on(method: string, path: string, handler: Handler) {
    this.handlers.set(`${method} ${path}`, handler);
    return this;
  }

  reset() {
    this.handlers.clear();
    this.calls.length = 0;
  }

  async stop() {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}
