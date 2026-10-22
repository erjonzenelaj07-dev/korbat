import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReduceMotion, useReducedMotion } from "react-native-reanimated";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_APPEARANCE, setAppearance } from "../src/lib/appearance";
import { useMotion, type Motion } from "../src/lib/motion";
import { MOTION } from "../src/theme/motion";

/**
 * useMotion() (UI design, section 5.1): one hook gives every component the motion values and whether to reduce them,
 * so no component reads either source on its own. Reduced motion has two sources, the operating system (Reanimated's
 * useReducedMotion(), mocked in test/setup.ts as a vi.fn) and the reader's own "Reduce motion: Always".
 */
function motion(): Motion {
  let found: Motion | undefined;
  const Probe = () => {
    found = useMotion();
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  if (!found) throw new Error("useMotion() gave nothing");
  return found;
}

afterEach(() => {
  vi.mocked(useReducedMotion).mockReturnValue(false);
  setAppearance(DEFAULT_APPEARANCE);
});

describe("the reduce sources", () => {
  test("neither source: motion is full", () => {
    expect(motion().reduced).toBe(false);
  });

  test("the operating system asks for reduced motion", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    expect(motion().reduced).toBe(true);
  });

  test("the reader chose Reduce motion: Always, whatever the system says", () => {
    setAppearance({ reduceMotion: "always" });
    expect(motion().reduced).toBe(true);
  });

  test("both at once", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    setAppearance({ reduceMotion: "always" });
    expect(motion().reduced).toBe(true);
  });
});

describe("the values come from theme/motion.ts", () => {
  test("springs take section 5.1's damping ratio and duration", () => {
    expect(motion().spring("springSnap")).toMatchObject({ dampingRatio: MOTION.springSnap.dampingRatio, duration: MOTION.springSnap.duration });
    expect(motion().spring("springRelease")).toMatchObject({ dampingRatio: 0.85, duration: 350 });
  });

  test("timings take their durations, the press its in and out", () => {
    expect(motion().timing("pressIn")).toMatchObject({ duration: MOTION.press.in });
    expect(motion().timing("pressOut")).toMatchObject({ duration: MOTION.press.out });
    expect(motion().timing("fade")).toMatchObject({ duration: 150 });
    expect(motion().timing("easeOut", 200)).toMatchObject({ duration: 200 });
    expect(motion().timing("easeInOut", 300)).toMatchObject({ duration: 300 });
  });

  test("korbat decides what reduced means, so Reanimated never second-guesses a timing; a spring under reduced motion lands at once", () => {
    expect(motion().timing("fade").reduceMotion).toBe(ReduceMotion.Never);
    expect(motion().spring("springSnap").reduceMotion).toBe(ReduceMotion.Never);
    setAppearance({ reduceMotion: "always" });
    expect(motion().timing("fade").reduceMotion).toBe(ReduceMotion.Never);
    expect(motion().spring("springSnap").reduceMotion).toBe(ReduceMotion.Always);
  });
});
