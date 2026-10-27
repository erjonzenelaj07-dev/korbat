import * as tokenizer from "stream-json/core/parser.js";
import type { Token } from "stream-json/core/parser.js";
import { IMPORT_RULES } from "@korbat/contracts";

/**
 * korbat's own assembler over stream-json's tokenizer (3b design, 5.5): it streams the elements of one array of a
 * data file, building one element at a time and counting its bytes and depth as it grows, so that an element over
 * 1 MiB or 64 levels is refused (item_too_large) before more of it is held. Everything outside the streamed array is
 * passed over without being held. stream-json's own Assembler and array streamer are not used: they hold an element
 * whole before its size can be read.
 *
 * The tokenizer is stream-json 3's documented raw `jsonParser` (the bare state machine; the caller decodes UTF-8),
 * with packValues off, so strings, keys and numbers arrive as chunks of at most one read. Its typings name only the
 * gen pipeline, so its shape is declared here: a function of text that returns stream-chain's many() (`values`) or none.
 */

type Tokens = { values: Token[] } | symbol;
const jsonParser = (tokenizer as unknown as { jsonParser: (options: { packValues: boolean }) => (text: string) => Tokens }).jsonParser;

/** One element went past the byte or depth cap: the adapter counts item_too_large and stops reading that file. */
export class ItemTooLarge extends Error {
  constructor() {
    super("item_too_large");
    this.name = "ItemTooLarge";
  }
}

/** Not JSON, or not the shape asked for. The tokenizer's message is never kept: it can quote the input. */
export class NotJson extends Error {
  constructor() {
    super("not_json");
    this.name = "NotJson";
  }
}

export interface JsonLimits {
  /** Characters held for one element (strings, keys and numbers by their length, one for every other token). */
  maxBytes: number;
  maxDepth: number;
}

const ITEM_LIMITS: JsonLimits = { maxBytes: IMPORT_RULES.itemMaxBytes, maxDepth: IMPORT_RULES.itemMaxDepth };
/** The end of a file is held back by this many characters, so that a trailing semicolon can be taken off it before it is parsed. */
const HOLD_BACK = 64;
const SEMICOLON = ";";

type Container = { kind: "object"; value: Record<string, unknown>; key: string | null } | { kind: "array"; value: unknown[] };

/** Builds one element from its tokens, refusing it as soon as it is too large or too deep. */
class Builder {
  private stack: Container[] = [];
  private text: string | null = null;
  private keyText: string | null = null;
  private bytes = 0;
  /** The finished element, once its last token arrived. */
  done = false;
  value: unknown = undefined;

  constructor(private readonly limits: JsonLimits) {}

  private grow(by: number): void {
    this.bytes += by;
    if (this.bytes > this.limits.maxBytes) throw new ItemTooLarge();
  }

  private place(value: unknown): void {
    const top = this.stack.at(-1);
    if (!top) {
      this.value = value;
      this.done = true;
    } else if (top.kind === "array") top.value.push(value);
    else {
      // Objects have no prototype, so a key named __proto__ is only a key.
      if (top.key === null) throw new NotJson();
      top.value[top.key] = value;
      top.key = null;
    }
  }

  private open(container: Container): void {
    this.grow(1);
    this.stack.push(container);
    if (this.stack.length > this.limits.maxDepth) throw new ItemTooLarge();
  }

  token(token: Token): void {
    switch (token.name) {
      case "startObject":
        this.open({ kind: "object", value: Object.create(null) as Record<string, unknown>, key: null });
        return;
      case "startArray":
        this.open({ kind: "array", value: [] });
        return;
      case "endObject":
      case "endArray": {
        this.grow(1);
        const top = this.stack.pop();
        if (!top) throw new NotJson();
        this.place(top.value);
        return;
      }
      case "startKey":
        this.keyText = "";
        return;
      case "endKey": {
        const top = this.stack.at(-1);
        if (!top || top.kind !== "object" || this.keyText === null) throw new NotJson();
        top.key = this.keyText;
        this.keyText = null;
        return;
      }
      case "startString":
      case "startNumber":
        this.text = "";
        return;
      case "stringChunk":
      case "numberChunk":
        this.grow(token.value.length);
        if (this.keyText !== null) this.keyText += token.value;
        else this.text += token.value;
        return;
      case "endString": {
        this.grow(1);
        const value = this.text ?? "";
        this.text = null;
        this.place(value);
        return;
      }
      case "endNumber": {
        this.grow(1);
        const value = Number(this.text);
        this.text = null;
        this.place(value);
        return;
      }
      case "nullValue":
      case "trueValue":
      case "falseValue":
        this.grow(1);
        this.place(token.value);
        return;
      default:
        // Packed values are off and the JSON tokenizer emits no whitespace tokens; anything else is not ours.
        return;
    }
  }
}

export interface StreamArrayOptions {
  /** The member of the top-level object whose array is streamed (Mastodon's orderedItems); without it, the top-level array. */
  member?: string;
  limits?: JsonLimits;
}

/**
 * The elements of one array, one at a time. Throws NotJson for a syntax error, a truncated file or another shape, and
 * ItemTooLarge for an element over a cap (after yielding every element before it).
 */
