// Types for site-headers.mjs, which the tests import; the script itself runs in Node without a compiler.
export declare const CONSOLE_CSP: string;
export declare function isHashedPath(pathname: string): boolean;
export declare function consoleSiteHeaders(pathname: string): Record<string, string>;
