/** react-dom ships no types and @types/react-dom is not installed; the tests use only this function. */
declare module "react-dom/server" {
  import type { ReactNode } from "react";
  export function renderToStaticMarkup(node: ReactNode): string;
}
