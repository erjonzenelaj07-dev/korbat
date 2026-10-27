import { readFileSync, renameSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ErrorEnvelope, ImportLineView, ImportPickView, ImportView } from "@korbat/contracts";
import { importsHarness, line, type ImportsHarness } from "./imports-harness";

vi.setConfig({ testTimeout: 120_000 });

/** A JPEG's, a PNG's and a GIF's first bytes, then filler: what the sniff reads. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const GIF = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0]);

/**
 * The preview's list, the picks and the preview's images (3b design, sections 4.4 and 9.2; 12.3): the lines' pages from the
 * intake's offsets with the intake's own rule, a pick saved with its line's facts and read back in the list and the
 * picks' counts, descriptions checked as AltText and only for images the source left without one, and the media route
 * for the owner alone, only while ready and bringing images, only for a file openWorkFile takes and that sniffs as an
 * image the preview shows.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the preview's lines, picks and images", () => {
  let h: ImportsHarness;
  beforeAll(async () => {
    h = await importsHarness({ settings: { maxActive: 100 } });
  });
  afterAll(async () => {
    await h?.close();
  });

  const refusal = async (res: Response) => [res.status, ErrorEnvelope.parse(await res.json()).error.code];
  const page = async (b: Awaited<ReturnType<ImportsHarness["ready"]>>["b"], id: string, n: number) => {
    const res = await b.fetch(`/api/imports/${id}/lines?page=${n}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: unknown[]; pages: number };
    return { lines: body.lines.map((item) => ImportLineView.parse(item)), pages: body.pages };
  };
  const pick = (b: Awaited<ReturnType<ImportsHarness["ready"]>>["b"], id: string, ref: number | string, body: unknown) => b.fetch(`/api/imports/${id}/lines/${ref}`, { method: "PUT", json: body });

  test("pages of fifty offered lines from the intake's offsets: an unreadable line is passed over, the last page is shorter, a page past the end is empty", async () => {
    const lines = Array.from({ length: 121 }, (_, ref) => (ref === 10 ? "not a line" : line(ref, ref % 7 === 1 ? { kind: "reply" } : {})));
    const { b, view } = await h.ready(lines);
    expect(view.scan?.posts).toBe(120);
    const first = await page(b, view.id, 0);
    expect(first.pages).toBe(3);
    expect(first.lines.map((item) => item.ref)).toEqual([...Array.from({ length: 10 }, (_, i) => i), ...Array.from({ length: 40 }, (_, i) => i + 11)]);
    expect(first.lines[1]).toEqual({ ref: 1, at: "2019-03-02", kind: "reply", marks: 1, text: "imported line 1", media: [], leftOut: false, alts: [] });
    const second = await page(b, view.id, 1);
    expect(second.lines.map((item) => item.ref)).toEqual(Array.from({ length: 50 }, (_, i) => i + 51));
    const third = await page(b, view.id, 2);
    expect(third.lines.map((item) => item.ref)).toEqual(Array.from({ length: 20 }, (_, i) => i + 101));
    expect((await page(b, view.id, 3)).lines).toEqual([]);
    expect(await refusal(await b.fetch(`/api/imports/${view.id}/lines?page=-1`))).toEqual([400, "invalid_request"]);
    // Someone else's import is no import; one that left ready has no list.
    const other = await h.signUp();
    expect(await refusal(await other.b.fetch(`/api/imports/${view.id}/lines?page=0`))).toEqual([404, "not_found"]);
    expect((await b.fetch(`/api/imports/${view.id}/cancel`, { method: "POST" })).status).toBe(200);
    expect(await refusal(await b.fetch(`/api/imports/${view.id}/lines?page=0`))).toEqual([409, "wrong_state"]);
  });

  test("a pick is saved with its line's month and marks and read back in the list, the pick's answer and the import's counts; a line that is not offered is not_found", async () => {
    const lines = [line(0), line(1, { kind: "reply" }), line(2, { at: "2019-05-04T00:00:00Z", warning: true, text: "Content warning: spoilers" }), "garbage", line(4)];
    const { b, view } = await h.ready(lines);
    const res = await pick(b, view.id, 1, { leftOut: true, alts: [] });
    expect(res.status).toBe(200);
    expect(ImportPickView.parse(await res.json())).toEqual({ ref: 1, leftOut: true, alts: [], picks: [{ month: "2019-03", groups: [[1, 1, 0, 0]] }] });
    expect(ImportPickView.parse(await (await pick(b, view.id, 2, { leftOut: true, alts: [] })).json()).picks).toEqual([
      { month: "2019-03", groups: [[1, 1, 0, 0]] },
      { month: "2019-05", groups: [[4, 1, 0, 0]] },
    ]);
    const listed = await page(b, view.id, 0);
    expect(listed.lines.map((item) => [item.ref, item.leftOut])).toEqual([[0, false], [1, true], [2, true], [4, false]]);
    expect(ImportView.parse(await (await b.fetch(`/api/imports/${view.id}`)).json()).picks).toEqual([
      { month: "2019-03", groups: [[1, 1, 0, 0]] },
      { month: "2019-05", groups: [[4, 1, 0, 0]] },
    ]);
    // Brought back: the line's pick stays, and counts nothing.
    expect(ImportPickView.parse(await (await pick(b, view.id, 1, { leftOut: false, alts: [] })).json()).picks).toEqual([{ month: "2019-05", groups: [[4, 1, 0, 0]] }]);
    expect(await refusal(await pick(b, view.id, 3, { leftOut: true, alts: [] }))).toEqual([404, "not_found"]);
    expect(await refusal(await pick(b, view.id, 5, { leftOut: true, alts: [] }))).toEqual([404, "not_found"]);
    expect(await refusal(await pick(b, view.id, "x", { leftOut: true, alts: [] }))).toEqual([404, "not_found"]);
    expect(await refusal(await pick(b, view.id, 0, { leftOut: "yes", alts: [] }))).toEqual([400, "invalid_request"]);
    // With images off a line takes no description.
    expect(await refusal(await pick(b, view.id, 0, { leftOut: false, alts: ["A photo"] }))).toEqual([400, "invalid_request"]);
    const other = await h.signUp();
    expect(await refusal(await pick(other.b, view.id, 0, { leftOut: true, alts: [] }))).toEqual([404, "not_found"]);
    expect((await b.fetch(`/api/imports/${view.id}/cancel`, { method: "POST" })).status).toBe(200);
    expect(await refusal(await pick(b, view.id, 0, { leftOut: true, alts: [] }))).toEqual([409, "wrong_state"]);
  });

  test("descriptions: AltText, at most four, only for an image the source left without one; the counts follow them", async () => {
    h.settings.images = true;
    let ready: Awaited<ReturnType<ImportsHarness["ready"]>>;
    try {
      ready = await h.ready([line(0, { media: [{ file: "0-0.jpg", alt: null }, { file: "0-1.png", alt: "A described chart" }, { file: "0-2.jpg", alt: null }] }), line(1)], {
        images: { "0-0.jpg": JPEG, "0-1.png": PNG },
        summary: { images: 3 },
      });
    } finally {
      h.settings.images = false;
    }
    const { b, view } = ready;
    expect((await h.row(view.id))?.images).toBe(true);
    // 0-2.jpg is missing: the intake counted it, and the line keeps two images, one described by its source.
    expect(view.scan).toMatchObject({ images: 2, imagesSkipped: { missing_file: 1 }, months: [{ month: "2019-03", groups: [[0, 2, 2, 1]] }] });
    const [listed] = (await page(b, view.id, 0)).lines;
    expect(listed!.media).toEqual([
      { file: "0-0.jpg", alt: null },
      { file: "0-1.png", alt: "A described chart" },
      { file: "0-2.jpg", alt: null },
    ]);
    const given = ImportPickView.parse(await (await pick(b, view.id, 0, { leftOut: false, alts: ["A photo of a harbour at dusk"] })).json());
    expect(given).toEqual({ ref: 0, leftOut: false, alts: ["A photo of a harbour at dusk"], picks: [{ month: "2019-03", groups: [[0, 0, 0, 1]] }] });
    expect((await page(b, view.id, 0)).lines[0]!.alts).toEqual(["A photo of a harbour at dusk"]);
    for (const alts of [[null, "Not over the source's own"], [null, null, "The missing one"], ["a", "b", "c", "d", "e"], ["   "], [String.fromCharCode(7) + "bell"], [5]]) {
      expect(await refusal(await pick(b, view.id, 0, { leftOut: false, alts })), JSON.stringify(alts)).toEqual([400, "invalid_request"]);
    }
    // Left out, the line's source-described image is counted out with it, and its given description counts no more.
    const out = ImportPickView.parse(await (await pick(b, view.id, 0, { leftOut: true, alts: ["A photo of a harbour at dusk"] })).json());
    expect(out.picks).toEqual([{ month: "2019-03", groups: [[0, 1, 1, 0]] }]);
  });

  test("the preview's images: the owner's only, while ready and bringing images, through openWorkFile, sniffed as JPEG, PNG or WebP, private and never stored", async () => {
    h.settings.images = true;
    let ready: Awaited<ReturnType<ImportsHarness["ready"]>>;
    try {
      ready = await h.ready([line(0, { media: [{ file: "0-0.jpg", alt: "One" }, { file: "0-1.jpg", alt: "Two" }, { file: "0-2.jpg", alt: "Three" }, { file: "0-3.png", alt: "Four" }] })], {
        images: { "0-0.jpg": JPEG, "0-1.jpg": PNG, "0-2.jpg": GIF, "0-3.png": new TextEncoder().encode("plain text, no image") },
      });
    } finally {
      h.settings.images = false;
    }
    const plain = await h.ready([line(0)]);
    const { b, view } = ready;
    const media = (file: string, who = b, id = view.id) => who.fetch(`/api/imports/${id}/media/${file}`);
    const jpeg = await media("0-0.jpg");
    expect(jpeg.status).toBe(200);
    expect([jpeg.headers.get("content-type"), jpeg.headers.get("cache-control"), jpeg.headers.get("x-content-type-options")]).toEqual(["image/jpeg", "private, no-store", "nosniff"]);
    expect(new Uint8Array(await jpeg.arrayBuffer())).toEqual(JPEG);
    // The bytes decide the type, never the name.
    const png = await media("0-1.jpg");
    expect([png.status, png.headers.get("content-type")]).toEqual([200, "image/png"]);
    await png.arrayBuffer();
    // A GIF, text and a name the work folder may not hold are no image of the preview.
    for (const file of ["0-2.jpg", "0-3.png", "0-0.gif", "x.jpg", "0-9.jpg"]) expect(await refusal(await media(file)), file).toEqual([404, "not_found"]);
    const other = await h.signUp();
    expect(await refusal(await media("0-0.jpg", other.b))).toEqual([404, "not_found"]);
    // An import that brings no images has none to show.
    expect(await refusal(await media("0-0.jpg", plain.b, plain.view.id))).toEqual([404, "not_found"]);
    // A media folder that is a link (a junction on Windows) to a folder holding the same file is refused.
    const elsewhere = path.join(h.root, `elsewhere-${view.id}`);
    renameSync(h.work.mediaDir(view.id), elsewhere);
    symlinkSync(elsewhere, h.work.mediaDir(view.id), "junction");
    expect(readFileSync(path.join(h.work.mediaDir(view.id), "0-0.jpg")).length).toBe(JPEG.length);
    expect(await refusal(await media("0-0.jpg"))).toEqual([404, "not_found"]);
    // Once the import has left ready, the preview's images are not shown.
    expect((await b.fetch(`/api/imports/${view.id}/cancel`, { method: "POST" })).status).toBe(200);
    expect(await refusal(await media("0-0.jpg"))).toEqual([409, "wrong_state"]);
    expect((await plain.b.fetch(`/api/imports/${plain.view.id}/cancel`, { method: "POST" })).status).toBe(200);
  });

  test("this file left no import row behind", async () => {
    const { now, before } = await h.cleanup();
    expect(now).toEqual(before);
  });
});
