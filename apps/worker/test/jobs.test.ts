import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import { JobRegistry, parseJob } from "../src/jobs";

const ctx = { log: pino({ level: "silent" }) };

describe("parseJob", () => {
  test("parses a well-formed job", () => {
    expect(parseJob('{"type":"noop","payload":{"a":1}}')).toEqual({ type: "noop", payload: { a: 1 } });
  });
  test("rejects garbage", () => {
    expect(() => parseJob("nope")).toThrow();
    expect(() => parseJob('{"payload":1}')).toThrow(/type/);
  });
});

describe("JobRegistry", () => {
  test("dispatches to the registered handler", async () => {
    const handler = vi.fn(async () => {});
    await new JobRegistry().register("noop", handler).dispatch({ type: "noop", payload: 7 }, ctx);
    expect(handler).toHaveBeenCalledWith(7, ctx);
  });
  test("rejects duplicate and unknown types", async () => {
    const r = new JobRegistry().register("a", async () => {});
    expect(() => r.register("a", async () => {})).toThrow(/duplicate/);
    await expect(r.dispatch({ type: "b", payload: null }, ctx)).rejects.toThrow(/no handler/);
  });
});
