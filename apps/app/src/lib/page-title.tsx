import type { ReactElement } from "react";
import Head from "expo-router/head";
import { fill, TITLE_WORDS, type TitleWord } from "./ui-words";

/**
 * Each screen's browser tab title (UI design, section 8.1, decision 16; WCAG 2.4.2), set on the client through
 * expo-router's Head, which applies the title of the screen in focus only. A title names the kind of screen and never an
 * account, so a synced browser history holds no handles. The server-rendered titles and the meta of share cards stay
 * with sub-project 2d.
 */
export function pageTitle(key: TitleWord, values: Record<string, string | number> = {}): string {
  return fill(TITLE_WORDS[key], values);
}

/**
 * The element that sets a screen's title: a screen renders what this returns once, anywhere in its tree. On native Head
 * hands the title to the system (Handoff and search on iOS) and draws nothing.
 */
export function usePageTitle(key: TitleWord, values?: Record<string, string | number>): ReactElement {
  return (
    <Head>
      <title>{pageTitle(key, values)}</title>
    </Head>
  );
}