export async function* streamArray(chunks: AsyncIterable<Uint8Array>, options: StreamArrayOptions = {}): AsyncGenerator<unknown> {
  const limits = options.limits ?? ITEM_LIMITS;
  const parse = jsonParser({ packValues: false });
  const decoder = new TextDecoder("utf-8");
  const member = options.member;

  // Where the parser stands: its depth, and what the walk is doing at that depth.
  let depth = 0;
  let started = false;
  /** The depth of the streamed array's elements, once it was found. */
  let itemDepth = -1;
  let finished = false;
  /** While seeking `member`: the key being read at depth 1 (cut once it is longer than `member`), and whether it matched. */
  let key: string | null = null;
  let matched = false;
  let builder: Builder | null = null;
  const ready: unknown[] = [];

  const step = (token: Token): void => {
    if (finished) return;
    if (builder) {
      builder.token(token);
      if (builder.done) {
        ready.push(builder.value);
        builder = null;
      }
      if (token.name === "startObject" || token.name === "startArray") depth++;
      else if (token.name === "endObject" || token.name === "endArray") depth--;
      return;
    }
    if (!started) {
      started = true;
      if (member === undefined) {
        if (token.name !== "startArray") throw new NotJson();
        depth = 1;
        itemDepth = 1;
        return;
      }
      if (token.name !== "startObject") throw new NotJson();
      depth = 1;
      return;
    }
    if (itemDepth >= 0 && depth === itemDepth) {
      // Inside the streamed array, between elements.
      if (token.name === "endArray") {
        finished = true;
        return;
      }
      builder = new Builder(limits);
      step(token);
      return;
    }
    // Seeking the member, or passing over a value that is not it.
    switch (token.name) {
      case "startObject":
      case "startArray":
        if (depth === 1 && matched) {
          if (token.name !== "startArray") throw new NotJson();
          itemDepth = 2;
          depth = 2;
          matched = false;
          return;
        }
        depth++;
        matched = false;
        return;
      case "endObject":
      case "endArray":
        depth--;
        if (depth === 0) throw new NotJson();
        return;
      case "startKey":
        if (depth === 1) key = "";
        return;
      case "stringChunk":
        if (key !== null && member !== undefined && key.length <= member.length) key += token.value;
        return;
      case "endKey":
        if (key !== null) matched = key === member;
        key = null;
        return;
      case "endString":
      case "endNumber":
      case "nullValue":
      case "trueValue":
      case "falseValue":
        // A scalar member value: if it was the member, the shape is wrong.
        if (depth === 1 && matched) throw new NotJson();
        return;
      default:
        return;
    }
  };

  const feed = (text: string): void => {
    if (text === "" || finished) return;
    let result: Tokens;
    try {
      result = parse(text);
    } catch {
      throw new NotJson();
    }
    if (typeof result === "symbol") return;
    for (const token of result.values) {
      step(token);
      if (finished) return;
    }
  };

  /** Feeds `text`, then hands out every element it finished, those before a refused one included, then the refusal. */
  async function* fed(text: string): AsyncGenerator<unknown> {
    let failure: unknown = null;
    try {
      feed(text);
    } catch (err) {
      failure = err;
    }
    while (ready.length > 0) yield ready.shift();
    if (failure !== null) throw failure;
  }

  let pending = "";
  for await (const chunk of chunks) {
    pending += decoder.decode(chunk, { stream: true });
    if (pending.length > HOLD_BACK) {
      const text = pending.slice(0, pending.length - HOLD_BACK);
      pending = pending.slice(pending.length - HOLD_BACK);
      yield* fed(text);
    }
    if (finished) return;
  }
  // The end of the file: a trailing semicolon and white space are not JSON, and are taken off before the last feed.
  let tail = (pending + decoder.decode()).trimEnd();
  if (tail.endsWith(SEMICOLON)) tail = tail.slice(0, -1).trimEnd();
  yield* fed(tail);
  if (!finished) throw new NotJson();
}

/**
 * The bytes after a data file's prefix (X's `window.YTD.<name>.part<N> = `): the prefix, at most `maxBytes` bytes up to
 * and including its first " = ", must match `pattern` exactly, and is dropped.
 */
export async function* afterPrefix(chunks: AsyncIterable<Uint8Array>, pattern: RegExp, maxBytes = 256): AsyncGenerator<Uint8Array> {
  let head = Buffer.alloc(0);
  let passed = false;
  const marker = Buffer.from(" = ", "latin1");
  for await (const chunk of chunks) {
    if (passed) {
      yield chunk;
      continue;
    }
    head = Buffer.concat([head, chunk]);
    const at = head.indexOf(marker);
    if (at < 0) {
      if (head.length > maxBytes) throw new NotJson();
      continue;
    }
    const end = at + marker.length;
    if (end > maxBytes || !pattern.test(head.subarray(0, end).toString("latin1"))) throw new NotJson();
    passed = true;
    if (end < head.length) yield head.subarray(end);
  }
  if (!passed) throw new NotJson();
}
