import { describe, expect, test } from "vitest";
import { IMPORT_RULES } from "@korbat/contracts";
import { ItemTooLarge, NotJson, afterPrefix, streamArray } from "../src/json";

/**
 * The assembler of 5.5 over stream-json's parser: one element at a time, its bytes and depth counted as it is built,
 * refused (item_too_large) past 1 MiB or 64 levels before more is held; everything outside the streamed array is
 * passed over without being held.
 */

async function* chunked(text: string, size = 7): AsyncGenerator<Uint8Array> {
  const bytes = Buffer.from(text, "utf8");
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

async function collect(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const item of source) out.push(item);
  return out;
}

/** A source that produces `total` bytes lazily, and counts how many it was asked for. */
function lazy(head: string, fill: string, total: number, tail: string) {
  const state = { pulled: 0 };
  async function* source(): AsyncGenerator<Uint8Array> {
    yield Buffer.from(head);
    state.pulled += head.length;
    const block = Buffer.from(fill.repeat(65_536 / fill.length));
    for (let sent = 0; sent < total; sent += block.length) {
      state.pulled += block.length;
      yield block;
    }
    yield Buffer.from(tail);
  }
  return { source: source(), state };
}

describe("streamArray", () => {
  test("yields a top-level array's elements in order, strings split across chunks and multibyte characters whole", async () => {
    const snowman = String.fromCodePoint(0x2603);
    const items = await collect(streamArray(chunked(`[ {"a": 1, "b": [true, null, -2.5e3]}, "x${snowman}y", 42, {"nested": {"k": "v"}} ]`, 3)));
    expect(JSON.parse(JSON.stringify(items))).toEqual([{ a: 1, b: [true, null, -2500] }, `x${snowman}y`, 42, { nested: { k: "v" } }]);
  });

  test("yields one member's array of the top-level object and passes over the rest without holding it", async () => {
    const text = `{"@context": "x", "big": "${"z".repeat(300_000)}", "orderedItems": [{"type": "Create"}, {"type": "Announce"}], "after": [1, 2]}`;
    const items = await collect(streamArray(chunked(text, 4_096), { member: "orderedItems" }));
    expect(JSON.parse(JSON.stringify(items))).toEqual([{ type: "Create" }, { type: "Announce" }]);
  });

  test("objects are built without a prototype, so __proto__ is only a key", async () => {
    const [item] = (await collect(streamArray(chunked('[{"__proto__": {"polluted": true}, "constructor": 1}]')))) as Record<string, unknown>[];
    expect(Object.getPrototypeOf(item)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(item!["__proto__"]).toEqual({ polluted: true });
  });

  test("a trailing semicolon and white space after the top-level value are ignored, and so is a later chunk", async () => {
    const LF = String.fromCharCode(10);
    expect(await collect(streamArray(chunked(`[1, 2];${LF}`)))).toEqual([1, 2]);
    expect(await collect(streamArray(chunked(`[1, 2] ${LF}${LF}`, 64)))).toEqual([1, 2]);
    // Bytes in a later read than the one that closed the array are never parsed.
    expect(await collect(streamArray(chunked("[1, 2]" + " ".repeat(70_000) + "trailing", 65_536)))).toEqual([1, 2]);
  });

  test("a syntax error, a truncated file, or another shape is NotJson", async () => {
    await expect(collect(streamArray(chunked("[1, 2,, 3]")))).rejects.toThrow(NotJson);
    await expect(collect(streamArray(chunked("[1, 2, {")))).rejects.toThrow(NotJson);
    await expect(collect(streamArray(chunked('{"a": 1}')))).rejects.toThrow(NotJson);
    await expect(collect(streamArray(chunked("[1]"), { member: "orderedItems" }))).rejects.toThrow(NotJson);
    await expect(collect(streamArray(chunked('{"orderedItems": 3}'), { member: "orderedItems" }))).rejects.toThrow(NotJson);
  });

  test("an element over 1 MiB is refused after the elements before it, without reading the rest of a 900 MB string", async () => {
    expect(IMPORT_RULES.itemMaxBytes).toBe(1_048_576);
    const { source, state } = lazy('[{"ok": 1}, "', "a", 900_000_000, '"]');
    const seen: unknown[] = [];
    await expect(
      (async () => {
        for await (const item of streamArray(source)) seen.push(item);
      })(),
    ).rejects.toThrow(ItemTooLarge);
    expect(JSON.parse(JSON.stringify(seen))).toEqual([{ ok: 1 }]);
    expect(state.pulled).toBeLessThan(3_000_000);
  });

  test("a key of 500 MB is refused the same way", async () => {
    const { source, state } = lazy('[{"', "k", 500_000_000, '": 1}]');
    await expect(collect(streamArray(source))).rejects.toThrow(ItemTooLarge);
    expect(state.pulled).toBeLessThan(3_000_000);
  });

  test("an element just under the byte cap is kept", async () => {
    const [item] = (await collect(streamArray(chunked(`["${"b".repeat(IMPORT_RULES.itemMaxBytes - 64)}"]`, 65_536)))) as string[];
    expect(item!.length).toBe(IMPORT_RULES.itemMaxBytes - 64);
  });

  test("depth: 64 levels are kept, 65 refused, and 1,000,000 brackets refused at once", async () => {
    expect(IMPORT_RULES.itemMaxDepth).toBe(64);
    const nested = (levels: number) => "[" + "[".repeat(levels) + "]".repeat(levels) + "]";
    expect(await collect(streamArray(chunked(nested(64), 4_096)))).toHaveLength(1);
    await expect(collect(streamArray(chunked(nested(65), 4_096)))).rejects.toThrow(ItemTooLarge);
    const { source, state } = lazy("[", "[", 1_000_000, "]");
    await expect(collect(streamArray(source))).rejects.toThrow(ItemTooLarge);
    expect(state.pulled).toBeLessThan(200_000);
  });
});

describe("afterPrefix", () => {
  const PATTERN = /^window[.]YTD[.][a-z_]+[.]part[0-9]+ = $/;

  test("drops a prefix that matches exactly and passes the rest through", async () => {
    const out = await collect(afterPrefix(chunked("window.YTD.tweets.part0 = [1, 2]", 5), PATTERN));
    expect(Buffer.concat(out as Uint8Array[]).toString("utf8")).toBe("[1, 2]");
  });

  test("refuses another prefix, a prefix that is too long, and a file without one", async () => {
    await expect(collect(afterPrefix(chunked("window.YTD.Tweets.part0 = []"), PATTERN))).rejects.toThrow(NotJson);
    await expect(collect(afterPrefix(chunked("window.YTD.tweets.part0 =[]"), PATTERN))).rejects.toThrow(NotJson);
    await expect(collect(afterPrefix(chunked(`window.YTD.${"a".repeat(400)}.part0 = []`), PATTERN))).rejects.toThrow(NotJson);
    await expect(collect(afterPrefix(chunked("[1, 2]"), PATTERN))).rejects.toThrow(NotJson);
  });
});
