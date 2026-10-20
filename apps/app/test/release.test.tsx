import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { ReleaseNoticeView } from "@korbat/contracts";
import { RELEASE_NOTICE, releaseNoticeParagraphs } from "@korbat/rules";
import { NoticesList } from "../src/components/moderation/CasesLists";
import { ReleaseNoticeDetail } from "../src/components/moderation/ReleaseNotice";
import { RELEASE_TEXTS } from "../src/lib/moderation-words";

/**
 * A release of sealed images as its author reads it (3d design, sections 7.2, 9.6 and W.6; Task 2): the notice's screen
 * prints RELEASE_NOTICE's paragraphs and no control, links the decision that sealed, and says [release.appeal] while an
 * appeal of that decision waits; "About you" lists the release as "Sealed images released" with its day. Nothing names an
 * authority, a reference or an assessment, and no image is drawn.
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { push: () => undefined },
}));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/ +/g, " ").trim();

const view: ReleaseNoticeView = {
  id: "1a2b3c4d-0000-4000-8000-000000000001",
  basis: "leave",
  releasedAt: "2026-10-18T10:05:00.000Z",
  backupsClearAt: "2026-11-17T10:05:00.000Z",
  upload: false,
  posts: [{ id: "1a2b3c4d-0000-4000-8000-000000000002", createdAt: "2026-09-01T08:30:00.000Z" }],
  postCount: 1,
  images: 2,
  sealDecisionId: "1a2b3c4d-0000-4000-8000-000000000003",
};

describe("a release's notice in the app (3d Task 2)", () => {
  test("the screen prints the notice's paragraphs, links the decision that sealed, and offers no control", () => {
    const markup = html(<ReleaseNoticeDetail view={view} appealOpen={false} />);
    const shown = textOf(markup);
    for (const paragraph of releaseNoticeParagraphs(view)) expect(shown).toContain(textOf(paragraph));
    expect(shown).toContain(RELEASE_TEXTS.title);
    expect(markup).toContain(`/settings/cases/${view.sealDecisionId}`);
    expect(shown).not.toContain(RELEASE_TEXTS.appeal);
    expect(markup).not.toMatch(/<img|<button/);
    expect(shown).not.toMatch(/no longer holds|destroyed|assessed|illegal|reference/i);
  });

  test("[release.appeal] while an appeal of the sealing decision waits", () => {
    expect(textOf(html(<ReleaseNoticeDetail view={view} appealOpen />))).toContain(RELEASE_TEXTS.appeal);
    expect(RELEASE_TEXTS.appeal).toBe("Your appeal is still open. An admin reviews it; korbat has released the images and will not show them again.");
  });

  test('"About you" lists a release as "Sealed images released" with its day, linking its notice, and nothing while there is none', () => {
    const markup = html(<NoticesList notices={[{ kind: "release", id: view.id, at: view.releasedAt }]} />);
    expect(textOf(markup)).toContain(`${RELEASE_TEXTS.entry} ${RELEASE_TEXTS.entryOn("2026-10-18")}`);
    expect(markup).toContain(`/settings/cases/releases/${view.id}`);
    expect(html(<NoticesList notices={[]} />)).toBe("");
    expect(RELEASE_NOTICE.what).toContain("A person did this, not a program.");
  });
});
