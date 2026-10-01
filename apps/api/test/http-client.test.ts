import { describe, expect, test } from "vitest";
import { Browser, type RequestApp } from "./integration/http-client";

/** A stand-in for the app: records what the client sends and answers with the Set-Cookie lines it is given. */
function recorder(setCookies: string[] = []) {
  const requests: { url: string; headers: Record<string, string>; method: string }[] = [];
  const app: RequestApp = {
    request(url, init) {
      requests.push({ url, method: init?.method ?? "GET", headers: { ...(init?.headers as Record<string, string>) } });
      const headers = new Headers();
      for (const line of setCookies) headers.append("set-cookie", line);
      return new Response("{}", { headers });
    },
  };
  return { app, requests };
}

describe("the integration client's Browser", () => {
  test("by default it is the app's browser: http://localhost, echoing __Host-korbat_csrf in x-csrf-token", async () => {
    const { app, requests } = recorder(["__Host-korbat_csrf=app-csrf; Path=/; Secure; SameSite=Lax"]);
    const b = new Browser(app, "http://localhost:8081");
    await b.fetch("/api/auth/sessions");
    await b.fetch("/api/auth/signout", { json: {} });
    expect(requests[0]).toMatchObject({ url: "http://localhost/api/auth/sessions", method: "GET" });
    expect(requests[0]!.headers.host).toBe("localhost");
    expect(requests[0]!.headers.origin).toBeUndefined();
    expect(requests[1]).toMatchObject({ url: "http://localhost/api/auth/signout", method: "POST" });
    expect(requests[1]!.headers).toMatchObject({ host: "localhost", origin: "http://localhost:8081", "x-csrf-token": "app-csrf" });
  });

  test("in console mode it requests the console's base, sends its host as Host, and echoes the named cookie in the named header", async () => {
    const { app, requests } = recorder([
      "__Host-korbat_staff_csrf=staff-csrf; Path=/; Secure; SameSite=Strict",
      "__Host-korbat_csrf=app-csrf; Path=/; Secure; SameSite=Lax",
    ]);
    const b = new Browser(app, "http://console.localhost:8090", {
      base: "http://console.localhost:8090",
      csrfCookie: "__Host-korbat_staff_csrf",
      csrfHeader: "x-staff-csrf",
    });
    await b.fetch("/api/staff/me");
    await b.fetch("/api/staff/signout", { json: {} });
    await b.fetch("/api/staff/signout", { json: {}, csrf: false });
    expect(requests.map((r) => r.url)).toEqual([
      "http://console.localhost:8090/api/staff/me",
      "http://console.localhost:8090/api/staff/signout",
      "http://console.localhost:8090/api/staff/signout",
    ]);
    for (const r of requests) expect(r.headers.host).toBe("console.localhost:8090");
    expect(requests[1]!.headers).toMatchObject({ origin: "http://console.localhost:8090", "x-staff-csrf": "staff-csrf" });
    // Only the named header carries the named cookie: the app's CSRF cookie, which the browser also holds, is never echoed.
    expect(requests[1]!.headers["x-csrf-token"]).toBeUndefined();
    expect(requests[2]!.headers["x-staff-csrf"]).toBeUndefined();
    // Both cookies still travel, as a browser sends every cookie of localhost to every port.
    expect(requests[1]!.headers.cookie).toBe("__Host-korbat_staff_csrf=staff-csrf; __Host-korbat_csrf=app-csrf");
  });
});
