import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/** public/theme-boot.js, the plain script index.html loads before anything else (UI design, section 4.2). */
export const BOOT_FILE = path.resolve(import.meta.dirname, "..", "public", "theme-boot.js");

/** What theme-boot.js did to the page: the html element's classes, attributes and inline style, and the theme-color meta. */
export interface BootResult {
  classes: string[];
  attributes: Record<string, string>;
  style: Record<string, string>;
  themeColor: string | null;
}

/**
 * Runs theme-boot.js in a fresh vm context that stands in for a browser at the top of the head: a document with an
 * html element and a head, localStorage holding `stored` under korbat.appearance (or throwing, as a blocked store
 * does), and matchMedia answering whether the system is dark (or missing). It gives the script exactly the browser
 * surface it may use, so a script that reaches for anything else fails here.
 */
export function runThemeBoot(options: { stored?: string | null; systemDark?: boolean; storageThrows?: boolean; noMatchMedia?: boolean } = {}): BootResult {
  const classes = new Set<string>();
  const attributes: Record<string, string> = {};
  const style: Record<string, string> = {};
  const metas: { name: string | null; attrs: Record<string, string> }[] = [];
  const element = (tag: string) => {
    const attrs: Record<string, string> = {};
    const made = {
      tagName: tag.toUpperCase(),
      attrs,
      get name() {
        return attrs.name ?? null;
      },
      setAttribute(name: string, value: string) {
        attrs[name] = String(value);
      },
      getAttribute(name: string) {
        return name in attrs ? attrs[name]! : null;
      },
    };
    return made;
  };
  const document = {
    documentElement: {
      classList: {
        add: (...names: string[]) => names.forEach((name) => classes.add(name)),
        remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
        contains: (name: string) => classes.has(name),
      },
      setAttribute(name: string, value: string) {
        attributes[name] = String(value);
      },
      style,
    },
    head: {
      appendChild(child: ReturnType<typeof element>) {
        metas.push({ name: child.name, attrs: child.attrs });
        return child;
      },
    },
    createElement: element,
    querySelector(selector: string) {
      const named = /^meta\[name="([^"]+)"\]$/.exec(selector);
      if (!named) throw new Error(`theme-boot.js asked for an unexpected selector: ${selector}`);
      const found = metas.find((meta) => meta.attrs.name === named[1]);
      return found ? { setAttribute: (name: string, value: string) => void (found.attrs[name] = String(value)) } : null;
    },
  };
  const storage = {
    getItem: (key: string) => (key === "korbat.appearance" ? (options.stored ?? null) : null),
  };
  const context: Record<string, unknown> = { document };
  Object.defineProperty(context, "localStorage", {
    get() {
      if (options.storageThrows) throw new Error("The operation is insecure.");
      return storage;
    },
  });
  if (!options.noMatchMedia) context.matchMedia = (query: string) => ({ matches: query === "(prefers-color-scheme: dark)" ? Boolean(options.systemDark) : false });
  context.window = context;
  vm.runInNewContext(readFileSync(BOOT_FILE, "utf8"), context, { filename: "theme-boot.js" });
  const themeColor = metas.find((meta) => meta.attrs.name === "theme-color")?.attrs.content ?? null;
  return { classes: [...classes].sort(), attributes, style, themeColor };
}
