/**
 * The faces on iOS and Android (UI design, section 4.3): every family resolves to the platform's system font until
 * sub-project 5 embeds the static files with expo-font's config plugin. An unknown family name on iOS logs an error,
 * so native never names a family it has not loaded. The web build takes fonts.web.ts instead.
 */
export const FONT_FAMILY: { display: string | undefined; text: string | undefined; mono: string | undefined } = {
  display: undefined,
  text: undefined,
  mono: undefined,
};

/** Nothing to install on native: the system font is already there. */
export function installFonts(): void {}
