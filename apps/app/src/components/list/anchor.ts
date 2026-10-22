/**
 * Prepending without a jump, on iOS and Android (UI design, section 7.5): FlatList's maintainVisibleContentPosition keeps
 * the first row in view where it is when rows are put above it, from the second row on (minIndexForVisible 1), so at the
 * very top the reader's own new post still pushes the rows down. The web does this itself in anchor.web.ts, whose pure
 * arithmetic the tests check; this file gives the same keeper with what native needs: a held row is shown with
 * scrollToIndex, and the focus moves (Page Down, a removed row's) are the web's alone, since native has no such keys.
 */

export interface RowBox {
  key: string;
  top: number;
  height: number;
}

export interface ViewAnchor {
  key: string;
  offset: number;
}

export interface AnchorTarget {
  node(): unknown;
  inset(): number;
  indexOf(key: string): number;
  scrollToIndex(index: number, viewOffset: number, animated: boolean): void;
  onTop?(key: string | null): void;
  feed?: boolean;
}

export interface AnchorKeeper {
  attach(): void;
  record(): void;
  hold(key: string, offset?: number): void;
  keepNext(): void;
  releaseNext(): void;
  jumpTo(key: string, animated: boolean): void;
  toTop(animated: boolean): boolean;
  view(): ViewAnchor | null;
  ownScroll(y: number): boolean;
  dispose(): void;
}

export const ANCHOR_PROPS = { maintainVisibleContentPosition: { minIndexForVisible: 1 } };

export function keepAnchor(target: AnchorTarget): AnchorKeeper {
  const show = (key: string, offset: number, animated: boolean) => {
    const index = target.indexOf(key);
    if (index >= 0) target.scrollToIndex(index, target.inset() + offset, animated);
  };
  return {
    attach: () => undefined,
    record: () => undefined,
    hold: (key, offset = 0) => show(key, offset, false),
    keepNext: () => undefined,
    releaseNext: () => undefined,
    jumpTo: (key, animated) => show(key, 0, animated),
    // FlatList scrolls itself to its top on native.
    toTop: () => false,
    view: () => null,
    ownScroll: () => false,
    dispose: () => undefined,
  };
}
