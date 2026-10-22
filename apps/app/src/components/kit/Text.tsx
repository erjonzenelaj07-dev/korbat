import { Platform, Text as NativeText, type TextProps as NativeTextProps, type TextStyle } from "react-native";
import { useAppearance, type Appearance } from "@/lib/appearance";
import { cn } from "@/theme/cn";
import { FONT_FAMILY } from "@/theme/fonts";
import type { ColorToken } from "@/theme/tokens";

/**
 * korbat's type (UI design, sections 4.3 and 6.2): every size, line height, weight, family and tracking in the app
 * comes from the variant named here, scaled by the reader's text step and drawn in the reader's font choice. Screens
 * never write size or weight classes; test/theme.test.ts refuses them outside this file once Task 8 ends.
 */
export type TextVariant = "display-1" | "display-2" | "display-3" | "title" | "post" | "body" | "body-strong" | "meta" | "chip" | "mono";

export type TextStep = Appearance["textStep"];

type Face = keyof typeof FONT_FAMILY;

interface VariantSpec {
  face: Face;
  weight: 400 | 600 | 700;
  /** Size and line height in px at the Default step. */
  size: number;
  line: number;
  /** Letter spacing in em: tighter as the size grows, a little open below 14 px. */
  tracking: number;
  /** Fraunces' own axes, set only where the table asks for them. */
  variation?: string;
}

/**
 * The ten variants. Fraunces (the display face) is used at 22 px and up only, where its optical size reads as meant;
 * below that, emphasis comes from weight. Prose is set loose (1.53 for posts), display tight.
 */
export const VARIANTS: Record<TextVariant, VariantSpec> = {
  "display-1": { face: "display", weight: 600, size: 34, line: 40, tracking: -0.02, variation: '"SOFT" 50, "WONK" 1' },
  "display-2": { face: "display", weight: 600, size: 28, line: 34, tracking: -0.015 },
  "display-3": { face: "display", weight: 600, size: 22, line: 28, tracking: -0.01 },
  title: { face: "text", weight: 700, size: 18, line: 24, tracking: 0 },
  post: { face: "text", weight: 400, size: 17, line: 26, tracking: 0 },
  body: { face: "text", weight: 400, size: 15, line: 22, tracking: 0 },
  "body-strong": { face: "text", weight: 700, size: 15, line: 22, tracking: 0 },
  meta: { face: "text", weight: 400, size: 13, line: 18, tracking: 0.005 },
  chip: { face: "text", weight: 700, size: 12, line: 16, tracking: 0.01 },
  mono: { face: "mono", weight: 400, size: 14, line: 20, tracking: 0 },
};

/** The text-size step multiplies size and line height together. */
export const TEXT_STEPS: Record<TextStep, number> = { smaller: 0.875, default: 1, larger: 1.125, largest: 1.25 };

/** The system font, for the reader who chooses it and as every korbat face's fallback while it loads. */
export const SYSTEM_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const SYSTEM_MONO_STACK = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

/** A size at a step, rounded to whole pixels. */
export function stepped(px: number, step: TextStep): number {
  return Math.round(px * TEXT_STEPS[step]);
}

/** A web style's lengths are CSS strings: rem for sizes, so the browser's own text size scales them, and em for tracking. */
interface WebTextStyle {
  fontFamily: string;
  fontWeight: "400" | "600" | "700";
  fontSize: `${number}rem`;
  lineHeight: `${number}rem`;
  letterSpacing?: `${number}em`;
  fontVariationSettings?: string;
}

/**
 * The one cast in the type code: React Native types fontSize, lineHeight and letterSpacing as numbers, and has no
 * fontVariationSettings, while react-native-web passes CSS strings and unknown properties through to the element.
 */
function webStyle(style: WebTextStyle): TextStyle {
  return style as unknown as TextStyle;
}

/**
 * The style of a variant at the reader's step and font. On web it is written in rem and em; on native in px times the
 * step, with the system font for every face until sub-project 5 embeds korbat's (theme/fonts.ts).
 */
