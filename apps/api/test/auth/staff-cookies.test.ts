import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { clearStaffCookies, setStaffCookies } from "../../src/auth";
import { STAFF_COOKIE_MAX_AGE_SECONDS, checkStaffCsrf, readStaffCookie } from "../../src/auth/staff/cookies";

const token = "S".repeat(43);

function app() {
  const a = new Hono();
  a.post("/set", (c) => {
    setStaffCookies(c, token);
    return c.text("ok");
  });
  a.post("/clear", (c) => {
    clearStaffCookies(c);
    return c.text("ok");
  });
  a.get("/read", (c) => c.text(readStaffCookie(c) ?? "none"));
  a.post("/csrf", (c) => c.text(checkStaffCsrf(c) ? "pass" : "fail"));
  return a;
}

/** The staff console's cookies (3a design, section 7, Every staff request), apart from the app's in name and attributes. */
describe("staff cookies", () => {
  test("both are __Host-, Secure, Path=/, SameSite=Strict, with no Domain and a Max-Age of 12 hours; the session's is HttpOnly and the CSRF cookie readable by the page", async () => {
    expect(STAFF_COOKIE_MAX_AGE_SECONDS).toBe(12 * 60 * 60);
    const cookies = (await app().request("/set", { method: "POST" })).headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    const session = cookies.find((c) => c.startsWith("__Host-korbat_staff="))!;
    const csrf = cookies.find((c) => c.startsWith("__Host-korbat_staff_csrf="))!;
    expect(session).toContain(`__Host-korbat_staff=${token};`);
    for (const line of [session, csrf]) {
      for (const attribute of ["Max-Age=43200", "Path=/", "Secure", "SameSite=Strict"]) expect(line).toContain(attribute);
      expect(line).not.toContain("Domain=");
    }
    expect(session).toContain("HttpOnly");
    expect(csrf).toMatch(/^__Host-korbat_staff_csrf=[A-Za-z0-9_-]{43};/);
    expect(csrf).not.toContain("HttpOnly");
    // A new CSRF value at every sign-in.
    const again = (await app().request("/set", { method: "POST" })).headers.getSetCookie().find((c) => c.startsWith("__Host-korbat_staff_csrf="))!;
    expect(again.split(";")[0]).not.toBe(csrf.split(";")[0]);
  });

  test("clearing expires both, with the attributes they were set with", async () => {
    const cookies = (await app().request("/clear", { method: "POST" })).headers.getSetCookie();
    expect(cookies.map((c) => c.slice(0, c.indexOf("="))).sort()).toEqual(["__Host-korbat_staff", "__Host-korbat_staff_csrf"]);
    for (const cookie of cookies) {
      for (const attribute of ["Max-Age=0", "Path=/", "Secure"]) expect(cookie).toContain(attribute);
    }
  });

  test("only the prefixed staff cookie is read; the app's session cookie is not a staff cookie", async () => {
    const read = async (cookie: string) => (await app().request("/read", { headers: { cookie } })).text();
    expect(await read(`__Host-korbat_staff=${token}`)).toBe(token);
    expect(await read(`korbat_staff=${token}`)).toBe("none");
    expect(await read(`__Host-korbat_session=${token}`)).toBe("none");
    expect(await read(`__Host-korbat_staff_csrf=${token}`)).toBe("none");
  });

  test("CSRF: the x-staff-csrf header must equal the staff CSRF cookie; the app's cookie and header do not count", async () => {
    const value = "c".repeat(43);
    const run = async (headers: Record<string, string>) => (await app().request("/csrf", { method: "POST", headers })).text();
    expect(await run({ cookie: `__Host-korbat_staff_csrf=${value}`, "x-staff-csrf": value })).toBe("pass");
    expect(await run({ cookie: `__Host-korbat_staff_csrf=${value}`, "x-staff-csrf": "d".repeat(43) })).toBe("fail");
    expect(await run({ cookie: `__Host-korbat_staff_csrf=${value}` })).toBe("fail");
    expect(await run({ "x-staff-csrf": value })).toBe("fail");
    expect(await run({ cookie: `__Host-korbat_csrf=${value}`, "x-csrf-token": value })).toBe("fail");
    expect(await run({ cookie: `__Host-korbat_csrf=${value}`, "x-staff-csrf": value })).toBe("fail");
  });
});
