import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { bearerToken, checkCsrf, clearSessionCookies, readSessionCookie, setSessionCookies } from "../../src/auth/cookies";

const token = `kb1_${"A".repeat(43)}`;

function app() {
  const a = new Hono();
  a.post("/set", (c) => {
    setSessionCookies(c, token, 3600);
    return c.text("ok");
  });
  a.post("/clear", (c) => {
    clearSessionCookies(c);
    return c.text("ok");
  });
  a.get("/read", (c) => c.text(readSessionCookie(c) ?? "none"));
  a.post("/csrf", (c) => c.text(checkCsrf(c, ["http://localhost:8081"]) ? "pass" : "fail"));
  a.get("/bearer", (c) => c.text(bearerToken(c) ?? "none"));
  return a;
}

describe("session cookies", () => {
  test("session cookie is __Host-, HttpOnly, Secure, SameSite=Lax; the CSRF cookie is readable by scripts", async () => {
    const cookies = (await app().request("/set", { method: "POST" })).headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("__Host-korbat_session="))!;
    const csrf = cookies.find((c) => c.startsWith("__Host-korbat_csrf="))!;
    expect(session).toContain(`__Host-korbat_session=${token}`);
    for (const attribute of ["Max-Age=3600", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) expect(session).toContain(attribute);
    expect(session).not.toContain("Domain=");
    expect(csrf).toMatch(/^__Host-korbat_csrf=[A-Za-z0-9_-]{43};/);
    expect(csrf).not.toContain("HttpOnly");
    expect(csrf).toContain("Secure");
  });
  test("only the prefixed session cookie is read", async () => {
    expect(await (await app().request("/read", { headers: { cookie: `__Host-korbat_session=${token}` } })).text()).toBe(token);
    expect(await (await app().request("/read", { headers: { cookie: `korbat_session=${token}` } })).text()).toBe("none");
  });
  test("clearing expires both cookies", async () => {
    const cookies = (await app().request("/clear", { method: "POST" })).headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) expect(cookie).toContain("Max-Age=0");
  });
});

describe("CSRF and bearer tokens", () => {
  test("CSRF needs an allowed Origin and a header equal to the cookie", async () => {
    const csrf = "c".repeat(43);
    const ok = { cookie: `__Host-korbat_csrf=${csrf}`, "x-csrf-token": csrf, origin: "http://localhost:8081" };
    const run = async (headers: Record<string, string>) => (await app().request("/csrf", { method: "POST", headers })).text();
    expect(await run(ok)).toBe("pass");
    expect(await run({ ...ok, origin: "https://evil.example" })).toBe("fail");
    expect(await run({ ...ok, "x-csrf-token": "d".repeat(43) })).toBe("fail");
    const { origin: _origin, ...withoutOrigin } = ok;
    expect(await run(withoutOrigin)).toBe("fail");
    const { "x-csrf-token": _header, ...withoutHeader } = ok;
    expect(await run(withoutHeader)).toBe("fail");
  });
  test("bearer tokens must be well-formed kb1_ tokens", async () => {
    const run = async (authorization?: string) =>
      (await app().request("/bearer", { headers: authorization ? { authorization } : {} })).text();
    expect(await run(`Bearer ${token}`)).toBe(token);
    expect(await run("Bearer kb1_short")).toBe("none");
    expect(await run(`Basic ${token}`)).toBe("none");
    expect(await run()).toBe("none");
  });
});