export function textStyle(
  variant: TextVariant,
  choice: { step: TextStep; font: Appearance["font"] },
  platform: "web" | "native" = Platform.OS === "web" ? "web" : "native",
  families: Record<Face, string | undefined> = FONT_FAMILY,
): TextStyle {
  const spec = VARIANTS[variant];
  const family = choice.font === "korbat" ? families[spec.face] : undefined;
  // Without Fraunces the display variants keep their presence by weight.
  const weight = spec.face === "display" && family === undefined ? 700 : spec.weight;
  const size = stepped(spec.size, choice.step);
  const line = stepped(spec.line, choice.step);
  if (platform === "web") {
    const stack = spec.face === "mono" ? SYSTEM_MONO_STACK : SYSTEM_STACK;
    const web: WebTextStyle = {
      fontFamily: family === undefined ? stack : `"${family}", ${stack}`,
      fontWeight: `${weight}`,
      fontSize: `${size / 16}rem`,
      lineHeight: `${line / 16}rem`,
    };
    if (spec.tracking !== 0) web.letterSpacing = `${spec.tracking}em`;
    if (spec.variation !== undefined && family !== undefined) web.fontVariationSettings = spec.variation;
    return webStyle(web);
  }
  const native: TextStyle = { fontWeight: `${weight}`, fontSize: size, lineHeight: line };
  if (family !== undefined) native.fontFamily = family;
  if (spec.tracking !== 0) native.letterSpacing = Math.round(spec.tracking * size * 100) / 100;
  return native;
}

/** What a text says about itself by colour: an ink, the accent, an error, or a status (always with its own words, section 4.8). */
export type Tone = "high" | "medium" | "low" | "accent" | "danger" | "review-ink" | "restricted-ink" | "verified-ink" | "explore-ink";

/** Each tone's colour token, for code that needs the colour itself (Icon on native). */
export const TONE_TOKEN: Record<Tone, ColorToken> = {
  high: "ink-high",
  medium: "ink-medium",
  low: "ink-low",
  accent: "accent-ink",
  danger: "danger-ink",
  "review-ink": "review-ink",
  "restricted-ink": "restricted-ink",
  "verified-ink": "verified-ink",
  "explore-ink": "explore-ink",
};

/** Each tone's class, written out whole so Tailwind finds it in the source. */
export const TONE_CLASS: Record<Tone, string> = {
  high: "text-ink-high",
  medium: "text-ink-medium",
  low: "text-ink-low",
  accent: "text-accent-ink",
  danger: "text-danger-ink",
  "review-ink": "text-review-ink",
  "restricted-ink": "text-restricted-ink",
  "verified-ink": "text-verified-ink",
  "explore-ink": "text-explore-ink",
};

/**
 * How far the operating system's text size may grow a variant on native: chrome (chips) at most 1.5 times, post
 * bodies without a cap (0), everything else twice. The web has the browser's own setting, which rem follows.
 */
const MAX_SCALE: Partial<Record<TextVariant, number>> = { chip: 1.5, post: 0 };

export interface TextProps extends NativeTextProps {
  variant?: TextVariant;
  tone?: Tone;
  /** A heading level (one level-1 heading per screen, its title), or running text. */
  as?: "p" | "h1" | "h2" | "h3" | "h4" | "span";
  /** The text face's italic, used for tombstones. */
  italic?: boolean;
  className?: string;
}

/**
 * Text in a variant and a tone. A heading is `accessibilityRole="header"` with its aria-level, which react-native-web
 * draws as h1 to h4; "p" and "span" are running text, which react-native-web draws as a block and, inside other text,
 * inline (React Native's role list has no paragraph).
 */
export function Text({ variant = "body", tone = "high", as, italic, className, style, maxFontSizeMultiplier, ...rest }: TextProps) {
  const appearance = useAppearance();
  const level = as === "h1" || as === "h2" || as === "h3" || as === "h4" ? Number(as.slice(1)) : undefined;
  return (
    <NativeText
      {...rest}
      accessibilityRole={level === undefined ? undefined : "header"}
      aria-level={level}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (Platform.OS === "web" ? undefined : (MAX_SCALE[variant] ?? 2))}
      className={cn(TONE_CLASS[tone], className)}
      style={[textStyle(variant, { step: appearance.textStep, font: appearance.font }), italic ? { fontStyle: "italic" } : null, style]}
    />
  );
}
