import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { NoticeItemStatus, UploadRefusalView } from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS, getRule, uploadNoticeParagraphs } from "@korbat/rules";
import { NoticesList } from "../src/components/moderation/CasesLists";
import { ItemLines } from "../src/components/moderation/ItemLines";
import { UploadNoticeDetail } from "../src/components/moderation/UploadNotice";
import { ComposerImages } from "../src/components/social/ComposerImages";
import { describeState, type ComposerImage } from "../src/components/social/useImageUploads";
import { ApiError, messageFor } from "../src/lib/api";
import { UPLOAD_TEXTS } from "../src/lib/moderation-words";

/**
 * A refused upload as its uploader sees it (3d design, sections 7.12, 9.5 to 9.7 and W.5; Task 7): the composer's tile
 * says the image was not accepted, shows no preview, links its notice and holds the post back; a post sent with it is
 * answered in the app's own words; the notice's screen prints UPLOAD_NOTICE's paragraphs and "Object" while an objection
 * is open; "About you" lists the refusal; and the status page of a report prints the sentence of a partly automated
 * decision in the place of 3c's.
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { push: () => undefined },
}));
vi.mock("expo-image", () => ({ Image: () => <img alt="" /> }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/ +/g, " ").trim();

const REFUSAL = "1a2b3c4d-0000-4000-8000-000000000011";
const view = (more: Partial<UploadRefusalView> = {}): UploadRefusalView => ({
  id: REFUSAL,
  refusedAt: "2026-10-18T10:05:00.000Z",
  source: "Example Hotline",
  matchKind: "exact",
  listedAs: "csam",
  objection: null,
  mayObject: true,
  endedAt: null,
  endAs: null,
  endReason: null,
  released: null,
  reportKept: false,
  ...more,
});

describe("a refused upload in the composer (9.5)", () => {
  const refused: ComposerImage = { key: "k1", previewUrl: "blob:x", alt: "a cat", status: "refused", id: "1a2b3c4d-0000-4000-8000-000000000012", error: null, refusalId: REFUSAL };

  test("its tile says [upload.refused] with the link Why to its notice, and shows no preview of the file", () => {
    const markup = html(<ComposerImages images={[refused]} onAlt={() => undefined} onRemove={() => undefined} />);
    expect(textOf(markup)).toContain(UPLOAD_TEXTS.refused);
    expect(textOf(markup)).toContain(UPLOAD_TEXTS.why);
    expect(markup).toContain(`/settings/cases/uploads/${REFUSAL}`);
    expect(markup).not.toContain("<img");
    expect(UPLOAD_TEXTS.refused).toBe("This image was not accepted.");
  });

  test("it holds the post back as a failed upload does, and a post sent with it is answered in the app's words", () => {
    expect(describeState([refused]).failed).toBe(true);
    expect(describeState([{ ...refused, status: "ready", refusalId: null }]).failed).toBe(false);
    expect(messageFor("upload_refused")).toBe("This image was not accepted, so the post was not sent. Remove the image to post. Its notice is under Settings, Cases.");
    void ApiError;
  });
});

describe("the notice's screen (9.5, W.5)", () => {
  const R2 = getRule("R2")!;

  test("it prints UPLOAD_NOTICE's paragraphs and Object while an objection is open, with no image", () => {
    const markup = html(<UploadNoticeDetail view={view()} onObject={async () => undefined} />);
    const shown = textOf(markup);
    for (const paragraph of uploadNoticeParagraphs(view(), R2.title, REDRESS_TEXTS[4])) expect(shown).toContain(textOf(paragraph));
    expect(shown).toContain(UPLOAD_TEXTS.title);
    expect(shown).toContain(UPLOAD_TEXTS.object);
    expect(markup).not.toContain("<img");
    expect(shown).not.toMatch(/is child sexual abuse material|confirmed|nobody has seen/);
  });

  test("no Object once the uploader objected, the hold ended as No report or the file was released; the objection's paragraph instead", () => {
    const objected = view({ mayObject: false, objection: { text: "x", objectedAt: "2026-10-18T11:00:00.000Z" } });
    const shown = textOf(html(<UploadNoticeDetail view={objected} onObject={async () => undefined} />));
    expect(shown).not.toContain(`${UPLOAD_TEXTS.object} `);
    expect(shown).toContain("You objected on 2026-10-18 11:00 UTC.");
    const ended = view({ mayObject: false, endAs: "no_report", endReason: "source_withdrew", endedAt: "2026-10-19T09:00:00.000Z" });
    expect(textOf(html(<UploadNoticeDetail view={ended} onObject={async () => undefined} />))).toContain("Example Hotline withdrew or corrected its entry: you can upload the image again.");
    // 3d review L7 (people5): what is written is kept as long as the terms say, the upload's record of a match, which outlasts
    // the file by matchKeepDays after a No report's end or a release.
    expect(UPLOAD_TEXTS.objectLead).toBe(
      "Write anything the admin should know. You can send one message. The admin reads it and decides without viewing the image. What you write is kept as long as this upload's record of a match (Terms, Your data).",
    );
    expect(UPLOAD_TEXTS.objectLead).not.toContain("keeps the file");
    expect(UPLOAD_TEXTS.objected("x")).toBe("You objected on x. An admin reads what you wrote; korbat tells you here what was decided, and by email when the hold is lifted.");
  });

  test('"About you" lists a refusal as "An upload was not accepted" with its day, linking its notice', () => {
    const markup = html(<NoticesList notices={[{ kind: "upload_refused", id: REFUSAL, at: "2026-10-18T10:05:00.000Z" }]} />);
    expect(textOf(markup)).toContain(`${UPLOAD_TEXTS.entry} ${UPLOAD_TEXTS.entryOn("2026-10-18")}`);
    expect(markup).toContain(`/settings/cases/uploads/${REFUSAL}`);
  });
});

describe("the status page of a report (9.6)", () => {
  const line = (more: Partial<NoticeItemStatus> = {}): NoticeItemStatus => ({
    position: 1,
    link: "http://localhost:8081/post/1a2b3c4d-0000-4000-8000-000000000013",
    scope: null,
    suspect: true,
    sealed: true,
    unseen: false,
    quotedBy: null,
    outcome: "restricted_rule",
    decidedOn: "2026-10-18",
    changed: false,
    reexamines: false,
    reexamination: null,
    rule: { id: "R2", title: "Child sexual abuse material" },
    ...more,
  });

  test("a decision recorded as partly automated prints update.automated.partly; any other prints nothing of the kind", () => {
    expect(textOf(html(<ItemLines items={[line({ automatedDecision: "partially" })]} />))).toContain(STATEMENT_WORDS.update.automated.partly);
    expect(textOf(html(<ItemLines items={[line()]} />))).not.toContain(STATEMENT_WORDS.update.automated.partly);
  });
});
