import { SocialErrorCode } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { SocialError, socialErrorMessage } from "../../src/social/context";

describe("social error messages", () => {
  test("every code the contracts list has a message", () => {
    for (const code of SocialErrorCode.options) expect(socialErrorMessage(code)?.length, code).toBeGreaterThan(10);
  });

  test("a page of an Explore ranking that is no longer kept is refused with explore_refreshed and the 2c design's wording", () => {
    expect(socialErrorMessage("explore_refreshed")).toBe("Explore was refreshed.");
    expect(new SocialError("explore_refreshed", 409)).toMatchObject({ code: "explore_refreshed", status: 409, message: "Explore was refreshed." });
  });
});
