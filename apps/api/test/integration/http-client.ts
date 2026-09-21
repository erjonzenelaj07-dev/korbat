import { randomInt } from "node:crypto";

/** Anything with Hono's `app.request`. */
export interface RequestApp {
  request(path: string, init?: RequestInit): Response | Promise<Response>;
}

interface FetchInit {
  method?: string;
  json?: unknown;
  /** A raw body with its declared type, which is how an image is uploaded. */
  raw?: { type: string; body: Uint8Array };
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Web only: send the X-CSRF-Token header (default true). */
  csrf?: boolean;
}

/**
 * A distinct client address per test client, sent as cf-connecting-ip, so per-IP rate limits in one
 * test never affect another.
 */
export const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

/** A minimal browser: keeps cookies, sends Origin on state changes and echoes the CSRF cookie in X-CSRF-Token. */
export class Browser {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly app: RequestApp,
    private readonly origin: string,
    private readonly ip: string = randomIp(),
  ) {}

  async fetch(path: string, init: FetchInit = {}): Promise<Response> {
    const method = init.method ?? (init.json === undefined && init.raw === undefined ? "GET" : "POST");
    const headers: Record<string, string> = { "cf-connecting-ip": this.ip, ...init.headers };
    if (this.cookies.size > 0) headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (method !== "GET") headers.origin = this.origin;
    const csrf = this.cookies.get("__Host-korbat_csrf");
    if (init.csrf !== false && csrf) headers["x-csrf-token"] = csrf;
    if (init.json !== undefined) headers["content-type"] = "application/json";
    if (init.raw) headers["content-type"] = init.raw.type;
    const body = init.raw ? init.raw.body : init.json === undefined ? undefined : JSON.stringify(init.json);
    const res = await this.app.request(path, { method, headers, body });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split("; ");
      const separator = pair!.indexOf("=");
      const name = pair!.slice(0, separator);
      if (attributes.includes("Max-Age=0")) this.cookies.delete(name);
      else this.cookies.set(name, pair!.slice(separator + 1));
    }
    return res;
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

/** A native app: no cookies and no Origin header; sends the bearer token once it has one. */
export class NativeClient {
  token: string | undefined;

  constructor(
    private readonly app: RequestApp,
    private readonly ip: string = randomIp(),
  ) {}

  fetch(path: string, init: Omit<FetchInit, "csrf"> = {}): Response | Promise<Response> {
    const method = init.method ?? (init.json === undefined ? "GET" : "POST");
    const headers: Record<string, string> = { "cf-connecting-ip": this.ip };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (init.json !== undefined) headers["content-type"] = "application/json";
    return this.app.request(path, { method, headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  }
}
