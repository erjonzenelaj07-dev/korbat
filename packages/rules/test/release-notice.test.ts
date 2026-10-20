import { describe, expect, test } from "vitest";
import type { ReleaseNoticeView } from "@korbat/contracts";
import { RELEASE_DAY_NOTICE, RELEASE_NOTICE, releaseNoticeParagraphs } from "../src/index";

/**
 * 3d Task 2 (design, sections 7.2, 9.6, 10.8 and W.6): the author's notice of a release, in each of its forms. It says what
 * korbat did and on which ground, in the commit's own terms ("released"), and never what any authority found, who gave
 * the leave, a reference, or that korbat "no longer holds" the images or "destroyed" them: at the commit the files are
 * still in the quarantine, and a backup may hold them until the day it names.
 */
describe("the release's notice (3d Task 2)", () => {
  const base: ReleaseNoticeView = {
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
  const several: ReleaseNoticeView = { ...base, posts: [...base.posts, { id: "1a2b3c4d-0000-4000-8000-000000000004", createdAt: "2026-09-02T08:30:00.000Z" }], postCount: 3, images: 5 };
  const forms: ReleaseNoticeView[] = [base, several, { ...base, basis: "period" }, { ...several, basis: "period" }, { ...base, upload: true, posts: [], postCount: 0, images: 1 }];

  test("one post on a recorded leave: the lead, the ground, what a release is, the seal's decision and the redress", () => {
    expect(releaseNoticeParagraphs(base)).toEqual([
      "korbat has released the sealed images of your post of 2026-09-01 08:30 UTC (2 in all): it will not show them again or give them back.",
      "An admin released them on 2026-10-18 10:05 UTC. The ground is the leave or instruction of an authority or a court to destroy them. korbat erased its record of the images and destroys the files. A backup of korbat's can hold them until 2026-11-17 10:05 UTC, and longer only where an authority has korbat keep one.",
      RELEASE_NOTICE.what,
      RELEASE_NOTICE.seal,
      RELEASE_NOTICE.redress,
    ]);
  });

  test("several posts, the ground period, and a held upload each take their own lead or ground", () => {
    expect(releaseNoticeParagraphs(several)[0]).toBe("korbat has released the sealed images of 3 of your posts (5 in all): it will not show them again or give them back.");
    expect(releaseNoticeParagraphs({ ...base, basis: "period" })[1]).toBe(
      "The authority korbat had reported them to did not answer within the time korbat's terms give for that. An admin released them on 2026-10-18 10:05 UTC, as korbat told you beforehand: korbat erased its record of the images and destroys the files. A backup of korbat's can hold them until 2026-11-17 10:05 UTC, and longer only where an authority has korbat keep one.",
    );
    expect(releaseNoticeParagraphs(forms[4]!)[0]).toBe(RELEASE_NOTICE.lead.upload);
  });

  test("no form says what an authority found, names who gave the leave or a reference, or says the images are no longer held or were destroyed", () => {
    const texts = [...forms.flatMap(releaseNoticeParagraphs), RELEASE_DAY_NOTICE("2026-09-01 08:30 UTC", "2026-12-01")];
    for (const text of texts) {
      expect(text).not.toMatch(/no longer holds|destroyed|assessed|illegal|reference|@|http/i);
      expect(text).not.toMatch(/(police|prosecutor|BKA|staff member)/i);
    }
    // Every form says what korbat did in its own word, and that a person did it.
    for (const form of forms) {
      const paragraphs = releaseNoticeParagraphs(form);
      expect(paragraphs[0]).toMatch(/released/);
      expect(paragraphs).toContain("A person did this, not a program. It cannot be undone: the images cannot be shown again or given back. The text of your post is not touched.");
    }
  });
});
